import { describe, expect, it } from "vitest";

import {
  MAX_NAV_STACK,
  NAV_CALLBACK,
  backHomeMarkup,
  backHomeRow,
  clearNavStack,
  popNavSnapshot,
  pushNavSnapshot,
  replyWithNav,
  type NavSnapshot,
  type NavStackSession,
} from "../../lib/nav.js";
import type { AppContext } from "../../bot.js";

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

describe("backHomeMarkup", () => {
  it("wraps backHomeRow in a single-row inline_keyboard reply_markup", () => {
    const markup = backHomeMarkup();
    expect(markup).toEqual({ inline_keyboard: [backHomeRow()] });
    expect(markup.inline_keyboard).toHaveLength(1);
    expect(markup.inline_keyboard[0]).toHaveLength(2);
  });
});

describe("replyWithNav", () => {
  it("defaults reply_markup to backHomeMarkup() when caller passes no extras", async () => {
    const replies: Array<{ text: string; extra: unknown }> = [];
    const ctx = {
      reply: async (text: string, extra: unknown) => {
        replies.push({ text, extra });
        return { message_id: 1 };
      },
    } as unknown as AppContext;

    await replyWithNav(ctx, "prompt");

    expect(replies).toHaveLength(1);
    expect((replies[0]!.extra as { reply_markup: unknown }).reply_markup).toEqual(
      backHomeMarkup(),
    );
  });

  it("respects a caller-supplied reply_markup instead of overriding it", async () => {
    const replies: Array<{ text: string; extra: unknown }> = [];
    const ctx = {
      reply: async (text: string, extra: unknown) => {
        replies.push({ text, extra });
        return { message_id: 1 };
      },
    } as unknown as AppContext;

    const custom = { inline_keyboard: [[{ text: "X", callback_data: "x" }]] };
    await replyWithNav(ctx, "prompt", { reply_markup: custom });

    expect((replies[0]!.extra as { reply_markup: unknown }).reply_markup).toBe(
      custom,
    );
  });

  it("forwards parse_mode and link_preview_options unchanged", async () => {
    const replies: Array<{ extra: unknown }> = [];
    const ctx = {
      reply: async (_text: string, extra: unknown) => {
        replies.push({ extra });
        return { message_id: 1 };
      },
    } as unknown as AppContext;

    await replyWithNav(ctx, "prompt", {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });

    const extra = replies[0]!.extra as {
      parse_mode: string;
      link_preview_options: { is_disabled: boolean };
    };
    expect(extra.parse_mode).toBe("HTML");
    expect(extra.link_preview_options).toEqual({ is_disabled: true });
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
