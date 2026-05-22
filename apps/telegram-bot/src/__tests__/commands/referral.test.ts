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
          status: "success",
          data: { rewardsWallet: (parsed.rewardsWallet ?? "").toLowerCase() },
          error: null,
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
    return new Response(
      JSON.stringify({ status: "success", data: body, error: null }),
      { status },
    );
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
    h.env.BOT_USERNAME = "CortisolTestBot";
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
      "https://t.me/CortisolTestBot?start=ref_7",
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
    h.env.BOT_USERNAME = "CortisolTestBot";
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address);

    await h.run(referralUpdate(7, "private", { username: "abc_user" }));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain(
      "https://t.me/CortisolTestBot?start=ref_abc_user",
    );
    // The numeric-userId form must not leak through once a username is set —
    // otherwise referral attribution would have two competing handles.
    expect(send!.body.text).not.toContain("?start=ref_7");
  });

  it("falls back to userId when the Telegram username fails validation", async () => {
    const h = makeBotHarness();
    h.env.BOT_USERNAME = "CortisolTestBot";
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address);

    // "ab" is shorter than Telegram's 5-char minimum — treat as absent.
    await h.run(referralUpdate(7, "private", { username: "ab" }));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain(
      "https://t.me/CortisolTestBot?start=ref_7",
    );
  });

  it("calls the bot-namespaced referrals endpoint with the lowercased identity wallet", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address);

    await h.run(referralUpdate(7));

    const apiCall = (fetchSpy.mock.calls as Array<[unknown, unknown?]>).find(
      (c) => String(c[0]).startsWith(API_BASE_URL),
    );
    expect(apiCall).toBeDefined();
    // The bot lowercases before hitting the api so a future caller
    // can't end up with two KV records (mixed-case vs lowercase) for
    // the same wallet — the api `readRewardsWallet` keys on
    // `.toLowerCase()` so a mixed-case URL would write/read different
    // entries than a downstream lookup.
    expect(String(apiCall![0])).toBe(
      `${API_BASE_URL}/api/v1/bot/referrals-v2/${wallet.address.toLowerCase()}`,
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

  it("surfaces an outage message + back/home row when the api is unavailable", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address, { status: 503 });

    await h.run(referralUpdate(7));

    const send = capture(fetchSpy).find((c) => c.url.includes("/sendMessage"));
    expect(send!.body.text).toContain("temporarily unavailable");
    const markup = (send!.body as { reply_markup?: unknown }).reply_markup as
      | { inline_keyboard: { text: string; callback_data: string }[][] }
      | undefined;
    expect(markup?.inline_keyboard).toBeDefined();
    const lastRow = markup!.inline_keyboard[markup!.inline_keyboard.length - 1]!;
    expect(lastRow.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
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

  it("Referral start-menu button edits the /start view in place with the referral UI", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address);

    await h.run(callbackUpdate(START_CALLBACK.referral));

    const calls = capture(fetchSpy);
    const edit = calls.find((c) => c.url.includes("/editMessageText"));
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    // Standardised edit-in-place navigation — no fresh ctx.reply, so
    // tapping Back from the referral view restores the original /start
    // message via the nav-stack snapshot pushed by editToSubmenu.
    expect(edit).toBeDefined();
    expect(send).toBeUndefined();
    expect(edit!.body.text).toContain("Your referral");
    expect(answer!.body.show_alert).toBeFalsy();
    expect(answer!.body.text ?? "").not.toMatch(/\/referral/);
  });

  it("Referral button falls back to a placeholder username when BOT_USERNAME is unset", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address);

    await h.run(callbackUpdate(START_CALLBACK.referral));

    const edit = capture(fetchSpy).find((c) =>
      c.url.includes("/editMessageText"),
    );
    expect(edit!.body.text).toMatch(/https:\/\/t\.me\/[A-Za-z0-9_]+\?start=ref_7/);
  });

  /**
   * Capture every URL hit on the api host so the stable-identity
   * assertions below can prove which wallet was used for the
   * referrals lookup — independent of any other test fixture.
   */
  const mockApiPerWallet = (
    fetchSpy: ReturnType<typeof vi.spyOn>,
    perWallet: Record<string, string>,
  ): { urls: string[] } => {
    const urls: string[] = [];
    withTelegramOk(fetchSpy, async (input) => {
      const url = String(input);
      urls.push(url);
      const match = /\/api\/v1\/bot\/referrals-v2\/(0x[0-9a-fA-F]{40})$/.exec(
        url,
      );
      if (!match) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      const wallet = match[1]!.toLowerCase();
      const rewards = (perWallet[wallet] ?? wallet).toLowerCase();
      return new Response(
        JSON.stringify({
          status: "success",
          data: {
            rewardsWallet: rewards,
            referredCount: 0,
            lifetimeEarnedUsdc: "0",
            badPaymentCount: 0,
            attributionLossCount: 0,
          },
          error: null,
        }),
        { status: 200 },
      );
    });
    return { urls };
  };

  it("keys stats by the user's referral-identity wallet, not the currently-active one", async () => {
    // The user has TWO wallets and has flipped `setActive` after
    // onboarding. The /referral surface must still query the API for
    // their original (identity) wallet — otherwise referral stats and
    // rewards-wallet config would fork every time the user switches
    // active, leaking the appearance of multiple disjoint referrer
    // identities to the same human.
    const h = makeBotHarness();
    const wm = walletManager(h);
    const walletA = await wm.createWallet(7, "main");
    const walletB = await wm.createWallet(7, "extra");
    await wm.setActive(7, walletB.id);
    // Profile pins identity to wallet A — this is what /start writes
    // on first-run after the fix lands.
    await h.kv.put(
      "profile:7",
      JSON.stringify({
        createdAt: Date.now(),
        referrer: null,
        referralIdentityWallet: walletA.address.toLowerCase(),
      }),
    );

    const { urls } = mockApiPerWallet(fetchSpy, {});

    await h.run(referralUpdate(7));

    const referralCalls = urls.filter((u) =>
      u.startsWith(`${API_BASE_URL}/api/v1/bot/referrals-v2/`),
    );
    expect(referralCalls).toHaveLength(1);
    expect(referralCalls[0]).toBe(
      `${API_BASE_URL}/api/v1/bot/referrals-v2/${walletA.address.toLowerCase()}`,
    );
    expect(referralCalls[0]).not.toContain(walletB.address.toLowerCase());
  });

  it("backfills the identity wallet onto a legacy profile that lacks the field", async () => {
    // Profiles written before this feature carry no
    // `referralIdentityWallet`. The helper must fall back to the
    // user's current active wallet AND persist that choice so
    // subsequent flips of `setActive` don't reshuffle the identity.
    const h = makeBotHarness();
    const wm = walletManager(h);
    const walletA = await wm.createWallet(7, "main");
    await h.kv.put(
      "profile:7",
      JSON.stringify({
        createdAt: 1_700_000_000_000,
        referrer: null,
      }),
    );

    mockApi(fetchSpy, walletA.address);

    await h.run(referralUpdate(7));

    const stored = (await h.kv.get("profile:7")) as string | null;
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as {
      referralIdentityWallet?: string;
      referrer: string | null;
      createdAt: number;
    };
    expect(parsed.referralIdentityWallet?.toLowerCase()).toBe(
      walletA.address.toLowerCase(),
    );
    // The backfill must not clobber existing fields.
    expect(parsed.referrer).toBeNull();
    expect(parsed.createdAt).toBe(1_700_000_000_000);
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

  it("edits the origin /referral card in place into the picker (no fresh sendMessage)", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address);

    await h.run(callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", { updateId: 1 }));

    const calls = capture(fetchSpy);
    // Picker lands as an edit on the originating callback message
    // (message_id 100 from `callbackUpdate`), not as a fresh
    // sendMessage that would leave the stale /referral card stacked
    // above the picker.
    const edit = calls.find(
      (c) =>
        c.url.includes("/editMessageText") &&
        String(c.body.text ?? "").includes(
          "Changing your rewards wallet does NOT redirect already-attributed referees",
        ),
    );
    expect(edit).toBeDefined();
    expect(edit!.body.message_id).toBe(100);
    const fresh = calls.find(
      (c) =>
        c.url.includes("/sendMessage") &&
        String(c.body.text ?? "").includes(
          "Changing your rewards wallet does NOT redirect already-attributed referees",
        ),
    );
    expect(fresh).toBeUndefined();
  });

  it("surfaces the past-attributions warning before prompting for the new address", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const wallet = await wm.createWallet(7, "main");
    mockApi(fetchSpy, wallet.address);

    await h.run(callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", { updateId: 10 }));
    await h.run(
      callbackUpdate(REFERRAL_CALLBACK.pickRewardsWalletCustom, "private", {
        updateId: 11,
      }),
    );

    // The Custom path renders the warning + address prompt as an
    // edit on the same origin bubble used by the picker — match on
    // the address-entry copy so the picker bubble doesn't accidentally
    // satisfy the assertion (it carries the warning text alone).
    const send = capture(fetchSpy).find(
      (c) =>
        (c.url.includes("/sendMessage") ||
          c.url.includes("/editMessageText")) &&
        String(c.body.text ?? "").includes(
          "Send the new rewards wallet address",
        ),
    );
    expect(send).toBeDefined();
    expect(send!.body.text).toContain(
      "Changing your rewards wallet does NOT redirect already-attributed referees",
    );
    expect(send!.body.text).toContain(
      "Send the new rewards wallet address",
    );
    // The warning is a wizard prompt — must carry Back/Home so the user
    // has a visible exit on the prompt itself.
    const kb =
      (send!.body.reply_markup as
        | {
            inline_keyboard?: Array<
              Array<{ text: string; callback_data?: string }>
            >;
          }
        | undefined)?.inline_keyboard ?? [];
    expect(
      kb.some(
        (row) =>
          row.some((b) => b.callback_data === "nav:h") &&
          row.some((b) => b.callback_data === "nav:b"),
      ),
    ).toBe(true);
  });

  it("rejects a non-address input and keeps the wizard open", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockApi(fetchSpy, "0xabcdef0123456789abcdef0123456789abcdef01");

    await h.run(callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", { updateId: 20 }));
    await h.run(
      callbackUpdate(REFERRAL_CALLBACK.pickRewardsWalletCustom, "private", {
        updateId: 22,
      }),
    );
    await h.run(textUpdate("not-an-address", 21));

    // Wizard renders both the warning and the invalid-address retry by
    // editing the origin /referral bubble in place — combine sends +
    // edits when asserting that the retry copy was surfaced.
    const outgoing = capture(fetchSpy).filter(
      (c) =>
        c.url.includes("/sendMessage") || c.url.includes("/editMessageText"),
    );
    expect(outgoing.length).toBeGreaterThanOrEqual(2);
    expect(outgoing[outgoing.length - 1]!.body.text).toContain(
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
      callbackUpdate(REFERRAL_CALLBACK.pickRewardsWalletCustom, "private", {
        updateId: 42,
      }),
    );
    await h.run(
      textUpdate("0x0000000000000000000000000000000000000000", 41),
    );

    // Burn warning is rendered into the origin /referral bubble via
    // editMessageText when an origin is threaded — combine endpoints.
    const outgoing = capture(fetchSpy).filter(
      (c) =>
        c.url.includes("/sendMessage") || c.url.includes("/editMessageText"),
    );
    const text = outgoing[outgoing.length - 1]!.body.text as string;
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

  it("halts cleanly on a slash command from inside the burn-address gate", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockApi(fetchSpy, "0xabcdef0123456789abcdef0123456789abcdef01");

    await h.run(callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", { updateId: 50 }));
    await h.run(
      callbackUpdate(REFERRAL_CALLBACK.pickRewardsWalletCustom, "private", {
        updateId: 53,
      }),
    );
    await h.run(
      textUpdate("0x000000000000000000000000000000000000dEaD", 51),
    );
    await h.run(textUpdate("/positions", 52));

    // No POST to /rewards-wallet — the conversation halted before
    // confirming the burn address.
    const postCall = (fetchSpy.mock.calls as Array<[unknown, unknown?]>).find(
      (c) =>
        String(c[0]).endsWith("/rewards-wallet") &&
        ((c[1] as RequestInit | undefined)?.method ?? "GET") === "POST",
    );
    expect(postCall).toBeUndefined();
  });

  it("halts cleanly on a slash command before address entry", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockApi(fetchSpy, "0xabcdef0123456789abcdef0123456789abcdef01");

    await h.run(callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", { updateId: 30 }));
    await h.run(
      callbackUpdate(REFERRAL_CALLBACK.pickRewardsWalletCustom, "private", {
        updateId: 32,
      }),
    );
    await h.run(textUpdate("/positions", 31));

    // No POST to /rewards-wallet — the conversation halted on the slash.
    const postCall = (fetchSpy.mock.calls as Array<[unknown, unknown?]>).find(
      (c) =>
        String(c[0]).endsWith("/rewards-wallet") &&
        ((c[1] as RequestInit | undefined)?.method ?? "GET") === "POST",
    );
    expect(postCall).toBeUndefined();
  });

  it("deletes the user's address message before showing the PIN prompt", async () => {
    // Regression: the wizard edits the origin /referral bubble
    // in-place from "send address" → "send PIN". Before this fix the
    // user's typed address still hovered in the chat below the
    // (now-PIN) prompt, leaving stale state under a prompt that no
    // longer matched. The fix sweeps the user's reply the same way
    // PIN replies are swept.
    const h = makeBotHarness();
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockApi(fetchSpy, "0xabcdef0123456789abcdef0123456789abcdef01");

    await h.run(
      callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", {
        updateId: 60,
      }),
    );
    await h.run(
      callbackUpdate(REFERRAL_CALLBACK.pickRewardsWalletCustom, "private", {
        updateId: 62,
      }),
    );
    const addressMessageId = 50 + 61; // mirrors textUpdate's id formula
    await h.run(
      textUpdate("0x1111111111111111111111111111111111111111", 61),
    );

    const deleteCall = capture(fetchSpy).find(
      (c) =>
        c.url.includes("/deleteMessage") &&
        c.body.message_id === addressMessageId,
    );
    expect(deleteCall).toBeDefined();
  });

  it("deletes the burn-address 'confirm' reply before continuing", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockApi(fetchSpy, "0xabcdef0123456789abcdef0123456789abcdef01");

    await h.run(
      callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", {
        updateId: 70,
      }),
    );
    await h.run(
      callbackUpdate(REFERRAL_CALLBACK.pickRewardsWalletCustom, "private", {
        updateId: 73,
      }),
    );
    await h.run(
      textUpdate("0x0000000000000000000000000000000000000000", 71),
    );
    const confirmMessageId = 50 + 72;
    await h.run(textUpdate("confirm", 72));

    const deleteCall = capture(fetchSpy).find(
      (c) =>
        c.url.includes("/deleteMessage") &&
        c.body.message_id === confirmMessageId,
    );
    expect(deleteCall).toBeDefined();
  });
});

