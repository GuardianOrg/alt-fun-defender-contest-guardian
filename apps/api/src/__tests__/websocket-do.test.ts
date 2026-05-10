import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AppBindings } from "../lib/types.js";

// --- Stub `cloudflare:workers` so the DO base class doesn't need the real runtime.
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

// Import after the mock so the DO base class is the stub.
const { WebSocketDO, shardKeyFor, broadcastShardsFor, ALL_TOKENS_KEY } =
  await import("../websocket/durable-object.js");
const { broadcastToChannel } = await import("../lib/broadcast.js");

describe("shardKeyFor", () => {
  it("uses lowercased token address as the routing key", () => {
    expect(
      shardKeyFor("trade", "0xABCDEFabcdef0000000000000000000000000000"),
    ).toBe("trade:0xabcdefabcdef0000000000000000000000000000");
  });

  it("falls back to the wildcard shard when no token is provided", () => {
    expect(shardKeyFor("trade")).toBe(`trade:${ALL_TOKENS_KEY}`);
    expect(shardKeyFor("trade", null)).toBe(`trade:${ALL_TOKENS_KEY}`);
    expect(shardKeyFor("trade", "")).toBe(`trade:${ALL_TOKENS_KEY}`);
  });

  it("ignores tokenAddress for inherently-global channels", () => {
    expect(shardKeyFor("newToken", "0xabc")).toBe(`newToken:${ALL_TOKENS_KEY}`);
    expect(shardKeyFor("stats", "0xabc")).toBe(`stats:${ALL_TOKENS_KEY}`);
  });
});

describe("broadcastShardsFor", () => {
  it("targets both the token shard and the wildcard shard for per-token events", () => {
    const shards = broadcastShardsFor(
      "trade",
      "0xAaaaAAAAaaaAAAAAaaAAAAaaAAAAaaaAaaaAaaAA",
    );
    expect(shards).toHaveLength(2);
    expect(shards).toContain("trade:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(shards).toContain(`trade:${ALL_TOKENS_KEY}`);
  });

  it("targets only the wildcard shard for token-less per-token events", () => {
    expect(broadcastShardsFor("trade")).toEqual([`trade:${ALL_TOKENS_KEY}`]);
  });

  it("targets only the wildcard shard for global channels", () => {
    expect(broadcastShardsFor("newToken", "0xabc")).toEqual([
      `newToken:${ALL_TOKENS_KEY}`,
    ]);
    expect(broadcastShardsFor("stats")).toEqual([`stats:${ALL_TOKENS_KEY}`]);
  });
});

// --- DurableObjectState / WebSocketPair mocks ---

class FakeWebSocket {
  readyState = 1;
  sent: string[] = [];
  send(msg: string) {
    this.sent.push(msg);
  }
  close() {
    this.readyState = 3;
  }
}

function createCtx(): DurableObjectState {
  return {
    acceptWebSocket: vi.fn(),
    storage: {} as DurableObjectStorage,
  } as unknown as DurableObjectState;
}

function makeEnv(): AppBindings {
  return {
    DATABASE_URL: "",
    BOUNCETECH_DATABASE_URL: "",
    ADMIN_API_KEY: "",
    PONDER_URL: "",
    IMAGES_BUCKET: {} as R2Bucket,
    WEBSOCKET_DO: {} as DurableObjectNamespace,
    WS_IP_LIMITER_DO: {} as DurableObjectNamespace,
    LT_TICKER_DO: {} as DurableObjectNamespace,
    AI: {} as Ai,
  };
}

describe("WebSocketDO subject-scoped fan-out", () => {
  beforeEach(() => {
    // Polyfill WebSocketPair for the DO's `new WebSocketPair()` call.
    (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair =
      class {
        0: FakeWebSocket;
        1: FakeWebSocket;
        constructor() {
          this[0] = new FakeWebSocket();
          this[1] = new FakeWebSocket();
        }
      };
  });

  it("broadcasts to every connection without per-subscription filtering", async () => {
    const ctx = createCtx();
    const env = makeEnv();
    const doInstance = new WebSocketDO(ctx, env);

    // Simulate two accepted connections by stuffing them into the
    // private map directly through the broadcast path. The fan-out is
    // O(connections-on-this-shard), so the unit-of-correctness is
    // "every connection here gets the same payload".
    const ws1 = new FakeWebSocket();
    const ws2 = new FakeWebSocket();
    (
      doInstance as unknown as { connections: Map<FakeWebSocket, unknown> }
    ).connections.set(ws1, {
      ip: "1.1.1.1",
      lastActivity: Date.now(),
      awaitingPong: false,
    });
    (
      doInstance as unknown as { connections: Map<FakeWebSocket, unknown> }
    ).connections.set(ws2, {
      ip: "2.2.2.2",
      lastActivity: Date.now(),
      awaitingPong: false,
    });

    doInstance.broadcast("trade", { id: "tx-1", tokenAddress: "0xaaa" });

    expect(ws1.sent).toHaveLength(1);
    expect(ws2.sent).toHaveLength(1);
    const msg = JSON.parse(ws1.sent[0]) as { channel: string; data: unknown };
    expect(msg.channel).toBe("trade");
    expect(msg.data).toEqual({ id: "tx-1", tokenAddress: "0xaaa" });
  });

  it("/broadcast routes the body through to fan-out", async () => {
    const ctx = createCtx();
    const env = makeEnv();
    const doInstance = new WebSocketDO(ctx, env);

    const ws = new FakeWebSocket();
    (
      doInstance as unknown as { connections: Map<FakeWebSocket, unknown> }
    ).connections.set(ws, {
      ip: "1.1.1.1",
      lastActivity: Date.now(),
      awaitingPong: false,
    });

    const req = new Request(
      "https://internal/broadcast?shard=trade:0xabc",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "trade", data: { foo: "bar" } }),
      },
    );
    const res = await doInstance.fetch(req);
    expect(res.status).toBe(200);
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({
      channel: "trade",
      data: { foo: "bar" },
    });
  });
});

