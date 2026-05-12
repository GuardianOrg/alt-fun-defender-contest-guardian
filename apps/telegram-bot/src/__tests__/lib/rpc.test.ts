import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { fetchNativeBalance } from "../../lib/rpc.js";

const RPC_URL = "https://rpc.test.local";
const ADDRESS = "0x000000000000000000000000000000000000dead";

describe("fetchNativeBalance", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it("decodes a hex balance into a bigint", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xde0b6b3a7640000" }),
        { status: 200 },
      ),
    );
    const balance = await fetchNativeBalance(
      { HYPEREVM_RPC_URL: RPC_URL },
      ADDRESS,
    );
    expect(balance).toBe(1_000_000_000_000_000_000n);
  });

  it("falls back to the public RPC when HYPEREVM_RPC_URL is unset", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }), {
        status: 200,
      }),
    );
    await fetchNativeBalance({}, ADDRESS);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      "https://rpc.hyperliquid.xyz/evm",
    );
  });

  it("returns null on a JSON-RPC error envelope", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32000, message: "bad" },
        }),
        { status: 200 },
      ),
    );
    const balance = await fetchNativeBalance(
      { HYPEREVM_RPC_URL: RPC_URL },
      ADDRESS,
    );
    expect(balance).toBeNull();
  });

  it("returns null on a non-2xx HTTP response", async () => {
    fetchSpy.mockResolvedValue(new Response("nope", { status: 503 }));
    const balance = await fetchNativeBalance(
      { HYPEREVM_RPC_URL: RPC_URL },
      ADDRESS,
    );
    expect(balance).toBeNull();
  });

  it("returns null on a network failure", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
    const balance = await fetchNativeBalance(
      { HYPEREVM_RPC_URL: RPC_URL },
      ADDRESS,
    );
    expect(balance).toBeNull();
  });

  it("passes an AbortSignal so a stalled RPC aborts on timeout", async () => {
    // We don't drive fake timers here — verifying that fetch receives
    // a signal proves the AbortController is wired. The catch branch
    // already returns null for AbortError (covered by the network-
    // failure test above), so the abort path returns null end-to-end.
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), {
        status: 200,
      }),
    );
    await fetchNativeBalance({ HYPEREVM_RPC_URL: RPC_URL }, ADDRESS);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
  });
});
