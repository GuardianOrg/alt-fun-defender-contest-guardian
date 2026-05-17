import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeBotHarness, type BotTestHarness } from "../helpers/bot.js";
import { NAV_CALLBACK } from "../../lib/nav.js";
import { WalletManager } from "../../lib/wallet.js";

/**
 * Integration tests for the `[🏠 Home]` callback. The AGENTS.md
 * navigation contract is: tapping Home MUST replace the existing
 * message with the /start view, regardless of whether the source
 * bubble is a text card (e.g. a buy card landed via the address
 * intercept) or a media card (e.g. a /track chart that
 * `editMessageText` structurally cannot edit). Both branches must
 * end with exactly one start-view bubble visible to the user — no
 * stale source bubble left behind, no double-rendered duplicates.
 */

const ZERO_MASTER_KEY = btoa("\0".repeat(32));
const RPC_URL = "https://rpc.test.local";
const WALLET_ADDR = "0x2222222222222222222222222222222222222222";
const USER_ID = 7;
const CHAT_ID = 42;
const BUBBLE_ID = 555;

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

const homeCallbackUpdate = () => ({
  update_id: 100,
  callback_query: {
    id: "cbq-home",
    from: { id: USER_ID, is_bot: false, first_name: "Ada" },
    chat_instance: "i-1",
    message: {
      message_id: BUBBLE_ID,
      date: 0,
      chat: { id: CHAT_ID, type: "private" as const },
      text: "old screen",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🏠 Home", callback_data: NAV_CALLBACK.home }],
        ],
      },
    },
    data: NAV_CALLBACK.home,
  },
});

const rpcOk = (): Response =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: `0x${(100_000_000n).toString(16).padStart(64, "0")}`,
    }),
    { status: 200 },
  );

const seedWallet = async (h: BotTestHarness): Promise<void> => {
  const wm = new WalletManager(h.kv as unknown as KVNamespace, ZERO_MASTER_KEY);
  const w = await wm.createWallet(USER_ID);
  const stored = (await h.kv.get(`wallet:${USER_ID}:${w.id}`)) as string;
  const parsed = JSON.parse(stored) as { address: string };
  parsed.address = WALLET_ADDR;
  await h.kv.put(`wallet:${USER_ID}:${w.id}`, JSON.stringify(parsed));
};

