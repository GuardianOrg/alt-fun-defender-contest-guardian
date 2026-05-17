import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeBotHarness, withTelegramOk, type BotTestHarness } from "./helpers/bot.js";
import { START_CALLBACK } from "../keyboards/start-menu.js";
import { WalletManager } from "../lib/wallet.js";

const ZERO_MASTER_KEY = btoa("\0".repeat(32));
const RPC_URL = "https://rpc.test.local";
const API_BASE = "https://api.test.local";

const TOKEN_ADDR = "0x1111111111111111111111111111111111111111";
const WALLET_ADDR = "0x2222222222222222222222222222222222222222";
const USER_ID = 7;
const CHAT_ID = 42;

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

const messageUpdate = (text: string, updateId = 2) => ({
  update_id: updateId,
  message: {
    message_id: 100 + updateId,
    date: 0,
    chat: { id: CHAT_ID, type: "private" as const },
    from: { id: USER_ID, is_bot: false, first_name: "Ada" },
    text,
    entities: [],
  },
});

const callbackUpdate = (data: string, updateId = 1) => ({
  update_id: updateId,
  callback_query: {
    id: `cbq-${updateId}`,
    from: { id: USER_ID, is_bot: false, first_name: "Ada" },
    chat_instance: "i-1",
    message: {
      message_id: 100,
      date: 0,
      chat: { id: CHAT_ID, type: "private" as const },
    },
    data,
  },
});

const tokenResponse = () =>
  new Response(
    JSON.stringify({
      data: {
        address: TOKEN_ADDR,
        name: "Test Token",
        ticker: "TEST",
        priceUsd: 0.001,
        mcapUsd: 5000,
        change24h: 5.2,
        ltChange24h: 2.1,
        curveFilled: 30,
        status: "curve",
      },
    }),
    { status: 200 },
  );

const wireMocks = (fetchSpy: ReturnType<typeof vi.spyOn>): void => {
  withTelegramOk(fetchSpy, async (input) => {
    const url = String(input);
    if (url === RPC_URL) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          // 100 USDC (6dp), padded to 32-byte word
          result: `0x${(100_000_000n).toString(16).padStart(64, "0")}`,
        }),
        { status: 200 },
      );
    }
    if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
      return tokenResponse();
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
};

const harnessWithWallet = async (): Promise<BotTestHarness> => {
  const h = makeBotHarness();
  h.env.HYPEREVM_RPC_URL = RPC_URL;
  const wm = new WalletManager(h.kv as unknown as KVNamespace, ZERO_MASTER_KEY);
  const w = await wm.createWallet(USER_ID);
  const stored = (await h.kv.get(`wallet:${USER_ID}:${w.id}`)) as string;
  const parsed = JSON.parse(stored) as { address: string };
  parsed.address = WALLET_ADDR;
  await h.kv.put(`wallet:${USER_ID}:${w.id}`, JSON.stringify(parsed));
  await h.kv.put(
    `session:${USER_ID}`,
    JSON.stringify({
      slippageBps: 100,
      defaultBuyUsdc: 20,
      degenMode: false,
    }),
  );
  return h;
};

// The final card may land via either `sendMessage` (no placeholder
// shipped, or edit fell back) or `editMessageText` (the placeholder
// was upgraded in place after the upstream fetches resolved). Both
// carry the same `text` + `reply_markup` shape, so callers can grep
// for "Test Token" on whichever leg actually shipped the body.
const findCardSend = (calls: TgCall[]): TgCall | undefined =>
  calls.find(
    (c) =>
      (c.url.includes("/sendMessage") ||
        c.url.includes("/editMessageText")) &&
      typeof c.body.text === "string" &&
      String(c.body.text).includes("Test Token"),
  );

const findLoadingSend = (calls: TgCall[]): TgCall | undefined =>
  calls.find(
    (c) =>
      c.url.includes("/sendMessage") &&
      typeof c.body.text === "string" &&
      String(c.body.text).includes("Loading"),
  );

