import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  CONFIRM_WINDOW_MS,
  cancelTrade,
  confirmKeyboard,
  confirmTrade,
  loadReferrer,
  renderConfirmReply,
  stageBuy,
  stageSell,
  submitBuy,
  submitSell,
} from "../../lib/execute.js";
import * as trade from "../../lib/trade.js";
import { MemoryKV } from "../helpers/bot.js";
import type { AppContext, SessionData } from "../../bot.js";
import { WalletManager } from "../../lib/wallet.js";

const ZERO_MASTER_KEY = btoa("\0".repeat(32));

const TOKEN = "0x1111111111111111111111111111111111111111";

const fakeCtx = async (
  session: Partial<SessionData> = {},
): Promise<{ ctx: AppContext; kv: MemoryKV }> => {
  const kv = new MemoryKV();
  const wm = new WalletManager(kv as unknown as KVNamespace, ZERO_MASTER_KEY);
  await wm.createWallet(7);

  const ctx = {
    from: { id: 7, is_bot: false, first_name: "Ada" },
    session: {
      slippageBps: 100,
      defaultBuyUsdc: 50,
      degenMode: false,
      ...session,
    },
    env: {
      WALLET_KV: kv,
      MASTER_KEY: ZERO_MASTER_KEY,
      BOT_FEE_ROUTER_ADDRESS: "0x4444444444444444444444444444444444444444",
      HYPEREVM_RPC_URL: "https://rpc.test.local",
    },
  } as unknown as AppContext;

  return { ctx, kv };
};

describe("stageBuy / stageSell", () => {
  it("writes a pendingTrade with nonce and expiry", async () => {
    const { ctx } = await fakeCtx();
    const before = Date.now();
    const { nonce, expiresAt } = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "TEST",
      usdcRaw: 20_000_000n,
    });
    expect(ctx.session.pendingTrade).toMatchObject({
      side: "buy",
      token: TOKEN,
      ticker: "TEST",
      amountRaw: "20000000",
      nonce,
    });
    expect(expiresAt).toBeGreaterThanOrEqual(before + CONFIRM_WINDOW_MS - 5);
  });

  it("stageSell stores side='sell' and the token-raw amount as string", async () => {
    const { ctx } = await fakeCtx();
    stageSell({
      ctx,
      token: TOKEN,
      ticker: "TEST",
      tokenRaw: 10n ** 18n,
    });
    expect(ctx.session.pendingTrade?.side).toBe("sell");
    expect(ctx.session.pendingTrade?.amountRaw).toBe(
      (10n ** 18n).toString(),
    );
  });

  it("each stage call mints a new nonce so a stale Confirm becomes a no-op", async () => {
    const { ctx } = await fakeCtx();
    const a = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    const b = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 30_000_000n,
    });
    expect(a.nonce).not.toBe(b.nonce);
    expect(ctx.session.pendingTrade?.nonce).toBe(b.nonce);
  });
});

describe("confirmKeyboard", () => {
  it("returns Confirm + Cancel buttons keyed on the nonce", () => {
    const kb = confirmKeyboard("abc123");
    expect(kb[0]).toEqual([
      { text: "✅ Confirm", callback_data: "cnf:abc123" },
      { text: "✖ Cancel", callback_data: "ccl:abc123" },
    ]);
  });
});

