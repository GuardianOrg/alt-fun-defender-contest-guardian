import { describe, it, expect } from "vitest";

import {
  buildPositionsPageKeyboard,
  buildPositionsView,
  chunkPositionsMessage,
  escapeHtml,
  formatFixed,
  formatTokenAmount,
  formatUsdc,
  POSITIONS_BUY_CALLBACK_CMD,
  POSITIONS_PAGE_CALLBACK_CMD,
  POSITIONS_PAGE_SIZE,
  POSITIONS_REFRESH_CALLBACK_CMD,
  POSITIONS_SELL_CALLBACK_CMD,
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
    expect(formatFixed("123456", 6, 2)).toBe("0.12");
  });

  it("handles negative values", () => {
    expect(formatFixed("-1500000", 6, 2)).toBe("-1.5");
  });

  it("renders amounts beyond Number.MAX_SAFE_INTEGER without precision loss", () => {
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
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(12);
  });

  it("returns just the header when there are no lines", () => {
    expect(chunkPositionsMessage("HEAD", [])).toEqual(["HEAD"]);
  });
});

describe("buildPositionsView", () => {
  it("returns the empty-state body when both sections are empty", () => {
    const view = buildPositionsView({ open: [], realised: [] }, 0, 0);
    expect(view.text).toBe("No open positions for this wallet.");
    expect(view.openActions).toEqual([]);
    expect(view.openTotal).toBe(0);
    expect(view.realisedTotal).toBe(0);
    expect(view.openTotalPages).toBe(1);
    expect(view.realisedTotalPages).toBe(1);
  });

  it("renders an Open header, ticker, balance, cost, value, signed PnL, and percent", () => {
    const view = buildPositionsView(
      { open: [openPos()], realised: [] },
      0,
      0,
    );
    expect(view.text).toContain("Open positions (1)");
    expect(view.text).toContain("ONE");
    expect(view.text).toContain("1.5");
    expect(view.text).toContain("cost $20");
    expect(view.text).toContain("value $25");
    expect(view.text).toContain("+$5");
    expect(view.text).toContain("+25.00%");
  });

  it("renders the open-position token address inside <code> so it's tap-to-copy", () => {
    const pos = openPos({
      token: "0xbBf3457b56e4B3E8Eb0c66cb9a626219d3000000",
      ticker: "ALPHA",
    });
    const view = buildPositionsView({ open: [pos], realised: [] }, 0, 0);
    expect(view.text).toContain(`<code>${pos.token}</code>`);
  });

  it("renders the realised-position token address inside <code>", () => {
    const pos = realisedPos({
      token: "0xbBf3457b56e4B3E8Eb0c66cb9a626219d3000000",
    });
    const view = buildPositionsView({ open: [], realised: [pos] }, 0, 0);
    expect(view.text).toContain(`<code>${pos.token}</code>`);
  });

  it("emits one openActions entry per visible open position", () => {
    const pos = openPos({
      token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ticker: "ALPHA",
    });
    const view = buildPositionsView({ open: [pos], realised: [] }, 0, 0);
    expect(view.openActions).toEqual([
      { token: pos.token, ticker: pos.ticker },
    ]);
  });

  it("omits ticker anchors when no botUsername is provided (fall-back to plain text)", () => {
    const pos = openPos({
      token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ticker: "ALPHA",
    });
    const view = buildPositionsView({ open: [pos], realised: [] }, 0, 0);
    expect(view.text).not.toContain("?start=buy_");
    expect(view.text).not.toContain("?start=sell_");
    expect(view.text).not.toContain("?start=track_");
    expect(view.text).not.toContain("t.me/");
    expect(view.text).not.toMatch(/<a\s/i);
  });

  it("wraps the open-position ticker in a `t.me/<bot>?start=track_<addr>` anchor when botUsername is provided", () => {
    const pos = openPos({
      token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ticker: "ALPHA",
    });
    const view = buildPositionsView(
      { open: [pos], realised: [] },
      0,
      0,
      "trade_cortisol_bot",
    );
    expect(view.text).toContain(
      `<a href="https://t.me/trade_cortisol_bot?start=track_${pos.token}">ALPHA</a>`,
    );
  });

  it("wraps the realised-position ticker in a `t.me/<bot>?start=track_<addr>` anchor when botUsername is provided", () => {
    const pos = realisedPos({
      token: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ticker: "BETA",
    });
    const view = buildPositionsView(
      { open: [], realised: [pos] },
      0,
      0,
      "trade_cortisol_bot",
    );
    expect(view.text).toContain(
      `<a href="https://t.me/trade_cortisol_bot?start=track_${pos.token}">BETA</a>`,
    );
  });

  it("does not emit openActions for realised (closed) positions", () => {
    const view = buildPositionsView(
      { open: [], realised: [realisedPos()] },
      0,
      0,
    );
    expect(view.openActions).toEqual([]);
  });

  it("HTML-escapes the ticker so an attacker-controlled symbol can't inject markup", () => {
    const pos = openPos({ ticker: "<img src=x onerror=1>" });
    const view = buildPositionsView({ open: [pos], realised: [] }, 0, 0);
    expect(view.text).not.toContain("<img src=x");
    expect(view.text).toContain("&lt;img src=x onerror=1&gt;");
  });

  it("renders a Realised header with proceeds, cost, signed PnL, percent", () => {
    const view = buildPositionsView(
      { open: [], realised: [realisedPos()] },
      0,
      0,
    );
    expect(view.text).toContain("Realised positions (1)");
    expect(view.text).toContain("TWO");
    expect(view.text).toContain("cost $10");
    expect(view.text).toContain("proceeds $15");
    expect(view.text).toContain("realised +$5");
    expect(view.text).toContain("+50.00%");
  });

  it("renders a negative PnL with the Unicode minus sign and floored percent", () => {
    const view = buildPositionsView(
      {
        open: [
          openPos({
            unrealisedPnlUsdc: "-1234567",
            unrealisedPnlPct: -12.349,
          }),
        ],
        realised: [],
      },
      0,
      0,
    );
    expect(view.text).toContain("−$1.23");
    expect(view.text).toContain("−12.35%");
  });

  it("renders an em-dash when percent is null (cost basis was zero)", () => {
    const view = buildPositionsView(
      {
        open: [
          openPos({
            costBasisUsdc: "0",
            unrealisedPnlPct: null,
          }),
        ],
        realised: [],
      },
      0,
      0,
    );
    expect(view.text).toContain("(—)");
  });

  it("includes both sections when both have entries", () => {
    const view = buildPositionsView(
      { open: [openPos()], realised: [realisedPos()] },
      0,
      0,
    );
    expect(view.text).toContain("Open positions (1)");
    expect(view.text).toContain("Realised positions (1)");
  });

  it("paginates each section by POSITIONS_PAGE_SIZE records, independently", () => {
    const open: BotOpenPosition[] = Array.from({ length: 47 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    const realised: BotRealisedPosition[] = Array.from(
      { length: 23 },
      (_, i) =>
        realisedPos({
          token: `0x${(1000 + i).toString(16).padStart(40, "0")}`,
          ticker: `R${i}`,
        }),
    );
    const view = buildPositionsView({ open, realised }, 0, 0);
    expect(view.openTotal).toBe(47);
    expect(view.realisedTotal).toBe(23);
    expect(view.openTotalPages).toBe(Math.ceil(47 / POSITIONS_PAGE_SIZE));
    expect(view.realisedTotalPages).toBe(Math.ceil(23 / POSITIONS_PAGE_SIZE));
    expect(view.openActions).toHaveLength(POSITIONS_PAGE_SIZE);
    // First open page: LT0..LT4; first realised page: R0..R4.
    for (let i = 0; i < POSITIONS_PAGE_SIZE; i++) {
      expect(view.text).toContain(`LT${i}`);
      expect(view.text).toContain(`R${i}`);
    }
    expect(view.text).not.toContain("LT5");
    expect(view.text).not.toContain("R5");
  });

  it("slices the correct window when navigating to a non-zero page on one axis only", () => {
    const open: BotOpenPosition[] = Array.from({ length: 47 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    // Page 2 (index 1) on the open axis → LT5..LT9. Realised stays on page 0.
    const view = buildPositionsView({ open, realised: [] }, 1, 0);
    expect(view.openPage).toBe(1);
    expect(view.realisedPage).toBe(0);
    for (let i = 5; i <= 9; i++) {
      expect(view.text).toContain(`LT${i}`);
    }
    expect(view.text).not.toContain("LT4");
    expect(view.text).not.toContain("LT10");
  });

  it("renders only the last (partial) slice on the final page when the total is not a multiple of POSITIONS_PAGE_SIZE", () => {
    const open: BotOpenPosition[] = Array.from({ length: 47 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    // 47 records, page size 5 → 10 pages; page index 9 = LT45 + LT46 only.
    const view = buildPositionsView({ open, realised: [] }, 9, 0);
    expect(view.openTotalPages).toBe(10);
    expect(view.openPage).toBe(9);
    expect(view.openActions).toHaveLength(2);
    expect(view.text).toContain("LT45");
    expect(view.text).toContain("LT46");
    expect(view.text).not.toContain("LT44");
  });

  it("clamps a too-high page index to the last available page", () => {
    const open: BotOpenPosition[] = Array.from({ length: 2 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    const view = buildPositionsView({ open, realised: [] }, 99, 99);
    expect(view.openPage).toBe(0);
    expect(view.realisedPage).toBe(0);
  });

  it("clamps a negative page index to 0", () => {
    const view = buildPositionsView({ open: [openPos()], realised: [] }, -5, -5);
    expect(view.openPage).toBe(0);
    expect(view.realisedPage).toBe(0);
  });
});

describe("buildPositionsPageKeyboard", () => {
  const WALLET = "0x1234567890abcdef1234567890abcdef12345678";
  const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  it("returns a Refresh + Back/Home keyboard when there are no positions at all", () => {
    const view = buildPositionsView({ open: [], realised: [] }, 0, 0);
    const kb = buildPositionsPageKeyboard(view, WALLET);
    expect(kb.inline_keyboard).toEqual([
      [
        {
          text: "🔄 Refresh",
          callback_data: `${POSITIONS_REFRESH_CALLBACK_CMD}:0:0:${WALLET}`,
        },
      ],
      [
        { text: "← Back", callback_data: "nav:b" },
        { text: "🏠 Home", callback_data: "nav:h" },
      ],
    ]);
  });

  it("emits a [Buy <TICKER>] [Sell <TICKER>] row per open position when both sections fit on one page", () => {
    const view = buildPositionsView(
      {
        open: [
          openPos({ token: TOKEN_A, ticker: "ALPHA" }),
          openPos({ token: TOKEN_B, ticker: "BETA" }),
        ],
        realised: [],
      },
      0,
      0,
    );
    const kb = buildPositionsPageKeyboard(view, WALLET);
    const rows = kb.inline_keyboard;
    // Two per-position rows + refresh + Back/Home.
    expect(rows).toHaveLength(4);
    expect(rows[0]!.map((b) => b.text)).toEqual(["Buy ALPHA", "Sell ALPHA"]);
    expect(rows[0]![0]!.callback_data).toBe(
      `${POSITIONS_BUY_CALLBACK_CMD}:${TOKEN_A}`,
    );
    expect(rows[0]![1]!.callback_data).toBe(
      `${POSITIONS_SELL_CALLBACK_CMD}:${TOKEN_A}`,
    );
    expect(rows[1]!.map((b) => b.text)).toEqual(["Buy BETA", "Sell BETA"]);
    expect(rows[2]!.map((b) => b.text)).toEqual(["🔄 Refresh"]);
    expect(rows[2]![0]!.callback_data).toBe(
      `${POSITIONS_REFRESH_CALLBACK_CMD}:0:0:${WALLET}`,
    );
    expect(rows[3]!.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
  });

  it("truncates a long ticker in the button label only (callback_data carries the address)", () => {
    const view = buildPositionsView(
      {
        open: [openPos({ token: TOKEN_A, ticker: "SUPERCALIFRAGILISTIC" })],
        realised: [],
      },
      0,
      0,
    );
    const kb = buildPositionsPageKeyboard(view, WALLET);
    const buySellRow = kb.inline_keyboard[0]!;
    expect(buySellRow[0]!.text.length).toBeLessThanOrEqual("Buy ".length + 12);
    expect(buySellRow[0]!.text.endsWith("…")).toBe(true);
    expect(buySellRow[0]!.callback_data).toContain(TOKEN_A);
  });

  it("emits a single open-section nav row labelled `→ Page 2/T Open Pos` on the first page when open spills past 5 records", () => {
    const open: BotOpenPosition[] = Array.from({ length: 47 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    const view = buildPositionsView({ open, realised: [] }, 0, 0);
    expect(view.openTotalPages).toBe(10);
    const kb = buildPositionsPageKeyboard(view, WALLET);
    const rows = kb.inline_keyboard;
    // 5 per-position rows + 1 open nav row + refresh + back/home = 8 rows.
    expect(rows).toHaveLength(8);
    const openNav = rows[5]!;
    expect(openNav).toHaveLength(1);
    expect(openNav[0]!.text).toBe("→ Page 2/10 Open Pos");
    expect(openNav[0]!.callback_data).toBe(
      `${POSITIONS_PAGE_CALLBACK_CMD}:1:0:${WALLET}`,
    );
  });

  it("emits both `← Page N/T` and `→ Page N+2/T` on a middle open page", () => {
    const open: BotOpenPosition[] = Array.from({ length: 47 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    const view = buildPositionsView({ open, realised: [] }, 1, 0);
    const kb = buildPositionsPageKeyboard(view, WALLET);
    const rows = kb.inline_keyboard;
    // page 2 of 10: previous = page 1, next = page 3.
    const openNav = rows[5]!;
    expect(openNav.map((b) => b.text)).toEqual([
      "← Page 1/10 Open Pos",
      "→ Page 3/10 Open Pos",
    ]);
    expect(openNav[0]!.callback_data).toBe(
      `${POSITIONS_PAGE_CALLBACK_CMD}:0:0:${WALLET}`,
    );
    expect(openNav[1]!.callback_data).toBe(
      `${POSITIONS_PAGE_CALLBACK_CMD}:2:0:${WALLET}`,
    );
  });

  it("emits only `← Page N-1/T Open Pos` on the last open page", () => {
    const open: BotOpenPosition[] = Array.from({ length: 47 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    // Page index 9 → page label 10 of 10.
    const view = buildPositionsView({ open, realised: [] }, 9, 0);
    const kb = buildPositionsPageKeyboard(view, WALLET);
    // 2 partial-page positions + 1 open nav + refresh + back/home = 5 rows.
    expect(kb.inline_keyboard).toHaveLength(5);
    const openNav = kb.inline_keyboard[2]!;
    expect(openNav.map((b) => b.text)).toEqual(["← Page 9/10 Open Pos"]);
  });

  it("paginates the realised section independently of open: a click on a realised-nav button preserves openPage in callback_data", () => {
    const open: BotOpenPosition[] = Array.from({ length: 47 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    const realised: BotRealisedPosition[] = Array.from({ length: 12 }, (_, i) =>
      realisedPos({
        token: `0x${(1000 + i).toString(16).padStart(40, "0")}`,
        ticker: `R${i}`,
      }),
    );
    // Open on page 3 (index 2), realised on page 1 (index 0).
    const view = buildPositionsView({ open, realised }, 2, 0);
    const kb = buildPositionsPageKeyboard(view, WALLET);
    // Find the realised nav row (after the open nav row).
    const rows = kb.inline_keyboard;
    // 5 position rows + open nav + realised nav + refresh + back/home.
    expect(rows).toHaveLength(9);
    const realisedNav = rows[6]!;
    // realisedTotal=12 → totalPages=3. Currently on page 1 → only Next.
    expect(realisedNav.map((b) => b.text)).toEqual(["→ Page 2/3 Realised Pos"]);
    // The realised-nav callback must preserve openPage = 2.
    expect(realisedNav[0]!.callback_data).toBe(
      `${POSITIONS_PAGE_CALLBACK_CMD}:2:1:${WALLET}`,
    );
  });

  it("realised-only response with >5 records emits a realised nav row and no open nav row", () => {
    const realised: BotRealisedPosition[] = Array.from({ length: 12 }, (_, i) =>
      realisedPos({
        token: `0x${(1000 + i).toString(16).padStart(40, "0")}`,
        ticker: `R${i}`,
      }),
    );
    const view = buildPositionsView({ open: [], realised }, 0, 0);
    const kb = buildPositionsPageKeyboard(view, WALLET);
    const rows = kb.inline_keyboard;
    // No open actions, no open nav. Just realised nav + refresh + back/home.
    expect(rows).toHaveLength(3);
    expect(rows[0]!.map((b) => b.text)).toEqual(["→ Page 2/3 Realised Pos"]);
    expect(rows[1]!.map((b) => b.text)).toEqual(["🔄 Refresh"]);
    expect(rows[2]!.map((b) => b.text)).toEqual(["← Back", "🏠 Home"]);
  });

  it("every callback_data stays inside the 64-byte Telegram ceiling at the largest plausible page counts", () => {
    const open: BotOpenPosition[] = Array.from({ length: 9999 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    const view = buildPositionsView({ open, realised: [] }, 4998, 0);
    const kb = buildPositionsPageKeyboard(view, WALLET);
    for (const b of kb.inline_keyboard.flat()) {
      expect(b.callback_data.length).toBeLessThanOrEqual(64);
    }
  });
});

describe("escapeHtml", () => {
  it("escapes the four HTML metacharacters Telegram cares about and leaves other UTF-8 alone", () => {
    expect(escapeHtml("a & <b> \"c\" 'd'")).toBe(
      "a &amp; &lt;b&gt; &quot;c&quot; 'd'",
    );
    expect(escapeHtml("ALPHA · 25.00%")).toBe("ALPHA · 25.00%");
  });
});

describe("ticker truncation in body lines", () => {
  it("clamps a pathologically long open-position ticker so the line cannot blow the 4096-char ceiling", () => {
    // Regression: previously a 5000-char ticker would pass through
    // verbatim and one page could exceed Telegram's 4096-char limit.
    // With 5 records per page the cap on each ticker keeps the whole
    // view well under the ceiling.
    const huge = "X".repeat(5000);
    const view = buildPositionsView(
      { open: [openPos({ ticker: huge })], realised: [] },
      0,
      0,
      "trade_cortisol_bot",
    );
    expect(view.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(view.text).toContain("…");
    expect(view.text).not.toContain("X".repeat(1000));
  });

  it("clamps a pathologically long realised-position ticker", () => {
    const huge = "Y".repeat(5000);
    const view = buildPositionsView(
      { open: [], realised: [realisedPos({ ticker: huge })] },
      0,
      0,
      "trade_cortisol_bot",
    );
    expect(view.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(view.text).toContain("…");
    expect(view.text).not.toContain("Y".repeat(1000));
  });

  it("a full page of huge tickers (5 open + 5 realised) still fits inside TELEGRAM_MESSAGE_LIMIT", () => {
    const huge = (prefix: string, i: number): string =>
      `${prefix}${i}-${"Z".repeat(5000)}`;
    const open: BotOpenPosition[] = Array.from({ length: 5 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: huge("O", i),
      }),
    );
    const realised: BotRealisedPosition[] = Array.from({ length: 5 }, (_, i) =>
      realisedPos({
        token: `0x${(1000 + i).toString(16).padStart(40, "0")}`,
        ticker: huge("R", i),
      }),
    );
    const view = buildPositionsView(
      { open, realised },
      0,
      0,
      "trade_cortisol_bot",
    );
    expect(view.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });
});

describe("ticker control-char sanitization", () => {
  it("collapses embedded \\n / \\r / \\t inside a ticker so the body never spills across lines", () => {
    const pos = openPos({ ticker: "EVIL\nMULTI\rLINE\tTICKER" });
    const view = buildPositionsView({ open: [pos], realised: [] }, 0, 0);
    expect(view.text).not.toMatch(/EVIL\n/);
    expect(view.text).not.toMatch(/EVIL\r/);
    expect(view.text).not.toMatch(/EVIL\t/);
    expect(view.text).toContain("EVIL MULTI LINE TICKER");
  });

  it("collapses embedded control chars inside a realised-position ticker too", () => {
    const pos = realisedPos({ ticker: "BAD\nNEWLINE" });
    const view = buildPositionsView({ open: [], realised: [pos] }, 0, 0);
    expect(view.text).toContain("BAD NEWLINE");
    expect(view.text).not.toMatch(/BAD\n/);
  });

  it("collapses control chars on inline-button labels (truncated form has no \\n / \\t)", () => {
    const pos = openPos({
      token: "0xcccccccccccccccccccccccccccccccccccccccc",
      ticker: "X\nY\tZ",
    });
    const view = buildPositionsView({ open: [pos], realised: [] }, 0, 0);
    const kb = buildPositionsPageKeyboard(
      view,
      "0x1234567890abcdef1234567890abcdef12345678",
    );
    const buyLabel = kb.inline_keyboard[0]![0]!.text;
    expect(buyLabel).not.toMatch(/[\n\r\t]/);
    expect(buyLabel).toBe("Buy X Y Z");
  });
});

describe("compact fallback when numeric fields are pathologically large", () => {
  it("falls back to a compact ticker+address rendering when the full body would exceed TELEGRAM_MESSAGE_LIMIT", () => {
    // Build positions where every bigint-backed numeric field is huge
    // (the per-ticker clamp alone does not bound `formatTokenAmount` /
    // `formatUsdc` output, so a malicious token contract could push the
    // composed body past the 4096-char limit).
    const wei = "9".repeat(200); // 200-digit integer string
    const open: BotOpenPosition[] = Array.from({ length: 5 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
        balance: wei,
        costBasisUsdc: wei,
        currentValueUsdc: wei,
        unrealisedPnlUsdc: wei,
        unrealisedPnlPct: 1_000_000,
      }),
    );
    const realised: BotRealisedPosition[] = Array.from({ length: 5 }, (_, i) =>
      realisedPos({
        token: `0x${(1000 + i).toString(16).padStart(40, "0")}`,
        ticker: `R${i}`,
        totalCostUsdc: wei,
        totalProceedsUsdc: wei,
        realisedPnlUsdc: wei,
        realisedPnlPct: 1_000_000,
      }),
    );
    const view = buildPositionsView(
      { open, realised },
      0,
      0,
      "trade_cortisol_bot",
    );
    expect(view.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    // Compact form: tickers + addresses survive, numeric fields drop.
    expect(view.text).toContain("LT0");
    expect(view.text).toContain("R0");
    expect(view.text).toContain("Open positions (5)");
    expect(view.text).toContain("Realised positions (5)");
  });
});

describe("positions message body fits TELEGRAM_MESSAGE_LIMIT", () => {
  it("any single (openPage, realisedPage) view stays inside the 4096-char ceiling", () => {
    // 5 open + 5 realised entries fit comfortably; this is the upper
    // bound on a single page, so a per-page record cap of 5 makes the
    // 4096-char concern moot but the assertion guards against future
    // line-format changes that would blow the limit.
    const open: BotOpenPosition[] = Array.from({ length: 47 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    const realised: BotRealisedPosition[] = Array.from({ length: 23 }, (_, i) =>
      realisedPos({
        token: `0x${(1000 + i).toString(16).padStart(40, "0")}`,
        ticker: `R${i}`,
      }),
    );
    for (let op = 0; op < 10; op++) {
      for (let rp = 0; rp < 5; rp++) {
        const view = buildPositionsView({ open, realised }, op, rp);
        expect(view.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
      }
    }
  });
});

const _typeShape: BotPositionsResponse = { open: [], realised: [] };
void _typeShape;
