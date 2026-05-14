import { describe, it, expect } from "vitest";

import {
  buildPositionsPageKeyboard,
  chunkPositionsMessage,
  escapeHtml,
  formatBotPositionsResponse,
  formatFixed,
  formatTokenAmount,
  formatUsdc,
  POSITIONS_BUY_CALLBACK_CMD,
  POSITIONS_PAGE_CALLBACK_CMD,
  POSITIONS_SELL_CALLBACK_CMD,
  POSITIONS_TRACK_CALLBACK_CMD,
  renderPaginatedPage,
  TELEGRAM_MESSAGE_LIMIT,
} from "../../lib/format.js";
import type {
  BotOpenPosition,
  BotPositionsResponse,
  BotRealisedPosition,
} from "../../lib/api.js";

const openPos = (
  overrides: Partial<BotOpenPosition> = {},
): BotOpenPosition => ({
  token: "0x1111111111111111111111111111111111111111",
  ticker: "ONE",
  balance: "1500000000000000000",
  costBasisUsdc: "20000000",
  currentValueUsdc: "25000000",
  unrealisedPnlUsdc: "5000000",
  unrealisedPnlPct: 25,
  ...overrides,
});

const realisedPos = (
  overrides: Partial<BotRealisedPosition> = {},
): BotRealisedPosition => ({
  token: "0x2222222222222222222222222222222222222222",
  ticker: "TWO",
  totalCostUsdc: "10000000",
  totalProceedsUsdc: "15000000",
  realisedPnlUsdc: "5000000",
  realisedPnlPct: 50,
  ...overrides,
});

describe("formatFixed", () => {
  it("renders an exact whole number with no fractional padding", () => {
    expect(formatFixed("1000000000000000000", 18, 4)).toBe("1");
  });

  it("trims trailing zeros from the fractional portion", () => {
    expect(formatFixed("1500000000000000000", 18, 4)).toBe("1.5");
  });

  it("groups the integer portion with commas", () => {
    expect(formatFixed("1234567890000000000000", 18, 2)).toBe("1,234.56");
  });

  it("handles zero", () => {
    expect(formatFixed("0", 6, 2)).toBe("0");
  });

  it("rounds down (truncates) the fractional portion at display precision", () => {
    // 0.123456 USDC at 2 dp → 0.12, not 0.13
    expect(formatFixed("123456", 6, 2)).toBe("0.12");
  });

  it("handles negative values", () => {
    expect(formatFixed("-1500000", 6, 2)).toBe("-1.5");
  });

  it("renders amounts beyond Number.MAX_SAFE_INTEGER without precision loss", () => {
    // 10^30 raw token units → 10^12 whole tokens. Number would lose digits here.
    expect(formatTokenAmount("1000000000000000000000000000000")).toBe(
      "1,000,000,000,000",
    );
  });
});

describe("formatUsdc / formatTokenAmount", () => {
  it("formatUsdc renders 6-decimal raw to 2 dp", () => {
    expect(formatUsdc("12345600")).toBe("12.34");
  });

  it("formatTokenAmount renders 18-decimal raw to 4 dp", () => {
    expect(formatTokenAmount("1234500000000000000")).toBe("1.2345");
  });
});

describe("chunkPositionsMessage", () => {
  it("packs lines under the limit into a single chunk", () => {
    const chunks = chunkPositionsMessage("HEAD", ["a", "b", "c"], 100);
    expect(chunks).toEqual(["HEAD\n\na\n\nb\n\nc"]);
  });

  it("splits when adding the next line would exceed the limit", () => {
    const lines = ["aaaa", "bbbb", "cccc"];
    const chunks = chunkPositionsMessage("HEAD", lines, 12);
    // "HEAD\n\naaaa" = 10 chars → next would be 16, splits.
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(12);
  });

  it("returns just the header when there are no lines", () => {
    expect(chunkPositionsMessage("HEAD", [])).toEqual(["HEAD"]);
  });
});

