import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { sendMessage } from "../lib/telegram.js";

describe("sendMessage", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
  });
  afterEach(() => fetchSpy.mockRestore());

  it("locks chat_id and text against `extra` overrides", async () => {
    await sendMessage("tok", 42, "hello", {
      chat_id: 999,
      text: "hijacked",
      reply_to_message_id: 7,
    });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.chat_id).toBe(42);
    expect(body.text).toBe("hello");
    expect(body.reply_to_message_id).toBe(7);
  });

  it("omits parse_mode by default (plain text)", async () => {
    await sendMessage("tok", 1, "hi");
    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.parse_mode).toBeUndefined();
  });

  it("forwards parse_mode when caller opts in via extra", async () => {
    await sendMessage("tok", 1, "<b>hi</b>", { parse_mode: "HTML" });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.parse_mode).toBe("HTML");
  });
});