describe("broadcastToChannel fan-out", () => {
  function makeWsNs() {
    // Track which shard ids were targeted by recording each `idFromName`
    // call alongside the matching `fetch` call. Simpler than threading
    // mock state through closures.
    const targeted: { shard: string; body: string }[] = [];
    let lastShard = "";
    const idFromName = vi.fn((name: string) => {
      lastShard = name;
      return { __shard: name };
    });
    const stubFetch = vi.fn(async (_url: string, init: RequestInit) => {
      targeted.push({ shard: lastShard, body: init.body as string });
      return new Response("ok", { status: 200 });
    });
    const ns = {
      idFromName,
      get: vi.fn(() => ({ fetch: stubFetch })),
    } as unknown as DurableObjectNamespace;
    return { ns, idFromName, stubFetch, targeted };
  }

  it("posts to both token-shard and wildcard shard for per-token events", async () => {
    const { ns, stubFetch, targeted } = makeWsNs();
    const env: AppBindings = { ...makeEnv(), WEBSOCKET_DO: ns };

    await broadcastToChannel(env, "trade", { hello: "world" }, "0xABC");

    expect(stubFetch).toHaveBeenCalledTimes(2);
    const ids = targeted.map((c) => c.shard).sort();
    expect(ids).toEqual(["trade:0xabc", `trade:${ALL_TOKENS_KEY}`].sort());
    for (const c of targeted) {
      expect(JSON.parse(c.body)).toEqual({
        channel: "trade",
        data: { hello: "world" },
      });
    }
  });

  it("posts to only the wildcard shard for global channels", async () => {
    const { ns, idFromName, stubFetch } = makeWsNs();
    const env: AppBindings = { ...makeEnv(), WEBSOCKET_DO: ns };

    await broadcastToChannel(env, "newToken", { x: 1 });

    expect(stubFetch).toHaveBeenCalledTimes(1);
    expect(idFromName).toHaveBeenCalledWith(`newToken:${ALL_TOKENS_KEY}`);
  });

  it("posts to only the wildcard shard when no tokenAddress is supplied", async () => {
    const { ns, idFromName, stubFetch } = makeWsNs();
    const env: AppBindings = { ...makeEnv(), WEBSOCKET_DO: ns };

    await broadcastToChannel(env, "trade", { x: 1 });

    expect(stubFetch).toHaveBeenCalledTimes(1);
    expect(idFromName).toHaveBeenCalledWith(`trade:${ALL_TOKENS_KEY}`);
  });

  it("does not throw when one shard fetch rejects (transport error)", async () => {
    const { ns, stubFetch } = makeWsNs();
    let calls = 0;
    stubFetch.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("shard down");
      return new Response("ok", { status: 200 });
    });
    const env: AppBindings = { ...makeEnv(), WEBSOCKET_DO: ns };

    await expect(
      broadcastToChannel(env, "trade", { x: 1 }, "0xABC"),
    ).resolves.toBeUndefined();
    expect(stubFetch).toHaveBeenCalledTimes(2);
  });

  it("treats a non-OK shard response as a fan-out failure (without throwing)", async () => {
    // Spy on console.log to confirm we surface the warn structured log
    // instead of silently dropping the broadcast (the stub.fetch promise
    // resolves on a 500, so the failure has to be detected from `res.ok`).
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((arg: unknown) => {
        logs.push(typeof arg === "string" ? arg : JSON.stringify(arg));
      });

    try {
      const { ns, stubFetch } = makeWsNs();
      let calls = 0;
      stubFetch.mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("boom", {
            status: 500,
            statusText: "Internal",
          });
        }
        return new Response("ok", { status: 200 });
      });
      const env: AppBindings = { ...makeEnv(), WEBSOCKET_DO: ns };

      await expect(
        broadcastToChannel(env, "trade", { x: 1 }, "0xABC"),
      ).resolves.toBeUndefined();
      expect(stubFetch).toHaveBeenCalledTimes(2);

      const warned = logs.find((l) => l.includes("broadcast_shard_failed"));
      expect(warned).toBeDefined();
      expect(warned).toContain("500");
    } finally {
      // Always restore the spy so a failed assertion above can't leak
      // a `console.log` mock into later tests.
      spy.mockRestore();
    }
  });
});
