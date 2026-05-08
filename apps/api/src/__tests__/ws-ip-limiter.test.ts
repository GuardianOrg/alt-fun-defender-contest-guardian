import { describe, it, expect, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: DurableObjectState;
    env: unknown;
    constructor(ctx: DurableObjectState, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { WsIpLimiter, MAX_CONNECTIONS_PER_IP, tryAcquireIpSlot, releaseIpSlot } =
  await import("../websocket/ip-limiter.js");

function makeLimiter() {
  const ctx = {} as DurableObjectState;
  return new WsIpLimiter(ctx, {} as unknown as ConstructorParameters<typeof WsIpLimiter>[1]);
}

async function call(
  limiter: InstanceType<typeof WsIpLimiter>,
  path: string,
  body: unknown,
) {
  const res = await limiter.fetch(
    new Request(`https://internal${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return (await res.json()) as { ok: boolean; count?: number };
}

describe("WsIpLimiter acquire/release", () => {
  it("admits up to MAX_CONNECTIONS_PER_IP", async () => {
    const limiter = makeLimiter();
    for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
      const r = await call(limiter, "/acquire", { ip: "1.1.1.1" });
      expect(r.ok).toBe(true);
      expect(r.count).toBe(i + 1);
    }
  });

  it("rejects when an IP is at the limit", async () => {
    const limiter = makeLimiter();
    for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
      await call(limiter, "/acquire", { ip: "1.1.1.1" });
    }
    const r = await call(limiter, "/acquire", { ip: "1.1.1.1" });
    expect(r.ok).toBe(false);
  });

  it("treats different IPs independently", async () => {
    const limiter = makeLimiter();
    for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
      await call(limiter, "/acquire", { ip: "1.1.1.1" });
    }
    const r = await call(limiter, "/acquire", { ip: "2.2.2.2" });
    expect(r.ok).toBe(true);
  });

  it("releases a slot back to the pool", async () => {
    const limiter = makeLimiter();
    for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
      await call(limiter, "/acquire", { ip: "1.1.1.1" });
    }
    await call(limiter, "/release", { ip: "1.1.1.1" });
    const r = await call(limiter, "/acquire", { ip: "1.1.1.1" });
    expect(r.ok).toBe(true);
  });

  it("floors release at zero (idempotent on missed acquire)", async () => {
    const limiter = makeLimiter();
    await call(limiter, "/release", { ip: "1.1.1.1" });
    await call(limiter, "/release", { ip: "1.1.1.1" });
    const r = await call(limiter, "/acquire", { ip: "1.1.1.1" });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
  });
});

describe("tryAcquireIpSlot / releaseIpSlot helpers", () => {
  it("forwards to /acquire and /release on the limiter DO", async () => {
    const fetched: string[] = [];
    const stub = {
      fetch: vi.fn(async (url: string) => {
        fetched.push(new URL(url).pathname);
        return new Response(JSON.stringify({ ok: true, count: 1 }), {
          status: 200,
        });
      }),
    };
    const ns = {
      idFromName: vi.fn(() => "id"),
      get: vi.fn(() => stub),
    } as unknown as DurableObjectNamespace;

    await tryAcquireIpSlot(ns, "1.1.1.1");
    await releaseIpSlot(ns, "1.1.1.1");

    expect(ns.idFromName).toHaveBeenCalledWith("ws-ip-limiter");
    expect(fetched).toEqual(["/acquire", "/release"]);
  });
});
