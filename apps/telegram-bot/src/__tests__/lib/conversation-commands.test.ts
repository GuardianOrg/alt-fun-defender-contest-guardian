import { describe, it, expect } from "vitest";

import { isOtherSlashCommand } from "../../lib/conversation-commands.js";

describe("isOtherSlashCommand", () => {
  it("matches a plain slash command", () => {
    expect(isOtherSlashCommand("/positions")).toBe(true);
  });

  it("matches a slash command with arguments", () => {
    expect(isOtherSlashCommand("/buy 0x1234")).toBe(true);
  });

  it("matches the addressed `/cmd@BotName` form Telegram sends in groups", () => {
    expect(isOtherSlashCommand("/sell@alt_fun_bot")).toBe(true);
  });

  // Regression: `/cancel` used to be special-cased out of this matcher so
  // it would fall through to the local isCancel branch. With `/cancel`
  // removed entirely, it must halt the wizard like any other slash so a
  // user who muscle-memories /cancel still cleanly exits.
  it("matches `/cancel` the same as any other slash command", () => {
    expect(isOtherSlashCommand("/cancel")).toBe(true);
    expect(isOtherSlashCommand("/CANCEL")).toBe(true);
    expect(isOtherSlashCommand("/cancel@alt_fun_bot")).toBe(true);
  });

  it("does not match plain text input the user might send to a wizard", () => {
    expect(isOtherSlashCommand("0x1234567890abcdef")).toBe(false);
    expect(isOtherSlashCommand("123456")).toBe(false);
    expect(isOtherSlashCommand("cancel")).toBe(false);
    expect(isOtherSlashCommand("")).toBe(false);
  });

  it("does not match `/` followed by non-letter (not a real command)", () => {
    expect(isOtherSlashCommand("/1abc")).toBe(false);
    expect(isOtherSlashCommand("/")).toBe(false);
  });
});
