import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeBotHarness, type BotTestHarness } from "../helpers/bot.js";
import { NAV_CALLBACK, type NavSnapshot } from "../../lib/nav.js";

/**
 * Regression: the /start screen renders the active wallet address
 * inside a `<code>` span so Telegram shows it as a tap-to-copy
 * inline-code chip. Before the fix, tapping a /start submenu button
 * (Wallet, Settings, …) and then tapping [← Back] restored the
 * screen as plain text — the snapshot only captured `msg.text`
 * (formatting-stripped) and dropped `msg.entities`, so the restored
 * bubble lost the `code` MessageEntity and the address stopped being
 * copiable. The fix captures `entities` on snapshot and forwards them
 * via the `entities` editMessage parameter on restore.
 *
 * This test pre-seeds a navStack snapshot carrying a `code` entity
 * over a wallet address, fires the `nav:b` callback, and asserts the
 * outbound editMessageText body includes the entity AND omits
 * `parse_mode` (Telegram rejects the pair).
 */

const USER_ID = 42;
const CHAT_ID = 99;
const BUBBLE_ID = 1234;
const WALLET_ADDR = "0xabCDef0123456789ABCDef0123456789abcDEF01";
const SUBMENU_TEXT = "old submenu";
const START_TEXT = `Welcome — wallet ${WALLET_ADDR} balance 0 USDC`;
const ADDRESS_OFFSET = START_TEXT.indexOf(WALLET_ADDR);

interface TgCall {
  url: string;
  body: Record<string, unknown>;
}

const capture = (fetchSpy: ReturnType<typeof vi.spyOn>): TgCall[] =>
  (fetchSpy.mock.calls as Array<[unknown, unknown?]>)
    .filter((call) => (call[1] as RequestInit | undefined)?.body !== undefined)
    .map((call) => ({
      url: String(call[0]),
      body: JSON.parse((call[1] as RequestInit).body as string) as Record<
        string,
        unknown
      >,
    }));

const startSnapshot: NavSnapshot = {
  text: START_TEXT,
  // No parseMode — production captures entities directly from the
  // rendered bubble (Telegram strips the HTML source), so the snapshot
  // intentionally restores via `entities`, not `parse_mode`.
  entities: [
    {
      type: "code",
      offset: ADDRESS_OFFSET,
      length: WALLET_ADDR.length,
    },
  ],
  keyboard: [[{ text: "Refresh", callback_data: "st:r" }]],
};

const seedSession = async (h: BotTestHarness): Promise<void> => {
  // grammY's KvAdapter writes the SessionData blob under `session:<userId>`
  // as JSON. We construct just enough of SessionData here for the back
  // handler — the session middleware merges anything we omit against the
  // default initialiser on read.
  await h.kv.put(
    `session:${USER_ID}`,
    JSON.stringify({
      slippageBps: 1000,
      defaultBuyUsdc: 20,
      degenMode: true,
      navStack: [startSnapshot],
    }),
  );
};

const backCallbackUpdate = () => ({
  update_id: 200,
  callback_query: {
    id: "cbq-back",
    from: { id: USER_ID, is_bot: false, first_name: "Ada" },
    chat_instance: "ci-1",
    message: {
      message_id: BUBBLE_ID,
      date: 0,
      chat: { id: CHAT_ID, type: "private" as const },
      text: SUBMENU_TEXT,
      reply_markup: {
        inline_keyboard: [
          [{ text: "← Back", callback_data: NAV_CALLBACK.back }],
        ],
      },
    },
    data: NAV_CALLBACK.back,
  },
});

describe("[← Back] restores entities so /start's wallet address stays tap-to-copy", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("forwards the captured `code` MessageEntity on the restoring editMessageText", async () => {
    const h = makeBotHarness();
    await seedSession(h);

    await h.run(backCallbackUpdate());

    const edit = capture(fetchSpy).find(
      (c) =>
        c.url.includes("/editMessageText") &&
        (c.body as { message_id?: number }).message_id === BUBBLE_ID,
    );
    expect(edit, "Back must edit the source bubble into the snapshot").toBeDefined();
    expect(edit!.body.text).toBe(START_TEXT);

    // The snapshot carries a `code` entity; the restore must forward it
    // verbatim. Without this the wallet address renders as plain text
    // and Telegram's tap-to-copy affordance is gone.
    const entities = edit!.body.entities as
      | Array<{ type: string; offset: number; length: number }>
      | undefined;
    expect(entities).toBeDefined();
    expect(entities).toEqual([
      { type: "code", offset: ADDRESS_OFFSET, length: WALLET_ADDR.length },
    ]);

    // Telegram rejects requests that set both `entities` and `parse_mode`,
    // so the restore path must drop `parse_mode` when entities are present.
    // Treat `undefined` and missing-key as equivalent — JSON.stringify
    // strips undefined values, so the property may not even appear.
    expect(edit!.body.parse_mode ?? null).toBeNull();
  });
});
