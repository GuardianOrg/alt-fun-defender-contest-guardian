import { describe, expect, it } from "vitest";

import {
  MAX_NAV_STACK,
  NAV_CALLBACK,
  backHomeRow,
  clearNavStack,
  popNavSnapshot,
  pushNavSnapshot,
  type NavSnapshot,
  type NavStackSession,
} from "../../lib/nav.js";

const sampleSnap = (label: string): NavSnapshot => ({
  text: `screen ${label}`,
  keyboard: [
    [{ text: label, callback_data: `cb:${label}` }],
  ],
});

describe("backHomeRow", () => {
  it("renders [← Back] [🏠 Home] with the global nav callback ids", () => {
    const row = backHomeRow();
    expect(row).toHaveLength(2);
    expect(row[0]).toEqual({
      text: "← Back",
      callback_data: NAV_CALLBACK.back,
    });
    expect(row[1]).toEqual({
      text: "🏠 Home",
      callback_data: NAV_CALLBACK.home,
    });
  });

  it("keeps both callback payloads well inside Telegram's 64-byte budget", () => {
    for (const b of backHomeRow()) {
      expect(b.callback_data.length).toBeLessThanOrEqual(64);
    }
  });
});

describe("pushNavSnapshot", () => {
  it("appends snapshots in push order", () => {
    const session: NavStackSession = {};
    pushNavSnapshot(session, sampleSnap("A"));
    pushNavSnapshot(session, sampleSnap("B"));
    expect(session.navStack?.map((s) => s.text)).toEqual([
      "screen A",
      "screen B",
    ]);
  });

  it("caps the stack at MAX_NAV_STACK, dropping the oldest entries", () => {
    const session: NavStackSession = {};
    for (let i = 0; i < MAX_NAV_STACK + 3; i++) {
      pushNavSnapshot(session, sampleSnap(`${i}`));
    }
    expect(session.navStack).toHaveLength(MAX_NAV_STACK);
    // The first three pushes should have rolled off the bottom.
    expect(session.navStack?.[0]?.text).toBe("screen 3");
  });
});

describe("popNavSnapshot", () => {
  it("returns the most recently pushed snapshot and shrinks the stack", () => {
    const session: NavStackSession = {};
    pushNavSnapshot(session, sampleSnap("A"));
    pushNavSnapshot(session, sampleSnap("B"));
    const popped = popNavSnapshot(session);
    expect(popped?.text).toBe("screen B");
    expect(session.navStack).toHaveLength(1);
  });

  it("returns undefined when the stack is empty", () => {
    const session: NavStackSession = {};
    expect(popNavSnapshot(session)).toBeUndefined();
  });
});

describe("clearNavStack", () => {
  it("empties the stack so subsequent Back calls fall through to Home", () => {
    const session: NavStackSession = {};
    pushNavSnapshot(session, sampleSnap("A"));
    pushNavSnapshot(session, sampleSnap("B"));
    clearNavStack(session);
    expect(session.navStack).toEqual([]);
    expect(popNavSnapshot(session)).toBeUndefined();
  });
});