describe("confirmTrade", () => {
  let execBuySpy: ReturnType<typeof vi.spyOn>;
  let execSellSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execBuySpy = vi.spyOn(trade, "executeBuy");
    execSellSpy = vi.spyOn(trade, "executeSell");
  });
  afterEach(() => {
    execBuySpy.mockRestore();
    execSellSpy.mockRestore();
  });

  it("returns 'expired' when no pendingTrade is staged", async () => {
    const { ctx } = await fakeCtx();
    const outcome = await confirmTrade(ctx, "anything");
    expect(outcome).toEqual({ kind: "expired" });
    expect(execBuySpy).not.toHaveBeenCalled();
  });

  it("returns 'expired' when nonce does not match", async () => {
    const { ctx } = await fakeCtx();
    stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    const outcome = await confirmTrade(ctx, "wrong-nonce");
    expect(outcome).toEqual({ kind: "expired" });
    expect(execBuySpy).not.toHaveBeenCalled();
  });

  it("returns 'expired' when the intent has aged past the window", async () => {
    const { ctx } = await fakeCtx();
    const { nonce } = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    ctx.session.pendingTrade!.expiresAt = Date.now() - 1;
    const outcome = await confirmTrade(ctx, nonce);
    expect(outcome).toEqual({ kind: "expired" });
  });

  it("executes a buy and clears the pendingTrade slot", async () => {
    execBuySpy.mockResolvedValue({
      ok: true,
      txHash: "0xabc",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx } = await fakeCtx();
    const { nonce } = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    const outcome = await confirmTrade(ctx, nonce);
    expect(outcome.kind).toBe("executed");
    expect(execBuySpy).toHaveBeenCalledTimes(1);
    expect(execSellSpy).not.toHaveBeenCalled();
    expect(ctx.session.pendingTrade).toBeUndefined();
  });

  it("dispatches stageSell intents to executeSell", async () => {
    execSellSpy.mockResolvedValue({
      ok: true,
      txHash: "0xbeef",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx } = await fakeCtx();
    const { nonce } = stageSell({
      ctx,
      token: TOKEN,
      ticker: "T",
      tokenRaw: 10n ** 18n,
    });
    const outcome = await confirmTrade(ctx, nonce);
    expect(outcome.kind).toBe("executed");
    expect(execSellSpy).toHaveBeenCalledTimes(1);
    expect(execBuySpy).not.toHaveBeenCalled();
  });

  it("clears the slot before executing so a duplicate Confirm cannot replay", async () => {
    let inFlight: Promise<unknown> | null = null;
    execBuySpy.mockImplementation(() => {
      // Slot must already be cleared at the moment the underlying call
      // fires — prevents replay even if a second Confirm tap arrives
      // before the first one's promise resolves.
      inFlight = Promise.resolve();
      return inFlight as Promise<never>;
    });
    const { ctx } = await fakeCtx();
    const { nonce } = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    await confirmTrade(ctx, nonce);
    expect(ctx.session.pendingTrade).toBeUndefined();
    // Second tap with the same nonce must now find an empty slot.
    const replay = await confirmTrade(ctx, nonce);
    expect(replay).toEqual({ kind: "expired" });
    expect(execBuySpy).toHaveBeenCalledTimes(1);
  });

  it("returns 'no_wallet' when the user has no active wallet", async () => {
    const kv = new MemoryKV();
    const ctx = {
      from: { id: 99, is_bot: false, first_name: "X" },
      session: {
        slippageBps: 100,
        defaultBuyUsdc: 50,
        degenMode: false,
      },
      env: {
        WALLET_KV: kv,
        MASTER_KEY: ZERO_MASTER_KEY,
        BOT_FEE_ROUTER_ADDRESS: "0x4444444444444444444444444444444444444444",
      },
    } as unknown as AppContext;
    const { nonce } = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    const outcome = await confirmTrade(ctx, nonce);
    expect(outcome.kind).toBe("no_wallet");
    expect(execBuySpy).not.toHaveBeenCalled();
  });
});

