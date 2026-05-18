import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Boundary mocks. The backfill has three external surfaces:
//   - `fetchMostRecentTokenAddresses(db, limit)` — direct-DB read (PR #1073).
//   - `registerTokenFromChain(env, address)` — does the actual insert.
//   - `broadcastNewToken(env, row)` — fire-and-forget WS fan-out.
// We mock all three so the test pins the backfill's *orchestration*
// (which addresses get registered, how failures are tallied) without
// reaching into RPC / DB / Durable Object internals.
const mockFetchMostRecentTokenAddresses = vi.fn();
const mockRegisterTokenFromChain = vi.fn();
const mockBroadcastNewToken = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchMostRecentTokenAddresses: mockFetchMostRecentTokenAddresses,
}));

vi.mock("../db/client.js", () => ({
  createDb: () => ({ __db: true }),
}));

// Don't `importActual` here — `token-registration.ts` transitively
// imports the WebSocket Durable Object, which pulls in `cloudflare:workers`
// (only resolvable inside the Worker runtime). The backfill only needs
// these three symbols at runtime, so stub them directly. `RegistrationError`
// is replicated as a minimal `Error` subclass — the backfill matches on
// it with `instanceof` to classify failures, so the class identity is
// what matters, not the file it came from.
class FakeRegistrationError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message);
  }
}
vi.mock("../lib/token-registration.js", () => ({
  RegistrationError: FakeRegistrationError,
  registerTokenFromChain: (...args: unknown[]) =>
    mockRegisterTokenFromChain(...args),
  broadcastNewToken: (...args: unknown[]) => mockBroadcastNewToken(...args),
}));

const { runRegistrationBackfill } = await import(
  "../lib/registration-backfill.js"
);

import type { AppBindings } from "../lib/types.js";

const baseEnv = {
  DATABASE_URL: "postgres://test",
} as unknown as AppBindings;

beforeEach(() => {
  mockFetchMostRecentTokenAddresses.mockReset();
  mockRegisterTokenFromChain.mockReset();
  mockBroadcastNewToken.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runRegistrationBackfill", () => {
  it("skips the tick when the indexer DB read fails", async () => {
    // Helper returns `null` on DB error. The backfill must skip the tick
    // entirely — calling `registerTokenFromChain` with a stale/empty set
    // would either no-op or, worse, deregister-rumour the freshness
    // signal future ticks rely on.
    mockFetchMostRecentTokenAddresses.mockResolvedValue(null);

    await runRegistrationBackfill(baseEnv);

    expect(mockRegisterTokenFromChain).not.toHaveBeenCalled();
    expect(mockBroadcastNewToken).not.toHaveBeenCalled();
  });

  it("does nothing when the indexer reports no recent tokens", async () => {
    mockFetchMostRecentTokenAddresses.mockResolvedValue([]);

    await runRegistrationBackfill(baseEnv);

    expect(mockRegisterTokenFromChain).not.toHaveBeenCalled();
  });

  it("registers every freshly-seen token and broadcasts the newly-registered ones", async () => {
    const rows = [
      { address: "0xaaaa000000000000000000000000000000000001" },
      { address: "0xbbbb000000000000000000000000000000000002" },
      { address: "0xcccc000000000000000000000000000000000003" },
    ];
    mockFetchMostRecentTokenAddresses.mockResolvedValue(rows);

    // First two register fresh, third is already in PostgreSQL (the
    // synchronous POST path beat the cron — the most common steady-state
    // outcome). Only the first two should produce a WS broadcast; the
    // skip path must not flood the channel with no-op notifications.
    mockRegisterTokenFromChain
      .mockResolvedValueOnce({ kind: "registered", token: { address: rows[0]!.address } })
      .mockResolvedValueOnce({ kind: "registered", token: { address: rows[1]!.address } })
      .mockResolvedValueOnce({ kind: "exists" });

    await runRegistrationBackfill(baseEnv);

    expect(mockRegisterTokenFromChain).toHaveBeenCalledTimes(3);
    expect(mockRegisterTokenFromChain.mock.calls[0]![1]).toBe(rows[0]!.address);
    expect(mockRegisterTokenFromChain.mock.calls[1]![1]).toBe(rows[1]!.address);
    expect(mockRegisterTokenFromChain.mock.calls[2]![1]).toBe(rows[2]!.address);

    expect(mockBroadcastNewToken).toHaveBeenCalledTimes(2);
  });

  it("continues past a single registration failure", async () => {
    // A single token failing to register (RPC blip, BounceTech LT
    // directory drift) must not abort the whole sweep — otherwise one
    // bad token could permanently block every newer launch from ever
    // making it into PostgreSQL.
    const rows = [
      { address: "0xaaaa000000000000000000000000000000000001" },
      { address: "0xbbbb000000000000000000000000000000000002" },
    ];
    mockFetchMostRecentTokenAddresses.mockResolvedValue(rows);

    mockRegisterTokenFromChain
      .mockRejectedValueOnce(new Error("rpc blip"))
      .mockResolvedValueOnce({ kind: "registered", token: { address: rows[1]!.address } });

    await runRegistrationBackfill(baseEnv);

    expect(mockRegisterTokenFromChain).toHaveBeenCalledTimes(2);
    expect(mockBroadcastNewToken).toHaveBeenCalledTimes(1);
  });

  it("calls the helper with the configured PONDER_FETCH_LIMIT", async () => {
    // Pin the limit so a future refactor that drops or widens it
    // surfaces in the diff. The cap is small (50) because the diff
    // against PostgreSQL is computed in JS — the typical case is
    // "everything already registered, nothing to do" and we don't want
    // a runaway pull dominating the cron tick.
    mockFetchMostRecentTokenAddresses.mockResolvedValue([]);

    await runRegistrationBackfill(baseEnv);

    expect(mockFetchMostRecentTokenAddresses).toHaveBeenCalledTimes(1);
    const limit = mockFetchMostRecentTokenAddresses.mock.calls[0]![1] as number;
    expect(limit).toBe(50);
  });
});
