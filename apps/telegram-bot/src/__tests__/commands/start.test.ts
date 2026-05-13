import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  makeBotHarness,
  withTelegramOk,
  type BotTestHarness,
} from "../helpers/bot.js";
import { START_CALLBACK } from "../../keyboards/start-menu.js";
import { WalletManager } from "../../lib/wallet.js";

const ZERO_MASTER_KEY = btoa("\0".repeat(32));
const RPC_URL = "https://rpc.test.local";

const startUpdate = (
  fromId: number | null,
  chatType = "private",
  options: { param?: string; username?: string } = {},
) => {
  const text = options.param ? `/start ${options.param}` : "/start";
  return {
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
              ...(options.username ? { username: options.username } : {}),
            },
          }
        : {}),
      text,
      entities: [{ type: "bot_command", offset: 0, length: 6 }],
    },
  };
};

const callbackUpdate = (data: string, chatType = "private") => ({
  update_id: 2,
  callback_query: {
    id: "cbq-1",
    from: { id: 7, is_bot: false, first_name: "Ada" },
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
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>).map((call) => ({
    url: String(call[0]),
    body: JSON.parse((call[1] as RequestInit).body as string) as Record<
      string,
      unknown
    >,
  }));

const walletManager = (h: BotTestHarness): WalletManager =>
  new WalletManager(h.kv as unknown as KVNamespace, ZERO_MASTER_KEY);

/**
 * Mock the Telegram + HyperEVM RPC fetches in one go. RPC responses
 * carry a hex-encoded balance — the bot decodes via `BigInt(result)`.
 *
 * The /start panel issues two RPC calls in parallel:
 *  - `eth_call` → USDC `balanceOf` (6-decimal)
 *  - `eth_getBalance` → native HYPE gas balance (18-decimal)
 *
 * `rpcBalance` controls USDC; `rpcHypeBalance` controls HYPE. Each
 * side is independent — when omitted, that side defaults to `0n`
 * (the mock returns a zero hex result), not to whatever the other
 * side was set to. This keeps 6-dec USDC fixtures from bleeding into
 * the 18-dec HYPE path in legacy tests. Either side can be set to
 * `"error"` (JSON-RPC error body) or `"fail"` (transport throw) to
 * exercise the degraded-balance fallback in isolation.
 */
type RpcMockSetting = bigint | "error" | "fail";

const mockBoth = (
  fetchSpy: ReturnType<typeof vi.spyOn>,
  opts: {
    rpcBalance?: RpcMockSetting;
    rpcHypeBalance?: RpcMockSetting;
  } = {},
): void => {
  const respond = (setting: RpcMockSetting | undefined): Response => {
    if (setting === "error") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -1, message: "bad" },
        }),
        { status: 200 },
      );
    }
    const balance = (setting as bigint | undefined) ?? 0n;
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: `0x${balance.toString(16)}`,
      }),
      { status: 200 },
    );
  };
  withTelegramOk(fetchSpy, async (input, init) => {
    if (String(input) === RPC_URL) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        method?: string;
      };
      const isHype = body.method === "eth_getBalance";
      // Default the unspecified side to 0 rather than mirroring the
      // other balance — USDC is 6-dec, HYPE is 18-dec, so feeding a
      // USDC fixture into the HYPE path produces nonsense like
      // 2.5e-12 HYPE in legacy tests that only meant to set USDC.
      const setting = isHype ? opts.rpcHypeBalance : opts.rpcBalance;
      if (setting === "fail") throw new Error("network down");
      return respond(setting);
    }
    throw new Error(`Unexpected fetch: ${String(input)}`);
  });
};

const harnessWithRpc = (): BotTestHarness => {
  const h = makeBotHarness();
  h.env.HYPEREVM_RPC_URL = RPC_URL;
  return h;
};

