import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import app from "../../index.js";
import { makeTestEnv } from "../helpers/env.js";

const env = makeTestEnv();

const walletUpdate = {
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: 42, type: "private" as const },
    from: { id: 7, is_bot: false, first_name: "Ada" },
    text: "/wallet",
    entities: [{ type: "bot_command", offset: 0, length: 7 }],
  },
};

const postWebhook = (body: unknown) =>
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

describe("/wallet command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("replies with the wallet placeholder", async () => {
    const res = await postWebhook(walletUpdate);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottest-bot-token/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.chat_id).toBe(42);
    expect(body.text).toContain("Wallet management is coming soon");
    // No parse_mode — guards against the silent 400 when token names or
    // addresses contain MarkdownV2 reserved chars before the `md` tag lands.
    expect(body.parse_mode).toBeUndefined();
  });

  it("includes the deferred actions from the spec", async () => {
    await postWebhook(walletUpdate);
    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    );
    for (const action of [
      "Create wallet",
      "Import wallet",
      "Switch active wallet",
      "Rename wallet",
      "Export private key",
      "Withdraw",
    ]) {
      expect(body.text).toContain(action);
    }
  });

  it("ACKs and does not call Telegram for unknown commands", async () => {
    const res = await postWebhook({
      update_id: 2,
      message: {
        message_id: 2,
        date: 0,
        chat: { id: 42, type: "private" as const },
        from: { id: 7, is_bot: false, first_name: "Ada" },
        text: "/nope",
        entities: [{ type: "bot_command", offset: 0, length: 5 }],
      },
    });
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ACKs even when /wallet handler throws (no Telegram retry storm)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("telegram down"));
    const res = await postWebhook(walletUpdate);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
