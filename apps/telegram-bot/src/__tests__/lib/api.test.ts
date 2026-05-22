import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  fetchBotPositions,
  fetchReferralStats,
  fetchToken,
  extractTokenAddress,
  isAddress,
} from "../../lib/api.js";

const env = {
  API_BASE_URL: "https://api.test.local",
  API_KEY: "test-api-key",
};

const apiSuccess = <T>(data: T) => ({ status: "success", data, error: null });

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

describe("fetchBotPositions", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const TOKEN_A = "0x1111111111111111111111111111111111111111";
  const TOKEN_B = "0x2222222222222222222222222222222222222222";

  const openRow = {
    token: TOKEN_A,
    ticker: "ONE",
    balance: "1500000000000000000",
    costBasisUsdc: "20000000",
    currentValueUsdc: "25000000",
    unrealisedPnlUsdc: "5000000",
    unrealisedPnlPct: 25,
  };

  const realisedRow = {
    token: TOKEN_B,
    ticker: "TWO",
    totalCostUsdc: "10000000",
    totalProceedsUsdc: "15000000",
    realisedPnlUsdc: "5000000",
    realisedPnlPct: 50,
  };

  // Defensive backstop: `buildHeaders` strips whitespace-only values so
  // a mis-pasted secret never serializes as ` ` on the wire and trips
  // apps/api's 401 path. `createBot` already throws on missing /
  // whitespace API_KEY at construction (see `bot.ts`), so this path is
  // unreachable in production — the test pins the helper-level contract
  // so a future refactor that drops the boot guard still can't leak
  // `x-api-key: " "`.
  it("omits X-API-Key when env.API_KEY is whitespace-only (helper-level backstop; boot guard already rejects this)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(apiSuccess({ open: [], realised: [] })),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await fetchBotPositions(
      { API_BASE_URL: env.API_BASE_URL, API_KEY: "   " },
      "0xabc",
    );
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.has("x-api-key")).toBe(false);
  });

  it("sends X-API-Key header and targets the bot positions route", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(apiSuccess({ open: [openRow], realised: [realisedRow] })),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const res = await fetchBotPositions(env, "0xabc");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.open).toHaveLength(1);
      expect(res.data.realised).toHaveLength(1);
      expect(res.data.open[0]!.ticker).toBe("ONE");
    }
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("x-api-key")).toBe("test-api-key");
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "https://api.test.local/api/v1/bot/positions-v2/0xabc",
    );
  });

  it("returns invalid_address on 400 (matches apps/api validation response)", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    expect(await fetchBotPositions(env, "0xabc")).toEqual({
      ok: false,
      kind: "invalid_address",
    });
  });

  it("returns unavailable on 503 (indexer down)", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    expect(await fetchBotPositions(env, "0xabc")).toEqual({
      ok: false,
      kind: "unavailable",
    });
  });

  it("returns unavailable when fetch itself throws (network error)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));
    expect(await fetchBotPositions(env, "0xabc")).toEqual({
      ok: false,
      kind: "unavailable",
    });
  });

  // Regression for "clicking positions yields no response": when apps/api or
  // the indexer stalls under load (see apps/indexer/RESPONSE_TIME_INVESTIGATION.md),
  // the read-side helper must abort instead of consuming the full Cloudflare
  // subrequest budget — otherwise the callback handler never reaches
  // `answerCallbackQuery` and the Telegram spinner hangs.
  it("aborts a stalled fetch after the GET timeout and returns unavailable", async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockImplementationOnce(
        (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const pending = fetchBotPositions(env, "0xabc");
      // GET_TIMEOUT_MS is temporarily 30s while apps/api is degraded —
      // see the inline comment on `GET_TIMEOUT_MS` in lib/api.ts.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await pending).toEqual({ ok: false, kind: "unavailable" });
      const init = fetchSpy.mock.calls[0]![1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression: with apps/api degraded and serving healthy responses in
  // ~10–25s (live `wrangler tail launchpad-api` 2026-05-17), the prior
  // 10s envelope aborted before the response landed and surfaced the
  // outage card on healthy tokens (e.g. T-REX token detail). The bumped
  // 30s budget must let a 25s response through unabbed.
  it("does not abort a sub-30s slow fetch — the response lands as ok", async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockImplementationOnce(
        (_url: unknown, _init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            setTimeout(() => {
              resolve(
                new Response(
                  JSON.stringify(apiSuccess({ open: [], realised: [] })),
                  { status: 200 },
                ),
              );
            }, 25_000);
          }),
      );
      const pending = fetchBotPositions(env, "0xabc");
      await vi.advanceTimersByTimeAsync(25_000);
      const result = await pending;
      expect(result.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns unknown on missing envelope.data", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    expect(await fetchBotPositions(env, "0xabc")).toEqual({
      ok: false,
      kind: "unknown",
    });
  });

  it("returns unknown when open is not an array", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(apiSuccess({ open: "nope", realised: [] })),
        { status: 200 },
      ),
    );
    expect(await fetchBotPositions(env, "0xabc")).toEqual({
      ok: false,
      kind: "unknown",
    });
  });

  it("returns unknown when an open entry has a non-numeric USDC string", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          apiSuccess({
            open: [{ ...openRow, costBasisUsdc: "abc" }],
            realised: [],
          }),
        ),
        { status: 200 },
      ),
    );
    expect(await fetchBotPositions(env, "0xabc")).toEqual({
      ok: false,
      kind: "unknown",
    });
  });

  it("accepts a null PnL percent (cost basis was zero)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          apiSuccess({
            open: [{ ...openRow, costBasisUsdc: "0", unrealisedPnlPct: null }],
            realised: [],
          }),
        ),
        { status: 200 },
      ),
    );
    const res = await fetchBotPositions(env, "0xabc");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.open[0]!.unrealisedPnlPct).toBeNull();
  });

  it("returns unknown when a realised entry is missing required fields", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(apiSuccess({ open: [], realised: [{ token: TOKEN_B }] })),
        { status: 200 },
      ),
    );
    expect(await fetchBotPositions(env, "0xabc")).toEqual({
      ok: false,
      kind: "unknown",
    });
  });

  it("targets the referrals route and parses stats", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          apiSuccess({
            referredWallets: 4,
            referredVolume: "2500000000",
            referrals: [],
          }),
        ),
        { status: 200 },
      ),
    );
    const res = await fetchReferralStats(env, "0xabc");
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "https://api.test.local/api/v1/referrals-v2/0xabc",
    );
    expect(res).toEqual({
      ok: true,
      data: { referredWallets: 4, referredVolume: "2500000000" },
    });
  });

  it("returns invalid_address on 400 for referrals", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    expect(await fetchReferralStats(env, "0xabc")).toEqual({
      ok: false,
      kind: "invalid_address",
    });
  });

  it("returns unknown when referrals payload is malformed (missing referredVolume)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(apiSuccess({ referredWallets: 1 })),
        { status: 200 },
      ),
    );
    expect(await fetchReferralStats(env, "0xabc")).toEqual({
      ok: false,
      kind: "unknown",
    });
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
      new Response(JSON.stringify(apiSuccess(VALID_TOKEN)), { status: 200 }),
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
      new Response(JSON.stringify(apiSuccess(withoutPrice)), { status: 200 }),
    );
    const result = await fetchToken(env, VALID_TOKEN.address);
    expect(result).toEqual({ ok: false, kind: "unknown" });
  });

  it("accepts a payload where a numeric field is null", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(apiSuccess({ ...VALID_TOKEN, ltChange24h: null })),
        { status: 200 },
      ),
    );
    const result = await fetchToken(env, VALID_TOKEN.address);
    expect(result.ok).toBe(true);
  });

  it("rejects a payload with missing status field", async () => {
    const { status: _omit, ...withoutStatus } = VALID_TOKEN;
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(apiSuccess(withoutStatus)), { status: 200 }),
    );
    const result = await fetchToken(env, VALID_TOKEN.address);
    expect(result).toEqual({ ok: false, kind: "unknown" });
  });

  it("normalises missing volume24hUsd to null", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(apiSuccess(VALID_TOKEN)), { status: 200 }),
    );
    const result = await fetchToken(env, VALID_TOKEN.address);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.volume24hUsd).toBeNull();
  });

  it("passes through volume24hUsd when present in the response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(apiSuccess({ ...VALID_TOKEN, volume24hUsd: 12345 })),
        { status: 200 },
      ),
    );
    const result = await fetchToken(env, VALID_TOKEN.address);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.volume24hUsd).toBe(12345);
  });
});
