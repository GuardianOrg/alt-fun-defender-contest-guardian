import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  makeBotHarness,
  withTelegramOk,
  type BotTestHarness,
} from "../helpers/bot.js";
import { START_CALLBACK } from "../../keyboards/start-menu.js";
import { REFERRAL_CALLBACK } from "../../commands/referral.js";
import { WalletManager } from "../../lib/wallet.js";

const ZERO_MASTER_KEY = btoa("\0".repeat(32));
const API_BASE_URL = "https://api.test.local";

interface FromOpts {
  username?: string;
  updateId?: number;
}

const referralUpdate = (
  fromId: number | null,
  chatType = "private",
  opts: FromOpts = {},
) => ({
  update_id: opts.updateId ?? 1,
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
  update_id: opts.updateId ?? 2,
  callback_query: {
    id: `cbq-${opts.updateId ?? 2}`,
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

const textUpdate = (text: string, updateId: number) => ({
  update_id: updateId,
  message: {
    message_id: 50 + updateId,
    date: 0,
    chat: { id: 42, type: "private" as const },
    from: { id: 7, is_bot: false, first_name: "Ada" },
    text,
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

interface BotStatsBody {
  rewardsWallet?: string;
  referredCount?: number;
  lifetimeEarnedUsdc?: string;
  badPaymentCount?: number;
  attributionLossCount?: number;
}

interface ApiOpts {
  status?: number;
  body?: BotStatsBody;
  fail?: boolean;
  rewardsWalletPostFails?: boolean;
}

const mockApi = (
  fetchSpy: ReturnType<typeof vi.spyOn>,
  rewardsWallet: string,
  opts: ApiOpts = {},
): void => {
  withTelegramOk(fetchSpy, async (input, init) => {
    const url = String(input);
    if (!url.startsWith(API_BASE_URL)) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    if (opts.fail) throw new Error("network down");

    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.endsWith("/rewards-wallet")) {
      if (opts.rewardsWalletPostFails) {
        return new Response(JSON.stringify({ error: "fail" }), { status: 503 });
      }
      const requestBody = (init as RequestInit | undefined)?.body;
      const parsed = JSON.parse(
        typeof requestBody === "string" ? requestBody : "{}",
      ) as { rewardsWallet?: string };
      return new Response(
        JSON.stringify({
          data: { rewardsWallet: (parsed.rewardsWallet ?? "").toLowerCase() },
        }),
        { status: 200 },
      );
    }
    const status = opts.status ?? 200;
    const body = opts.body ?? {
      rewardsWallet,
      referredCount: 0,
      lifetimeEarnedUsdc: "0",
      badPaymentCount: 0,
      attributionLossCount: 0,
    };
    return new Response(JSON.stringify({ data: body }), { status });
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
    mockApi(fetchSpy, wallet.address, {
      body: {
        rewardsWallet: wallet.address,
        referredCount: 3,
        lifetimeEarnedUsdc: "1500000000",
        badPaymentCount: 0,
        attributionLossCount: 0,
      },
    });

    await h.run(referralUpdate(7));

    const send = capture(fetchSpy).find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    expect(send!.body.parse_mode).toBe("HTML");
    expect(send!.body.text).toContain("Your referral");
    // No username on this update — link falls back to the numeric userId.
    expect(send!.body.text).toContain(
      "https://t.me/AltFunTestBot?start=ref_7",
    );
    expect(send!.body.text).toContain(`<code>${wallet.address}</code>`);
    expect(send!.body.text).toContain("Referred users: 3");
    // 1,500,000,000 raw at 6dp → $1,500
    expect(send!.body.text).toContain("Lifetime earned: $1,500 USDC");
    // Change rewards wallet button surfaces below the body.
    const markup = send!.body.reply_markup as
      | { inline_keyboard: { callback_data: string }[][] }
      | undefined;
    expect(markup?.inline_keyboard[0][0].callback_data).toBe(
      REFERRAL_CALLBACK.changeRewardsWallet,
    );
  });

  it("uses the Telegram username in the referral link when set", async () => {
    const h = makeBotHarness();
    h.env.BOT_USERNAME = "AltFunTestBot";
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address);

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
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address);

    // "ab" is shorter than Telegram's 5-char minimum — treat as absent.
    await h.run(referralUpdate(7, "private", { username: "ab" }));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain(
      "https://t.me/AltFunTestBot?start=ref_7",
    );
  });

  it("calls the bot-namespaced referrals endpoint with the active wallet", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address);

    await h.run(referralUpdate(7));

    const apiCall = (fetchSpy.mock.calls as Array<[unknown, unknown?]>).find(
      (c) => String(c[0]).startsWith(API_BASE_URL),
    );
    expect(apiCall).toBeDefined();
    expect(String(apiCall![0])).toBe(
      `${API_BASE_URL}/api/v1/bot/referrals/${wallet.address}`,
    );
  });

  it("renders bad-payment banner only when badPaymentCount > 0", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address, {
      body: {
        rewardsWallet: wallet.address,
        referredCount: 5,
        lifetimeEarnedUsdc: "0",
        badPaymentCount: 2,
        attributionLossCount: 0,
      },
    });

    await h.run(referralUpdate(7));

    const send = capture(fetchSpy).find((c) => c.url.includes("/sendMessage"));
    expect(send!.body.text).toContain("Rewards wallet rejecting USDC transfers");
    expect(send!.body.text).toContain("2 referral payments rolled into treasury");
    // Attribution banner must NOT appear here.
    expect(send!.body.text).not.toContain("Attribution dropped");
  });

  it("renders attribution-loss banner only when attributionLossCount > 0", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address, {
      body: {
        rewardsWallet: wallet.address,
        referredCount: 5,
        lifetimeEarnedUsdc: "0",
        badPaymentCount: 0,
        attributionLossCount: 1,
      },
    });

    await h.run(referralUpdate(7));

    const send = capture(fetchSpy).find((c) => c.url.includes("/sendMessage"));
    expect(send!.body.text).toContain("Attribution dropped");
    expect(send!.body.text).toContain("1 user hit your link");
    expect(send!.body.text).not.toContain("Rewards wallet rejecting");
  });

  it("renders both banners when both counts > 0", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address, {
      body: {
        rewardsWallet: wallet.address,
        referredCount: 5,
        lifetimeEarnedUsdc: "0",
        badPaymentCount: 3,
        attributionLossCount: 2,
      },
    });

    await h.run(referralUpdate(7));

    const send = capture(fetchSpy).find((c) => c.url.includes("/sendMessage"));
    expect(send!.body.text).toContain("Rewards wallet rejecting");
    expect(send!.body.text).toContain("Attribution dropped");
  });

  it("never includes a claim/withdraw button", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address, {
      body: {
        rewardsWallet: wallet.address,
        referredCount: 5,
        lifetimeEarnedUsdc: "100000",
        badPaymentCount: 3,
        attributionLossCount: 0,
      },
    });

    await h.run(referralUpdate(7));

    const send = capture(fetchSpy).find((c) => c.url.includes("/sendMessage"));
    const markup = send!.body.reply_markup as
      | { inline_keyboard: { text: string; callback_data: string }[][] }
      | undefined;
    const allTexts = (markup?.inline_keyboard ?? [])
      .flat()
      .map((b) => b.text.toLowerCase());
    for (const t of allTexts) {
      expect(t).not.toContain("claim");
      expect(t).not.toContain("withdraw");
      expect(t).not.toContain("payout");
    }
  });

  it("prompts the user to /start when they have no active wallet", async () => {
    const h = makeBotHarness();
    withTelegramOk(fetchSpy, async (input) => {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    await h.run(referralUpdate(7));

    const send = capture(fetchSpy).find((c) => c.url.includes("/sendMessage"));
    expect(send!.body.text).toContain("No active wallet");
    expect(send!.body.text).toContain("/start");
  });

  it("surfaces an outage message when the api is unavailable", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address, { status: 503 });

    await h.run(referralUpdate(7));

    const send = capture(fetchSpy).find((c) => c.url.includes("/sendMessage"));
    expect(send!.body.text).toContain("temporarily unavailable");
  });

  it("rejects /referral in a non-private chat", async () => {
    const h = makeBotHarness();
    withTelegramOk(fetchSpy, async (input) => {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    await h.run(referralUpdate(7, "group"));

    const send = capture(fetchSpy).find((c) => c.url.includes("/sendMessage"));
    expect(send!.body.text).toContain("private-DM only");
  });

  it("rejects /referral with no `from` user (channel post / anon admin)", async () => {
    const h = makeBotHarness();
    withTelegramOk(fetchSpy, async (input) => {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    await h.run(referralUpdate(null));

    const send = capture(fetchSpy).find((c) => c.url.includes("/sendMessage"));
    expect(send!.body.text).toContain("personal Telegram account");
  });

  it("Referral start-menu button sends the referral UI as a new message", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address);

    await h.run(callbackUpdate(START_CALLBACK.referral));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(send).toBeDefined();
    expect(send!.body.text).toContain("Your referral");
    expect(answer!.body.show_alert).toBeFalsy();
    expect(answer!.body.text ?? "").not.toMatch(/\/referral/);
  });

  it("Referral button falls back to a placeholder username when BOT_USERNAME is unset", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address);

    await h.run(callbackUpdate(START_CALLBACK.referral));

    const send = capture(fetchSpy).find((c) => c.url.includes("/sendMessage"));
    expect(send!.body.text).toMatch(/https:\/\/t\.me\/[A-Za-z0-9_]+\?start=ref_7/);
  });
});

