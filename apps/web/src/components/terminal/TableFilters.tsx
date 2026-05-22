import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";

import { getAssetDisplayName } from "@launchpad/shared";
import { useDispatch, useSelector } from "react-redux";

import styles from "./TableFilters.module.css";
import { LEVERAGE_OPTIONS } from "../../config/constants";
import { useAvailableUnderlyingAssets } from "../../hooks/useAssets";
import {
  clearTokenFilters,
  selectActiveFilter,
  selectTokenFilters,
  selectTokenSort,
  setTokenDirectionFilter,
  setTokenLeverageFilter,
  setTokenSort,
  setTokenUnderlyingFilter,
} from "../../state/uiSlice";
import { cn } from "../../utils/format";
import AssetIcon from "../shared/AssetIcon";

import type { UnderlyingAsset, Leverage } from "../../config/constants";
import type { TokenSort } from "../../services/tokenService";
import type { Direction } from "../../services/types";

/** Exactly one transient filter popover can be open at a time. */
type OpenPopover = null | "sort" | "market" | "leverage" | "direction";

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
  /** Wrapper containing both the trigger button and popover. */
  anchorRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  align?: "left" | "right";
  children: ReactNode;
}

/** Gap between anchor and popover, in px. */
const POPOVER_OFFSET_PX = 4;

/** Minimum gutter between popover and viewport edge. */
const VIEWPORT_GUTTER_PX = 8;

/**
 * Lightweight anchored popover: parent owns open state, outside-click/Esc close.
 * Fixed positioning keeps it out of the horizontally-scrollable rail's overflow box.
 */
function FilterPopover({
  anchorRef,
  onClose,
  align = "left",
  children,
}: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties | null>(null);

  // Measure before paint and listen to capture-phase scroll so the popover tracks rail/page scrolling.
  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      // Cap width to the space available from the anchored edge to the viewport gutter.
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

  // Suppress first paint until the anchor has been measured.
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

/** Tab-aware label for the abstract default sort. */
function defaultSortLabel(
  activeFilter: ReturnType<typeof selectActiveFilter>,
): string {
  return activeFilter === "graduated" ? "RECENTLY GRADUATED" : "24H VOLUME";
}

/** Explicit sort labels mirror table column names. */
function explicitSortLabel(sort: Exclude<TokenSort, "default">): string {
  if (sort === "mcap") return "MCAP";
  if (sort === "volume24h") return "24H VOLUME";
  return "24H CHANGE";
}

export default function TableFilters() {
  const dispatch = useDispatch();
  const filters = useSelector(selectTokenFilters);
  const activeFilter = useSelector(selectActiveFilter);
  const tokenSort = useSelector(selectTokenSort);
  const availableAssets = useAvailableUnderlyingAssets();
  const [open, setOpen] = useState<OpenPopover>(null);

  const sortRef = useRef<HTMLDivElement | null>(null);
  const marketRef = useRef<HTMLDivElement | null>(null);
  const leverageRef = useRef<HTMLDivElement | null>(null);
  const directionRef = useRef<HTMLDivElement | null>(null);

  // NEW and GRADUATING have fixed API ordering, so sort controls would be misleading.
  const showSortTrigger =
    activeFilter === "trending" || activeFilter === "graduated";

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
  const handleSelectSort = (next: TokenSort) => {
    dispatch(setTokenSort(next));
    closeAll();
  };

  const sortTriggerLabel =
    tokenSort === "default"
      ? defaultSortLabel(activeFilter)
      : explicitSortLabel(tokenSort);

  return (
    <div className={styles.rail} role="group" aria-label="Filter tokens">
      {showSortTrigger && (
        <div className={styles.triggerWrap} ref={sortRef}>
          <FilterTrigger
            label="Sort"
            value={sortTriggerLabel}
            // Default sort is the tab's natural ordering, so keep the trigger neutral.
            active={tokenSort !== "default"}
            open={open === "sort"}
            onClick={() => toggle("sort")}
          />
          {open === "sort" && (
            <FilterPopover anchorRef={sortRef} onClose={closeAll}>
              <div className={styles.popoverHeader}>Sort by</div>
              <div className={styles.optionList}>
                <OptionRow
                  selected={tokenSort === "default"}
                  onClick={() => handleSelectSort("default")}
                >
                  <span>{defaultSortLabel(activeFilter)}</span>
                </OptionRow>
                {/* TRENDING already defaults to 24H VOLUME; show the explicit row only on GRADUATED. */}
                {activeFilter === "graduated" && (
                  <OptionRow
                    selected={tokenSort === "volume24h"}
                    onClick={() => handleSelectSort("volume24h")}
                  >
                    <span>{explicitSortLabel("volume24h")}</span>
                  </OptionRow>
                )}
                <OptionRow
                  selected={tokenSort === "mcap"}
                  onClick={() => handleSelectSort("mcap")}
                >
                  <span>{explicitSortLabel("mcap")}</span>
                </OptionRow>
                <OptionRow
                  selected={tokenSort === "change24h"}
                  onClick={() => handleSelectSort("change24h")}
                >
                  <span>{explicitSortLabel("change24h")}</span>
                </OptionRow>
              </div>
            </FilterPopover>
          )}
        </div>
      )}

      <div className={styles.triggerWrap} ref={marketRef}>
        <FilterTrigger
          label="Market"
          value={
            filters.underlying ? getAssetDisplayName(filters.underlying) : null
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
              {availableAssets.map((a) => (
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
