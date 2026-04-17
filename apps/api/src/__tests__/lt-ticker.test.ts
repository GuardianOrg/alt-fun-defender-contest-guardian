import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AppBindings } from "../lib/types.js";

// --- Stub cloudflare:workers DurableObject base class ---
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

// --- Mock DB select (tracks distinct LT addresses) ---
const mockSelectDistinct = vi.fn();

vi.mock("../db/client.js", () => ({
  createDb: () => ({ selectDistinct: mockSelectDistinct }),
}));

// --- Mock Neon (BounceTech snapshot rows) ---
const mockNeonQuery = vi.fn();
vi.mock("@neondatabase/serverless", () => ({
  neon: () => mockNeonQuery,
}));

// --- Mock broadcastToChannel ---
const mockBroadcast = vi.fn();
vi.mock("../lib/broadcast.js", () => ({
  broadcastToChannel: mockBroadcast,
}));

// Import under test AFTER mocks.
const { LtTicker } = await import("../websocket/lt-ticker.js");

function createState() {
  const state: Record<string, unknown> = {
    alarm: null as number | null,
  };

  const storage = {
    getAlarm: vi.fn(async () => state.alarm as number | null),
    setAlarm: vi.fn(async (at: number) => {
      state.alarm = at;
    }),
  };

  return {
    _state: state,
    ctx: { storage } as unknown as DurableObjectState,
  };
}

function makeEnv(): AppBindings {
  return {
    DATABASE_URL: "postgres://test",
    BOUNCETECH_DATABASE_URL: "postgres://bouncetech",
    ADMIN_API_KEY: "admin-key",
    PONDER_URL: "http://localhost:42069",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    AI: {} as Ai,
  };
}

// `selectDistinct` uses a chained call, so we mock the full `.from()` step.
function stubDistinct(ltPairs: string[]) {
  mockSelectDistinct.mockReturnValue({
    from: vi.fn().mockResolvedValue(ltPairs.map((p) => ({ ltPair: p }))),
  });
}

describe("LtTicker /ensure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("schedules first alarm when none exists", async () => {
    const { ctx } = createState();
    const ticker = new LtTicker(ctx, makeEnv());

    const res = await ticker.fetch(new Request("https://internal/ensure"));

    expect(res.status).toBe(200);
    expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when alarm is already scheduled", async () => {
    const { ctx, _state } = createState();
    _state.alarm = Date.now() + 5000;
    const ticker = new LtTicker(ctx, makeEnv());

    const res = await ticker.fetch(new Request("https://internal/ensure"));

    expect(res.status).toBe(200);
    expect(ctx.storage.setAlarm).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown paths", async () => {
    const { ctx } = createState();
    const ticker = new LtTicker(ctx, makeEnv());
    const res = await ticker.fetch(new Request("https://internal/other"));
    expect(res.status).toBe(404);
  });
});

describe("LtTicker alarm diff logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets next alarm first, then broadcasts changed rates", async () => {
    const { ctx } = createState();
    stubDistinct(["0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]);
    mockNeonQuery.mockResolvedValue([
      {
        token_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        exchange_rate: "1000000000000000000",
      },
    ]);

    const ticker = new LtTicker(ctx, makeEnv());
    await ticker.alarm();

    // Alarm rescheduled first — critical for liveness.
    expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(1);
    const alarmTs = (ctx.storage.setAlarm as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as number;
    expect(alarmTs).toBeGreaterThan(Date.now());

    // First tick — all rates are "new", so broadcast fires.
    expect(mockBroadcast).toHaveBeenCalledTimes(1);
    const [, channel, payload, routingKey] = mockBroadcast.mock.calls[0];
    expect(channel).toBe("price");
    expect((payload as { ltAddress: string }).ltAddress).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(routingKey).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("does not broadcast when rate is unchanged", async () => {
    const { ctx } = createState();
    stubDistinct(["0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]);
    mockNeonQuery.mockResolvedValue([
      {
        token_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        exchange_rate: "1000000000000000000",
      },
    ]);

    const ticker = new LtTicker(ctx, makeEnv());
    await ticker.alarm();
    mockBroadcast.mockClear();

    // Second alarm with identical rate → no broadcast.
    await ticker.alarm();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it("broadcasts only the LT whose rate changed", async () => {
    const { ctx } = createState();
    stubDistinct([
      "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    ]);
    mockNeonQuery.mockResolvedValue([
      {
        token_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        exchange_rate: "1000000000000000000",
      },
      {
        token_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        exchange_rate: "2000000000000000000",
      },
    ]);

    const ticker = new LtTicker(ctx, makeEnv());
    await ticker.alarm();
    mockBroadcast.mockClear();

    mockNeonQuery.mockResolvedValue([
      {
        token_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        exchange_rate: "1000000000000000000",
      },
      {
        token_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        exchange_rate: "2100000000000000000",
      },
    ]);

    await ticker.alarm();

    expect(mockBroadcast).toHaveBeenCalledTimes(1);
    const [, , payload] = mockBroadcast.mock.calls[0];
    expect((payload as { ltAddress: string }).ltAddress).toBe(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
  });

  it("reschedules next alarm even when BT query throws", async () => {
    const { ctx } = createState();
    stubDistinct(["0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]);
    mockNeonQuery.mockRejectedValue(new Error("connection failed"));

    const ticker = new LtTicker(ctx, makeEnv());
    await ticker.alarm();

    expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(1);
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it("skips broadcast entirely when no LTs are tracked", async () => {
    const { ctx } = createState();
    stubDistinct([]);

    const ticker = new LtTicker(ctx, makeEnv());
    await ticker.alarm();

    expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(1);
    expect(mockNeonQuery).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });
});
