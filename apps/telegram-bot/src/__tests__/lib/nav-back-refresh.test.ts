import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeBotHarness, type BotTestHarness } from "../helpers/bot.js";
import {
  NAV_CALLBACK,
  registerView,
  type NavSnapshot,
  type SubmenuView,
} from "../../lib/nav.js";

/**
 * Regression: tapping [← Back] used to restore the frozen text /
 * keyboard captured when the parent was last on screen. Any state
 * that moved between push and pop (a wallet that was just created,
 * a balance that just refreshed, a preset that was just edited) was
 * invisible until the user manually refreshed — and worse, the user
 * sometimes saw the *pre-change* version of the parent and assumed
 * the change had been undone.
 *
 * The fix tags each pushed snapshot with the bubble's current view
 * id (when one is set on the session). On pop, the Back handler
 * rebuilds the view via the registered builder and renders that
 * fresh output instead of the frozen capture.
 *
 * This test seeds a navStack entry tagged with a test-only view id,
 * registers a builder that produces distinctly *different* text than
 * the frozen snapshot, fires the `nav:b` callback, and asserts that
 * the bubble was edited to the builder's fresh output — not the
 * snapshot's stale text.
 */

const USER_ID = 4242;
const CHAT_ID = 9999;
const BUBBLE_ID = 5678;
const STALE_TEXT = "wallet panel — 0 wallets (stale)";
const FRESH_TEXT = "wallet panel — 1 wallet (fresh)";
const TEST_VIEW_ID = "test:back-refresh";

interface TgCall {
  url: string;
  body: Record<string, unknown>;
}

const capture = (fetchSpy: ReturnType<typeof vi.spyOn>): TgCall[] =>
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>)
    .filter((call) => (call[1] as RequestInit | undefined)?.body !== undefined)
    .map((call) => ({
      url: String(call[0]),
      body: JSON.parse((call[1] as RequestInit).body as string) as Record<
        string,
        unknown
      >,
    }));

const taggedSnapshot: NavSnapshot = {
  // Frozen text — what the parent looked like at push time. If the
  // builder runs, this is NOT what the user should see on Back.
  text: STALE_TEXT,
  keyboard: [[{ text: "Refresh", callback_data: "noop" }]],
  view: { id: TEST_VIEW_ID },
};

const untaggedSnapshot: NavSnapshot = {
  text: STALE_TEXT,
  keyboard: [[{ text: "Refresh", callback_data: "noop" }]],
};

const seedSession = async (
  h: BotTestHarness,
  stack: NavSnapshot[],
): Promise<void> => {
  await h.kv.put(
    `session:${USER_ID}`,
    JSON.stringify({
      slippageBps: 1000,
      defaultBuyUsdc: 20,
      degenMode: true,
      navStack: stack,
    }),
  );
};

const backCallbackUpdate = () => ({
  update_id: 300,
  callback_query: {
    id: "cbq-refresh",
    from: { id: USER_ID, is_bot: false, first_name: "Ada" },
    chat_instance: "ci-2",
    message: {
      message_id: BUBBLE_ID,
      date: 0,
      chat: { id: CHAT_ID, type: "private" as const },
      text: "deeper screen",
      reply_markup: {
        inline_keyboard: [
          [{ text: "← Back", callback_data: NAV_CALLBACK.back }],
        ],
      },
    },
    data: NAV_CALLBACK.back,
  },
});

describe("[← Back] re-renders the parent view from live data when tagged", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("invokes the registered builder and edits the bubble to the builder's output (not the stale snapshot)", async () => {
    let builderInvocations = 0;
    registerView(TEST_VIEW_ID, async (): Promise<SubmenuView | null> => {
      builderInvocations += 1;
      return {
        text: FRESH_TEXT,
        inlineKeyboard: [
          [{ text: "Withdraw", callback_data: "wlt:wd" }],
          [{ text: "← Back", callback_data: NAV_CALLBACK.back }],
        ],
      };
    });

    const h = makeBotHarness();
    await seedSession(h, [taggedSnapshot]);

    await h.run(backCallbackUpdate());

    expect(builderInvocations).toBe(1);
    const edits = capture(fetchSpy).filter(
      (c) =>
        c.url.includes("/editMessageText") &&
        (c.body as { message_id?: number }).message_id === BUBBLE_ID,
    );
    expect(edits).toHaveLength(1);
    expect(edits[0]!.body.text).toBe(FRESH_TEXT);
    expect(edits[0]!.body.text).not.toBe(STALE_TEXT);
  });

  it("falls back to the frozen snapshot when the builder returns null", async () => {
    // Builder-null is the "view temporarily unavailable" signal —
    // e.g. RPC degraded, no active wallet. The user must still get
    // *something* on Back, so the frozen snapshot is the safety net.
    registerView(TEST_VIEW_ID, async () => null);

    const h = makeBotHarness();
    await seedSession(h, [taggedSnapshot]);

    await h.run(backCallbackUpdate());

    const edits = capture(fetchSpy).filter(
      (c) =>
        c.url.includes("/editMessageText") &&
        (c.body as { message_id?: number }).message_id === BUBBLE_ID,
    );
    expect(edits).toHaveLength(1);
    expect(edits[0]!.body.text).toBe(STALE_TEXT);
  });

  it("ignores the registry for untagged snapshots and uses the frozen text", async () => {
    // Pre-migration call sites that don't set `view` on the snapshot
    // must continue to work — Back restores the captured content
    // exactly as before. This is the gradual-migration guarantee.
    let builderInvocations = 0;
    registerView(TEST_VIEW_ID, async () => {
      builderInvocations += 1;
      return {
        text: FRESH_TEXT,
        inlineKeyboard: [[{ text: "x", callback_data: "x" }]],
      };
    });

    const h = makeBotHarness();
    await seedSession(h, [untaggedSnapshot]);

    await h.run(backCallbackUpdate());

    expect(builderInvocations).toBe(0);
    const edits = capture(fetchSpy).filter(
      (c) =>
        c.url.includes("/editMessageText") &&
        (c.body as { message_id?: number }).message_id === BUBBLE_ID,
    );
    expect(edits[0]!.body.text).toBe(STALE_TEXT);
  });
});