describe("renderConfirmReply", () => {
  it("renders expired copy", () => {
    expect(renderConfirmReply({ kind: "expired" })).toMatch(/expired/i);
  });

  it("renders no_wallet copy", () => {
    expect(renderConfirmReply({ kind: "no_wallet" })).toMatch(/no active wallet/i);
  });

  it("renders a success tx link with the ticker", () => {
    const reply = renderConfirmReply({
      kind: "executed",
      side: "buy",
      ticker: "TEST",
      result: {
        ok: true,
        txHash:
          "0xdeadbeef000000000000000000000000000000000000000000000000000000ab",
        quotedOut: 1n,
        minOut: 1n,
      },
    });
    expect(reply).toContain("Buy confirmed for TEST");
    expect(reply).toContain("hyperevmscan.io/tx/0xdeadbeef");
    // Fee summary lives only in /help fees per issue #801 — never on
    // the buy/sell menu and never on the receipt.
    expect(reply).not.toContain("Bot fee 0.5%");
    expect(reply).not.toContain("Alt Fun fee 0.5%");
  });

  it("includes the on-chain tokens received on a buy when actualTokensOut is set (issue #802)", () => {
    // Confirm reply now surfaces the actual on-chain amount decoded
    // from the BotRouterTrade log, formatted via formatToken18 against
    // the user-supplied ticker. Pre-fix the user saw only the tx hash.
    const reply = renderConfirmReply({
      kind: "executed",
      side: "buy",
      ticker: "TEST",
      result: {
        ok: true,
        txHash:
          "0xdeadbeef000000000000000000000000000000000000000000000000000000ab",
        quotedOut: 1_200n * 10n ** 18n,
        minOut: 1_100n * 10n ** 18n,
        // 1234.5 tokens, 18-dp raw.
        actualTokensOut: 1_234_500_000_000_000_000_000n,
      },
    });
    expect(reply).toMatch(/Received:\s+1,?234\.50\d* TEST/);
    expect(reply).toContain("Buy confirmed for TEST");
  });

  it("includes the on-chain net USDC received on a sell when actualUsdcOut is set", () => {
    // For sells, the receipt parses `BotRouterTrade.usdcAmount - botFee`
    // and surfaces it as the user-facing "Received: $X USDC" line —
    // mirroring the buy receipt's tokens-received line, but in USDC
    // (the user-facing currency on the sell side).
    const reply = renderConfirmReply({
      kind: "executed",
      side: "sell",
      ticker: "TEST",
      result: {
        ok: true,
        txHash:
          "0xdeadbeef000000000000000000000000000000000000000000000000000000ab",
        quotedOut: 12_500_000n,
        minOut: 12_000_000n,
        // 12.34 USDC, 6-dp raw.
        actualUsdcOut: 12_340_000n,
      },
    });
    expect(reply).toMatch(/Received:\s+\$12\.34 USDC/);
    expect(reply).toContain("Sell confirmed for TEST");
  });

  it("omits the received line on a sell when actualUsdcOut is missing", () => {
    // Router version drift or a log-stripping relayer can leave
    // actualUsdcOut undefined. The confirm reply must not surface a
    // misleading "Received" line built from the pre-trade quote.
    const reply = renderConfirmReply({
      kind: "executed",
      side: "sell",
      ticker: "TEST",
      result: {
        ok: true,
        txHash:
          "0xdeadbeef000000000000000000000000000000000000000000000000000000ab",
        quotedOut: 1n,
        minOut: 1n,
      },
    });
    expect(reply).not.toMatch(/Received:/);
    expect(reply).toContain("Sell confirmed for TEST");
  });

  it("renders the mapped error copy on failure", () => {
    const reply = renderConfirmReply({
      kind: "executed",
      side: "buy",
      ticker: "TEST",
      result: {
        ok: false,
        kind: "reverted",
        reason: "SlippageExceeded",
      },
    });
    expect(reply).toMatch(/Price moved/);
  });

  it("renders ⏳ (not ❌) with explorer link for a pending receipt-timeout result", () => {
    // Receipt-timeout = tx in mempool, outcome unknown. Prefixing with
    // ❌ would tell the user their trade failed even though the chain
    // may still mine it to success or revert. ⏳ matches the "pending,
    // check explorer" semantics the reviewer asked for.
    const reply = renderConfirmReply({
      kind: "executed",
      side: "buy",
      ticker: "TEST",
      result: {
        ok: false,
        kind: "pending",
        reason: "WaitForTransactionReceiptTimeoutError",
        txHash:
          "0xdeadbeef000000000000000000000000000000000000000000000000000000ab",
      },
    });
    expect(reply.startsWith("⏳")).toBe(true);
    expect(reply).not.toMatch(/^❌/);
    expect(reply).toMatch(/pending/i);
    expect(reply).toContain("hyperevmscan.io/tx/0xdeadbeef");
  });
});

describe("loadReferrer", () => {
  const ZERO = "0x0000000000000000000000000000000000000000";
  const env = (kv: MemoryKV) =>
    ({
      WALLET_KV: kv as unknown as KVNamespace,
      MASTER_KEY: ZERO_MASTER_KEY,
    } as unknown as AppContext["env"]);

  const writeProfile = async (
    kv: MemoryKV,
    userId: number,
    referrer: string | null,
  ): Promise<void> => {
    await kv.put(
      `profile:${userId}`,
      JSON.stringify({ createdAt: 1, referrer }),
    );
  };

  it("returns ZERO_ADDRESS when no profile is recorded", async () => {
    const kv = new MemoryKV();
    const ref = await loadReferrer(env(kv), 7);
    expect(ref).toBe(ZERO);
  });

  it("returns ZERO_ADDRESS when profile.referrer is null", async () => {
    const kv = new MemoryKV();
    await writeProfile(kv, 7, null);
    const ref = await loadReferrer(env(kv), 7);
    expect(ref).toBe(ZERO);
  });

  it("returns the referrer stored on the profile", async () => {
    const kv = new MemoryKV();
    const wallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await writeProfile(kv, 7, wallet);
    const ref = await loadReferrer(env(kv), 7);
    expect(ref).toBe(wallet);
  });

  it("coerces a malformed profile JSON to ZERO_ADDRESS", async () => {
    const kv = new MemoryKV();
    await kv.put("profile:7", "not-json");
    const ref = await loadReferrer(env(kv), 7);
    expect(ref).toBe(ZERO);
  });

  it("ignores a stale orphan referrer:<id> KV key (regression for #BUG)", async () => {
    // Earlier code wrote/read a `referrer:<id>` key that no production
    // call site populated, so every trade silently passed ZERO_ADDRESS
    // to BotFeeRouter and `referrerStats` never accrued. The current
    // path reads from `profile:<id>` only — assert the orphan key has
    // no effect.
    const kv = new MemoryKV();
    const wallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await kv.put("referrer:7", wallet);
    const ref = await loadReferrer(env(kv), 7);
    expect(ref).toBe(ZERO);
  });
});

