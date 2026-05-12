import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import app from "../index.js";
import type { Env } from "../lib/types.js";

const env: Env = {
  TELEGRAM_BOT_TOKEN: "test-bot-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  ADMIN_API_KEY: "test-admin-key",
};

const post = (body: string | object, headers: Record<string, string> = {}) =>
  app.request(
    "/admin/set-webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-key": "test-admin-key",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );

describe("POST /admin/set-webhook", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        }),
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("rejects requests missing the admin key", async () => {
    const res = await post(
      { url: "https://example.com/webhook" },
      { "x-admin-key": "" },
    );
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400s on malformed JSON without calling Telegram", async () => {
    const res = await post("not json");
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400s when url is missing", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400s when url is not a string", async () => {
    const res = await post({ url: 123 });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400s on unparseable url", async () => {
    const res = await post({ url: "not a url" });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400s on non-https url (Telegram requires https)", async () => {
    const res = await post({ url: "http://example.com/webhook" });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards valid https url to Telegram with secret_token", async () => {
    const res = await post({ url: "https://example.com/webhook" });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottest-bot-token/setWebhook");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.url).toBe("https://example.com/webhook");
    expect(body.secret_token).toBe("test-secret");
    expect(body.allowed_updates).toEqual(["message"]);
  });
});
