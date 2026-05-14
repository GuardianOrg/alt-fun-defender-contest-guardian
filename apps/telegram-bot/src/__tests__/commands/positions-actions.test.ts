import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { makeBotHarness, type BotTestHarness } from "../helpers/bot.js";
import { WalletManager } from "../../lib/wallet.js";

const ZERO_MASTER_KEY = btoa("\0".repeat(32));
const RPC_URL = "https://rpc.test.local";
const TOKEN = "0xaaaa000000000000000000000000000000000000";

const seedActiveWallet = async (h: BotTestHarness): Promise<string> => {
  const wm = new WalletManager(h.kv as unknown as KVNamespace, ZERO_MASTER_KEY);
  const w = await wm.createWallet(7);
  return w.address;
};

const actionCallback = (
  data: string,
  chatType: "private" | "group" = "private",
) => ({
  update_id: 10,
  callback_query: {
    id: "cbq-1",
    from: { id: 7, is_bot: false, first_name: "Ada" },
    chat_instance: "instance-1",
    data,
    message: {
      message_id: 99,
      date: 0,
      chat: { id: 42, type: chatType },
    },
  },
});

interface TgCall {
  url: string;
  body: Record<string, unknown>;
}

const collectCalls = (fetchSpy: ReturnType<typeof vi.spyOn>): TgCall[] =>
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>)
    .filter((call) => {
      const init = call[1] as RequestInit | undefined;
      return typeof init?.body === "string";
    })
    .map((call) => ({
      url: String(call[0]),
      body: JSON.parse((call[1] as RequestInit).body as string) as Record<
        string,
        unknown
      >,
    }));

const harnessWithRpc = (): BotTestHarness => {
  const h = makeBotHarness();
  h.env.HYPEREVM_RPC_URL = RPC_URL;
  return h;
};

const mockActionFetch = (fetchSpy: ReturnType<typeof vi.spyOn>): void => {
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === RPC_URL) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }),
        { status: 200 },
      );
    }
    if (url.includes(`/api/v1/tokens/${TOKEN}`)) {
      return new Response(
        JSON.stringify({
          data: {
            address: TOKEN,
            name: "Test Token",
            ticker: "ALPHA",
            priceUsd: 0.05,
            mcapUsd: 50_000,
            change24h: 12.5,
            ltChange24h: null,
            volume24hUsd: 1000,
            curveFilled: 0.42,
            status: "curve",
            ltPair: null,
          },
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({ ok: true, result: true }),
      { status: 200 },
    );
  });
};

/**
 * Per-position `[Buy]` / `[Sell]` callback handlers registered by
 * `/positions`. The legacy implementation embedded a `t.me?start=...`
 * HTML anchor in the message body; tapping that anchor bounced the
 * user through Telegram's link-handler UI even inside the same bot's
 * chat and broke entirely when `BOT_USERNAME` was misconfigured.
 * Callback buttons keep the action in-chat and remove the username
 * dependency.
 */
describe("positions Buy/Sell callbacks (pb / ps)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("pb:<token> replies with a buy card in the same chat", async () => {
    const h = harnessWithRpc();
    await seedActiveWallet(h);
    mockActionFetch(fetchSpy);
    await h.run(actionCallback(`pb:${TOKEN}`));
    const sends = collectCalls(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(sends).toHaveLength(1);
    expect(sends[0]!.body.chat_id).toBe(42);
    const markup = sends[0]!.body.reply_markup as {
      inline_keyboard: { text: string }[][];
    };
    const labels = markup.inline_keyboard.flat().map((b) => b.text);
    // Quick-buy amount buttons prove `replyWithActionCard` routed to
    // the buy-card keyboard rather than something else.
    expect(labels.some((t) => t.includes("Buy 20"))).toBe(true);
  });

  it("ps:<token> replies with a sell card in the same chat", async () => {
    const h = harnessWithRpc();
    await seedActiveWallet(h);
    mockActionFetch(fetchSpy);
    await h.run(actionCallback(`ps:${TOKEN}`));
    const sends = collectCalls(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(sends).toHaveLength(1);
    const markup = sends[0]!.body.reply_markup as {
      inline_keyboard: { text: string }[][];
    };
    const labels = markup.inline_keyboard.flat().map((b) => b.text);
    expect(labels.some((t) => t === "Sell 100%")).toBe(true);
  });

  it("acks the callback query (no silent un-spin) when handling pb/ps", async () => {
    const h = harnessWithRpc();
    await seedActiveWallet(h);
    mockActionFetch(fetchSpy);
    await h.run(actionCallback(`pb:${TOKEN}`));
    const acks = collectCalls(fetchSpy).filter((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(acks).toHaveLength(1);
  });

  it("toasts the no-active-wallet error when the user has no wallet yet", async () => {
    const h = harnessWithRpc();
    mockActionFetch(fetchSpy);
    await h.run(actionCallback(`pb:${TOKEN}`));
    const acks = collectCalls(fetchSpy).filter((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(acks).toHaveLength(1);
    expect(String(acks[0]!.body.text)).toContain("No active wallet");
    // No buy card should be rendered.
    const sends = collectCalls(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(sends).toHaveLength(0);
  });

  it("rejects an invalid token address with a toast", async () => {
    const h = harnessWithRpc();
    await seedActiveWallet(h);
    mockActionFetch(fetchSpy);
    await h.run(actionCallback("pb:not-a-token"));
    const acks = collectCalls(fetchSpy).filter((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(acks).toHaveLength(1);
    expect(String(acks[0]!.body.text)).toContain("Invalid token");
  });

  it("rejects a non-private chat with the private-DM-only alert", async () => {
    const h = harnessWithRpc();
    await seedActiveWallet(h);
    mockActionFetch(fetchSpy);
    await h.run(actionCallback(`pb:${TOKEN}`, "group"));
    const acks = collectCalls(fetchSpy).filter((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(acks).toHaveLength(1);
    expect(String(acks[0]!.body.text)).toContain("private-DM only");
    expect(acks[0]!.body.show_alert).toBe(true);
  });
});
