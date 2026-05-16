import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AppBindings } from "../lib/types.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: DurableObjectState;
    env: AppBindings;
    constructor(ctx: DurableObjectState, env: AppBindings) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const mockReadContract = vi.fn();
vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: () => ({ readContract: mockReadContract }),
    http: () => null,
  };
});

const mockInsertChain = {
  values: vi.fn(),
  onConflictDoUpdate: vi.fn(),
};
mockInsertChain.values.mockReturnValue(mockInsertChain);
mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);

const mockDb = {
  insert: vi.fn(() => mockInsertChain),
};

vi.mock("../db/client.js", () => ({
  createDb: () => mockDb,
}));

const { LtDirectoryPoller } = await import("../websocket/lt-directory-poller.js");

function createState() {
  const state: { alarm: number | null; storage: Map<string, unknown> } = {
    alarm: null,
    storage: new Map(),
  };

  const storage = {
    get: vi.fn(async (key: string) => state.storage.get(key)),
    put: vi.fn(async (key: string, value: unknown) => {
      state.storage.set(key, value);
    }),
    getAlarm: vi.fn(async () => state.alarm),
    setAlarm: vi.fn(async (at: number) => {
      state.alarm = at;
    }),
  };

  const pendingInits: Promise<void>[] = [];
  const blockConcurrencyWhile = vi.fn(async (fn: () => Promise<void>) => {
    const p = fn();
    pendingInits.push(p);
    await p;
  });

  return {
    _state: state,
    pendingInits,
    ctx: { storage, blockConcurrencyWhile } as unknown as DurableObjectState,
  };
}

async function settleInit(pendingInits: Promise<void>[]) {
  await Promise.allSettled(pendingInits);
}

function makeEnv(): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "postgres://bouncetech",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "http://localhost:42069",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    LT_DIRECTORY_POLLER_DO: {} as DurableObjectNamespace,
  };
}

// Two address shapes — the helper returns lowercased addresses, but the
// poller persists checksummed.
const HYPE_2L_LOWER = "0xa000000000000000000000000000000000000001" as const;
const HYPE_2L_CHECKSUM = "0xA000000000000000000000000000000000000001" as const;

function stubHelperReturn(rows: Array<{
  leveragedToken: string;
  targetAsset: string;
  targetLeverage: bigint;
  isLong: boolean;
  exchangeRate: bigint;
  baseAssetBalance: bigint;
  totalAssets: bigint;
  mintPaused: boolean;
}>) {
  // viem's getLeveragedTokens read returns an array shaped like
  // `HelperReturn[]`. Fill the extra fields the poller doesn't use.
  mockReadContract.mockImplementation(async (args: {
    functionName: string;
  }) => {
    if (args.functionName === "getLeveragedTokens") {
      return rows.map((r) => ({
        ...r,
        marketId: 0,
        hyperliquidNotional: 0n,
        userCredit: 0n,
        credit: 0n,
        agentData: [],
        balanceOf: 0n,
        isStandbyMode: false,
      }));
    }
    if (args.functionName === "name") return "HYPE 2x Long";
    if (args.functionName === "symbol") return "HYPE2L";
    if (args.functionName === "decimals") return 18;
    throw new Error(`Unexpected readContract call: ${args.functionName}`);
  });
}

describe("LtDirectoryPoller self-kickstart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertChain.values.mockReturnValue(mockInsertChain);
    mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);
  });

  it("schedules an alarm in the constructor when none exists", async () => {
    const { ctx, pendingInits } = createState();
    new LtDirectoryPoller(ctx, makeEnv());
    await settleInit(pendingInits);
    expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(1);
  });

  it("does not schedule a second alarm when one already exists", async () => {
    const { ctx, _state, pendingInits } = createState();
    _state.alarm = Date.now() + 5000;
    new LtDirectoryPoller(ctx, makeEnv());
    await settleInit(pendingInits);
    expect(ctx.storage.setAlarm).not.toHaveBeenCalled();
  });
});