describe("/start command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("auto-creates a wallet on first interaction and renders address + balance", async () => {
    const h = harnessWithRpc();
    // 2.50 USDC (6 decimals).
    mockBoth(fetchSpy, { rpcBalance: 2_500_000n });

    await h.run(startUpdate(7));

    const wallets = await walletManager(h).listWallets(7);
    expect(wallets).toHaveLength(1);
    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send).toBeDefined();
    expect(send!.body.parse_mode).toBe("HTML");
    expect(send!.body.text).toContain("Welcome to CortisolBot");
    // Wallet address rendered inside <code> for tap-to-copy.
    expect(send!.body.text).toContain(`<code>${wallets[0]!.address}</code>`);
    expect(send!.body.text).toContain("Balance: $2.50 USDC");
  });

  it("does not create a second wallet on a repeat /start", async () => {
    const h = harnessWithRpc();
    mockBoth(fetchSpy);
    const wm = walletManager(h);
    const existing = await wm.createWallet(7, "main");

    await h.run(startUpdate(7));

    const wallets = await wm.listWallets(7);
    expect(wallets).toHaveLength(1);
    expect(wallets[0]!.id).toBe(existing.id);
    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain(`<code>${existing.address}</code>`);
  });

  it("renders an em-dash for balance when the RPC fails", async () => {
    const h = harnessWithRpc();
    mockBoth(fetchSpy, { rpcBalance: "fail", rpcHypeBalance: "fail" });

    await h.run(startUpdate(7));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain("Balance: — USDC");
    expect(send!.body.text).toContain("Gas balance: — HYPE");
  });

  it("renders both USDC and native HYPE (gas) balances on first /start", async () => {
    const h = harnessWithRpc();
    mockBoth(fetchSpy, {
      rpcBalance: 2_500_000n, // $2.50 USDC (6-dec)
      rpcHypeBalance: 1_234_500_000_000_000_000n, // 1.2345 HYPE (18-dec)
    });

    await h.run(startUpdate(7));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain("Balance: $2.50 USDC");
    expect(send!.body.text).toContain("Gas balance: 1.2345 HYPE");
  });

  it("HYPE balance falls back to em-dash independently of USDC when only HYPE RPC fails", async () => {
    const h = harnessWithRpc();
    mockBoth(fetchSpy, {
      rpcBalance: 2_500_000n,
      rpcHypeBalance: "error",
    });

    await h.run(startUpdate(7));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain("Balance: $2.50 USDC");
    expect(send!.body.text).toContain("Gas balance: — HYPE");
  });

  it("renders the full main-menu keyboard with a Buy-USDC URL button and Refresh", async () => {
    const h = harnessWithRpc();
    mockBoth(fetchSpy);

    await h.run(startUpdate(7));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    const keyboard = (
      send!.body.reply_markup as {
        inline_keyboard: ({ text: string; url?: string; callback_data?: string })[][];
      }
    ).inline_keyboard;
    // First row: URL button + Refresh
    expect(keyboard[0]?.[0]?.url).toBeDefined();
    expect(keyboard[0]?.[0]?.text).toContain("Buy USDC");
    expect(keyboard[0]?.[1]?.callback_data).toBe(START_CALLBACK.refresh);
    // Remaining rows cover every supported command.
    const allCallbacks = keyboard
      .flat()
      .map((b) => b.callback_data)
      .filter((d): d is string => d !== undefined);
    expect(allCallbacks).toEqual(
      expect.arrayContaining([
        START_CALLBACK.refresh,
        START_CALLBACK.buy,
        START_CALLBACK.sell,
        START_CALLBACK.positions,
        START_CALLBACK.track,
        START_CALLBACK.wallet,
        START_CALLBACK.withdraw,
        START_CALLBACK.settings,
        START_CALLBACK.security,
        START_CALLBACK.referral,
        START_CALLBACK.help,
      ]),
    );
  });

  it("rejects /start in a non-private chat without exposing wallet state", async () => {
    const h = harnessWithRpc();
    mockBoth(fetchSpy);

    await h.run(startUpdate(7, "group"));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain("private-DM only");
    expect(send!.body.text).not.toContain("Welcome to CortisolBot");
    // No wallet created for a group invocation.
    expect(await walletManager(h).listWallets(7)).toHaveLength(0);
  });

  it("rejects /start with no `from` user (channel post / anon admin)", async () => {
    const h = harnessWithRpc();
    mockBoth(fetchSpy);

    await h.run(startUpdate(null));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    expect(send!.body.text).toContain("Wallets require a personal");
  });

  it("Refresh callback edits the welcome message in place with fresh USDC + HYPE balances", async () => {
    const h = harnessWithRpc();
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockBoth(fetchSpy, {
      rpcBalance: 1_000_000n, // $1.00 USDC
      rpcHypeBalance: 500_000_000_000_000_000n, // 0.5 HYPE
    });

    await h.run(callbackUpdate(START_CALLBACK.refresh));

    const calls = capture(fetchSpy);
    const edit = calls.find((c) => c.url.includes("/editMessageText"));
    const answer = calls.find((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(edit).toBeDefined();
    expect(edit!.body.text).toContain("Balance: $1.00 USDC");
    expect(edit!.body.text).toContain("Gas balance: 0.5 HYPE");
    expect(answer!.body.text).toBe("Balance refreshed");
  });

  it("Refresh toast falls back to 'Balance unavailable' only when both USDC and HYPE RPCs fail", async () => {
    const h = harnessWithRpc();
    const wm = walletManager(h);
    await wm.createWallet(7, "main");
    mockBoth(fetchSpy, { rpcBalance: "fail", rpcHypeBalance: "fail" });

    await h.run(callbackUpdate(START_CALLBACK.refresh));

    const answer = capture(fetchSpy).find((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(answer!.body.text).toBe("Balance unavailable");
  });

  it("Refresh toasts 'No active wallet' when the user has no wallet (and does not auto-create)", async () => {
    const h = harnessWithRpc();
    mockBoth(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.refresh));

    const answer = capture(fetchSpy).find((c) =>
      c.url.includes("/answerCallbackQuery"),
    );
    expect(answer!.body.show_alert).toBe(true);
    expect(answer!.body.text).toContain("No active wallet");
    expect(await walletManager(h).listWallets(7)).toHaveLength(0);
  });

  it("Settings button opens the settings panel inline instead of showing a hint toast", async () => {
    const h = harnessWithRpc();
    mockBoth(fetchSpy);
    await h.run(callbackUpdate(START_CALLBACK.settings));
    const calls = capture(fetchSpy);
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    // Silent callback ack — no hint toast.
    expect(answer!.body.show_alert).toBeFalsy();
    expect(String(answer!.body.text ?? "")).not.toMatch(/\/settings/);
    // Bot replies with the settings status view.
    expect(send).toBeDefined();
    expect(String(send!.body.text)).toMatch(/Slippage:/);
  });

  it.each([START_CALLBACK.buy, START_CALLBACK.sell, START_CALLBACK.track])(
    "%s enters the token-lookup flow instead of showing a hint toast",
    async (cmd) => {
      const h = harnessWithRpc();
      mockBoth(fetchSpy);
      await h.run(callbackUpdate(cmd));
      const calls = capture(fetchSpy);
      const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
      const send = calls.find((c) => c.url.includes("/sendMessage"));
      // Silent callback query ack (no show_alert toast)
      expect(answer!.body.show_alert).toBeFalsy();
      // Bot sends the token-address prompt message
      expect(send).toBeDefined();
      expect(String(send!.body.text)).toMatch(/contract address|alt\.fun|hyperevmscan/i);
    },
  );

  it("Positions button opens positions for the active wallet directly without prompting the user to type /positions", async () => {
    const h = harnessWithRpc();
    const wm = walletManager(h);
    const created = await wm.createWallet(7, "main");

    withTelegramOk(fetchSpy, async (input) => {
      const url = String(input);
      if (url === RPC_URL) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }),
          { status: 200 },
        );
      }
      if (url.includes("/api/v1/bot/positions/")) {
        return new Response(
          JSON.stringify({ data: { open: [], realised: [] } }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await h.run(callbackUpdate(START_CALLBACK.positions));

    // Telegram fetches carry a JSON body; upstream API GETs do not.
    // Slice the two surfaces apart so capture()'s JSON.parse doesn't
    // trip on the bodyless GETs.
    const allCalls = fetchSpy.mock.calls as Array<[unknown, unknown?]>;
    const tgCalls = allCalls
      .filter(([url]) => String(url).startsWith("https://api.telegram.org"))
      .map(([url, init]) => ({
        url: String(url),
        body: JSON.parse((init as RequestInit).body as string) as Record<
          string,
          unknown
        >,
      }));
    const apiUrls = allCalls
      .map(([url]) => String(url))
      .filter((u) => u.startsWith("https://api.test.local"));

    const send = tgCalls.find((c) => c.url.includes("/sendMessage"));
    const answer = tgCalls.find((c) => c.url.includes("/answerCallbackQuery"));
    // Must reply with the positions view, not a hint toast.
    expect(send).toBeDefined();
    expect(send!.body.text).toContain("No open positions for this wallet.");
    expect(answer!.body.show_alert).toBeFalsy();
    expect(answer!.body.text ?? "").not.toMatch(/\/positions/);
    // Active wallet must be the one we created, not an arg-supplied address.
    expect(apiUrls.length).toBeGreaterThan(0);
    for (const u of apiUrls) {
      expect(u.toLowerCase()).toContain(created.address.toLowerCase());
    }
  });

  it("Positions button surfaces a 'No active wallet' alert when the user has no wallet", async () => {
    const h = harnessWithRpc();
    mockBoth(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.positions));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    expect(send).toBeUndefined();
    expect(answer!.body.show_alert).toBe(true);
    expect(answer!.body.text).toContain("No active wallet");
  });

  it("Buy USDC button points at the Relay HyperEVM onramp with the user's wallet pre-filled", async () => {
    const h = harnessWithRpc();
    mockBoth(fetchSpy);

    await h.run(startUpdate(7));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    const keyboard = (
      send!.body.reply_markup as {
        inline_keyboard: { text: string; url?: string }[][];
      }
    ).inline_keyboard;
    const buyUsdcButton = keyboard[0]?.[0];
    expect(buyUsdcButton?.text).toContain("Buy USDC");
    const url = new URL(buyUsdcButton!.url!);
    expect(url.host).toBe("relay.link");
    expect(url.pathname).toBe("/onramp/hyperevm");
    expect(url.searchParams.get("toCurrency")?.toLowerCase()).toBe(
      "0xb88339cb7199b77e23db6e890353e22632ba630f",
    );
    expect(url.searchParams.get("toAddress")).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(url.searchParams.get("lockToken")).toBe("true");
    expect(url.searchParams.get("lockToChain")).toBe("true");
  });

  it("Buy USDC button honours an explicit BUY_USDC_URL override", async () => {
    const h = harnessWithRpc();
    h.env.BUY_USDC_URL = "https://override.example/funding";
    mockBoth(fetchSpy);

    await h.run(startUpdate(7));

    const send = capture(fetchSpy).find((c) =>
      c.url.includes("/sendMessage"),
    );
    const keyboard = (
      send!.body.reply_markup as {
        inline_keyboard: { text: string; url?: string }[][];
      }
    ).inline_keyboard;
    expect(keyboard[0]?.[0]?.url).toBe("https://override.example/funding");
  });

  it("Security button sends the security panel directly without prompting the user to type /security", async () => {
    const h = harnessWithRpc();
    mockBoth(fetchSpy);

    await h.run(callbackUpdate(START_CALLBACK.security));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    // Must send the security UI as a new message, not a toast hint.
    expect(send).toBeDefined();
    expect(send!.body.text).toContain("Security");
    // answerCallbackQuery must not be a show_alert hint toast.
    expect(answer!.body.show_alert).toBeFalsy();
    expect(answer!.body.text ?? "").not.toMatch(/\/security/);
  });

  it("Wallet button sends wallet UI directly without prompting the user to type /wallet", async () => {
    const h = harnessWithRpc();
    mockBoth(fetchSpy);
    const wm = walletManager(h);
    await wm.createWallet(7, "main");

    await h.run(callbackUpdate(START_CALLBACK.wallet));

    const calls = capture(fetchSpy);
    const send = calls.find((c) => c.url.includes("/sendMessage"));
    const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
    // Must send the wallet UI as a new message, not a toast hint.
    expect(send).toBeDefined();
    expect(send!.body.text).toContain("Wallets");
    // answerCallbackQuery must not be a show_alert hint toast.
    expect(answer!.body.show_alert).toBeFalsy();
    expect(answer!.body.text ?? "").not.toMatch(/\/wallet/);
  });
});

/**
 * Referral-onboarding behaviour for /start. Covers the spec in
 * apps/telegram-bot/AGENTS.md → /start → "Referrer attribution" and
 * "Default rewards wallet".
 */
describe("/start referral onboarding", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  interface ApiMockOptions {
    referralStatsByWallet?: Record<string, { rewardsWallet: string }>;
  }

  const mockAll = (
    opts: ApiMockOptions = {},
    rpcBalance: bigint = 0n,
  ): void => {
    withTelegramOk(fetchSpy, async (input, init) => {
      const url = String(input);
      if (url === RPC_URL) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `0x${rpcBalance.toString(16)}`,
          }),
          { status: 200 },
        );
      }
      if (url.startsWith("https://api.test.local")) {
        // POST .../rewards-wallet — echo back the supplied wallet so
        // the bot's caller sees ok:true. Body must parse to JSON.
        if (url.endsWith("/rewards-wallet") && (init?.method ?? "GET") === "POST") {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            rewardsWallet?: string;
          };
          return new Response(
            JSON.stringify({
              data: {
                rewardsWallet: (body.rewardsWallet ?? "").toLowerCase(),
              },
            }),
            { status: 200 },
          );
        }
        // GET /api/v1/bot/referrals/:wallet — return stats keyed by
        // the trailing wallet segment, or 404 if the test did not
        // pre-register one. 404 collapses to `not_found` in api.ts
        // which `resolveReferrer` treats as "drop deeplink silently".
        const match = /\/api\/v1\/bot\/referrals\/(0x[0-9a-fA-F]{40})$/.exec(
          url,
        );
        if (match) {
          const wallet = match[1]!.toLowerCase();
          const lookup = opts.referralStatsByWallet ?? {};
          const hit = lookup[wallet];
          if (!hit) {
            return new Response(
              JSON.stringify({ error: "not found" }),
              { status: 404 },
            );
          }
          return new Response(
            JSON.stringify({
              data: {
                rewardsWallet: hit.rewardsWallet.toLowerCase(),
                referredCount: 0,
                lifetimeEarnedUsdc: "0",
                badPaymentCount: 0,
                attributionLossCount: 0,
              },
            }),
            { status: 200 },
          );
        }
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  };

  const harness = (): BotTestHarness => {
    const h = makeBotHarness();
    h.env.HYPEREVM_RPC_URL = RPC_URL;
    return h;
  };

  const profileFor = async (
    h: BotTestHarness,
    userId: number,
  ): Promise<{ createdAt: number; referrer: string | null } | null> => {
    const raw = (await h.kv.get(`profile:${userId}`)) as string | null;
    return raw === null
      ? null
      : (JSON.parse(raw) as { createdAt: number; referrer: string | null });
  };

  const usernameMappingFor = async (
    h: BotTestHarness,
    username: string,
  ): Promise<string | null> => {
    return (await h.kv.get(
      `tg-username:${username.toLowerCase()}`,
    )) as string | null;
  };

  it("first /start writes a profile and defaults rewards wallet to the new active wallet", async () => {
    const h = harness();
    mockAll();

    await h.run(startUpdate(7));

    const wallet = (await walletManager(h).getActive(7))!;
    const profile = await profileFor(h, 7);
    expect(profile).not.toBeNull();
    expect(profile!.referrer).toBeNull();
    expect(profile!.createdAt).toBeGreaterThan(0);

    const apiCalls = (fetchSpy.mock.calls as Array<[unknown, unknown?]>)
      .map((c) => String(c[0]).toLowerCase())
      .filter((u) => u.startsWith("https://api.test.local"));
    const rewardsPost = apiCalls.find((u) =>
      u.includes(
        `/api/v1/bot/referrals/${wallet.address.toLowerCase()}/rewards-wallet`,
      ),
    );
    expect(rewardsPost).toBeDefined();
  });

  it("records username → userId mapping on every /start when the user has a Telegram username", async () => {
    const h = harness();
    mockAll();

    await h.run(startUpdate(7, "private", { username: "AdaSharer" }));

    // Lowercased key — case-insensitive lookup for the deeplink parser.
    expect(await usernameMappingFor(h, "adasharer")).toBe("7");
  });

  it("ignores bare /start (no deeplink) — profile.referrer stays null", async () => {
    const h = harness();
    mockAll();

    await h.run(startUpdate(7));

    const profile = await profileFor(h, 7);
    expect(profile!.referrer).toBeNull();
  });

  it("resolves ref_<userId> when the referrer is already onboarded", async () => {
    const h = harness();
    // Pre-seed referrer (userId 42): they have an active wallet and
    // the api reports a known rewardsWallet for it.
    const wm = walletManager(h);
    const referrerWallet = await wm.createWallet(42, "ref");
    const expectedRewards = referrerWallet.address.toLowerCase();
    mockAll({
      referralStatsByWallet: {
        [referrerWallet.address.toLowerCase()]: {
          rewardsWallet: expectedRewards,
        },
      },
    });

    await h.run(startUpdate(7, "private", { param: "ref_42" }));

    const profile = await profileFor(h, 7);
    expect(profile!.referrer?.toLowerCase()).toBe(expectedRewards);
  });

  it("drops ref_<userId> silently when the referrer has not yet onboarded", async () => {
    const h = harness();
    mockAll();

    await h.run(startUpdate(7, "private", { param: "ref_42" }));

    const profile = await profileFor(h, 7);
    expect(profile!.referrer).toBeNull();
  });

  it("resolves ref_<username> via the username mapping written by an earlier /start", async () => {
    const h = harness();
    const wm = walletManager(h);
    const referrerWallet = await wm.createWallet(42, "ref");
    // Seed the username mapping the way a real prior /start would.
    await h.kv.put("tg-username:adasharer", "42");
    mockAll({
      referralStatsByWallet: {
        [referrerWallet.address.toLowerCase()]: {
          rewardsWallet: referrerWallet.address.toLowerCase(),
        },
      },
    });

    await h.run(startUpdate(7, "private", { param: "ref_AdaSharer" }));

    const profile = await profileFor(h, 7);
    expect(profile!.referrer?.toLowerCase()).toBe(
      referrerWallet.address.toLowerCase(),
    );
  });

  it("does not overwrite referrer on a repeat /start (lifetime attribution)", async () => {
    const h = harness();
    const wm = walletManager(h);
    const refA = await wm.createWallet(42, "refA");
    const refB = await wm.createWallet(99, "refB");
    mockAll({
      referralStatsByWallet: {
        [refA.address.toLowerCase()]: {
          rewardsWallet: refA.address.toLowerCase(),
        },
        [refB.address.toLowerCase()]: {
          rewardsWallet: refB.address.toLowerCase(),
        },
      },
    });

    // First /start binds the referrer to userId 42.
    await h.run(startUpdate(7, "private", { param: "ref_42" }));
    const firstProfile = await profileFor(h, 7);
    expect(firstProfile!.referrer?.toLowerCase()).toBe(
      refA.address.toLowerCase(),
    );

    // Second /start with a different deeplink must NOT overwrite.
    await h.run(startUpdate(7, "private", { param: "ref_99" }));
    const secondProfile = await profileFor(h, 7);
    expect(secondProfile!.referrer?.toLowerCase()).toBe(
      refA.address.toLowerCase(),
    );
  });

  it("ignores malformed deeplink params", async () => {
    const h = harness();
    mockAll();

    await h.run(startUpdate(7, "private", { param: "not_a_ref" }));

    const profile = await profileFor(h, 7);
    expect(profile!.referrer).toBeNull();
  });

  it("self-referral via ref_<own userId> binds the user's own wallet as the referrer", async () => {
    const h = harness();
    // No pre-existing wallet for user 7; the bot auto-creates during
    // /start. After creation, the api reports the user's own wallet
    // as their default rewardsWallet — so self-referral resolves to
    // that same address (spec: self-referral allowed, lowers effective
    // bot fee from 0.5% → 0.4%).
    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://api.telegram.org")) {
        return new Response(
          JSON.stringify({ ok: true, result: true }),
          { status: 200 },
        );
      }
      if (url === RPC_URL) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }),
          { status: 200 },
        );
      }
      if (url.startsWith("https://api.test.local")) {
        if (
          url.endsWith("/rewards-wallet") &&
          (init?.method ?? "GET") === "POST"
        ) {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            rewardsWallet?: string;
          };
          return new Response(
            JSON.stringify({
              data: { rewardsWallet: (body.rewardsWallet ?? "").toLowerCase() },
            }),
            { status: 200 },
          );
        }
        const match = /\/api\/v1\/bot\/referrals\/(0x[0-9a-fA-F]{40})$/.exec(
          url,
        );
        if (match) {
          // Echo: api defaults rewardsWallet to the wallet address
          // when no record is present, which is exactly what the
          // self-referral path relies on.
          return new Response(
            JSON.stringify({
              data: {
                rewardsWallet: match[1]!.toLowerCase(),
                referredCount: 0,
                lifetimeEarnedUsdc: "0",
                badPaymentCount: 0,
                attributionLossCount: 0,
              },
            }),
            { status: 200 },
          );
        }
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await h.run(startUpdate(7, "private", { param: "ref_7" }));

    const wallet = (await walletManager(h).getActive(7))!;
    const profile = await profileFor(h, 7);
    expect(profile!.referrer?.toLowerCase()).toBe(
      wallet.address.toLowerCase(),
    );
  });
});

