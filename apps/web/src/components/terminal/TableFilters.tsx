import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";

import { getAssetDisplayName } from "@launchpad/shared";
import { useDispatch, useSelector } from "react-redux";

import styles from "./TableFilters.module.css";
import { LEVERAGE_OPTIONS, UNDERLYING_ASSETS } from "../../config/constants";
import { useLiveUnderlyings } from "../../hooks/useAssets";
import {
  clearTokenFilters,
  selectTokenFilters,
  setTokenDirectionFilter,
  setTokenLeverageFilter,
  setTokenUnderlyingFilter,
} from "../../state/uiSlice";
import { cn } from "../../utils/format";
import AssetIcon from "../shared/AssetIcon";

import type { UnderlyingAsset, Leverage } from "../../config/constants";
import type { Direction } from "../../services/types";

/**
 * Tracks which filter trigger has an open popover. Exactly one popover is
 * visible at a time — opening one closes another, the same way the search
 * + earnings panels in `uiSlice` work. Local state (not Redux) because the
 * open-popover is transient UI: nothing else in the app cares which one is
 * showing, and there's no value in keeping it across remounts.
 */
type OpenPopover = null | "market" | "leverage" | "direction";

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="10"
    height="10"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      transform: open ? "rotate(180deg)" : "rotate(0deg)",
      transition: "transform 0.15s ease",
    }}
  >
    <polyline points="6 8 10 12 14 8" />
  </svg>
);

const CheckIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

interface PopoverProps {
  /** Wrapper that contains both the trigger button and this popover. */
  anchorRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  align?: "left" | "right";
  children: ReactNode;
}

/** Gap between the anchor's bottom edge and the popover's top edge, in px.
 *  Mirrors the legacy `top: calc(100% + 0.4rem)` rule that lived in the
 *  CSS module when the popover was still absolutely positioned. */
const POPOVER_OFFSET_PX = 4;

/** Minimum gutter between the popover's outer edge and the viewport
 *  edge it grows toward. Keeps the popover from sitting flush against
 *  the screen on narrow viewports when the trigger is near a corner. */
const VIEWPORT_GUTTER_PX = 8;

/**
 * Anchored popover used by all three filter triggers. Mirrors the
 * lightweight pattern from `DocsMenu` / `SettingsPopup`: outside-click +
 * Esc closes, parent owns open state, no scrim or focus trap. We ignore
 * clicks inside the trigger wrapper so a second click on the same trigger
 * cleanly closes the popover (without racing the document `mousedown`
 * that would otherwise re-open it on the trailing click event).
 *
 * Positioning is `position: fixed` driven by the anchor's
 * `getBoundingClientRect()`, NOT `position: absolute` against the
 * trigger wrap. The absolutely-positioned version got vertically
 * clipped whenever the rail scrolled sideways on narrow viewports:
 * the rail's `overflow-x: auto` forces `overflow-y` to compute to
 * `auto` too (CSS spec rule — the two axes can't disagree on
 * visibility), so anything dropping below the rail's bottom edge
 * gets cut off. Fixed positioning escapes the rail's overflow box
 * via the viewport, and a scroll-capture listener keeps the popover
 * glued to the trigger as the rail or the page scrolls.
 */
function FilterPopover({
  anchorRef,
  onClose,
  align = "left",
  children,
}: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties | null>(null);

  // `useLayoutEffect` so the first paint already has correct coords —
  // a one-frame jump from (0, 0) to the anchor's location otherwise
  // shows up as a visible flicker on open. Capture-phase `scroll`
  // listener catches scrolls on any element in the document
  // (including the rail's own overflow scroll on narrow viewports),
  // not just the window — so the popover follows the trigger when
  // the user side-scrolls the filter rail under it.
  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      // Cap the popover's width at the space available between the
      // anchored edge and the opposite side of the viewport (minus a
      // small gutter). Without this, a right-aligned popover whose
      // `min-width` exceeds the distance from the trigger's right
      // edge to the viewport's left edge would overflow past the
      // outer container on narrow screens.
      if (align === "right") {
        setPosition({
          position: "fixed",
          top: rect.bottom + POPOVER_OFFSET_PX,
          right: Math.max(window.innerWidth - rect.right, VIEWPORT_GUTTER_PX),
          maxWidth: Math.max(rect.right - VIEWPORT_GUTTER_PX, 0),
        });
      } else {
        setPosition({
          position: "fixed",
          top: rect.bottom + POPOVER_OFFSET_PX,
          left: Math.max(rect.left, VIEWPORT_GUTTER_PX),
          maxWidth: Math.max(
            window.innerWidth - rect.left - VIEWPORT_GUTTER_PX,
            0,
          ),
        });
      }
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchorRef, align]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Two-way contain check: the popover is now `position: fixed`
      // and lives outside the trigger's clipping box, but it's still
      // a DOM descendant of the same `.triggerWrap` (since we don't
      // portal). The `anchor.contains` check already covers clicks
      // on the popover via the trigger-wrap relationship, but the
      // `popoverRef` check is kept as a defensive belt — if a future
      // refactor portals this out of the trigger wrap, the popover-
      // click path still won't accidentally close itself.
      const anchor = anchorRef.current;
      const popover = popoverRef.current;
      if (anchor?.contains(target)) return;
      if (popover?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose]);

  // Suppress the first paint until `useLayoutEffect` has measured the
  // anchor — otherwise the popover briefly flashes at the viewport's
  // top-left before snapping to the correct coordinates.
  if (!position) return null;

  return (
    <div
      ref={popoverRef}
      className={styles.popover}
      style={position}
      role="menu"
    >
      {children}
    </div>
  );
}