describe("formatBotPositionsResponse", () => {
  it("returns an empty-state page when both sections are empty", () => {
    const pages = formatBotPositionsResponse({ open: [], realised: [] });
    expect(pages).toHaveLength(1);
    expect(pages[0]!.text).toBe("No open positions for this wallet.");
    expect(pages[0]!.openActions).toEqual([]);
  });

  it("renders an Open header, ticker, balance, cost, value, signed PnL, and percent", () => {
    const pages = formatBotPositionsResponse({
      open: [openPos()],
      realised: [],
    });
    const joined = pages.map((p) => p.text).join("\n");
    expect(joined).toContain("Open positions (1)");
    expect(joined).toContain("ONE");
    expect(joined).toContain("1.5");
    expect(joined).toContain("cost $20");
    expect(joined).toContain("value $25");
    expect(joined).toContain("+$5");
    expect(joined).toContain("+25.00%");
  });

  it("renders the open-position token address inside <code> so it's tap-to-copy", () => {
    const pos = openPos({
      token: "0xbBf3457b56e4B3E8Eb0c66cb9a626219d3000000",
      ticker: "ALPHA",
    });
    const pages = formatBotPositionsResponse({ open: [pos], realised: [] });
    const joined = pages.map((p) => p.text).join("\n");
    expect(joined).toContain(`<code>${pos.token}</code>`);
  });

  it("renders the realised-position token address inside <code>", () => {
    const pos = realisedPos({
      token: "0xbBf3457b56e4B3E8Eb0c66cb9a626219d3000000",
    });
    const pages = formatBotPositionsResponse({ open: [], realised: [pos] });
    const joined = pages.map((p) => p.text).join("\n");
    expect(joined).toContain(`<code>${pos.token}</code>`);
  });

  it("emits one openActions entry per open position on the page it lands on", () => {
    const pos = openPos({
      token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ticker: "ALPHA",
    });
    const pages = formatBotPositionsResponse({ open: [pos], realised: [] });
    expect(pages).toHaveLength(1);
    expect(pages[0]!.openActions).toEqual([
      { token: pos.token, ticker: pos.ticker },
    ]);
  });

  it("does not emit `t.me?start=...` HTML anchors in the body any more", () => {
    // Regression: the legacy Buy/Sell anchors bounced through Telegram's
    // link-handler UI even inside the same bot's chat. Per-position
    // callback buttons (see `buildPositionsPageKeyboard`) replace them.
    const pos = openPos({
      token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ticker: "ALPHA",
    });
    const pages = formatBotPositionsResponse({ open: [pos], realised: [] });
    const joined = pages.map((p) => p.text).join("\n");
    expect(joined).not.toContain("?start=buy_");
    expect(joined).not.toContain("?start=sell_");
    expect(joined).not.toContain("t.me/");
  });

  it("does not emit openActions for realised (closed) positions", () => {
    const pages = formatBotPositionsResponse({
      open: [],
      realised: [realisedPos()],
    });
    for (const page of pages) expect(page.openActions).toEqual([]);
  });

  it("HTML-escapes the ticker so an attacker-controlled symbol can't inject markup", () => {
    const pos = openPos({ ticker: "<img src=x onerror=1>" });
    const pages = formatBotPositionsResponse({ open: [pos], realised: [] });
    const joined = pages.map((p) => p.text).join("\n");
    expect(joined).not.toContain("<img src=x");
    expect(joined).toContain("&lt;img src=x onerror=1&gt;");
  });

  it("renders a Realised header with proceeds, cost, signed PnL, percent", () => {
    const pages = formatBotPositionsResponse({
      open: [],
      realised: [realisedPos()],
    });
    const joined = pages.map((p) => p.text).join("\n");
    expect(joined).toContain("Realised positions (1)");
    expect(joined).toContain("TWO");
    expect(joined).toContain("cost $10");
    expect(joined).toContain("proceeds $15");
    expect(joined).toContain("realised +$5");
    expect(joined).toContain("+50.00%");
  });

  it("renders a negative PnL with the Unicode minus sign and floored percent", () => {
    const pages = formatBotPositionsResponse({
      open: [
        openPos({
          unrealisedPnlUsdc: "-1234567",
          unrealisedPnlPct: -12.349,
        }),
      ],
      realised: [],
    });
    const joined = pages.map((p) => p.text).join("\n");
    expect(joined).toContain("−$1.23");
    // Math.floor on negatives rounds toward -∞: -12.349 → -12.35.
    expect(joined).toContain("−12.35%");
  });

  it("renders an em-dash when percent is null (cost basis was zero)", () => {
    const pages = formatBotPositionsResponse({
      open: [
        openPos({
          costBasisUsdc: "0",
          unrealisedPnlPct: null,
        }),
      ],
      realised: [],
    });
    expect(pages.map((p) => p.text).join("\n")).toContain("(—)");
  });

  it("chunks output into <=4096-char Telegram messages for large lists", () => {
    const many: BotOpenPosition[] = Array.from({ length: 250 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    const pages = formatBotPositionsResponse({ open: many, realised: [] });
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages)
      expect(page.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });

  it("scopes openActions to the positions on each page (no drift between pages)", () => {
    const many: BotOpenPosition[] = Array.from({ length: 250 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    const pages = formatBotPositionsResponse({ open: many, realised: [] });
    expect(pages.length).toBeGreaterThan(1);
    // Every page must have at least one openAction (no empty pages),
    // and the sum across pages must equal the input open count.
    const total = pages.reduce((acc, p) => acc + p.openActions.length, 0);
    expect(total).toBe(many.length);
    for (const page of pages) {
      // Each openAction's ticker must appear in that page's text.
      for (const action of page.openActions) {
        expect(page.text).toContain(action.ticker);
      }
    }
  });

  it("includes both sections when both have entries", () => {
    const pages = formatBotPositionsResponse({
      open: [openPos()],
      realised: [realisedPos()],
    });
    const joined = pages.map((p) => p.text).join("\n");
    expect(joined).toContain("Open positions (1)");
    expect(joined).toContain("Realised positions (1)");
  });
});

describe("escapeHtml", () => {
  it("escapes the four HTML metacharacters Telegram cares about and leaves other UTF-8 alone", () => {
    // Telegram's HTML parse mode requires `&`, `<`, `>` to be entity-
    // encoded inside text. `"` is escaped too so attacker-controlled
    // tickers stay safe if a future change reintroduces attribute
    // interpolation. Single quotes are not part of Telegram's grammar
    // — see https://core.telegram.org/bots/api#html-style — so the
    // escaper deliberately stops at four.
    expect(escapeHtml("a & <b> \"c\" 'd'")).toBe(
      "a &amp; &lt;b&gt; &quot;c&quot; 'd'",
    );
    expect(escapeHtml("ALPHA · 25.00%")).toBe("ALPHA · 25.00%");
  });
});

const pages = (texts: string[]): { text: string; openActions: [] }[] =>
  texts.map((text) => ({ text, openActions: [] }));

describe("renderPaginatedPage", () => {
  it("returns the only page verbatim when totalPages = 1 (no footer)", () => {
    expect(renderPaginatedPage(pages(["body"]), 0)).toBe("body");
  });

  it("appends a 'Page X of Y' footer when totalPages > 1", () => {
    const out = renderPaginatedPage(pages(["a", "b", "c"]), 1);
    expect(out.startsWith("b")).toBe(true);
    expect(out).toContain("Page 2 of 3");
  });

  it("clamps a too-high page index to the last available page", () => {
    const out = renderPaginatedPage(pages(["a", "b"]), 99);
    expect(out.startsWith("b")).toBe(true);
    expect(out).toContain("Page 2 of 2");
  });

  it("clamps a negative page index to 0", () => {
    const out = renderPaginatedPage(pages(["a", "b"]), -5);
    expect(out.startsWith("a")).toBe(true);
    expect(out).toContain("Page 1 of 2");
  });

  it("returns an empty string for an empty page list", () => {
    expect(renderPaginatedPage([], 0)).toBe("");
  });

  it("paginated body + footer fits within TELEGRAM_MESSAGE_LIMIT for max-sized pages", () => {
    const maxBody = "x".repeat(TELEGRAM_MESSAGE_LIMIT - 24);
    const ps = pages([maxBody, maxBody, maxBody]);
    for (const page of [0, 1, 2]) {
      const rendered = renderPaginatedPage(ps, page);
      expect(rendered.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
      expect(rendered).toContain(`Page ${page + 1} of 3`);
    }
  });

  it("formatBotPositionsResponse pages fit within the reserved footer budget", () => {
    const many: BotOpenPosition[] = Array.from({ length: 250 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    const result = formatBotPositionsResponse({ open: many, realised: [] });
    expect(result.length).toBeGreaterThan(1);
    for (let i = 0; i < result.length; i++) {
      const rendered = renderPaginatedPage(result, i);
      expect(rendered.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    }
  });
});

describe("buildPositionsPageKeyboard", () => {
  const WALLET = "0x1234567890abcdef1234567890abcdef12345678";
  const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  it("returns a Back/Home-only keyboard when there are no open actions and only one page", () => {
    const kb = buildPositionsPageKeyboard(0, 1, WALLET, []);
    expect(kb.inline_keyboard).toEqual([
      [{ text: "← Back", callback_data: "nav:b" }, { text: "🏠 Home", callback_data: "nav:h" }],
    ]);
  });

  it("emits a [<TICKER>] track row followed by a [Buy <TICKER>] [Sell <TICKER>] row per open action", () => {
    const kb = buildPositionsPageKeyboard(0, 1, WALLET, [
      { token: TOKEN_A, ticker: "ALPHA" },
      { token: TOKEN_B, ticker: "BETA" },
    ]);
    const rows = kb.inline_keyboard;
    // Per position: a track row + a buy/sell row → 2 positions = 4
    // rows, plus the trailing Close row.
    expect(rows).toHaveLength(5);
    expect(rows[0]!.map((b) => b.text)).toEqual(["ALPHA"]);
    expect(rows[0]![0]!.callback_data).toBe(
      `${POSITIONS_TRACK_CALLBACK_CMD}:${TOKEN_A}`,
    );
    expect(rows[1]!.map((b) => b.text)).toEqual(["Buy ALPHA", "Sell ALPHA"]);
    expect(rows[1]![0]!.callback_data).toBe(
      `${POSITIONS_BUY_CALLBACK_CMD}:${TOKEN_A}`,
    );
    expect(rows[1]![1]!.callback_data).toBe(
      `${POSITIONS_SELL_CALLBACK_CMD}:${TOKEN_A}`,
    );
    expect(rows[2]!.map((b) => b.text)).toEqual(["BETA"]);
    expect(rows[2]![0]!.callback_data).toBe(
      `${POSITIONS_TRACK_CALLBACK_CMD}:${TOKEN_B}`,
    );
    expect(rows[3]!.map((b) => b.text)).toEqual(["Buy BETA", "Sell BETA"]);
    expect(rows[4]!.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
  });

  it("truncates a long ticker in the button label only (callback_data carries the address)", () => {
    const kb = buildPositionsPageKeyboard(0, 1, WALLET, [
      { token: TOKEN_A, ticker: "SUPERCALIFRAGILISTIC" },
    ]);
    // First row is the track label; second is buy/sell.
    const trackRow = kb.inline_keyboard[0]!;
    expect(trackRow[0]!.text.length).toBeLessThanOrEqual(12);
    expect(trackRow[0]!.text.endsWith("…")).toBe(true);
    expect(trackRow[0]!.callback_data).toContain(TOKEN_A);
    const row = kb.inline_keyboard[1]!;
    expect(row[0]!.text.length).toBeLessThanOrEqual("Buy ".length + 12);
    expect(row[0]!.text.endsWith("…")).toBe(true);
    // The full token address must still ride in callback_data verbatim
    // — the truncation is purely cosmetic on the label side.
    expect(row[0]!.callback_data).toContain(TOKEN_A);
  });

  it("page 0 of N: emits open action rows + a [Next →] nav row only", () => {
    const kb = buildPositionsPageKeyboard(0, 3, WALLET, [
      { token: TOKEN_A, ticker: "ALPHA" },
    ]);
    const rows = kb.inline_keyboard;
    expect(rows[0]!.map((b) => b.text)).toEqual(["ALPHA"]);
    expect(rows[1]!.map((b) => b.text)).toEqual(["Buy ALPHA", "Sell ALPHA"]);
    const nav = rows[2]!;
    expect(nav.map((b) => b.text)).toEqual(["Next →"]);
    expect(nav[0]!.callback_data).toBe(
      `${POSITIONS_PAGE_CALLBACK_CMD}:1:${WALLET}`,
    );
    expect(rows.at(-1)!.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
  });

  it("middle page: emits [← Prev] and [Next →] with correct target indices", () => {
    const kb = buildPositionsPageKeyboard(1, 3, WALLET, []);
    const nav = kb.inline_keyboard[0]!;
    expect(nav.map((b) => b.text)).toEqual(["← Prev", "Next →"]);
    expect(nav[0]!.callback_data).toBe(
      `${POSITIONS_PAGE_CALLBACK_CMD}:0:${WALLET}`,
    );
    expect(nav[1]!.callback_data).toBe(
      `${POSITIONS_PAGE_CALLBACK_CMD}:2:${WALLET}`,
    );
    expect(kb.inline_keyboard.at(-1)!.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
  });

  it("last page: emits only [← Prev]", () => {
    const kb = buildPositionsPageKeyboard(2, 3, WALLET, []);
    const nav = kb.inline_keyboard[0]!;
    expect(nav.map((b) => b.text)).toEqual(["← Prev"]);
    expect(kb.inline_keyboard.at(-1)!.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
  });

  it("every callback_data stays inside the 64-byte Telegram ceiling", () => {
    const kb = buildPositionsPageKeyboard(999, 1000, WALLET, [
      { token: TOKEN_A, ticker: "ALPHA" },
      { token: TOKEN_B, ticker: "BETA" },
    ]);
    for (const b of kb.inline_keyboard.flat()) {
      expect(b.callback_data.length).toBeLessThanOrEqual(64);
    }
  });
});

const _typeShape: BotPositionsResponse = { open: [], realised: [] };
void _typeShape;
