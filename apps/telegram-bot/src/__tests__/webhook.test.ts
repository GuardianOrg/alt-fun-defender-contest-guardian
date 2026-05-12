import { describe, it, expect, beforeEach, vi } from "vitest";

import app from "../index.js";
import { makeTestEnv } from "./helpers/env.js";

/**
 * Webhook unit tests cover the routing layer only — auth header
 * validation, body parsing, chat_id extraction, and the ChatDO fetch
 * call. The bot itself (`createBot(env).handleUpdate(update)`) is
 * tested in the per-command files.
 */

interface DoSpyState {
  idFromNameCalls: string[];
  fetchCalls: { url: string; body: string }[];
}

const buildEnvWithDoSpy = (
  state: DoSpyState,
): ReturnType<typeof makeTestEnv> => {
  const stubStub = {
    fetch: async (input: Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      const body =
        init?.body !== undefined
          ? String(init.body)
          : input instanceof Request
            ? await input.text()
            : "";
      state.fetchCalls.push({ url, body });
      return new Response("ok");
    },
  } as unknown as DurableObjectStub;
  return makeTestEnv({
    CHAT_DO: {
      idFromName: (name: string) => {
        state.idFromNameCalls.push(name);
        return {} as DurableObjectId;
      },
      get: () => stubStub,
    } as unknown as DurableObjectNamespace,
  });
};

const post = (
  env: ReturnType<typeof makeTestEnv>,
  body: unknown,
  headers: Record<string, string> = {
    "x-telegram-bot-api-secret-token": "test-secret",
  },
) =>
  app.request(
    "/webhook",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );

const commandUpdate = (text: string, chatId = 42) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: chatId, type: "private" as const },
    from: { id: 7, is_bot: false, first_name: "Ada" },
    text,
    entities: [{ type: "bot_command", offset: 0, length: text.length }],
  },
});

describe("POST /webhook", () => {
  let doState: DoSpyState;

  beforeEach(() => {
    doState = { idFromNameCalls: [], fetchCalls: [] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
  });

  it("rejects requests without the secret header", async () => {
    const res = await post(buildEnvWithDoSpy(doState), commandUpdate("/start"), {});
    expect(res.status).toBe(403);
    expect(doState.fetchCalls).toEqual([]);
  });

  it("rejects requests with the wrong secret", async () => {
    const res = await post(buildEnvWithDoSpy(doState), commandUpdate("/start"), {
      "x-telegram-bot-api-secret-token": "wrong",
    });
    expect(res.status).toBe(403);
    expect(doState.fetchCalls).toEqual([]);
  });

  it("ACKs 200 even when the body is unparseable (no Telegram retry storm)", async () => {
    const res = await post(buildEnvWithDoSpy(doState), "not json");
    expect(res.status).toBe(200);
    expect(doState.fetchCalls).toEqual([]);
  });

  it("ACKs and no-ops when no chat id can be extracted (no message + no callback_query)", async () => {
    const res = await post(buildEnvWithDoSpy(doState), { update_id: 99 });
    expect(res.status).toBe(200);
    expect(doState.fetchCalls).toEqual([]);
  });

  it("routes message updates to ChatDO keyed by chat id", async () => {
    const env = buildEnvWithDoSpy(doState);
    const res = await post(env, commandUpdate("/start", 42));
    expect(res.status).toBe(200);
    expect(doState.idFromNameCalls).toEqual(["chat:42"]);
    expect(doState.fetchCalls).toHaveLength(1);
    expect(doState.fetchCalls[0]?.url).toContain("/update");
    // Body forwarded verbatim — the DO re-parses for grammY.
    expect(JSON.parse(doState.fetchCalls[0]!.body)).toMatchObject({
      update_id: 1,
      message: { chat: { id: 42 } },
    });
  });

  it("routes callback_query updates to ChatDO using the originating chat", async () => {
    const env = buildEnvWithDoSpy(doState);
    const res = await post(env, {
      update_id: 5,
      callback_query: {
        id: "cbq-1",
        from: { id: 7, is_bot: false, first_name: "Ada" },
        chat_instance: "i-1",
        message: {
          message_id: 100,
          date: 0,
          chat: { id: 99, type: "private" },
        },
        data: "wc",
      },
    });
    expect(res.status).toBe(200);
    expect(doState.idFromNameCalls).toEqual(["chat:99"]);
  });

  it("ACKs 200 even when DO fetch throws (logged + swallowed)", async () => {
    const env = makeTestEnv({
      CHAT_DO: {
        idFromName: () => ({}) as DurableObjectId,
        get: () =>
          ({
            fetch: async () => {
              throw new Error("DO unavailable");
            },
          }) as unknown as DurableObjectStub,
      } as unknown as DurableObjectNamespace,
    });
    const res = await post(env, commandUpdate("/start"));
    expect(res.status).toBe(200);
  });
});
