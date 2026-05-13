import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  makeBotHarness,
  withTelegramOk,
  type BotTestHarness,
} from "../helpers/bot.js";
import { START_CALLBACK } from "../../keyboards/start-menu.js";
import { WalletManager } from "../../lib/wallet.js";

const ZERO_MASTER_KEY = btoa("\0".repeat(32));
const API_BASE_URL = "https://api.test.local";

interface FromOpts {
  username?: string;
}

const referralUpdate = (
  fromId: number | null,
  chatType = "private",
  opts: FromOpts = {},
) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: 42, type: chatType as "private" | "group" },
    ...(fromId !== null
      ? {
          from: {
            id: fromId,
            is_bot: false,
            first_name: "Ada",
            ...(opts.username ? { username: opts.username } : {}),
          },
        }
      : {}),
    text: "/referral",
    entities: [{ type: "bot_command", offset: 0, length: 9 }],
  },
});

const callbackUpdate = (
  data: string,
  chatType = "private",
  opts: FromOpts = {},
) => ({
  update_id: 2,
  callback_query: {
    id: "cbq-1",
    from: {
      id: 7,
      is_bot: false,
      first_name: "Ada",
      ...(opts.username ? { username: opts.username } : {}),
    },
    chat_instance: "i-1",
    message: {
      message_id: 100,
      date: 0,
      chat: { id: 42, type: chatType as "private" | "group" },
    },
    data,
  },
});

interface TgCall {
  url: string;
  body: Record<string, unknown>;
}

const capture = (fetchSpy: ReturnType<typeof vi.spyOn>): TgCall[] =>
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

const walletManager = (h: BotTestHarness): WalletManager =>
  new WalletManager(h.kv as unknown as KVNamespace, ZERO_MASTER_KEY);

interface ApiOpts {
  status?: number;
  body?: unknown;
  fail?: boolean;
}

const mockApi = (
  fetchSpy: ReturnType<typeof vi.spyOn>,
  opts: ApiOpts = {},
): void => {
  withTelegramOk(fetchSpy, async (input) => {
    const url = String(input);
    if (!url.startsWith(API_BASE_URL)) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    if (opts.fail) throw new Error("network down");
    const status = opts.status ?? 200;
    const body =
      opts.body ??
      {
        data: {
          referredWallets: 3,
          referredVolume: "1500000000",
          referrals: [],
        },
      };
    return new Response(JSON.stringify(body), { status });
  });
};

describe("/referral command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("renders link, rewards wallet and stats for the active wallet", async () => {
    const h = makeBotHarness();
    h.env.BOT_USERNAME = "AltFunTestBot";
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy);

    await h.run(referralUpdate(7));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send).toBeDefined();
    expect(send!.body.parse_mode).toBe("HTML");
    expect(send!.body.text).toContain("Your referral");
    // No username on this update — link falls back to the numeric userId.
    expect(send!.body.text).toContain(
      "https://t.me/AltFunTestBot?start=ref_7",
    );
    expect(send!.body.text).toContain(`<code>${wallet.address}</code>`);
    expect(send!.body.text).toContain("Referred wallets: 3");
    // 1,500,000,000 raw at 6dp → $1,500
    expect(send!.body.text).toContain("Referred volume: $1,500 USDC");
  });

  it("uses the Telegram username in the referral link when set", async () => {
    const h = makeBotHarness();
    h.env.BOT_USERNAME = "AltFunTestBot";
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockApi(fetchSpy);

    await h.run(referralUpdate(7, "private", { username: "abc_user" }));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain(
      "https://t.me/AltFunTestBot?start=ref_abc_user",
    );
    // The numeric-userId form must not leak through once a username is set —
    // otherwise referral attribution would have two competing handles.
    expect(send!.body.text).not.toContain("?start=ref_7");
  });

  it("falls back to userId when the Telegram username fails validation", async () => {
    const h = makeBotHarness();
    h.env.BOT_USERNAME = "AltFunTestBot";
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockApi(fetchSpy);

    // "ab" is shorter than Telegram's 5-char minimum — treat as absent.
    await h.run(referralUpdate(7, "private", { username: "ab" }));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain(
      "https://t.me/AltFunTestBot?start=ref_7",
    );
  });

  it("calls the v1 referrals endpoint with the active wallet address", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy);

    await h.run(referralUpdate(7));

    const apiCall = (fetchSpy.mock.calls as Array<[unknown, unknown?]>).find(
      (c) => String(c[0]).startsWith(API_BASE_URL),
    );
    expect(apiCall).toBeDefined();
    expect(String(apiCall![0])).toBe(
      `${API_BASE_URL}/api/v1/referrals/${wallet.address}`,
    );
  });

  it("prompts the user to /start when they have no active wallet", async () => {
    const h = makeBotHarness();
    // Telegram fetch is enough — api should never be hit when no wallet.
    withTelegramOk(fetchSpy, async (input) => {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    await h.run(referralUpdate(7));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain("No active wallet");
    expect(send!.body.text).toContain("/start");
  });

  it("surfaces an outage message when the api is unavailable", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockApi(fetchSpy, { status: 503 });

    await h.run(referralUpdate(7));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain("temporarily unavailable");
  });

  it("rejects /referral in a non-private chat", async () => {
    const h = makeBotHarness();
    withTelegramOk(fetchSpy, async (input) => {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    await h.run(referralUpdate(7, "group"));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain("private-DM only");
  });

  it("rejects /referral with no `from` user (channel post / anon admin)", async () => {
    const h = makeBotHarness();
    withTelegramOk(fetchSpy, async (input) => {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    await h.run(referralUpdate(null));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain("personal Telegram account");
  });

  it("Referral start-menu button sends the referral UI as a new message (not a toast hint)", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockApi(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.referral));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(send).toBeDefined();
    expect(send!.body.text).toContain("Your referral");
    // The toast must not be a show_alert hint pointing at /referral —
    // tapping the button should open the UI directly.
    expect(answer!.body.show_alert).toBeFalsy();
    expect(answer!.body.text ?? "").not.toMatch(/\/referral/);
  });

  it("Referral button falls back to a placeholder username when BOT_USERNAME is unset", async () => {
    const h = makeBotHarness();
    // Leave BOT_USERNAME unset
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockApi(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.referral));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toMatch(/https:\/\/t\.me\/[A-Za-z0-9_]+\?start=ref_7/);
  });
});