describe("Rewards wallet picker", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("renders one button per existing wallet, two per row, plus Custom + Back/Home", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const w1 = await wm.createWallet(7, "main");
    const w2 = await wm.createWallet(7); // unlabeled — falls back to shortened address
    const w3 = await wm.createWallet(7, "extra");
    // Use an unrelated rewards wallet so the layout assertions in this
    // test aren't perturbed by the `• … •` selected-state marker —
    // dedicated test below covers the marker behaviour.
    mockApi(fetchSpy, "0xabcdef0123456789abcdef0123456789abcdef01");

    await h.run(
      callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", {
        updateId: 200,
      }),
    );

    const edit = capture(fetchSpy).find((c) =>
      c.url.includes("/editMessageText"),
    );
    expect(edit).toBeDefined();
    const kb = (edit!.body.reply_markup as {
      inline_keyboard: { text: string; callback_data?: string }[][];
    }).inline_keyboard;

    // Three wallets → row 0 has w1 + w2, row 1 has w3 alone (odd
    // trailing wallet lands on its own single-button row).
    expect(kb[0]).toHaveLength(2);
    expect(kb[0]![0]!.text).toBe("main");
    expect(kb[0]![0]!.callback_data).toBe(
      `${REFERRAL_CALLBACK.pickRewardsWalletPrefix}${w1.id}`,
    );
    // Unlabeled wallet renders as `0x5A2e...F444`-style shortened address.
    expect(kb[0]![1]!.text).toMatch(/^0x[0-9a-fA-F]{4}\.\.\.[0-9a-fA-F]{4}$/);
    expect(kb[0]![1]!.callback_data).toBe(
      `${REFERRAL_CALLBACK.pickRewardsWalletPrefix}${w2.id}`,
    );
    expect(kb[1]).toHaveLength(1);
    expect(kb[1]![0]!.text).toBe("extra");
    expect(kb[1]![0]!.callback_data).toBe(
      `${REFERRAL_CALLBACK.pickRewardsWalletPrefix}${w3.id}`,
    );
    // Custom row sits on its own row, ahead of Back/Home.
    expect(kb[2]).toHaveLength(1);
    expect(kb[2]![0]!.text).toBe("Custom");
    expect(kb[2]![0]!.callback_data).toBe(
      REFERRAL_CALLBACK.pickRewardsWalletCustom,
    );
    expect(
      kb[3]!.some((b) => b.callback_data === "nav:b") &&
        kb[3]!.some((b) => b.callback_data === "nav:h"),
    ).toBe(true);
  });

  it("persists the picked wallet address through the PIN gate without prompting for a custom address", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const w1 = await wm.createWallet(7, "main");
    const w2 = await wm.createWallet(7, "extra");
    // Profile pins identity to the first wallet so the POST URL is
    // stable regardless of any later setActive flips.
    await h.kv.put(
      "profile:7",
      JSON.stringify({
        createdAt: 1,
        referrer: null,
        referralIdentityWallet: w1.address.toLowerCase(),
      }),
    );
    mockApi(fetchSpy, w1.address);

    await h.run(
      callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", {
        updateId: 300,
      }),
    );
    await h.run(
      callbackUpdate(
        `${REFERRAL_CALLBACK.pickRewardsWalletPrefix}${w2.id}`,
        "private",
        { updateId: 301 },
      ),
    );
    // PIN set wizard: send + confirm.
    await h.run(textUpdate("123456", 302));
    await h.run(textUpdate("123456", 303));

    const postCall = (fetchSpy.mock.calls as Array<[unknown, unknown?]>).find(
      (c) =>
        String(c[0]).endsWith("/rewards-wallet") &&
        ((c[1] as RequestInit | undefined)?.method ?? "GET") === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse(
      ((postCall![1] as RequestInit).body as string) ?? "{}",
    ) as { rewardsWallet?: string };
    expect(body.rewardsWallet?.toLowerCase()).toBe(w2.address.toLowerCase());
    // The POST URL must be keyed by the identity wallet (w1), not w2.
    expect(String(postCall![0])).toBe(
      `${API_BASE_URL}/api/v1/bot/referrals/${w1.address.toLowerCase()}/rewards-wallet`,
    );
  });

  it("marks the wallet matching the current rewards wallet with `• … •` bullets", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const w1 = await wm.createWallet(7, "main");
    const w2 = await wm.createWallet(7, "extra");
    await wm.createWallet(7, "third");
    // Mock api so the current rewards wallet is w2 — hex chars
    // uppercased (api validator only accepts `0x` + mixed-case hex) to
    // prove the picker comparison is case-insensitive on the hex body.
    mockApi(fetchSpy, w1.address, {
      body: {
        rewardsWallet: `0x${w2.address.slice(2).toUpperCase()}`,
        referredCount: 0,
        lifetimeEarnedUsdc: "0",
        badPaymentCount: 0,
        attributionLossCount: 0,
      },
    });

    await h.run(
      callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", {
        updateId: 500,
      }),
    );

    const edit = capture(fetchSpy).find((c) =>
      c.url.includes("/editMessageText"),
    );
    expect(edit).toBeDefined();
    const kb = (edit!.body.reply_markup as {
      inline_keyboard: { text: string; callback_data?: string }[][];
    }).inline_keyboard;

    // w1 ("main") and w2 ("extra") sit on the first row; only w2 is
    // the active rewards wallet so only its label gets the bullets.
    expect(kb[0]![0]!.text).toBe("main");
    expect(kb[0]![1]!.text).toBe("• extra •");
    // w3 lands on the trailing single-button row; it is not the
    // current rewards wallet so it stays unmarked.
    expect(kb[1]![0]!.text).toBe("third");
    // Custom never carries the marker.
    expect(kb[2]![0]!.text).toBe("Custom");
  });

  it("falls back to an unmarked picker when the rewards-wallet api lookup fails", async () => {
    const h = makeBotHarness();
    const wm = walletManager(h);
    const w1 = await wm.createWallet(7, "main");
    mockApi(fetchSpy, w1.address, { status: 503 });

    await h.run(
      callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", {
        updateId: 501,
      }),
    );

    const edit = capture(fetchSpy).find((c) =>
      c.url.includes("/editMessageText"),
    );
    expect(edit).toBeDefined();
    const kb = (edit!.body.reply_markup as {
      inline_keyboard: { text: string; callback_data?: string }[][];
    }).inline_keyboard;
    // No wallet rendered with bullets when the api is unreachable.
    expect(kb[0]![0]!.text).toBe("main");
  });

  it("renders Custom + Back/Home even when the user has zero wallets", async () => {
    const h = makeBotHarness();
    mockApi(fetchSpy, "0xabcdef0123456789abcdef0123456789abcdef01");

    await h.run(
      callbackUpdate(REFERRAL_CALLBACK.changeRewardsWallet, "private", {
        updateId: 400,
      }),
    );

    const edit = capture(fetchSpy).find((c) =>
      c.url.includes("/editMessageText"),
    );
    expect(edit).toBeDefined();
    const kb = (edit!.body.reply_markup as {
      inline_keyboard: { text: string; callback_data?: string }[][];
    }).inline_keyboard;
    // No wallet rows, only Custom + Back/Home.
    expect(kb).toHaveLength(2);
    expect(kb[0]![0]!.text).toBe("Custom");
    expect(kb[0]![0]!.callback_data).toBe(
      REFERRAL_CALLBACK.pickRewardsWalletCustom,
    );
  });
});
