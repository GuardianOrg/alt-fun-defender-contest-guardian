import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  CALLBACK_DATA_LIMIT,
  CallbackEncodeError,
  type CallbackHandler,
  dispatchCallback,
  encodeCallback,
  parseCallback,
} from "../../lib/callbacks.js";
import type { TelegramCallbackQuery } from "../../lib/telegram.js";
import { makeTestEnv } from "../helpers/env.js";

const env = makeTestEnv();

const buildQuery = (
  overrides: Partial<TelegramCallbackQuery> = {},
): TelegramCallbackQuery => ({
  id: "cbq-1",
  from: { id: 7, is_bot: false, first_name: "Ada" },
  chat_instance: "instance-1",
  data: "noop",
  ...overrides,
});

describe("encodeCallback", () => {
  it("roundtrips through parseCallback", () => {
    const data = encodeCallback("sell", "50", "abcd1234");
    expect(parseCallback(data)).toEqual({
      cmd: "sell",
      args: ["50", "abcd1234"],
    });
  });

  it("encodes a bare command with no args", () => {
    expect(encodeCallback("ping")).toBe("ping");
  });

  it("rejects an empty cmd", () => {
    expect(() => encodeCallback("")).toThrow(CallbackEncodeError);
  });

  it("rejects a cmd containing the separator", () => {
    expect(() => encodeCallback("a:b")).toThrow(CallbackEncodeError);
  });

  it("rejects an arg containing the separator", () => {
    expect(() => encodeCallback("sell", "50", "x:y")).toThrow(
      CallbackEncodeError,
    );
  });

  it("rejects payloads over the 64-byte ceiling", () => {
    const tooLong = "x".repeat(CALLBACK_DATA_LIMIT);
    expect(() => encodeCallback("cmd", tooLong)).toThrow(CallbackEncodeError);
  });

  it("counts bytes in UTF-8, not characters", () => {
    // Each "💀" is 4 bytes in UTF-8. 16 of them = 64 bytes — equal to the
    // limit when combined with cmd alone is over budget.
    const sixteen = "💀".repeat(16);
    expect(() => encodeCallback("cmd", sixteen)).toThrow(CallbackEncodeError);
  });

  it("accepts a payload exactly at the byte limit", () => {
    // cmd 'c' + ':' = 2 bytes, leave 62 bytes of arg.
    const arg = "a".repeat(CALLBACK_DATA_LIMIT - 2);
    const data = encodeCallback("c", arg);
    expect(data.length).toBe(CALLBACK_DATA_LIMIT);
  });
});

describe("parseCallback", () => {
  it("returns null on empty data", () => {
    expect(parseCallback("")).toBeNull();
  });

  it("returns null when cmd is empty (leading separator)", () => {
    expect(parseCallback(":50")).toBeNull();
  });

  it("returns null for over-budget payloads (forged updates)", () => {
    const tooLong = "c:" + "x".repeat(CALLBACK_DATA_LIMIT);
    expect(parseCallback(tooLong)).toBeNull();
  });

  it("returns an empty args array for a bare cmd", () => {
    expect(parseCallback("ping")).toEqual({ cmd: "ping", args: [] });
  });
});

interface SentCall {
  method: string;
  body: Record<string, unknown>;
}

const collectTelegramCalls = (
  fetchSpy: ReturnType<typeof vi.spyOn>,
): SentCall[] =>
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>).map((call) => {
    const url = String(call[0]);
    const method = url.split("/").pop() ?? "";
    const body = JSON.parse(
      (call[1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    return { method, body };
  });

describe("dispatchCallback", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("routes to the registered handler and forwards parsed args", async () => {
    const handler = vi.fn<CallbackHandler>(async () => undefined);
    const registry = new Map<string, CallbackHandler>([["sell", handler]]);
    await dispatchCallback(
      env,
      buildQuery({ data: encodeCallback("sell", "50", "abcd1234") }),
      registry,
    );
    expect(handler).toHaveBeenCalledTimes(1);
    const ctx = handler.mock.calls[0]![0];
    expect(ctx.args).toEqual(["50", "abcd1234"]);
    expect(ctx.query.id).toBe("cbq-1");
  });

  it("always calls answerCallbackQuery exactly once", async () => {
    const handler: CallbackHandler = async () => undefined;
    await dispatchCallback(
      env,
      buildQuery({ data: "ping" }),
      new Map([["ping", handler]]),
    );
    const calls = collectTelegramCalls(fetchSpy).filter(
      (c) => c.method === "answerCallbackQuery",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.callback_query_id).toBe("cbq-1");
  });

  it("forwards the handler's toast text and show_alert to Telegram", async () => {
    const handler: CallbackHandler = async () => ({
      text: "Sold 50%",
      show_alert: true,
    });
    await dispatchCallback(
      env,
      buildQuery({ data: "sell" }),
      new Map([["sell", handler]]),
    );
    const calls = collectTelegramCalls(fetchSpy);
    expect(calls[0]!.body).toMatchObject({
      callback_query_id: "cbq-1",
      text: "Sold 50%",
      show_alert: true,
    });
  });

  it("answers with an 'unknown action' toast for an unrouted cmd", async () => {
    await dispatchCallback(
      env,
      buildQuery({ data: "mystery:1" }),
      new Map(),
    );
    const calls = collectTelegramCalls(fetchSpy);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.text).toBe("Unknown action.");
  });

  it("answers with a 'button expired' toast when data is missing", async () => {
    await dispatchCallback(env, buildQuery({ data: undefined }), new Map());
    const calls = collectTelegramCalls(fetchSpy);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.text).toBe("Button expired or invalid.");
  });

  it("answers with a 'button expired' toast when data is over-budget", async () => {
    // Forged: server-emitted data is always <=64 bytes, but webhook secret
    // is rotated more aggressively than the public dispatcher contract.
    const oversize = "x".repeat(CALLBACK_DATA_LIMIT + 5);
    await dispatchCallback(env, buildQuery({ data: oversize }), new Map());
    const calls = collectTelegramCalls(fetchSpy);
    expect(calls[0]!.body.text).toBe("Button expired or invalid.");
  });

  it("answers with an error alert when the handler throws", async () => {
    const handler: CallbackHandler = async () => {
      throw new Error("boom");
    };
    await dispatchCallback(
      env,
      buildQuery({ data: "fail" }),
      new Map([["fail", handler]]),
    );
    const calls = collectTelegramCalls(fetchSpy);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({
      show_alert: true,
    });
    expect(String(calls[0]!.body.text)).toContain("Something went wrong");
  });

  it("does not throw when answerCallbackQuery itself fails", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("telegram down"));
    await expect(
      dispatchCallback(env, buildQuery({ data: "ping" }), new Map()),
    ).resolves.toBeUndefined();
  });
});
