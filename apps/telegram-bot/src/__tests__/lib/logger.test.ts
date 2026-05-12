import { describe, it, expect, vi } from "vitest";

import {
  createLogger,
  isSensitiveKey,
  type Logger,
} from "../../lib/logger.js";

interface LogLine {
  level: "debug" | "info" | "warn" | "error";
  ts: string;
  msg: string;
  [k: string]: unknown;
}

const FIXED_DATE = new Date("2026-05-12T12:00:00.000Z");

const captureLine = (
  fn: (logger: Logger) => void,
  consoleMethod: "log" | "warn" | "error",
): LogLine => {
  const spy = vi.spyOn(console, consoleMethod).mockImplementation(() => {});
  try {
    const logger = createLogger(() => FIXED_DATE);
    fn(logger);
    expect(spy).toHaveBeenCalledTimes(1);
    const raw = spy.mock.calls[0]![0];
    return JSON.parse(String(raw)) as LogLine;
  } finally {
    spy.mockRestore();
  }
};

describe("isSensitiveKey", () => {
  it.each([
    "token",
    "TOKEN",
    "BOT_TOKEN",
    "TELEGRAM_BOT_TOKEN",
    "botToken",
    "secret",
    "WEBHOOK_SECRET",
    "webhookSecret",
    "api_key",
    "apiKey",
    "x-api-key",
    "X-API-Key",
    "API_KEY",
    "MASTER_KEY",
    "masterKey",
    "master-key",
    "privateKey",
    "private_key",
    "PRIVATE",
    "pin",
    "PIN",
    "pin_attempts",
    "mnemonic",
    "password",
  ])("redacts %s", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    "chat_id",
    "chatId",
    "wallet_address",
    "walletAddress",
    "amount",
    "ticker",
    "pinned", // common boolean, not a credential
    "keyboard", // grammY/Telegram concept
    "seed_buy", // domain term — creator seed buy
    "queryId",
    "callback_query_id",
    "level",
    "msg",
    "err",
  ])("keeps %s", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe("logger levels", () => {
  it("routes debug + info through console.log", () => {
    const debug = captureLine((l) => l.debug("hello"), "log");
    expect(debug.level).toBe("debug");
    const info = captureLine((l) => l.info("hello"), "log");
    expect(info.level).toBe("info");
  });

  it("routes warn through console.warn", () => {
    const line = captureLine((l) => l.warn("careful"), "warn");
    expect(line.level).toBe("warn");
  });

  it("routes error through console.error", () => {
    const line = captureLine((l) => l.error("kaboom"), "error");
    expect(line.level).toBe("error");
  });

  it("includes a fixed-shape header (level, ts, msg)", () => {
    const line = captureLine((l) => l.info("hello"), "log");
    expect(line).toMatchObject({
      level: "info",
      ts: FIXED_DATE.toISOString(),
      msg: "hello",
    });
  });
});

describe("logger context", () => {
  it("flattens context fields next to the header", () => {
    const line = captureLine(
      (l) => l.info("position fetched", { chatId: 42, count: 3 }),
      "log",
    );
    expect(line.chatId).toBe(42);
    expect(line.count).toBe(3);
  });

  it("redacts sensitive top-level keys", () => {
    const line = captureLine(
      (l) =>
        l.error("oops", {
          chatId: 42,
          BOT_TOKEN: "should-never-appear",
          api_key: "leaked-key",
          pin: 1234,
        }),
      "error",
    );
    expect(line.chatId).toBe(42);
    expect(line.BOT_TOKEN).toBe("[REDACTED]");
    expect(line.api_key).toBe("[REDACTED]");
    expect(line.pin).toBe("[REDACTED]");
  });

  it("redacts nested sensitive keys", () => {
    const line = captureLine(
      (l) =>
        l.error("oops", {
          user: { id: 7, mnemonic: "horse staple battery", chatId: 42 },
        }),
      "error",
    );
    expect(line.user).toMatchObject({
      id: 7,
      mnemonic: "[REDACTED]",
      chatId: 42,
    });
  });

  it("redacts inside arrays of objects", () => {
    const line = captureLine(
      (l) =>
        l.info("batch", {
          items: [{ id: 1, password: "p1" }, { id: 2, password: "p2" }],
        }),
      "log",
    );
    expect(line.items).toEqual([
      { id: 1, password: "[REDACTED]" },
      { id: 2, password: "[REDACTED]" },
    ]);
  });

  it("serializes Error instances with name, message, and stack", () => {
    const err = new Error("boom");
    const line = captureLine((l) => l.error("failed", { err }), "error");
    const serialized = line.err as { name: string; message: string; stack?: string };
    expect(serialized.name).toBe("Error");
    expect(serialized.message).toBe("boom");
    expect(typeof serialized.stack).toBe("string");
  });

  it("does not throw on circular references", () => {
    const a: Record<string, unknown> = { id: 1 };
    a.self = a;
    const line = captureLine((l) => l.info("cycle", { a }), "log");
    const aOut = line.a as Record<string, unknown>;
    expect(aOut.id).toBe(1);
    expect(aOut.self).toBe("[Circular]");
  });

  it("emits a valid JSON line even with no context", () => {
    const line = captureLine((l) => l.info("bare"), "log");
    expect(line.msg).toBe("bare");
    expect(line.level).toBe("info");
  });
});