describe("confirmTrade referrer propagation", () => {
  let execBuySpy: ReturnType<typeof vi.spyOn>;
  let execSellSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execBuySpy = vi.spyOn(trade, "executeBuy");
    execSellSpy = vi.spyOn(trade, "executeSell");
  });
  afterEach(() => {
    execBuySpy.mockRestore();
    execSellSpy.mockRestore();
  });

  it("passes the user's stored referrer to executeBuy (not ZERO_ADDRESS)", async () => {
    execBuySpy.mockResolvedValue({
      ok: true,
      txHash: "0xabc",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx, kv } = await fakeCtx();
    const referrer = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await kv.put(
      "profile:7",
      JSON.stringify({ createdAt: 1, referrer }),
    );
    const { nonce } = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    await confirmTrade(ctx, nonce);
    expect(execBuySpy).toHaveBeenCalledTimes(1);
    const call = execBuySpy.mock.calls[0] as [unknown, { referrer: string }];
    expect(call[1].referrer).toBe(referrer);
  });

  it("falls back to ZERO_ADDRESS when no referrer is stored on the profile", async () => {
    execBuySpy.mockResolvedValue({
      ok: true,
      txHash: "0xabc",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx } = await fakeCtx();
    const { nonce } = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    await confirmTrade(ctx, nonce);
    const call = execBuySpy.mock.calls[0] as [unknown, { referrer: string }];
    expect(call[1].referrer).toBe("0x0000000000000000000000000000000000000000");
  });
});

describe("confirmTrade idempotency wiring", () => {
  let execBuySpy: ReturnType<typeof vi.spyOn>;
  let execSellSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execBuySpy = vi.spyOn(trade, "executeBuy");
    execSellSpy = vi.spyOn(trade, "executeSell");
  });
  afterEach(() => {
    execBuySpy.mockRestore();
    execSellSpy.mockRestore();
  });

  it("passes a KV-backed idempotency binding keyed on (userId, nonce) to executeBuy", async () => {
    execBuySpy.mockResolvedValue({
      ok: true,
      txHash: "0xabc",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx, kv } = await fakeCtx();
    const { nonce } = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    await confirmTrade(ctx, nonce);
    const call = execBuySpy.mock.calls[0] as [
      unknown,
      { idempotency?: { kv: unknown; key: string } },
    ];
    // The binding is what protects against double-spend on webhook retry —
    // if this regresses to `undefined`, the commit-log layer is bypassed
    // and the only protection left is the in-memory session clear.
    expect(call[1].idempotency).toBeDefined();
    expect(call[1].idempotency?.kv).toBe(kv);
    // Key encodes both the Telegram user id and the staged nonce so
    // different users / intents never collide. The user id here matches
    // the `fakeCtx` setup (7) and the nonce is the one `stageBuy`
    // minted into the session.
    expect(call[1].idempotency?.key).toBe(`txintent:7:${nonce}`);
  });

  it("passes the same idempotency binding shape to executeSell", async () => {
    execSellSpy.mockResolvedValue({
      ok: true,
      txHash: "0xbeef",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx } = await fakeCtx();
    const { nonce } = stageSell({
      ctx,
      token: TOKEN,
      ticker: "T",
      tokenRaw: 10n ** 18n,
    });
    await confirmTrade(ctx, nonce);
    const call = execSellSpy.mock.calls[0] as [
      unknown,
      { idempotency?: { kv: unknown; key: string } },
    ];
    expect(call[1].idempotency).toBeDefined();
    expect(call[1].idempotency?.key).toBe(`txintent:7:${nonce}`);
  });
});

