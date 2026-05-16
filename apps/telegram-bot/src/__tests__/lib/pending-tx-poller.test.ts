import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionReceiptNotFoundError, encodeEventTopics, encodeAbiParameters } from "viem";
import { BotFeeRouterAbi } from "@launchpad/shared";

import {
  PENDING_TX_MAX_POLL_DURATION_MS,
  PENDING_TX_POLL_INTERVAL_MS,
  processPendingTxAlarm,
  schedulePendingTxPoll,
  type PendingTxRecord,
} from "../../lib/pending-tx-poller.js";

const TX_HASH = "0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabca" as const;
const TOKEN = "0x1111111111111111111111111111111111111111";

const RPC_URL = "https://rpc.test.local";

/**
 * In-memory stand-in for `DurableObjectStorage`. Only models the
 * surface `pending-tx-poller` actually touches: `get` / `put` /
 * `delete` / `list` (by prefix) and `getAlarm` / `setAlarm`.
 */
const makeStorage = () => {
  const map = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    map,
    get alarm() {
      return alarm;
    },
    set alarm(v: number | null) {
      alarm = v;
    },
    api: {
      get: async (k: string) => map.get(k),
      put: async (k: string, v: unknown) => {
        map.set(k, v);
      },
      delete: async (k: string) => {
        map.delete(k);
      },
      list: async ({ prefix }: { prefix: string }) => {
        const out = new Map<string, unknown>();
        for (const [k, v] of map) {
          if (k.startsWith(prefix)) out.set(k, v);
        }
        return out;
      },
      getAlarm: async () => alarm,
      setAlarm: async (when: number) => {
        alarm = when;
      },
      deleteAlarm: async () => {
        alarm = null;
      },
    },
  };
};

type FakeStorage = ReturnType<typeof makeStorage>;
const asStorage = (s: FakeStorage) => s.api as unknown as Parameters<typeof processPendingTxAlarm>[1];

const makeRecord = (overrides: Partial<PendingTxRecord> = {}): PendingTxRecord => ({
  txHash: TX_HASH,
  chatId: 42,
  messageId: 99,
  side: "buy",
  ticker: "TICK",
  token: TOKEN,
  quotedOut: "1000000000000000000",
  minOut: "950000000000000000",
  startedAt: Date.now(),
  ...overrides,
});

