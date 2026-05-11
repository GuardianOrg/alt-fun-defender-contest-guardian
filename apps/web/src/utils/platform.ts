/**
 * Platform detection helpers, used to render OS-appropriate UI affordances
 * (notably the search-modal keyboard hint in the header — Apple platforms
 * show ⌘K, everyone else shows Ctrl+K). The actual key handler accepts both
 * `metaKey` and `ctrlKey` regardless of OS, so misdetecting here only affects
 * the displayed hint, never functionality.
 *
 * Detection order:
 *   1. `navigator.userAgentData.platform` (modern UA-Client-Hints, Chromium).
 *   2. `navigator.platform` (legacy but reliable on Safari and Firefox where
 *      UA-Client-Hints isn't shipped).
 *   3. `navigator.userAgent` regex as a last-resort fallback.
 *
 * Detection is module-scope memoised: the platform doesn't change during a
 * session, so we don't need a hook or reactive subscription.
 */

type NavigatorWithUaData = Navigator & {
  userAgentData?: { platform?: string };
};

function detectIsApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;

  const uaData = (navigator as NavigatorWithUaData).userAgentData;
  if (uaData?.platform) {
    return /mac|ios|iphone|ipad|ipod/i.test(uaData.platform);
  }

  const platform = navigator.platform ?? "";
  if (platform) {
    return /mac|iphone|ipad|ipod/i.test(platform);
  }

  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent ?? "");
}

export const IS_APPLE_PLATFORM = detectIsApplePlatform();

/**
 * Display string for the meta/ctrl modifier in keyboard-shortcut hints.
 * `⌘` on Apple platforms, `Ctrl` everywhere else.
 */
export const META_KEY_LABEL = IS_APPLE_PLATFORM ? "⌘" : "Ctrl";

/**
 * Combined label for the search-modal shortcut. We keep the `+` on non-Apple
 * builds (`Ctrl+K`) because `CtrlK` reads as a typo, but omit it on Apple
 * builds (`⌘K`) where the symbol carries the modifier semantics on its own —
 * this matches macOS menubar conventions.
 */
export const SEARCH_SHORTCUT_LABEL = IS_APPLE_PLATFORM ? "⌘K" : "Ctrl+K";