describe("LtDirectoryPoller /ensure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertChain.values.mockReturnValue(mockInsertChain);
    mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);
  });

  it("returns heartbeat state on /ensure", async () => {
    const { ctx, pendingInits } = createState();
    const poller = new LtDirectoryPoller(ctx, makeEnv());
    await settleInit(pendingInits);
    const res = await poller.fetch(new Request("https://internal/ensure"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lastTickAt: number | null };
    expect(body).toHaveProperty("lastTickAt");
  });

  it("returns 404 for unknown paths", async () => {
    const { ctx, pendingInits } = createState();
    const poller = new LtDirectoryPoller(ctx, makeEnv());
    await settleInit(pendingInits);
    const res = await poller.fetch(new Request("https://internal/other"));
    expect(res.status).toBe(404);
  });
});

describe("LtDirectoryPoller alarm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertChain.values.mockReturnValue(mockInsertChain);
    mockInsertChain.onConflictDoUpdate.mockResolvedValue(undefined);
  });

  async function buildPoller(
    ctx: DurableObjectState,
    pendingInits: Promise<void>[],
    env: AppBindings,
  ) {
    const poller = new LtDirectoryPoller(ctx, env);
    await settleInit(pendingInits);
    (ctx.storage.setAlarm as ReturnType<typeof vi.fn>).mockClear();
    return poller;
  }

  it("reschedules next alarm before any work runs", async () => {
    const { ctx, pendingInits } = createState();
    stubHelperReturn([
      {
        leveragedToken: HYPE_2L_LOWER,
        targetAsset: "HYPE",
        targetLeverage: 2_000_000_000_000_000_000n,
        isLong: true,
        exchangeRate: 1_000_000_000_000_000_000n,
        baseAssetBalance: 0n,
        totalAssets: 0n,
        mintPaused: false,
      },
    ]);

    const poller = await buildPoller(ctx, pendingInits, makeEnv());
    await poller.alarm();

    expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(1);
    const alarmTs = (ctx.storage.setAlarm as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as number;
    expect(alarmTs).toBeGreaterThan(Date.now());
  });

  it("upserts every LT returned by the helper, with checksummed addresses", async () => {
    const { ctx, pendingInits } = createState();
    stubHelperReturn([
      {
        leveragedToken: HYPE_2L_LOWER,
        targetAsset: "HYPE",
        targetLeverage: 2_000_000_000_000_000_000n,
        isLong: true,
        exchangeRate: 1_000_000_000_000_000_000n,
        baseAssetBalance: 500n,
        totalAssets: 900n,
        mintPaused: false,
      },
    ]);

    const poller = await buildPoller(ctx, pendingInits, makeEnv());
    await poller.alarm();

    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(mockInsertChain.values).toHaveBeenCalledTimes(1);
    const rows = mockInsertChain.values.mock.calls[0][0] as Array<{
      address: string;
      symbol: string;
      targetLeverage: number;
      exchangeRate: string;
      mintPaused: boolean;
      pollSequence: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].address).toBe(HYPE_2L_CHECKSUM);
    expect(rows[0].symbol).toBe("HYPE2L");
    // BounceTech encodes targetLeverage on-chain as 2 × 1e18; the poller
    // must unscale before persisting because the `target_leverage` schema
    // column is `integer` (max 2_147_483_647) and would overflow on the
    // raw wei-scaled bigint. Any future regression of the unscaling step
    // shows up here as `targetLeverage = 2e18`, which also trips the
    // sanity cap below.
    expect(rows[0].targetLeverage).toBe(2);
    expect(rows[0].targetLeverage).toBeLessThanOrEqual(1000);
    expect(rows[0].exchangeRate).toBe("1000000000000000000");
    expect(rows[0].mintPaused).toBe(false);
    expect(rows[0].pollSequence).toBe(1);

    expect(mockInsertChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("reschedules the next alarm even when the helper read throws", async () => {
    const { ctx, pendingInits } = createState();
    mockReadContract.mockRejectedValue(new Error("rpc unavailable"));

    const poller = await buildPoller(ctx, pendingInits, makeEnv());
    await poller.alarm();

    expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("does not clobber existing rows on an empty helper response", async () => {
    const { ctx, pendingInits } = createState();
    stubHelperReturn([]);

    const poller = await buildPoller(ctx, pendingInits, makeEnv());
    await poller.alarm();

    expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("emits a structured warn log on an empty helper response so the condition shows up in real-time logs", async () => {
    const { ctx, pendingInits } = createState();
    stubHelperReturn([]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const poller = await buildPoller(ctx, pendingInits, makeEnv());
    await poller.alarm();

    const events = logSpy.mock.calls
      .map(([msg]) => {
        try {
          return JSON.parse(msg as string) as {
            level?: string;
            event?: string;
          };
        } catch {
          return null;
        }
      })
      .filter((e): e is { level: string; event: string } => e !== null);
    expect(
      events.some(
        (e) =>
          e.event === "lt_directory_poller_empty_response" &&
          e.level === "warn",
      ),
    ).toBe(true);

    logSpy.mockRestore();
  });

  it("bumps pollSequence monotonically across successful ticks", async () => {
    const { ctx, pendingInits } = createState();
    stubHelperReturn([
      {
        leveragedToken: HYPE_2L_LOWER,
        targetAsset: "HYPE",
        targetLeverage: 2_000_000_000_000_000_000n,
        isLong: true,
        exchangeRate: 1n,
        baseAssetBalance: 0n,
        totalAssets: 0n,
        mintPaused: false,
      },
    ]);

    const poller = await buildPoller(ctx, pendingInits, makeEnv());
    await poller.alarm();
    await poller.alarm();

    const firstCall = mockInsertChain.values.mock.calls[0][0] as Array<{
      pollSequence: number;
    }>;
    const secondCall = mockInsertChain.values.mock.calls[1][0] as Array<{
      pollSequence: number;
    }>;
    expect(firstCall[0].pollSequence).toBe(1);
    expect(secondCall[0].pollSequence).toBe(2);
  });

  it("skips malformed-leverage rows individually so one bad row can't fail the whole batch", async () => {
    const { ctx, pendingInits } = createState();
    const HYPE_3L_LOWER = "0xa000000000000000000000000000000000000002" as const;
    const HYPE_5L_LOWER = "0xa000000000000000000000000000000000000003" as const;
    stubHelperReturn([
      {
        leveragedToken: HYPE_2L_LOWER,
        targetAsset: "HYPE",
        targetLeverage: 2_000_000_000_000_000_000n,
        isLong: true,
        exchangeRate: 1n,
        baseAssetBalance: 0n,
        totalAssets: 0n,
        mintPaused: false,
      },
      {
        // Wildly out-of-range value — would overflow `integer` (max
        // 2_147_483_647) post-descaling and atomically fail the batch
        // upsert. Guard must skip this row instead.
        leveragedToken: HYPE_3L_LOWER,
        targetAsset: "HYPE",
        targetLeverage:
          10_000_000_000n * TARGET_LEVERAGE_SCALE_TEST,
        isLong: true,
        exchangeRate: 1n,
        baseAssetBalance: 0n,
        totalAssets: 0n,
        mintPaused: false,
      },
      {
        leveragedToken: HYPE_5L_LOWER,
        targetAsset: "HYPE",
        targetLeverage: 5_000_000_000_000_000_000n,
        isLong: true,
        exchangeRate: 1n,
        baseAssetBalance: 0n,
        totalAssets: 0n,
        mintPaused: false,
      },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const poller = await buildPoller(ctx, pendingInits, makeEnv());
    await poller.alarm();

    // Two good rows upserted; one bad row skipped.
    expect(mockInsertChain.values).toHaveBeenCalledTimes(1);
    const rows = mockInsertChain.values.mock.calls[0][0] as Array<{
      targetLeverage: number;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.targetLeverage).sort()).toEqual([2, 5]);

    // Structured warn surfaces the skip so it shows up in live tail.
    const events = logSpy.mock.calls
      .map(([msg]) => {
        try {
          return JSON.parse(msg as string) as {
            level?: string;
            event?: string;
          };
        } catch {
          return null;
        }
      })
      .filter((e): e is { level: string; event: string } => e !== null);
    expect(
      events.some(
        (e) =>
          e.event === "lt_directory_invalid_target_leverage" &&
          e.level === "warn",
      ),
    ).toBe(true);

    logSpy.mockRestore();
  });
});

// Mirrors the poller's TARGET_LEVERAGE_SCALE — kept local to the test so the
// fixture can construct intentionally-out-of-range values without importing
// from the module under test (and exposing the constant publicly).
const TARGET_LEVERAGE_SCALE_TEST = 10n ** 18n;