describe("[🏠 Home] callback always replaces the source bubble with /start", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("edits in place when the source is a text bubble (no delete, no fresh send)", async () => {
    const h = makeBotHarness();
    h.env.HYPEREVM_RPC_URL = RPC_URL;
    await seedWallet(h);

    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === RPC_URL) return rpcOk();
      if (url.startsWith("https://api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await h.run(homeCallbackUpdate());

    const calls = capture(fetchSpy);
    const editStart = calls.find(
      (c) =>
        c.url.includes("/editMessageText") &&
        typeof c.body.text === "string" &&
        String(c.body.text).includes("Welcome"),
    );
    expect(editStart, "Home must edit the source bubble into /start").toBeDefined();
    expect(
      (editStart!.body as { message_id?: number }).message_id,
      "edit must target the bubble that carried the Home button",
    ).toBe(BUBBLE_ID);

    // No fresh start-view send and no delete on the happy edit path —
    // a duplicate would stack a second bubble below the (now-edited)
    // source, leaving the chat with two home menus.
    const sendStart = calls.find(
      (c) =>
        c.url.includes("/sendMessage") &&
        typeof c.body.text === "string" &&
        String(c.body.text).includes("Welcome"),
    );
    expect(sendStart).toBeUndefined();
    expect(
      calls.filter((c) => c.url.includes("/deleteMessage")),
    ).toHaveLength(0);
  });

  it("deletes the source and sends a fresh /start when the bubble cannot be edited (photo / non-text)", async () => {
    const h = makeBotHarness();
    h.env.HYPEREVM_RPC_URL = RPC_URL;
    await seedWallet(h);

    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === RPC_URL) return rpcOk();
      if (url.startsWith("https://api.telegram.org")) {
        if (url.includes("/editMessageText")) {
          // Telegram's exact reply when editMessageText is called
          // against a photo/media bubble (e.g. the /track chart card).
          // Before the fix this propagated out of `editMessageToSnapshot`
          // and the Home tap looked dead from the client.
          return new Response(
            JSON.stringify({
              ok: false,
              error_code: 400,
              description:
                "Bad Request: there is no text in the message to edit",
            }),
            { status: 400 },
          );
        }
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await h.run(homeCallbackUpdate());

    const calls = capture(fetchSpy);
    const sendStart = calls.find(
      (c) =>
        c.url.includes("/sendMessage") &&
        typeof c.body.text === "string" &&
        String(c.body.text).includes("Welcome"),
    );
    expect(
      sendStart,
      "fallback path must send /start as a fresh reply",
    ).toBeDefined();

    const deleteSource = calls.find(
      (c) =>
        c.url.includes("/deleteMessage") &&
        (c.body as { message_id?: number }).message_id === BUBBLE_ID,
    );
    expect(
      deleteSource,
      "fallback path must delete the source bubble so Home replaces it",
    ).toBeDefined();

    // Replace-not-duplicate: ordering matters. The fresh /start send
    // must land BEFORE the delete so a transient send failure cannot
    // leave the chat empty. (Mirrors the editToSubmenu fallback.)
    const sendIdx = calls.findIndex((c) => c === sendStart);
    const deleteIdx = calls.findIndex((c) => c === deleteSource);
    expect(sendIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThan(sendIdx);
  });

  it("preserves the source bubble when the fallback /sendMessage also fails (no delete)", async () => {
    // Regression for the "edit-fails-then-send-fails" race: if both
    // legs fail the source bubble is the user's only remaining UI.
    // Deleting it after a failed send would leave the chat blank.
    const h = makeBotHarness();
    h.env.HYPEREVM_RPC_URL = RPC_URL;
    await seedWallet(h);

    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === RPC_URL) return rpcOk();
      if (url.startsWith("https://api.telegram.org")) {
        if (url.includes("/editMessageText")) {
          return new Response(
            JSON.stringify({
              ok: false,
              error_code: 400,
              description:
                "Bad Request: there is no text in the message to edit",
            }),
            { status: 400 },
          );
        }
        if (url.includes("/sendMessage")) {
          return new Response(
            JSON.stringify({ ok: false, error_code: 500 }),
            { status: 500 },
          );
        }
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    // The error from the failed /sendMessage propagates out of
    // grammY's middleware stack; the bot's top-level `catch` logs it.
    // The test only cares that the delete didn't run AFTER the send
    // failure — wrap so the assertion still runs.
    await h.run(homeCallbackUpdate()).catch(() => undefined);

    const calls = capture(fetchSpy);
    // The fallback send is attempted and fails.
    const sendStart = calls.find((c) => c.url.includes("/sendMessage"));
    expect(sendStart).toBeDefined();
    // The source bubble is NOT deleted — without a successful
    // replacement, deleting it would strand the user on a blank chat.
    const deleteSource = calls.find(
      (c) =>
        c.url.includes("/deleteMessage") &&
        (c.body as { message_id?: number }).message_id === BUBBLE_ID,
    );
    expect(deleteSource).toBeUndefined();
  });

  it("deletes the source and surfaces a toast when /start cannot render (no active wallet)", async () => {
    // No wallet seeded — buildStartSnapshot returns null. The user
    // must not be stranded with the source bubble; clear it and
    // surface guidance to re-run /start.
    const h = makeBotHarness();
    h.env.HYPEREVM_RPC_URL = RPC_URL;

    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === RPC_URL) return rpcOk();
      if (url.startsWith("https://api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await h.run(homeCallbackUpdate());

    const calls = capture(fetchSpy);
    const deleteSource = calls.find(
      (c) =>
        c.url.includes("/deleteMessage") &&
        (c.body as { message_id?: number }).message_id === BUBBLE_ID,
    );
    expect(deleteSource).toBeDefined();
    const toast = calls.find(
      (c) =>
        c.url.includes("/answerCallbackQuery") &&
        typeof c.body.text === "string" &&
        String(c.body.text).includes("Run /start"),
    );
    expect(toast).toBeDefined();
  });
});