/**
 * Action deeplink behaviour for /start — `buy_<addr>` and `sell_<addr>`
 * payloads emitted by the inline `Buy` / `Sell` HTML anchors on each
 * open position in `/positions`. The handler must skip the welcome
 * screen and reply with a fresh buy/sell card pre-loaded for the
 * selected token.
 */
describe("/start action deeplink (buy_/sell_)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const TOKEN = "0xaaaa000000000000000000000000000000000000";

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const mockActionFetch = (): void => {
    withTelegramOk(fetchSpy, async (input, init) => {
      const url = String(input);
      if (url === RPC_URL) {
        // ERC-20 `balanceOf` + native HYPE both decoded via BigInt.
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }),
          { status: 200 },
        );
      }
      if (url.startsWith("https://api.test.local")) {
        // POST .../rewards-wallet — echo back the wallet supplied by
        // the first-start onboarding side-effect.
        if (
          url.endsWith("/rewards-wallet") &&
          (init?.method ?? "GET") === "POST"
        ) {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            rewardsWallet?: string;
          };
          return new Response(
            JSON.stringify({
              data: {
                rewardsWallet: (body.rewardsWallet ?? "").toLowerCase(),
              },
            }),
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
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  };

  const sentBodies = (): Array<{
    text: string;
    reply_markup?: unknown;
  }> =>
    (fetchSpy.mock.calls as Array<[unknown, unknown?]>)
      .filter((call) => String(call[0]).includes("/sendMessage"))
      .map(
        (call) =>
          JSON.parse((call[1] as RequestInit).body as string) as {
            text: string;
            reply_markup?: unknown;
          },
      );

  it("buy_<addr> deeplink replies with a buy card and skips the welcome screen", async () => {
    const h = harnessWithRpc();
    mockActionFetch();
    await h.run(startUpdate(7, "private", { param: `buy_${TOKEN}` }));
    const sent = sentBodies();
    expect(sent).toHaveLength(1);
    const markup = sent[0]!.reply_markup as
      | { inline_keyboard: { text: string; callback_data: string }[][] }
      | undefined;
    expect(markup).toBeDefined();
    const allButtons = markup!.inline_keyboard.flat();
    // The buy-card keyboard exposes the standard quick-buy amounts —
    // proof the handler routed to `renderBuyTokenCardText`, not the
    // welcome message.
    expect(allButtons.some((b) => b.text.includes("Buy 20"))).toBe(true);
    // Welcome message would carry the address as a tap-to-copy block.
    expect(sent[0]!.text).not.toContain("Welcome to");
  });

  it("sell_<addr> deeplink replies with a sell card", async () => {
    const h = harnessWithRpc();
    mockActionFetch();
    await h.run(startUpdate(7, "private", { param: `sell_${TOKEN}` }));
    const sent = sentBodies();
    expect(sent).toHaveLength(1);
    const markup = sent[0]!.reply_markup as
      | { inline_keyboard: { text: string; callback_data: string }[][] }
      | undefined;
    expect(markup).toBeDefined();
    const allButtons = markup!.inline_keyboard.flat();
    expect(allButtons.some((b) => b.text === "Sell 100%")).toBe(true);
    expect(sent[0]!.text).not.toContain("Welcome to");
  });

  it("falls back to the welcome screen for a malformed action payload", async () => {
    const h = harnessWithRpc();
    // No token-data fetch should fire — only the welcome RPC + Telegram.
    mockBoth(fetchSpy);
    await h.run(startUpdate(7, "private", { param: "buy_not-an-address" }));
    const sent = sentBodies();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Welcome to");
  });
});
