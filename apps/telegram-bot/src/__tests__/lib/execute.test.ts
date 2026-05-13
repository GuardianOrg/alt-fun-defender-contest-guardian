import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  CONFIRM_WINDOW_MS,
  cancelTrade,
  confirmKeyboard,
  confirmTrade,
  renderConfirmReply,
  stageBuy,
  stageSell,
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
    expect(reply).toContain("Buy submitted for TEST");
    expect(reply).toContain("hyperevmscan.io/tx/0xdeadbeef");
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