describe("Address → buy menu intercept (issue #821)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("pasting a bare contract address outside any flow lands the user on the buy card", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    await h.run(messageUpdate(TOKEN_ADDR, 5));

    const calls = capture(fetchSpy);
    const card = findCardSend(calls);
    expect(card).toBeDefined();
    const text = String(card!.body.text);
    expect(text).toContain("TEST");
    const keyboard =
      (card!.body.reply_markup as { inline_keyboard?: unknown[][] })
        ?.inline_keyboard ?? [];
    const buttons = keyboard.flat() as Array<{ text: string }>;
    expect(buttons.some((b) => b.text.includes("Buy 20"))).toBe(true);
    expect(buttons.some((b) => b.text.includes("Buy 100"))).toBe(true);
  });

  it("pasting a bare address sweeps the user's message AFTER the Loading placeholder lands", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    await h.run(messageUpdate(TOKEN_ADDR, 13));

    const calls = capture(fetchSpy);
    const del = calls.find((c) => c.url.includes("/deleteMessage"));
    expect(del).toBeDefined();
    expect(del!.body).toMatchObject({
      chat_id: CHAT_ID,
      // messageUpdate(_, 13) → message_id = 100 + 13 = 113
      message_id: 113,
    });
    // The card still ships even though the user's message was wiped.
    const card = findCardSend(calls);
    expect(card).toBeDefined();
    // Ordering matters: the Loading placeholder must hit Telegram BEFORE
    // the deleteMessage call removes the user's paste. Otherwise the
    // chat blinks blank between the delete and the placeholder send —
    // which is the exact regression this guards against. The placeholder
    // is the first `sendMessage` the intercept fires.
    const loadingIdx = calls.findIndex((c) =>
      c.url.includes("/sendMessage") &&
      typeof c.body.text === "string" &&
      String(c.body.text).includes("Loading"),
    );
    const deleteUserIdx = calls.findIndex(
      (c) =>
        c.url.includes("/deleteMessage") &&
        (c.body as { message_id?: number }).message_id === 113,
    );
    expect(loadingIdx).toBeGreaterThanOrEqual(0);
    expect(deleteUserIdx).toBeGreaterThan(loadingIdx);
  });

  it("pasting an alt.fun URL outside any flow lands the buy card too", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    await h.run(messageUpdate(`https://alt.fun/${TOKEN_ADDR}`, 6));

    const card = findCardSend(capture(fetchSpy));
    expect(card).toBeDefined();
    expect(String(card!.body.text)).toContain("TEST");
  });

  it("pasting a hyperevmscan URL outside any flow lands the buy card too", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    await h.run(
      messageUpdate(`https://hyperevmscan.io/token/${TOKEN_ADDR}`, 11),
    );

    const card = findCardSend(capture(fetchSpy));
    expect(card).toBeDefined();
    expect(String(card!.body.text)).toContain("TEST");
  });

  it("group-chat address paste does NOT trigger the buy card (privacy: USDC balance must not leak into groups)", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    await h.run({
      update_id: 12,
      message: {
        message_id: 999,
        date: 0,
        chat: { id: -100, type: "group" as const, title: "Test Group" },
        from: { id: USER_ID, is_bot: false, first_name: "Ada" },
        text: TOKEN_ADDR,
        entities: [],
      },
    });

    const calls = capture(fetchSpy);
    const card = findCardSend(calls);
    expect(card).toBeUndefined();
    expect(
      calls.filter((c) => c.url.includes("/sendMessage")),
    ).toHaveLength(0);
    // The intercept short-circuits before the deleteMessage call too —
    // the bot must not try to delete user posts in groups it doesn't
    // own.
    expect(
      calls.filter((c) => c.url.includes("/deleteMessage")),
    ).toHaveLength(0);
  });

  it("buy card still ships when deleteMessage fails (best-effort sweep, hard guarantee on the card)", async () => {
    const h = await harnessWithWallet();
    withTelegramOk(fetchSpy, async (input) => {
      const url = String(input);
      if (url.includes("/deleteMessage")) {
        // Telegram returns 400 when the message is already gone — the
        // intercept must swallow and still ship the card.
        return new Response(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: "Bad Request: message to delete not found",
          }),
          { status: 400 },
        );
      }
      if (url === RPC_URL) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `0x${(100_000_000n).toString(16).padStart(64, "0")}`,
          }),
          { status: 200 },
        );
      }
      if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
        return tokenResponse();
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await h.run(messageUpdate(TOKEN_ADDR, 14));

    const card = findCardSend(capture(fetchSpy));
    expect(card).toBeDefined();
    expect(String(card!.body.text)).toContain("TEST");
  });

  it("pasting a second address deletes the prior card and sends a fresh one near the cursor", async () => {
    // Regression: the earlier "morph in place via editMessageText"
    // optimisation silently edited the prior card upstream the moment
    // the user had interacted with anything else since that card was
    // sent — the edit landed against a message scrolled out of view
    // and the user saw their paste vanish with no visible response
    // near where they were typing. Delete + fresh send guarantees the
    // new card lands at the bottom of the chat, one bot card at a time.
    const h = await harnessWithWallet();
    let nextMessageId = 5000;
    const sendMessageIds: number[] = [];
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.telegram.org")) {
        if (url.includes("/sendMessage")) {
          const messageId = nextMessageId++;
          sendMessageIds.push(messageId);
          return new Response(
            JSON.stringify({
              ok: true,
              result: {
                message_id: messageId,
                date: 0,
                chat: { id: CHAT_ID, type: "private" },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      if (url === RPC_URL) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `0x${(100_000_000n).toString(16).padStart(64, "0")}`,
          }),
          { status: 200 },
        );
      }
      if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
        return tokenResponse();
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    // First paste — buy card lands and its id is captured.
    await h.run(messageUpdate(TOKEN_ADDR, 20));
    const firstCardId = sendMessageIds.at(-1);
    expect(firstCardId).toBeDefined();
    fetchSpy.mockClear();

    // Second paste — prior card must be DELETED, then a fresh
    // placeholder sent at the bottom of the chat (edited to the final
    // card body). Editing the prior id (a scrolled-out-of-view slot)
    // would silently strand the user.
    await h.run(messageUpdate(TOKEN_ADDR, 21));

    const calls = capture(fetchSpy);
    const deletePrior = calls.find(
      (c) =>
        c.url.includes("/deleteMessage") &&
        (c.body as { message_id?: number }).message_id === firstCardId,
    );
    expect(deletePrior).toBeDefined();
    // No edit lands on the (now-gone) prior card id.
    const editsOnPriorCard = calls.filter(
      (c) =>
        c.url.includes("/editMessageText") &&
        (c.body as { message_id?: number }).message_id === firstCardId,
    );
    expect(editsOnPriorCard).toHaveLength(0);
    // A fresh Loading placeholder lands as a new sendMessage, then is
    // edited in place to the final card body on its OWN id.
    const loading = findLoadingSend(calls);
    expect(loading).toBeDefined();
    const card = findCardSend(calls);
    expect(card).toBeDefined();
    expect(String(card!.body.text)).toContain("TEST");
  });

  it("non-address text outside any flow is ignored (no buy card, no error)", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    await h.run(messageUpdate("hello world", 7));

    const calls = capture(fetchSpy);
    expect(
      calls.filter((c) => c.url.includes("/sendMessage")),
    ).toHaveLength(0);
  });

  it("a pasted address inside the /withdraw wizard exits the wizard and shows the buy card", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    // Enter the wizard via the [Withdraw] button.
    await h.run(callbackUpdate(START_CALLBACK.withdraw, 1));
    fetchSpy.mockClear();
    wireMocks(fetchSpy);

    // Asset prompt is active. Paste the contract address.
    await h.run(messageUpdate(TOKEN_ADDR, 8));

    const calls = capture(fetchSpy);
    const card = findCardSend(calls);
    expect(card).toBeDefined();
    // The wizard's "Unsupported asset" retry copy must NOT fire.
    const unsupportedRetry = calls.find(
      (c) =>
        c.url.includes("/sendMessage") &&
        String(c.body.text).includes("Unsupported asset"),
    );
    expect(unsupportedRetry).toBeUndefined();
  });

  it("a pasted address inside the /settings buy-amount wizard exits and shows the buy card", async () => {
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);

    // Open the buy-amount wizard via the settings button.
    await h.run(callbackUpdate("set:buy", 1));
    fetchSpy.mockClear();
    wireMocks(fetchSpy);

    await h.run(messageUpdate(TOKEN_ADDR, 9));

    const card = findCardSend(capture(fetchSpy));
    expect(card).toBeDefined();
    expect(String(card!.body.text)).toContain("TEST");
  });

  it("ships a Loading placeholder before the card lands, then edits it in place", async () => {
    const h = await harnessWithWallet();
    // Inline mock so `sendMessage` returns a real Message with a
    // numeric `message_id` — without that, the placeholder pointer is
    // `undefined`, the in-place edit path is skipped, and the card
    // arrives via a second sendMessage (the production-degraded
    // fallback). This test guards the production behaviour, so we have
    // to feed the bot the same Message shape Telegram ships.
    let nextMessageId = 7000;
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.telegram.org")) {
        if (url.includes("/sendMessage")) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: {
                message_id: nextMessageId++,
                date: 0,
                chat: { id: CHAT_ID, type: "private" },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      if (url === RPC_URL) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `0x${(100_000_000n).toString(16).padStart(64, "0")}`,
          }),
          { status: 200 },
        );
      }
      if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
        return tokenResponse();
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await h.run(messageUpdate(TOKEN_ADDR, 30));

    const calls = capture(fetchSpy);
    const loading = findLoadingSend(calls);
    expect(loading).toBeDefined();
    // The full address is wrapped in `<code>` so Telegram's tap-to-copy
    // gesture copies the full hex string, not a `0x1234…abcd` shortened
    // form. Shortening here would leak `…` into the user's clipboard.
    expect(String(loading!.body.text)).toContain(`<code>${TOKEN_ADDR}</code>`);
    expect(String(loading!.body.text)).not.toContain("…</code>");

    // The card must arrive via `editMessageText` against the same
    // message that carried the placeholder — that's the whole point of
    // the loading state. A second `sendMessage` carrying the card body
    // means the user briefly saw "Loading…" then it scrolled out from
    // under them, defeating the UX fix.
    const cardEdit = calls.find(
      (c) =>
        c.url.includes("/editMessageText") &&
        typeof c.body.text === "string" &&
        String(c.body.text).includes("Test Token"),
    );
    expect(cardEdit).toBeDefined();

    const loadingSendIdx = calls.findIndex((c) => c === loading);
    const cardEditIdx = calls.findIndex((c) => c === cardEdit);
    expect(loadingSendIdx).toBeLessThan(cardEditIdx);

    // Exactly one bot-originated `sendMessage` lands in the chat — the
    // loading placeholder. The card edit reuses that message slot
    // rather than sending a fresh one.
    const botSends = calls.filter((c) => c.url.includes("/sendMessage"));
    expect(botSends).toHaveLength(1);
  });

  it("wizard intercept lands the buy card as a fresh message even when a stale prior buy-card slot exists", async () => {
    // Regression: when a user has interacted with the bare-text
    // intercept earlier in the chat, `lastBuyCardMessageByChat` carries
    // a pointer to that old buy card. If the user later opens a
    // /settings wizard and pastes an address, the wizard intercept used
    // to reuse that stale upstream slot — the loading placeholder + the
    // final card both edited a message scrolled far above the current
    // wizard view, so the user saw their paste and the prompt vanish
    // with no visible response anywhere near where they were typing.
    // The wizard intercept must instead ship a fresh placeholder near
    // the wizard so the buy card lands at the bottom of the chat where
    // the user is looking.
    const STALE_BUY_CARD_ID = 60;
    const h = await harnessWithWallet();
    // Re-seed the session with the stale pointer.
    await h.kv.put(
      `session:${USER_ID}`,
      JSON.stringify({
        slippageBps: 100,
        defaultBuyUsdc: 20,
        buyPresetsUsdc: [20, 40, 60, 80, 100],
        sellPresetsPct: [10, 25, 50, 75, 100],
        degenMode: false,
        lastBuyCardMessageByChat: { [String(CHAT_ID)]: STALE_BUY_CARD_ID },
      }),
    );

    let nextMessageId = 200;
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.telegram.org")) {
        if (url.includes("/sendMessage")) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: {
                message_id: nextMessageId++,
                date: 0,
                chat: { id: CHAT_ID, type: "private" },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      if (url === RPC_URL) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `0x${(100_000_000n).toString(16).padStart(64, "0")}`,
          }),
          { status: 200 },
        );
      }
      if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
        return tokenResponse();
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    // Enter the settings buy-preset wizard so a real conversation is
    // active when the paste arrives.
    await h.run(callbackUpdate("set:bp0", 1));
    fetchSpy.mockClear();
    await h.run(messageUpdate(TOKEN_ADDR, 5));

    const calls = capture(fetchSpy);
    // The stale slot must NOT be edited — neither for the Loading
    // placeholder nor for the final card body. Editing it would leave
    // the wizard responsive only via a message scrolled out of view.
    const editsOnStale = calls.filter(
      (c) =>
        c.url.includes("/editMessageText") &&
        (c.body as { message_id?: number }).message_id === STALE_BUY_CARD_ID,
    );
    expect(editsOnStale).toHaveLength(0);

    // The stale slot must be DELETED so the user doesn't see a stale
    // buy card upstream alongside the freshly-sent one.
    const deleteStale = calls.find(
      (c) =>
        c.url.includes("/deleteMessage") &&
        (c.body as { message_id?: number }).message_id === STALE_BUY_CARD_ID,
    );
    expect(deleteStale).toBeDefined();

    // The buy card must land via a fresh sendMessage (Loading) → in-
    // place edit to final card on the freshly-allocated id.
    const loading = findLoadingSend(calls);
    expect(loading).toBeDefined();
    const card = findCardSend(calls);
    expect(card).toBeDefined();
    expect(String(card!.body.text)).toContain("TEST");
  });

  it("bare-text intercept deletes the stale prior buy card and lands a fresh one at the cursor", async () => {
    // Mirrors the wizard-intercept regression for the bare-text path:
    // a `lastBuyCardMessageByChat` pointer to a card scrolled out of
    // view (because the user did other things between pastes) used to
    // silently edit that upstream slot. The user's paste vanished and
    // nothing visible landed at the bottom of the chat. Deleting the
    // prior card before sending the fresh placeholder restores the
    // "buy card always near the cursor" guarantee.
    const STALE_BUY_CARD_ID = 70;
    const h = await harnessWithWallet();
    await h.kv.put(
      `session:${USER_ID}`,
      JSON.stringify({
        slippageBps: 100,
        defaultBuyUsdc: 20,
        buyPresetsUsdc: [20, 40, 60, 80, 100],
        sellPresetsPct: [10, 25, 50, 75, 100],
        degenMode: false,
        lastBuyCardMessageByChat: { [String(CHAT_ID)]: STALE_BUY_CARD_ID },
      }),
    );

    let nextMessageId = 200;
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.telegram.org")) {
        if (url.includes("/sendMessage")) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: {
                message_id: nextMessageId++,
                date: 0,
                chat: { id: CHAT_ID, type: "private" },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      if (url === RPC_URL) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `0x${(100_000_000n).toString(16).padStart(64, "0")}`,
          }),
          { status: 200 },
        );
      }
      if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
        return tokenResponse();
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await h.run(messageUpdate(TOKEN_ADDR, 6));

    const calls = capture(fetchSpy);
    // No edit lands on the stale id.
    const editsOnStale = calls.filter(
      (c) =>
        c.url.includes("/editMessageText") &&
        (c.body as { message_id?: number }).message_id === STALE_BUY_CARD_ID,
    );
    expect(editsOnStale).toHaveLength(0);
    // The stale id IS deleted.
    const deleteStale = calls.find(
      (c) =>
        c.url.includes("/deleteMessage") &&
        (c.body as { message_id?: number }).message_id === STALE_BUY_CARD_ID,
    );
    expect(deleteStale).toBeDefined();
    // And a fresh buy card lands.
    const card = findCardSend(calls);
    expect(card).toBeDefined();
    expect(String(card!.body.text)).toContain("TEST");
  });

  it("token-not-found surfaces inside the placeholder via editMessageText (no second message)", async () => {
    const h = await harnessWithWallet();
    let nextMessageId = 8000;
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.telegram.org")) {
        if (url.includes("/sendMessage")) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: {
                message_id: nextMessageId++,
                date: 0,
                chat: { id: CHAT_ID, type: "private" },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      if (url === RPC_URL) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }),
          { status: 200 },
        );
      }
      if (url.startsWith(API_BASE) && url.includes("/api/v1/tokens/")) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await h.run(messageUpdate(TOKEN_ADDR, 31));

    const calls = capture(fetchSpy);
    expect(findLoadingSend(calls)).toBeDefined();
    const errorEdit = calls.find(
      (c) =>
        c.url.includes("/editMessageText") &&
        typeof c.body.text === "string" &&
        String(c.body.text).includes("Token not found"),
    );
    expect(errorEdit).toBeDefined();
  });

  it("address intercept clears any prior nav stack so Back on the buy card cannot pop into a stale parent", async () => {
    // Pasting a contract address is a fresh entry point — the user is
    // pivoting onto a buy card unrelated to whatever sub-menu they were
    // in before. Without this clear, a later Back tap on the buy card
    // would pop into a screen the user has long since moved away from.
    // Symmetric with /start (the other entry point).
    const h = await harnessWithWallet();
    wireMocks(fetchSpy);
    // Re-seed session with a populated navStack on top of what
    // `harnessWithWallet` already wrote.
    await h.kv.put(
      `session:${USER_ID}`,
      JSON.stringify({
        slippageBps: 100,
        defaultBuyUsdc: 20,
        degenMode: false,
        navStack: [
          {
            text: "stale parent",
            keyboard: [[{ text: "x", callback_data: "x" }]],
          },
        ],
      }),
    );

    await h.run(messageUpdate(TOKEN_ADDR, 50));

    const raw = (await h.kv.get(`session:${USER_ID}`)) as string | null;
    expect(raw).not.toBeNull();
    const session = JSON.parse(raw!) as { navStack?: unknown[] };
    expect(session.navStack ?? []).toEqual([]);
  });
});