describe("submitBuy / submitSell (degen-mode entry)", () => {
  let execBuySpy: ReturnType<typeof vi.spyOn>;
  let execSellSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execBuySpy = vi.spyOn(trade, "executeBuy");
    execSellSpy = vi.spyOn(trade, "executeSell");
  });
  afterEach(() => {
    execBuySpy.mockRestore();
    execSellSpy.mockRestore();
  });

  it("submitBuy stages and immediately executes — no nonce-gated confirm step", async () => {
    execBuySpy.mockResolvedValue({
      ok: true,
      txHash: "0xabc",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx } = await fakeCtx();
    const outcome = await submitBuy({
      ctx,
      token: TOKEN,
      ticker: "TEST",
      usdcRaw: 20_000_000n,
    });
    expect(outcome.kind).toBe("executed");
    expect(execBuySpy).toHaveBeenCalledTimes(1);
    // The intent slot is cleared by the time the call returns — a Confirm
    // tap from a stale UI message must not be able to replay.
    expect(ctx.session.pendingTrade).toBeUndefined();
  });

  it("submitSell routes through executeSell with the staged token amount", async () => {
    execSellSpy.mockResolvedValue({
      ok: true,
      txHash: "0xbeef",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx } = await fakeCtx();
    const outcome = await submitSell({
      ctx,
      token: TOKEN,
      ticker: "TEST",
      tokenRaw: 10n ** 18n,
    });
    expect(outcome.kind).toBe("executed");
    expect(execSellSpy).toHaveBeenCalledTimes(1);
    expect(execBuySpy).not.toHaveBeenCalled();
    const call = execSellSpy.mock.calls[0] as [unknown, { tokenAmount: bigint }];
    expect(call[1].tokenAmount).toBe(10n ** 18n);
  });

  it("submitBuy still propagates the user's stored referrer", async () => {
    execBuySpy.mockResolvedValue({
      ok: true,
      txHash: "0xabc",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx, kv } = await fakeCtx();
    const referrer = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await kv.put(
      "profile:7",
      JSON.stringify({ createdAt: 1, referrer }),
    );
    await submitBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    const call = execBuySpy.mock.calls[0] as [unknown, { referrer: string }];
    expect(call[1].referrer).toBe(referrer);
  });
});

describe("post-trade workflow-stack sweep", () => {
  let execBuySpy: ReturnType<typeof vi.spyOn>;
  let execSellSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execBuySpy = vi.spyOn(trade, "executeBuy");
    execSellSpy = vi.spyOn(trade, "executeSell");
  });
  afterEach(() => {
    execBuySpy.mockRestore();
    execSellSpy.mockRestore();
  });

  /**
   * Build a ctx with a stub `api.deleteMessage`, a chat id, and any
   * workflow-stack entries pre-loaded. Mirrors what a real chat looks
   * like by the time the user taps Confirm: the stack already holds
   * the token-detail card + the "Ready to…" staging prompt, both
   * pushed by the upstream callback handler.
   */
  const fakeCtxWithSweep = async (
    stack: { chatId: number; messageId: number }[] = [],
  ) => {
    const { ctx, kv } = await fakeCtx();
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    (ctx as unknown as { api: unknown }).api = { deleteMessage };
    (ctx as unknown as { chat: unknown }).chat = { id: 7, type: "private" };
    ctx.session.workflowMessages = [...stack];
    return { ctx, kv, deleteMessage };
  };

  it("deletes every tracked workflow message on a successful buy", async () => {
    execBuySpy.mockResolvedValue({
      ok: true,
      txHash: "0xabc",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx, deleteMessage } = await fakeCtxWithSweep([
      { chatId: 7, messageId: 555 }, // token-detail card
      { chatId: 7, messageId: 556 }, // "Ready to buy…" staging prompt
    ]);
    const { nonce } = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    await confirmTrade(ctx, nonce);
    expect(deleteMessage).toHaveBeenCalledTimes(2);
    expect(deleteMessage).toHaveBeenCalledWith(7, 555);
    expect(deleteMessage).toHaveBeenCalledWith(7, 556);
    expect(ctx.session.workflowMessages).toEqual([]);
  });

  it("deletes every tracked workflow message on a successful sell", async () => {
    execSellSpy.mockResolvedValue({
      ok: true,
      txHash: "0xbeef",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx, deleteMessage } = await fakeCtxWithSweep([
      { chatId: 7, messageId: 222 },
    ]);
    const { nonce } = stageSell({
      ctx,
      token: TOKEN,
      ticker: "T",
      tokenRaw: 10n ** 18n,
    });
    await confirmTrade(ctx, nonce);
    expect(deleteMessage).toHaveBeenCalledWith(7, 222);
  });

  it("preserves entries for OTHER chats on sweep (per-chat scope)", async () => {
    execBuySpy.mockResolvedValue({
      ok: true,
      txHash: "0xabc",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx, deleteMessage } = await fakeCtxWithSweep([
      { chatId: 7, messageId: 100 },
      { chatId: 99, messageId: 200 }, // different chat — must survive
    ]);
    const { nonce } = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    await confirmTrade(ctx, nonce);
    expect(deleteMessage).toHaveBeenCalledTimes(1);
    expect(deleteMessage).toHaveBeenCalledWith(7, 100);
    expect(ctx.session.workflowMessages).toEqual([
      { chatId: 99, messageId: 200 },
    ]);
  });

  it("does NOT sweep when the trade reverts (user may want to retry from the card)", async () => {
    execBuySpy.mockResolvedValue({
      ok: false,
      kind: "reverted",
      reason: "SlippageExceeded",
    });
    const { ctx, deleteMessage } = await fakeCtxWithSweep([
      { chatId: 7, messageId: 555 },
    ]);
    const { nonce } = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    await confirmTrade(ctx, nonce);
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(ctx.session.workflowMessages).toEqual([
      { chatId: 7, messageId: 555 },
    ]);
  });

  it("does NOT sweep when the receipt is still pending (tx in mempool)", async () => {
    execBuySpy.mockResolvedValue({
      ok: false,
      kind: "pending",
      reason: "WaitForTransactionReceiptTimeoutError",
      txHash: "0xabc",
    });
    const { ctx, deleteMessage } = await fakeCtxWithSweep([
      { chatId: 7, messageId: 555 },
    ]);
    const { nonce } = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    await confirmTrade(ctx, nonce);
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it("swallows a Telegram 400 'message not found' on each delete (already gone)", async () => {
    execBuySpy.mockResolvedValue({
      ok: true,
      txHash: "0xabc",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx, kv } = await fakeCtx();
    const deleteMessage = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("Bad Request: message to delete not found"), {
          error_code: 400,
          description: "Bad Request: message to delete not found",
        }),
      );
    (ctx as unknown as { api: unknown }).api = { deleteMessage };
    (ctx as unknown as { chat: unknown }).chat = { id: 7, type: "private" };
    ctx.session.workflowMessages = [{ chatId: 7, messageId: 555 }];
    void kv;
    const { nonce } = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    const outcome = await confirmTrade(ctx, nonce);
    expect(outcome.kind).toBe("executed");
    expect(deleteMessage).toHaveBeenCalledTimes(1);
  });

  it("submitBuy (degen-mode) sweeps the stack on success", async () => {
    execBuySpy.mockResolvedValue({
      ok: true,
      txHash: "0xabc",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx, deleteMessage } = await fakeCtxWithSweep([
      { chatId: 7, messageId: 88 },
    ]);
    await submitBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    expect(deleteMessage).toHaveBeenCalledWith(7, 88);
  });

  it("submitSell (degen-mode) sweeps the stack on success", async () => {
    execSellSpy.mockResolvedValue({
      ok: true,
      txHash: "0xbeef",
      quotedOut: 1n,
      minOut: 1n,
    });
    const { ctx, deleteMessage } = await fakeCtxWithSweep([
      { chatId: 7, messageId: 88 },
    ]);
    await submitSell({
      ctx,
      token: TOKEN,
      ticker: "T",
      tokenRaw: 10n ** 18n,
    });
    expect(deleteMessage).toHaveBeenCalledWith(7, 88);
  });
});

describe("cancelTrade", () => {
  it("clears the pendingTrade when the nonce matches", async () => {
    const { ctx } = await fakeCtx();
    const { nonce } = stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    expect(cancelTrade(ctx, nonce)).toBe(true);
    expect(ctx.session.pendingTrade).toBeUndefined();
  });

  it("returns false and preserves the slot when the nonce mismatches", async () => {
    const { ctx } = await fakeCtx();
    stageBuy({
      ctx,
      token: TOKEN,
      ticker: "T",
      usdcRaw: 20_000_000n,
    });
    expect(cancelTrade(ctx, "wrong")).toBe(false);
    expect(ctx.session.pendingTrade).toBeDefined();
  });
});