beforeEach(() => {
  vi.restoreAllMocks();
  // Stub global fetch so the bubble editor's Telegram REST call never
  // hits the wire. Each test rebinds this when it cares about the
  // call payload.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const env = {
  TELEGRAM_BOT_TOKEN: "test:abc",
  HYPEREVM_RPC_URL: RPC_URL,
  WALLET_KV: {
    get: async () => null,
    put: async () => {},
  } as unknown as KVNamespace,
} as unknown as Parameters<typeof processPendingTxAlarm>[0];

describe("schedulePendingTxPoll", () => {
  it("persists the record under a tx-hash-keyed slot and arms the alarm", async () => {
    const s = makeStorage();
    const rec = makeRecord();
    await schedulePendingTxPoll({ storage: asStorage(s) as never }, rec);
    expect(s.map.size).toBe(1);
    const key = `pendingTx:${rec.txHash.toLowerCase()}`;
    expect(s.map.get(key)).toEqual(rec);
    expect(s.alarm).not.toBeNull();
    expect(s.alarm! - Date.now()).toBeLessThanOrEqual(PENDING_TX_POLL_INTERVAL_MS);
  });

  it("keeps an earlier alarm and does not push it out when scheduling a second record", async () => {
    const s = makeStorage();
    const earlier = Date.now() + 1_000;
    s.alarm = earlier;
    await schedulePendingTxPoll(
      { storage: asStorage(s) as never },
      makeRecord({ txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    );
    expect(s.alarm).toBe(earlier);
  });
});

/**
 * Build a `Log` shaped like a `BotRouterTrade` event so the alarm
 * handler decodes `tokenAmount` / `usdcAmount` / `botFee` for the
 * receipt path.
 */
const buildRouterTradeLog = (args: {
  side: "buy" | "sell";
  tokenAmount: bigint;
  usdcAmount: bigint;
  botFee: bigint;
}) => {
  // `BotRouterTrade(trader indexed, token indexed, side, usdcAmount,
  // tokenAmount, botFee, referrer, referrerCut, treasuryCut)`. The
  // exact indexed/non-indexed split is router-specific, so we ask
  // viem to encode topics+data from the ABI.
  const topics = encodeEventTopics({
    abi: BotFeeRouterAbi,
    eventName: "BotRouterTrade",
    args: {
      trader: "0x0000000000000000000000000000000000000123",
      token: TOKEN as `0x${string}`,
    },
  });
  // Non-indexed args follow `BotRouterTrade` ABI order. Encode any
  // non-indexed fields conservatively; the decoder ignores fields it
  // doesn't read so an over-encoded data section is harmless. We just
  // need `tokenAmount`, `usdcAmount`, and `botFee` to round-trip.
  // We construct a payload manually keyed off the abi inputs.
  const event = (BotFeeRouterAbi as readonly { type: string; name?: string; inputs?: readonly { name: string; type: string; indexed?: boolean }[] }[]).find(
    (x) => x.type === "event" && x.name === "BotRouterTrade",
  );
  if (!event?.inputs) throw new Error("BotRouterTrade event not found in ABI");
  const nonIndexed = event.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(
    nonIndexed.map((i) => ({ name: i.name, type: i.type })),
    nonIndexed.map((i) => {
      switch (i.name) {
        case "side":
          return args.side === "buy" ? 0 : 1;
        case "usdcAmount":
          return args.usdcAmount;
        case "tokenAmount":
          return args.tokenAmount;
        case "botFee":
          return args.botFee;
        case "referrer":
          return "0x0000000000000000000000000000000000000000" as `0x${string}`;
        case "referrerCut":
          return 0n;
        case "treasuryCut":
          return args.botFee;
        default:
          if (i.type.startsWith("uint")) return 0n;
          if (i.type === "address") return "0x0000000000000000000000000000000000000000" as `0x${string}`;
          if (i.type === "string") return "";
          return 0n;
      }
    }) as never,
  );
  return { topics, data, address: "0x4444444444444444444444444444444444444444" as `0x${string}` };
};

describe("processPendingTxAlarm", () => {
  it("does nothing when there are no pending entries", async () => {
    const s = makeStorage();
    await processPendingTxAlarm(env, asStorage(s) as never);
    expect(s.alarm).toBeNull();
  });

  it("finalises a confirmed buy, edits the bubble, and clears the slot", async () => {
    const s = makeStorage();
    const rec = makeRecord({ side: "buy" });
    s.map.set(`pendingTx:${rec.txHash.toLowerCase()}`, rec);

    const log = buildRouterTradeLog({
      side: "buy",
      tokenAmount: 1_234_500_000_000_000_000n,
      usdcAmount: 20_000_000n,
      botFee: 100_000n,
    });
    const fakeReceipt = {
      status: "success",
      logs: [log],
      transactionHash: rec.txHash,
    };

    // Patch viem's `getTransactionReceipt` on the client by stubbing
    // the public-client builder via a module mock.
    const tradeModule = await import("../../lib/trade.js");
    const buildSpy = vi
      .spyOn(tradeModule, "buildPublicClient")
      .mockReturnValue({
        getTransactionReceipt: vi.fn().mockResolvedValue(fakeReceipt),
      } as unknown as ReturnType<typeof tradeModule.buildPublicClient>);

    const editSpy = vi.fn(
      async (_input: unknown, _init: unknown) =>
        new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", editSpy);

    await processPendingTxAlarm(env, asStorage(s) as never);

    expect(s.map.size).toBe(0);
    expect(editSpy).toHaveBeenCalled();
    const fetchCall = editSpy.mock.calls[0]!;
    const body = JSON.parse(String((fetchCall[1] as unknown as { body: string }).body));
    expect(body.text).toContain("Buy confirmed");
    expect(body.text).toContain(rec.txHash);

    buildSpy.mockRestore();
  });

  it("leaves the entry in place and reschedules the alarm when the receipt is not yet mined", async () => {
    const s = makeStorage();
    const rec = makeRecord();
    s.map.set(`pendingTx:${rec.txHash.toLowerCase()}`, rec);

    const tradeModule = await import("../../lib/trade.js");
    const notFound = new TransactionReceiptNotFoundError({ hash: rec.txHash });
    vi.spyOn(tradeModule, "buildPublicClient").mockReturnValue({
      getTransactionReceipt: vi.fn().mockRejectedValue(notFound),
    } as unknown as ReturnType<typeof tradeModule.buildPublicClient>);

    await processPendingTxAlarm(env, asStorage(s) as never);

    expect(s.map.size).toBe(1);
    expect(s.alarm).not.toBeNull();
    expect(s.alarm! - Date.now()).toBeLessThanOrEqual(PENDING_TX_POLL_INTERVAL_MS);
  });

  it("gives up after the max poll duration and stops re-arming the alarm", async () => {
    const s = makeStorage();
    const rec = makeRecord({
      startedAt: Date.now() - PENDING_TX_MAX_POLL_DURATION_MS - 1_000,
    });
    s.map.set(`pendingTx:${rec.txHash.toLowerCase()}`, rec);

    const tradeModule = await import("../../lib/trade.js");
    const notFound = new TransactionReceiptNotFoundError({ hash: rec.txHash });
    vi.spyOn(tradeModule, "buildPublicClient").mockReturnValue({
      getTransactionReceipt: vi.fn().mockRejectedValue(notFound),
    } as unknown as ReturnType<typeof tradeModule.buildPublicClient>);

    await processPendingTxAlarm(env, asStorage(s) as never);

    expect(s.map.size).toBe(0);
    // No remaining entries → no re-arm. Alarm pre-state was null.
    expect(s.alarm).toBeNull();
  });

  it("reverts a mined-but-failed receipt to an ❌ bubble", async () => {
    const s = makeStorage();
    const rec = makeRecord();
    s.map.set(`pendingTx:${rec.txHash.toLowerCase()}`, rec);

    const fakeReceipt = {
      status: "reverted",
      logs: [],
      transactionHash: rec.txHash,
    };

    const tradeModule = await import("../../lib/trade.js");
    vi.spyOn(tradeModule, "buildPublicClient").mockReturnValue({
      getTransactionReceipt: vi.fn().mockResolvedValue(fakeReceipt),
    } as unknown as ReturnType<typeof tradeModule.buildPublicClient>);

    const editSpy = vi.fn(
      async (_input: unknown, _init: unknown) =>
        new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", editSpy);

    await processPendingTxAlarm(env, asStorage(s) as never);

    const body = JSON.parse(String((editSpy.mock.calls[0]![1] as unknown as { body: string }).body));
    expect(body.text.startsWith("❌")).toBe(true);
    expect(s.map.size).toBe(0);
  });
});
