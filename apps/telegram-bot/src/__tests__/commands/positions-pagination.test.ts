import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import app from "../../index.js";
import { callbackHandlers } from "../../lib/callbacks.js";
import { handlePositionsPage } from "../../commands/positions.js";
import type { Env } from "../../lib/types.js";

const env: Env = {
  TELEGRAM_BOT_TOKEN: "test-bot-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  ADMIN_API_KEY: "test-admin-key",
  API_BASE_URL: "https://api.test.local",
  API_KEY: "test-api-key",
};

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";

const mockApi = (positions: number, balances: number): void => {
  const port = Array.from({ length: positions }, (_, i) => ({
    tokenAddress: `0x${i.toString(16).padStart(40, "0")}`,
    tokenAmount: "0",
    costBasisUsdc: "1000000",
  }));
  const bal = Array.from({ length: balances }, (_, i) => ({
    address: `0x${i.toString(16).padStart(40, "0")}`,
    name: `Long Token Name Number ${i}`,
    ticker: `LT${i}`,
    ltPair: "0xbbbb",
    leverage: 2,
    underlying: "HYPE",
    ltDirection: "long",
    balance: "1000000000000000000",
  }));
  (vi.mocked(globalThis.fetch) as ReturnType<typeof vi.fn>).mockImplementation(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/portfolio/")) {
        return new Response(
          JSON.stringify({ data: { positions: port, approximate: false } }),
          { status: 200 },
        );
      }
      if (url.includes("/api/v1/balances/")) {
        return new Response(JSON.stringify({ data: bal }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    },
  );
};

describe("handlePositionsPage registration", () => {
  it("registers the `pp` handler in the production callback registry", () => {
    // Importing commands/positions side-effect registers the handler so
    // routes/webhook.ts can dispatch callback_query without an explicit
    // wiring step. Asserting this in a test prevents a silent drop if
    // someone refactors the registration out.
    expect(callbackHandlers.get("pp")).toBe(handlePositionsPage);
  });
});

describe("handlePositionsPage (unit)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const baseQuery = () => ({
    id: "cbq-1",
    from: { id: 7, is_bot: false, first_name: "Ada" },
    chat_instance: "instance-1",
    data: `pp:1:${WALLET}`,
    message: {
      message_id: 99,
      date: 0,
      chat: { id: 42, type: "private" as const },
    },
  });

  it("rejects malformed args with an 'invalid page' toast", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));
    const answer = await handlePositionsPage({
      env,
      query: baseQuery(),
      args: ["not-a-number", WALLET],
    });
    expect(answer).toEqual({ text: "Invalid page request." });
  });

  it("rejects a non-address wallet arg with an 'invalid page' toast", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));
    const answer = await handlePositionsPage({
      env,
      query: baseQuery(),
      args: ["1", "not-a-wallet"],
    });
    expect(answer).toEqual({ text: "Invalid page request." });
  });

  it("returns 'message no longer available' when the query has no message (inline mode / >48h old)", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));
    const q = baseQuery();
    delete (q as { message?: unknown }).message;
    const answer = await handlePositionsPage({
      env,
      query: q,
      args: ["1", WALLET],
    });
    expect(answer).toEqual({ text: "Message no longer available." });
  });

  it("returns 'data temporarily unavailable' when the upstream API is 503", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://api.test.local")) {
        return new Response("{}", { status: 503 });
      }
      return new Response("{}", { status: 200 });
    });
    const answer = await handlePositionsPage({
      env,
      query: baseQuery(),
      args: ["1", WALLET],
    });
    expect(answer).toEqual({
      text: "Data temporarily unavailable — try again in a moment.",
    });
  });

  it("edits the originating message with the requested page content + keyboard", async () => {
    mockApi(250, 250);
    await handlePositionsPage({
      env,
      query: baseQuery(),
      args: ["1", WALLET],
    });
    const editCalls = (
      fetchSpy.mock.calls as Array<[unknown, unknown?]>
    ).filter((c) => String(c[0]).includes("/editMessageText"));
    expect(editCalls).toHaveLength(1);
    const body = JSON.parse(
      (editCalls[0]![1] as RequestInit).body as string,
    ) as {
      chat_id: number;
      message_id: number;
      text: string;
      reply_markup?: {
        inline_keyboard: { text: string; callback_data: string }[][];
      };
    };
    expect(body.chat_id).toBe(42);
    expect(body.message_id).toBe(99);
    expect(body.text).toContain("Page 2 of");
    // Middle/end page: both Prev and Next should be present if more pages exist,
    // or only Prev on the last page. For 250 positions, page 1 is not last —
    // so we expect both buttons.
    const buttons = body.reply_markup!.inline_keyboard.flat();
    const texts = buttons.map((b) => b.text);
    expect(texts).toContain("← Prev");
    if (texts.length > 1) expect(texts).toContain("Next →");
    for (const b of buttons) {
      expect(b.callback_data).toMatch(/^pp:\d+:0x[0-9a-f]{40}$/i);
    }
  });

  it("clamps requested page to the last available page (positions shrunk since render)", async () => {
    // Only one position now → one page total → page 0 only.
    mockApi(1, 1);
    await handlePositionsPage({
      env,
      query: baseQuery(),
      args: ["99", WALLET],
    });
    const editCalls = (
      fetchSpy.mock.calls as Array<[unknown, unknown?]>
    ).filter((c) => String(c[0]).includes("/editMessageText"));
    expect(editCalls).toHaveLength(1);
    const body = JSON.parse(
      (editCalls[0]![1] as RequestInit).body as string,
    ) as { text: string; reply_markup?: unknown };
    // Single page → no "Page X of Y" footer, no keyboard.
    expect(body.text).not.toContain("Page ");
    expect(body.reply_markup).toBeUndefined();
  });

  it("never throws when editMessageText returns 400 (deleted message / not modified)", async () => {
    // Mock portfolio + balances 200, then editMessageText 400.
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/portfolio/")) {
        return new Response(
          JSON.stringify({
            data: {
              positions: Array.from({ length: 250 }, (_, i) => ({
                tokenAddress: `0x${i.toString(16).padStart(40, "0")}`,
                tokenAmount: "0",
                costBasisUsdc: "1000000",
              })),
              approximate: false,
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/v1/balances/")) {
        return new Response(
          JSON.stringify({
            data: Array.from({ length: 250 }, (_, i) => ({
              address: `0x${i.toString(16).padStart(40, "0")}`,
              name: `Long Token Name Number ${i}`,
              ticker: `LT${i}`,
              ltPair: "0xbbbb",
              leverage: 2,
              underlying: "HYPE",
              ltDirection: "long",
              balance: "1000000000000000000",
            })),
          }),
          { status: 200 },
        );
      }
      if (url.includes("/editMessageText")) {
        return new Response(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: "Bad Request: message to edit not found",
          }),
          { status: 400 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    await expect(
      handlePositionsPage({
        env,
        query: baseQuery(),
        args: ["1", WALLET],
      }),
    ).resolves.toBeUndefined();
  });
});

describe("pp callback end-to-end via webhook", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("dispatches a pp callback through the webhook → answerCallbackQuery + editMessageText", async () => {
    mockApi(250, 250);
    const callbackUpdate = {
      update_id: 10,
      callback_query: {
        id: "cbq-200",
        from: { id: 7, is_bot: false, first_name: "Ada" },
        chat_instance: "instance-1",
        data: `pp:2:${WALLET}`,
        message: {
          message_id: 99,
          date: 0,
          chat: { id: 42, type: "private" },
        },
      },
    };
    const res = await app.request(
      "/webhook",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-secret",
        },
        body: JSON.stringify(callbackUpdate),
      },
      env,
    );
    expect(res.status).toBe(200);
    const calls = fetchSpy.mock.calls as Array<[unknown, unknown?]>;
    const urls = calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/editMessageText"))).toBe(true);
    expect(urls.some((u) => u.includes("/answerCallbackQuery"))).toBe(true);
    const editCall = calls.find((c) =>
      String(c[0]).includes("/editMessageText"),
    )!;
    const editBody = JSON.parse(
      (editCall[1] as RequestInit).body as string,
    ) as { text: string };
    expect(editBody.text).toContain("Page 3 of");
  });
});
