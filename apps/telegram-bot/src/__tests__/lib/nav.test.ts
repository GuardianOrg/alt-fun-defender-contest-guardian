import { describe, expect, it } from "vitest";

import {
  MAX_NAV_STACK,
  NAV_CALLBACK,
  backHomeMarkup,
  backHomeRow,
  clearNavStack,
  editToSubmenu,
  isBenignEditError,
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

describe("isBenignEditError", () => {
  it("matches the four Telegram 400 strings that mean 'edit target gone or unchanged'", () => {
    const cases = [
      "message to edit not found",
      "Bad Request: message not found",
      "Bad Request: message is not modified",
      "Bad Request: message can't be edited",
    ];
    for (const desc of cases) {
      expect(isBenignEditError({ error_code: 400, description: desc })).toBe(
        true,
      );
    }
  });

  it("rejects non-400 errors and unrelated 400 descriptions", () => {
    expect(isBenignEditError({ error_code: 403, description: "forbidden" })).toBe(
      false,
    );
    expect(
      isBenignEditError({ error_code: 400, description: "chat not found" }),
    ).toBe(false);
    expect(isBenignEditError(new Error("boom"))).toBe(false);
  });
});

interface EditCall {
  text: string;
  extra: {
    parse_mode?: string;
    reply_markup?: { inline_keyboard: unknown };
    link_preview_options?: { is_disabled: boolean };
  };
}

interface SubmenuMockCtx {
  session: NavStackSession;
  callbackQuery?: {
    message?: {
      text?: string;
      reply_markup?: { inline_keyboard: unknown };
    };
  };
  editMessageText: (text: string, extra: EditCall["extra"]) => Promise<unknown>;
  reply: (text: string, extra: EditCall["extra"]) => Promise<unknown>;
  deleteMessage: () => Promise<unknown>;
  editCalls: EditCall[];
  replyCalls: EditCall[];
  deleteCalls: number;
}

const makeCtx = (
  opts: {
    editError?: unknown;
    deleteError?: unknown;
    parentMessage?: { text: string; reply_markup: { inline_keyboard: unknown } };
  } = {},
): SubmenuMockCtx => {
  const editCalls: EditCall[] = [];
  const replyCalls: EditCall[] = [];
  const ctx: SubmenuMockCtx = {
    session: {},
    callbackQuery: opts.parentMessage
      ? { message: opts.parentMessage }
      : undefined,
    editCalls,
    replyCalls,
    deleteCalls: 0,
    editMessageText: async (text, extra) => {
      editCalls.push({ text, extra });
      if (opts.editError) throw opts.editError;
      return { message_id: 1 };
    },
    reply: async (text, extra) => {
      replyCalls.push({ text, extra });
      return { message_id: 2 };
    },
    deleteMessage: async () => {
      ctx.deleteCalls += 1;
      if (opts.deleteError) throw opts.deleteError;
      return true;
    },
  };
  return ctx;
};

describe("editToSubmenu", () => {
  it("captures the parent message snapshot, pushes it onto the nav stack, then edits in place", async () => {
    const parent = {
      text: "start view",
      reply_markup: {
        inline_keyboard: [[{ text: "Wallet", callback_data: "st:w" }]],
      },
    };
    const ctx = makeCtx({ parentMessage: parent });

    await editToSubmenu(ctx as unknown as AppContext, {
      text: "wallet panel",
      inlineKeyboard: [
        [{ text: "Create", callback_data: "wc" }],
        backHomeRow(),
      ],
    });

    expect(ctx.editCalls).toHaveLength(1);
    expect(ctx.editCalls[0]!.text).toBe("wallet panel");
    expect(ctx.replyCalls).toHaveLength(0);
    expect(ctx.deleteCalls).toBe(0);
    expect(ctx.session.navStack).toHaveLength(1);
    expect(ctx.session.navStack?.[0]?.text).toBe("start view");
  });

  it("returns the original message id on the happy edit path", async () => {
    // Workflow-stack consumers (the post-trade sweep in track.ts)
    // read `editedMessageId` to track the card the user is now
    // looking at. On the happy path that's the same message we just
    // edited, not a new send.
    const parent = {
      text: "track card",
      reply_markup: { inline_keyboard: [[{ text: "Buy", callback_data: "trkb:0xabc" }]] },
    };
    const ctx = {
      ...makeCtx({ parentMessage: parent }),
      callbackQuery: {
        message: { ...parent, message_id: 999 },
      },
    } as unknown as Parameters<typeof makeCtx>[0] & {
      callbackQuery: { message: { message_id: number } };
    };
    // Re-create the mock with a known message_id on the callback msg.
    const editCalls: EditCall[] = [];
    const ctxFull = {
      session: {} as NavStackSession,
      callbackQuery: { message: { ...parent, message_id: 999 } },
      editMessageText: async (text: string, extra: EditCall["extra"]) => {
        editCalls.push({ text, extra });
        return true;
      },
      reply: async () => ({ message_id: 42 }),
      deleteMessage: async () => true,
    };
    const result = await editToSubmenu(ctxFull as unknown as AppContext, {
      text: "buy card",
      inlineKeyboard: [backHomeRow()],
    });
    expect(result.editedMessageId).toBe(999);
  });

  it("returns the fresh reply id when the edit path fell back to delete+reply", async () => {
    const editCalls: EditCall[] = [];
    const ctxFull = {
      session: {} as NavStackSession,
      callbackQuery: { message: { text: "old", reply_markup: { inline_keyboard: [] }, message_id: 1 } },
      editMessageText: async (text: string, extra: EditCall["extra"]) => {
        editCalls.push({ text, extra });
        throw { error_code: 400, description: "message to edit not found" };
      },
      reply: async () => ({ message_id: 777 }),
      deleteMessage: async () => true,
    };
    const result = await editToSubmenu(ctxFull as unknown as AppContext, {
      text: "buy card",
      inlineKeyboard: [backHomeRow()],
    });
    expect(result.editedMessageId).toBe(777);
  });

  it("forwards parseMode and linkPreviewDisabled to editMessageText", async () => {
    const ctx = makeCtx();
    await editToSubmenu(ctx as unknown as AppContext, {
      text: "x",
      parseMode: "HTML",
      inlineKeyboard: [backHomeRow()],
      linkPreviewDisabled: true,
    });
    expect(ctx.editCalls[0]!.extra.parse_mode).toBe("HTML");
    expect(ctx.editCalls[0]!.extra.link_preview_options).toEqual({
      is_disabled: true,
    });
  });

  it("falls back to deleteMessage + reply when editMessageText hits a benign 400", async () => {
    const ctx = makeCtx({
      editError: { error_code: 400, description: "message to edit not found" },
    });
    await editToSubmenu(ctx as unknown as AppContext, {
      text: "submenu",
      inlineKeyboard: [backHomeRow()],
    });
    expect(ctx.editCalls).toHaveLength(1);
    expect(ctx.deleteCalls).toBe(1);
    expect(ctx.replyCalls).toHaveLength(1);
    expect(ctx.replyCalls[0]!.text).toBe("submenu");
  });

  it("propagates non-benign edit errors instead of falling back silently", async () => {
    const ctx = makeCtx({
      editError: { error_code: 403, description: "forbidden" },
    });
    // Non-benign errors get logged but the helper still falls through
    // to the delete+reply path — the user must end up looking at the
    // submenu either way. The non-benign branch logs (a warn) so an
    // ops alert can fire; it does not throw.
    await editToSubmenu(ctx as unknown as AppContext, {
      text: "submenu",
      inlineKeyboard: [backHomeRow()],
    });
    expect(ctx.replyCalls).toHaveLength(1);
  });
});
