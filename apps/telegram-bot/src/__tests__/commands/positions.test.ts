import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import app from "../../index.js";
import { makeTestEnv } from "../helpers/env.js";

const env = makeTestEnv();

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";

const positionsUpdate = (args: string) => {
  const text = `/positions${args ? ` ${args}` : ""}`;
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 42, type: "private" },
      from: { id: 7, is_bot: false, first_name: "Ada" },
      text,
      entities: [{ type: "bot_command", offset: 0, length: 10 }],
    },
  };
};

const post = (body: object) =>
  app.request(
    "/webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "test-secret",
      },
      body: JSON.stringify(body),
    },
    env,
  );

interface SentMessage {
  chat_id: number;
  text: string;
  reply_markup?: unknown;
}

const sentMessages = (fetchSpy: ReturnType<typeof vi.spyOn>): SentMessage[] =>
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>)
    .filter((call) => String(call[0]).includes("/sendMessage"))
    .map(
      (call) =>
        JSON.parse(
          (call[1] as RequestInit).body as string,
        ) as SentMessage,
    );

describe("/positions", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("replies with usage when no wallet argument is provided", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));
    const res = await post(positionsUpdate(""));
    expect(res.status).toBe(200);
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Usage: /positions");
    // No upstream API calls should be made when the input is rejected client-side.
    const apiCalls = (
      fetchSpy.mock.calls as Array<[unknown, unknown?]>
    ).filter((call) => String(call[0]).startsWith("https://api.test.local"));
    expect(apiCalls).toHaveLength(0);
  });

  it("replies with an error when the wallet is not a 0x-address", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));
    const res = await post(positionsUpdate("not-a-wallet"));
    expect(res.status).toBe(200);
    const sent = sentMessages(fetchSpy);
    expect(sent[0]!.text.toLowerCase()).toContain("invalid wallet");
    const apiCalls = (
      fetchSpy.mock.calls as Array<[unknown, unknown?]>
    ).filter((call) => String(call[0]).startsWith("https://api.test.local"));
    expect(apiCalls).toHaveLength(0);
  });

  it("renders an empty-state message when the wallet holds no positions", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/portfolio/")) {
        return new Response(
          JSON.stringify({ data: { positions: [], approximate: false } }),
          { status: 200 },
        );
      }
      if (url.includes("/api/v1/balances/")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    await post(positionsUpdate(WALLET));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe("No open positions for this wallet.");
  });

  it("renders joined positions (name, amount, cost basis) when both endpoints return data", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/portfolio/")) {
        return new Response(
          JSON.stringify({
            data: {
              positions: [
                {
                  tokenAddress: "0xaaaa000000000000000000000000000000000000",
                  tokenAmount: "0",
                  costBasisUsdc: "50000000",
                },
              ],
              approximate: false,
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/v1/balances/")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                address: "0xAAAA000000000000000000000000000000000000",
                name: "Alpha Token",
                ticker: "ALPHA",
                ltPair: "0xbbbb",
                leverage: 2,
                underlying: "HYPE",
                ltDirection: "long",
                balance: "2500000000000000000",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    await post(positionsUpdate(WALLET));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    const text = sent[0]!.text;
    expect(text).toContain("Open positions (1)");
    expect(text).toContain("Alpha Token (ALPHA)");
    expect(text).toContain("2.5");
    expect(text).toContain("$50");
    // Single-page result must not attach a keyboard; an empty
    // nav row would render as a zero-height inline strip.
    expect(sent[0]!.reply_markup).toBeUndefined();
  });

  it("attaches a Next button when the response paginates", async () => {
    // 250 long-name positions push the rendered output past 4096 chars
    // and into multi-chunk territory — the same fixture used by
    // format.test.ts to validate chunking.
    const positions = Array.from({ length: 250 }, (_, i) => ({
      tokenAddress: `0x${i.toString(16).padStart(40, "0")}`,
      tokenAmount: "0",
      costBasisUsdc: "1000000",
    }));
    const balances = Array.from({ length: 250 }, (_, i) => ({
      address: `0x${i.toString(16).padStart(40, "0")}`,
      name: `Long Token Name Number ${i}`,
      ticker: `LT${i}`,
      ltPair: "0xbbbb",
      leverage: 2,
      underlying: "HYPE",
      ltDirection: "long",
      balance: "1000000000000000000",
    }));
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/portfolio/")) {
        return new Response(
          JSON.stringify({ data: { positions, approximate: false } }),
          { status: 200 },
        );
      }
      if (url.includes("/api/v1/balances/")) {
        return new Response(JSON.stringify({ data: balances }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 200 });
    });
    await post(positionsUpdate(WALLET));
    const sent = sentMessages(fetchSpy);
    // Pagination replaces the old chunk-blast — exactly one outbound
    // message regardless of how many pages the data occupies.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Open positions (250)");
    expect(sent[0]!.text).toContain("Page 1 of");
    const markup = sent[0]!.reply_markup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    expect(markup).toBeDefined();
    const buttons = markup.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(["Next →"]);
    // Page 0 — only Next, no Prev.
    expect(buttons[0]!.callback_data).toMatch(/^pp:1:0x[0-9a-f]{40}$/i);
  });

  it("replies with a degraded-data message when the API returns 503", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.test.local")) {
        return new Response("{}", { status: 503 });
      }
      return new Response("{}", { status: 200 });
    });
    await post(positionsUpdate(WALLET));
    const sent = sentMessages(fetchSpy);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text.toLowerCase()).toContain(
      "data temporarily unavailable",
    );
  });

  it("sends the bot's X-API-Key on every upstream read", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/portfolio/")) {
        return new Response(
          JSON.stringify({ data: { positions: [], approximate: false } }),
          { status: 200 },
        );
      }
      if (url.includes("/api/v1/balances/")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    await post(positionsUpdate(WALLET));
    const apiCalls = (
      fetchSpy.mock.calls as Array<[unknown, unknown?]>
    ).filter((call) => String(call[0]).startsWith("https://api.test.local"));
    expect(apiCalls).toHaveLength(2);
    for (const call of apiCalls) {
      const headers = new Headers((call[1] as RequestInit).headers);
      expect(headers.get("x-api-key")).toBe("test-api-key");
    }
  });
});