interface TriggerProps {
  label: string;
  value: string | null;
  active: boolean;
  open: boolean;
  onClick: () => void;
}

function FilterTrigger({ label, value, active, open, onClick }: TriggerProps) {
  return (
    <button
      type="button"
      className={cn(
        styles.trigger,
        active && styles.triggerActive,
        open && styles.triggerOpen,
      )}
      onClick={onClick}
      aria-haspopup="menu"
      aria-expanded={open}
    >
      <span className={styles.triggerLabel}>{label}</span>
      <span className={styles.triggerValue}>{value ?? "All"}</span>
      <ChevronIcon open={open} />
    </button>
  );
}

interface OptionRowProps {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}

function OptionRow({ selected, onClick, children }: OptionRowProps) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      className={cn(styles.option, selected && styles.optionSelected)}
      onClick={onClick}
    >
      <span className={styles.optionContent}>{children}</span>
      {selected && (
        <span className={styles.optionCheck} aria-hidden="true">
          <CheckIcon />
        </span>
      )}
    </button>
  );
}

/**
 * Three-trigger filter rail rendered on the right side of the home-page
 * `CommandBar`. Replaces the old "X tokens live" counter — counting all
 * launched tokens stopped scaling visually once the catalogue grew, and
 * the space reads more useful as a discovery affordance than as a
 * vanity metric.
 *
 * Each trigger anchors a small popover with a single-select option list:
 *   - Market: every supported underlying (HYPE, ETH, BTC, GOLD, …), with
 *     LT-live filtering so retired BounceTech markets don't show up.
 *   - Leverage: 2× / 3× / 5×.
 *   - Direction: Long / Short.
 *
 * "All" at the top of each list clears that facet. Selecting any other
 * row updates Redux and the home-page `useInfiniteTokens` query refetches
 * server-side (the API supports `?underlying=` / `?leverage=` /
 * `?direction=` directly — see `apps/api/src/routes/tokens/list.ts`).
 *
 * Below `1240px` the rail wraps onto its own row directly under the
 * lifecycle tabs (see the matching media queries in
 * `CommandBar.module.css` and `TableFilters.module.css`). On those
 * narrower viewports the rail and tabs would crowd each other on a
 * single line, so the bar collapses into two sub-bands inside the
 * same `tableSection` frame — tabs on top, filter rail underneath,
 * with horizontal overflow scroll on each so the affordances never
 * disappear entirely on phone-width viewports.
 */
