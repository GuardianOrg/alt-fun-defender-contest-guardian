import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { fetchBalances, fetchPortfolio, isAddress } from "../../lib/api.js";

const env = {
  API_BASE_URL: "https://api.test.local",
  API_KEY: "test-api-key",
};

describe("isAddress", () => {
  it("accepts 0x + 40 hex chars (mixed case)", () => {
    expect(isAddress("0xAbCDef0123456789AbcDeF0123456789AbCdEF01")).toBe(true);
  });

  it("rejects missing 0x prefix", () => {
    expect(isAddress("AbCDef0123456789AbcDeF0123456789AbCdEF01")).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isAddress("0x1234")).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isAddress("0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBe(false);
  });
});

describe("fetchPortfolio / fetchBalances", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("sends X-API-Key header and returns parsed data on 200", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { positions: [], approximate: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const res = await fetchPortfolio(env, "0xabc");
    expect(res.ok).toBe(true);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("x-api-key")).toBe("test-api-key");
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "https://api.test.local/api/v1/portfolio/0xabc",
    );
  });

  it("returns invalid_address on 400 (matches apps/api validation response)", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    const res = await fetchPortfolio(env, "0xabc");
    expect(res).toEqual({ ok: false, kind: "invalid_address" });
  });

  it("returns unavailable on 503 (indexer down)", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    const res = await fetchPortfolio(env, "0xabc");
    expect(res).toEqual({ ok: false, kind: "unavailable" });
  });

  it("returns unavailable when fetch itself throws (network error)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));
    const res = await fetchBalances(env, "0xabc");
    expect(res).toEqual({ ok: false, kind: "unavailable" });
  });

  it("returns unknown on missing envelope.data", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const res = await fetchPortfolio(env, "0xabc");
    expect(res).toEqual({ ok: false, kind: "unknown" });
  });

  it("targets the balances route for fetchBalances", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    await fetchBalances(env, "0xabc");
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "https://api.test.local/api/v1/balances/0xabc",
    );
  });
});
