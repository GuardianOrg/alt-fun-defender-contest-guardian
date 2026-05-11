import { afterEach, describe, expect, it, vi } from "vitest";

type NavigatorOverrides = {
  userAgentData?: { platform: string };
  platform?: string;
  userAgent?: string;
};

async function loadPlatformWith(overrides: NavigatorOverrides) {
  const stub: NavigatorOverrides = {};
  if (overrides.userAgentData)
    stub.userAgentData = overrides.userAgentData;
  if (overrides.platform !== undefined) stub.platform = overrides.platform;
  if (overrides.userAgent !== undefined) stub.userAgent = overrides.userAgent;

  vi.stubGlobal("navigator", stub);
  vi.resetModules();
  return await import("./platform");
}

describe("platform detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("flags macOS via userAgentData (modern Chromium)", async () => {
    const { IS_APPLE_PLATFORM, SEARCH_SHORTCUT_LABEL } = await loadPlatformWith({
      userAgentData: { platform: "macOS" },
      platform: "Win32", // intentional mismatch — UA-Client-Hints wins
      userAgent: "Mozilla/5.0",
    });
    expect(IS_APPLE_PLATFORM).toBe(true);
    expect(SEARCH_SHORTCUT_LABEL).toBe("⌘K");
  });

  it("flags Windows via userAgentData", async () => {
    const { IS_APPLE_PLATFORM, SEARCH_SHORTCUT_LABEL } = await loadPlatformWith({
      userAgentData: { platform: "Windows" },
      platform: "Win32",
      userAgent: "Mozilla/5.0",
    });
    expect(IS_APPLE_PLATFORM).toBe(false);
    expect(SEARCH_SHORTCUT_LABEL).toBe("Ctrl+K");
  });

  it("falls back to navigator.platform on Safari/Firefox (no userAgentData)", async () => {
    const { IS_APPLE_PLATFORM, SEARCH_SHORTCUT_LABEL } = await loadPlatformWith({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });
    expect(IS_APPLE_PLATFORM).toBe(true);
    expect(SEARCH_SHORTCUT_LABEL).toBe("⌘K");
  });

  it("returns Ctrl+K for Linux", async () => {
    const { IS_APPLE_PLATFORM, SEARCH_SHORTCUT_LABEL } = await loadPlatformWith({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });
    expect(IS_APPLE_PLATFORM).toBe(false);
    expect(SEARCH_SHORTCUT_LABEL).toBe("Ctrl+K");
  });

  it("returns Ctrl+K for Windows even when navigator.platform is empty", async () => {
    const { IS_APPLE_PLATFORM, SEARCH_SHORTCUT_LABEL } = await loadPlatformWith({
      platform: "",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    });
    expect(IS_APPLE_PLATFORM).toBe(false);
    expect(SEARCH_SHORTCUT_LABEL).toBe("Ctrl+K");
  });

  it("flags iPad via userAgent regex when platform is empty", async () => {
    const { IS_APPLE_PLATFORM, SEARCH_SHORTCUT_LABEL } = await loadPlatformWith({
      platform: "",
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    expect(IS_APPLE_PLATFORM).toBe(true);
    expect(SEARCH_SHORTCUT_LABEL).toBe("⌘K");
  });

  // Regression: the module is imported eagerly by `Header.tsx`, so even a
  // brief SSR / Node import (e.g. Vite `ssr: { external: false }`, future
  // Vitest setup that pre-imports components) must not throw on `navigator`
  // being undefined. The implementation guards with a `typeof` check; this
  // pins the behaviour so the guard can't be removed silently.
  it("returns Ctrl+K when navigator is unavailable (SSR / Node)", async () => {
    vi.stubGlobal("navigator", undefined);
    vi.resetModules();
    const { IS_APPLE_PLATFORM, SEARCH_SHORTCUT_LABEL } = await import(
      "./platform"
    );
    expect(IS_APPLE_PLATFORM).toBe(false);
    expect(SEARCH_SHORTCUT_LABEL).toBe("Ctrl+K");
  });
});