export default function TableFilters() {
  const dispatch = useDispatch();
  const filters = useSelector(selectTokenFilters);
  const [open, setOpen] = useState<OpenPopover>(null);

  const marketRef = useRef<HTMLDivElement | null>(null);
  const leverageRef = useRef<HTMLDivElement | null>(null);
  const directionRef = useRef<HTMLDivElement | null>(null);

  // Match the live-LT filter applied to the create flow + token list
  // (issue #621). Underlyings BounceTech hasn't surfaced on their UI
  // shouldn't be selectable as a facet either — picking one would just
  // return an empty page. We always keep the currently-selected
  // underlying in the list so a transient `liveUnderlyings` refetch
  // can't pull the active selection out from under the user.
  const liveUnderlyings = useLiveUnderlyings();
  const visibleAssets = useMemo(() => {
    if (!liveUnderlyings) return UNDERLYING_ASSETS;
    return UNDERLYING_ASSETS.filter(
      (a) => liveUnderlyings.has(a) || a === filters.underlying,
    );
  }, [liveUnderlyings, filters.underlying]);

  const hasActiveFilters =
    filters.underlying !== undefined ||
    filters.leverage !== undefined ||
    filters.direction !== undefined;
  const activeCount =
    (filters.underlying !== undefined ? 1 : 0) +
    (filters.leverage !== undefined ? 1 : 0) +
    (filters.direction !== undefined ? 1 : 0);

  const toggle = (panel: OpenPopover) => {
    setOpen((current) => (current === panel ? null : panel));
  };

  const closeAll = () => setOpen(null);

  const handleSelectUnderlying = (next: UnderlyingAsset | undefined) => {
    dispatch(setTokenUnderlyingFilter(next));
    closeAll();
  };
  const handleSelectLeverage = (next: Leverage | undefined) => {
    dispatch(setTokenLeverageFilter(next));
    closeAll();
  };
  const handleSelectDirection = (next: Direction | undefined) => {
    dispatch(setTokenDirectionFilter(next));
    closeAll();
  };

  return (
    <div className={styles.rail} role="group" aria-label="Filter tokens">
      <div className={styles.triggerWrap} ref={marketRef}>
        <FilterTrigger
          label="Market"
          value={
            filters.underlying
              ? getAssetDisplayName(filters.underlying)
              : null
          }
          active={filters.underlying !== undefined}
          open={open === "market"}
          onClick={() => toggle("market")}
        />
        {open === "market" && (
          <FilterPopover anchorRef={marketRef} onClose={closeAll}>
            <div className={styles.popoverHeader}>Market</div>
            <div className={styles.optionList}>
              <OptionRow
                selected={filters.underlying === undefined}
                onClick={() => handleSelectUnderlying(undefined)}
              >
                <span>All markets</span>
              </OptionRow>
              {visibleAssets.map((a) => (
                <OptionRow
                  key={a}
                  selected={filters.underlying === a}
                  onClick={() => handleSelectUnderlying(a)}
                >
                  <AssetIcon
                    asset={a}
                    size={18}
                    className={styles.optionIcon}
                    monogramRatio={0.48}
                  />
                  <span>{getAssetDisplayName(a)}</span>
                </OptionRow>
              ))}
            </div>
          </FilterPopover>
        )}
      </div>

      <div className={styles.triggerWrap} ref={leverageRef}>
        <FilterTrigger
          label="Leverage"
          value={filters.leverage !== undefined ? `${filters.leverage}×` : null}
          active={filters.leverage !== undefined}
          open={open === "leverage"}
          onClick={() => toggle("leverage")}
        />
        {open === "leverage" && (
          <FilterPopover anchorRef={leverageRef} onClose={closeAll}>
            <div className={styles.popoverHeader}>Leverage</div>
            <div className={styles.optionList}>
              <OptionRow
                selected={filters.leverage === undefined}
                onClick={() => handleSelectLeverage(undefined)}
              >
                <span>All leverages</span>
              </OptionRow>
              {LEVERAGE_OPTIONS.map((l) => (
                <OptionRow
                  key={l}
                  selected={filters.leverage === l}
                  onClick={() => handleSelectLeverage(l)}
                >
                  <span className={styles.leverageBadge}>{l}×</span>
                </OptionRow>
              ))}
            </div>
          </FilterPopover>
        )}
      </div>

      <div className={styles.triggerWrap} ref={directionRef}>
        <FilterTrigger
          label="Direction"
          value={
            filters.direction === "long"
              ? "Long"
              : filters.direction === "short"
                ? "Short"
                : null
          }
          active={filters.direction !== undefined}
          open={open === "direction"}
          onClick={() => toggle("direction")}
        />
        {open === "direction" && (
          <FilterPopover
            anchorRef={directionRef}
            onClose={closeAll}
            align="right"
          >
            <div className={styles.popoverHeader}>Direction</div>
            <div className={styles.optionList}>
              <OptionRow
                selected={filters.direction === undefined}
                onClick={() => handleSelectDirection(undefined)}
              >
                <span>Both directions</span>
              </OptionRow>
              <OptionRow
                selected={filters.direction === "long"}
                onClick={() => handleSelectDirection("long")}
              >
                <span className={cn(styles.directionDot, styles.dotMint)} />
                <span>Long</span>
              </OptionRow>
              <OptionRow
                selected={filters.direction === "short"}
                onClick={() => handleSelectDirection("short")}
              >
                <span className={cn(styles.directionDot, styles.dotRed)} />
                <span>Short</span>
              </OptionRow>
            </div>
          </FilterPopover>
        )}
      </div>

      {hasActiveFilters && (
        <button
          type="button"
          className={styles.clearButton}
          onClick={() => {
            dispatch(clearTokenFilters());
            closeAll();
          }}
          aria-label={`Clear ${activeCount} active filter${activeCount === 1 ? "" : "s"}`}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <span>Clear</span>
        </button>
      )}
    </div>
  );
}