describe("Change rewards wallet wizard", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("surfaces the past-attributions warning before prompting for the new address", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address);

    await h.run(callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", { updateId: 10 }));

    const send = capture(fetchSpy).find((c) => c.url.includes("/sendMessage"));
    expect(send).toBeDefined();
    expect(send!.body.text).toContain(
      "Changing your rewards wallet does NOT redirect already-attributed referees",
    );
    expect(send!.body.text).toContain(
      "Send the new rewards wallet address",
    );
  });

  it("rejects a non-address input and keeps the wizard open", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockApi(fetchSpy, "0xabcdef0123456789abcdef0123456789abcdef01");

    await h.run(callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", { updateId: 20 }));
    await h.run(textUpdate("not-an-address", 21));

    const sends = capture(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    // Two sendMessage calls expected: the warning + the invalid-address reply.
    expect(sends.length).toBeGreaterThanOrEqual(2);
    expect(sends[sends.length - 1].body.text).toContain(
      "Not a valid HyperEVM address",
    );
  });

  it("warns + requires explicit 'confirm' before accepting a known burn address", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockApi(fetchSpy, "0xabcdef0123456789abcdef0123456789abcdef01");

    await h.run(callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", { updateId: 40 }));
    await h.run(
      textUpdate("0x0000000000000000000000000000000000000000", 41),
    );

    const sends = capture(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    const text = sends[sends.length - 1].body.text as string;
    expect(text).toContain("known burn");
    expect(text).toContain("confirm");
    // No POST to /rewards-wallet yet — the wizard is gated on the
    // user typing 'confirm'.
    const postCall = (fetchSpy.mock.calls as Array<[unknown, unknown?]>).find(
      (c) =>
        String(c[0]).endsWith("/rewards-wallet") &&
        ((c[1] as RequestInit | undefined)?.method ?? "GET") === "POST",
    );
    expect(postCall).toBeUndefined();
  });

  it("aborts cleanly on /cancel from inside the burn-address gate", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockApi(fetchSpy, "0xabcdef0123456789abcdef0123456789abcdef01");

    await h.run(callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", { updateId: 50 }));
    await h.run(
      textUpdate("0x000000000000000000000000000000000000dEaD", 51),
    );
    await h.run(textUpdate("/cancel", 52));

    const sends = capture(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(sends[sends.length - 1].body.text).toContain("cancelled");
  });

  it("cancels cleanly on /cancel before address entry", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockApi(fetchSpy, "0xabcdef0123456789abcdef0123456789abcdef01");

    await h.run(callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", { updateId: 30 }));
    await h.run(textUpdate("/cancel", 31));

    const sends = capture(fetchSpy).filter((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(sends[sends.length - 1].body.text).toContain("cancelled");
  });
});
