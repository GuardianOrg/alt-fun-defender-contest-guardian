import { describe, it, expect } from "vitest";

import { parseCommand } from "../lib/commands.js";
import type { TelegramMessage } from "../lib/telegram.js";

const baseMsg = (overrides: Partial<TelegramMessage> = {}): TelegramMessage => ({
  message_id: 1,
  date: 0,
  chat: { id: 42, type: "private" },
  ...overrides,
});

describe("parseCommand", () => {
  it("returns null when message has no text", () => {
    expect(parseCommand(baseMsg())).toBeNull();
  });

  it("returns null when no entities are present", () => {
    expect(parseCommand(baseMsg({ text: "/start" }))).toBeNull();
  });

  it("parses a bare /start command", () => {
    const cmd = parseCommand(
      baseMsg({
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      }),
    );
    expect(cmd).toEqual({ name: "start", args: "" });
  });

  it("strips the @botname suffix used in groups", () => {
    const cmd = parseCommand(
      baseMsg({
        text: "/start@altfun_bot",
        entities: [{ type: "bot_command", offset: 0, length: 17 }],
      }),
    );
    expect(cmd?.name).toBe("start");
  });

  it("captures args after the command token", () => {
    const cmd = parseCommand(
      baseMsg({
        text: "/buy   0xabc 10",
        entities: [{ type: "bot_command", offset: 0, length: 4 }],
      }),
    );
    expect(cmd).toEqual({ name: "buy", args: "0xabc 10" });
  });

  it("ignores bot_command entities that aren't at offset 0", () => {
    // A "/foo" mid-message is a mention of a command, not an invocation.
    const cmd = parseCommand(
      baseMsg({
        text: "hello /start",
        entities: [{ type: "bot_command", offset: 6, length: 6 }],
      }),
    );
    expect(cmd).toBeNull();
  });

  it("lowercases the command name", () => {
    const cmd = parseCommand(
      baseMsg({
        text: "/START",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      }),
    );
    expect(cmd?.name).toBe("start");
  });
});
