import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  fetchBalances,
  fetchPortfolio,
  fetchToken,
  extractTokenAddress,
  isAddress,
} from "../../lib/api.js";

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

  it("omits X-API-Key when env.API_KEY is undefined (falls into apps/api anonymous bucket, see #640)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { positions: [], approximate: false } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await fetchPortfolio(
      { API_BASE_URL: env.API_BASE_URL, API_KEY: undefined },
      "0xabc",
    );
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    // Header absent — NOT `"undefined"` string. Sending the literal
    // string would trip apps/api's 401 path; omitting it routes the
    // request into the anonymous 240/min per-IP bucket.
    expect(headers.has("x-api-key")).toBe(false);
  });

  it("omits X-API-Key when env.API_KEY is the empty string", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { positions: [], approximate: false } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await fetchPortfolio(
      { API_BASE_URL: env.API_BASE_URL, API_KEY: "" },
      "0xabc",
    );
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.has("x-api-key")).toBe(false);
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

  it("returns unknown when fetchPortfolio payload has malformed shape (string instead of array)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { positions: "nope", approximate: false } }),
        { status: 200 },
      ),
    );
    expect(await fetchPortfolio(env, "0xabc")).toEqual({
      ok: false,
      kind: "unknown",
    });
  });

  it("returns unknown when a portfolio position is missing required string fields", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            positions: [{ tokenAddress: "0xaaa" }], // missing tokenAmount, costBasisUsdc
            approximate: false,
          },
        }),
        { status: 200 },
      ),
    );
    expect(await fetchPortfolio(env, "0xabc")).toEqual({
      ok: false,
      kind: "unknown",
    });
  });

  it("returns unknown when fetchBalances payload is an object instead of an array", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { not: "an array" } }), {
        status: 200,
      }),
    );
    expect(await fetchBalances(env, "0xabc")).toEqual({
      ok: false,
      kind: "unknown",
    });
  });

  it("returns unknown when a balance entry is missing required string fields", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: [{ address: "0xaaa" }] }), // missing name/ticker/balance
        { status: 200 },
      ),
    );
    expect(await fetchBalances(env, "0xabc")).toEqual({
      ok: false,
      kind: "unknown",
    });
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

describe("extractTokenAddress", () => {
  it("extracts a bare 0x address", () => {
    expect(extractTokenAddress("0x1111111111111111111111111111111111111111")).toBe(
      "0x1111111111111111111111111111111111111111",
    );
  });

  it("extracts address from an alt.fun URL", () => {
    expect(
      extractTokenAddress("https://alt.fun/0x1111111111111111111111111111111111111111"),
    ).toBe("0x1111111111111111111111111111111111111111");
  });

  it("extracts address from a hyperevmscan URL", () => {
    expect(
      extractTokenAddress(
        "https://hyperevmscan.io/token/0x1111111111111111111111111111111111111111",
      ),
    ).toBe("0x1111111111111111111111111111111111111111");
  });

  it("rejects a truncated address inside a longer hex run", () => {
    // 82 hex chars — address regex must not match a 40-char slice of this
    const longHex = "0x" + "a".repeat(82);
    expect(extractTokenAddress(longHex)).toBeNull();
  });

  it("returns null for plaintext with no address", () => {
    expect(extractTokenAddress("no address here")).toBeNull();
  });
});

describe("fetchToken", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const VALID_TOKEN = {
    address: "0x1111111111111111111111111111111111111111",
    name: "Test",
    ticker: "TST",
    priceUsd: 0.001,
    mcapUsd: 5000,
    change24h: 1.5,
    ltChange24h: null,
    curveFilled: 30,
    status: "curve",
  };

  it("returns token data for a well-formed response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: VALID_TOKEN }), { status: 200 }),
    );
    const result = await fetchToken(env, VALID_TOKEN.address);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.ticker).toBe("TST");
  });

  it("returns not_found for 404", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    const result = await fetchToken(env, "0x" + "1".repeat(40));
    expect(result).toEqual({ ok: false, kind: "not_found" });
  });

  it("returns unavailable for 503", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("", { status: 503 }));
    const result = await fetchToken(env, "0x" + "1".repeat(40));
    expect(result).toEqual({ ok: false, kind: "unavailable" });
  });

  it("rejects a payload where a numeric field is undefined (missing from JSON)", async () => {
    // priceUsd omitted — isOptionalNumber must reject undefined
    const { priceUsd: _omit, ...withoutPrice } = VALID_TOKEN;
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: withoutPrice }), { status: 200 }),
    );
    const result = await fetchToken(env, VALID_TOKEN.address);
    expect(result).toEqual({ ok: false, kind: "unknown" });
  });

  it("accepts a payload where a numeric field is null", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { ...VALID_TOKEN, ltChange24h: null } }),
        { status: 200 },
      ),
    );
    const result = await fetchToken(env, VALID_TOKEN.address);
    expect(result.ok).toBe(true);
  });

  it("rejects a payload with missing status field", async () => {
    const { status: _omit, ...withoutStatus } = VALID_TOKEN;
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: withoutStatus }), { status: 200 }),
    );
    const result = await fetchToken(env, VALID_TOKEN.address);
    expect(result).toEqual({ ok: false, kind: "unknown" });
  });

  it("normalises missing volume24hUsd to null", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: VALID_TOKEN }), { status: 200 }),
    );
    const result = await fetchToken(env, VALID_TOKEN.address);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.volume24hUsd).toBeNull();
  });

  it("passes through volume24hUsd when present in the response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { ...VALID_TOKEN, volume24hUsd: 12345 } }),
        { status: 200 },
      ),
    );
    const result = await fetchToken(env, VALID_TOKEN.address);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.volume24hUsd).toBe(12345);
  });
});
