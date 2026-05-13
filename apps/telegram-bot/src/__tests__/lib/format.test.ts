import { describe, it, expect } from "vitest";

import {
  buildPositionsPageKeyboard,
  chunkPositionsMessage,
  formatBotPositionsResponse,
  formatFixed,
  formatTokenAmount,
  formatUsdc,
  POSITION_BUY_CALLBACK_CMD,
  POSITION_SELL_CALLBACK_CMD,
  POSITIONS_PAGE_CALLBACK_CMD,
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
  it("returns an empty-state message when both sections are empty", () => {
    const out = formatBotPositionsResponse({ open: [], realised: [] });
    expect(out.map((c) => c.text)).toEqual([
      "No open positions for this wallet.",
    ]);
    expect(out[0]!.openPositions).toEqual([]);
  });

  it("renders an Open header, ticker, balance, cost, value, signed PnL, and percent", () => {
    const out = formatBotPositionsResponse({
      open: [openPos()],
      realised: [],
    });
    const joined = out.map((c) => c.text).join("\n");
    expect(joined).toContain("Open positions (1)");
    expect(joined).toContain("ONE");
    expect(joined).toContain("1.5");
    expect(joined).toContain("cost $20");
    expect(joined).toContain("value $25");
    expect(joined).toContain("+$5");
    expect(joined).toContain("+25.00%");
  });

  it("renders a Realised header with proceeds, cost, signed PnL, percent", () => {
    const out = formatBotPositionsResponse({
      open: [],
      realised: [realisedPos()],
    });
    const joined = out.map((c) => c.text).join("\n");
    expect(joined).toContain("Realised positions (1)");
    expect(joined).toContain("TWO");
    expect(joined).toContain("cost $10");
    expect(joined).toContain("proceeds $15");
    expect(joined).toContain("realised +$5");
    expect(joined).toContain("+50.00%");
  });

  it("renders a negative PnL with the Unicode minus sign and floored percent", () => {
    const out = formatBotPositionsResponse({
      open: [
        openPos({
          unrealisedPnlUsdc: "-1234567",
          unrealisedPnlPct: -12.349,
        }),
      ],
      realised: [],
    });
    const joined = out.map((c) => c.text).join("\n");
    expect(joined).toContain("−$1.23");
    // Math.floor on negatives rounds toward -∞: -12.349 → -12.35.
    expect(joined).toContain("−12.35%");
  });

  it("renders an em-dash when percent is null (cost basis was zero)", () => {
    const out = formatBotPositionsResponse({
      open: [
        openPos({
          costBasisUsdc: "0",
          unrealisedPnlPct: null,
        }),
      ],
      realised: [],
    });
    expect(out.map((c) => c.text).join("\n")).toContain("(—)");
  });

  it("chunks output into <=4096-char Telegram messages for large lists", () => {
    const many: BotOpenPosition[] = Array.from({ length: 250 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    const out = formatBotPositionsResponse({ open: many, realised: [] });
    expect(out.length).toBeGreaterThan(1);
    for (const chunk of out)
      expect(chunk.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });

  it("includes both sections when both have entries", () => {
    const out = formatBotPositionsResponse({
      open: [openPos()],
      realised: [realisedPos()],
    });
    const joined = out.map((c) => c.text).join("\n");
    expect(joined).toContain("Open positions (1)");
    expect(joined).toContain("Realised positions (1)");
  });

  it("tags each chunk with the open positions whose lines it contains", () => {
    const a = openPos({
      token: "0x1111111111111111111111111111111111111111",
      ticker: "AAA",
    });
    const b = openPos({
      token: "0x2222222222222222222222222222222222222222",
      ticker: "BBB",
    });
    const out = formatBotPositionsResponse({
      open: [a, b],
      realised: [realisedPos()],
    });
    const allTagged = out.flatMap((c) => c.openPositions);
    // Open positions are surfaced for keyboard wiring; realised
    // entries are intentionally not — closed positions have no
    // [Sell]/[Buy] action.
    expect(allTagged.map((p) => p.ticker)).toEqual(["AAA", "BBB"]);
  });

  it("groups tagged open positions with the chunk where their line lands", () => {
    // Force chunk-splitting by generating many positions, then verify
    // every visible ticker is exposed via the matching chunk's
    // `openPositions` (i.e. the tag tracks the body it was rendered
    // into, not the input order).
    const many: BotOpenPosition[] = Array.from({ length: 80 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    const out = formatBotPositionsResponse({ open: many, realised: [] });
    expect(out.length).toBeGreaterThan(1);
    for (const chunk of out) {
      for (const pos of chunk.openPositions) {
        expect(chunk.text).toContain(pos.ticker);
      }
    }
    const totalTagged = out.reduce((n, c) => n + c.openPositions.length, 0);
    expect(totalTagged).toBe(many.length);
  });
});

describe("renderPaginatedPage", () => {
  it("returns the only chunk verbatim when totalPages = 1 (no footer)", () => {
    expect(renderPaginatedPage(["body"], 0)).toBe("body");
  });

  it("appends a 'Page X of Y' footer when totalPages > 1", () => {
    const out = renderPaginatedPage(["a", "b", "c"], 1);
    expect(out.startsWith("b")).toBe(true);
    expect(out).toContain("Page 2 of 3");
  });

  it("clamps a too-high page index to the last available page", () => {
    const out = renderPaginatedPage(["a", "b"], 99);
    expect(out.startsWith("b")).toBe(true);
    expect(out).toContain("Page 2 of 2");
  });

  it("clamps a negative page index to 0", () => {
    const out = renderPaginatedPage(["a", "b"], -5);
    expect(out.startsWith("a")).toBe(true);
    expect(out).toContain("Page 1 of 2");
  });

  it("returns an empty string for an empty chunk list", () => {
    expect(renderPaginatedPage([], 0)).toBe("");
  });

  it("paginated body + footer fits within TELEGRAM_MESSAGE_LIMIT for max-sized chunks", () => {
    const maxBody = "x".repeat(TELEGRAM_MESSAGE_LIMIT - 24);
    const chunks = [maxBody, maxBody, maxBody];
    for (const page of [0, 1, 2]) {
      const rendered = renderPaginatedPage(chunks, page);
      expect(rendered.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
      expect(rendered).toContain(`Page ${page + 1} of 3`);
    }
  });

  it("formatBotPositionsResponse chunks fit within the reserved footer budget", () => {
    const many: BotOpenPosition[] = Array.from({ length: 250 }, (_, i) =>
      openPos({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        ticker: `LT${i}`,
      }),
    );
    const chunks = formatBotPositionsResponse({ open: many, realised: [] });
    expect(chunks.length).toBeGreaterThan(1);
    const texts = chunks.map((c) => c.text);
    for (let i = 0; i < texts.length; i++) {
      const rendered = renderPaginatedPage(texts, i);
      expect(rendered.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    }
  });
});

describe("buildPositionsPageKeyboard", () => {
  const WALLET = "0x1234567890abcdef1234567890abcdef12345678";

  it("returns null for single-page with no open positions (avoids an empty inline strip)", () => {
    expect(buildPositionsPageKeyboard(0, 1, WALLET)).toBeNull();
    expect(buildPositionsPageKeyboard(0, 1, WALLET, [])).toBeNull();
  });

  it("page 0 of N: emits only [Next →]", () => {
    const kb = buildPositionsPageKeyboard(0, 3, WALLET);
    const buttons = kb!.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(["Next →"]);
    expect(buttons[0]!.callback_data).toBe(
      `${POSITIONS_PAGE_CALLBACK_CMD}:1:${WALLET}`,
    );
  });

  it("middle page: emits [← Prev] and [Next →] with correct target indices", () => {
    const kb = buildPositionsPageKeyboard(1, 3, WALLET);
    const buttons = kb!.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(["← Prev", "Next →"]);
    expect(buttons[0]!.callback_data).toBe(
      `${POSITIONS_PAGE_CALLBACK_CMD}:0:${WALLET}`,
    );
    expect(buttons[1]!.callback_data).toBe(
      `${POSITIONS_PAGE_CALLBACK_CMD}:2:${WALLET}`,
    );
  });

  it("last page: emits only [← Prev]", () => {
    const kb = buildPositionsPageKeyboard(2, 3, WALLET);
    const buttons = kb!.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(["← Prev"]);
  });

  it("stays inside the 64-byte callback_data ceiling", () => {
    const kb = buildPositionsPageKeyboard(999, 1000, WALLET);
    for (const b of kb!.inline_keyboard.flat()) {
      expect(b.callback_data.length).toBeLessThanOrEqual(64);
    }
  });

  it("emits a Buy/Sell row per open position above the nav row", () => {
    const positions = [
      openPos({
        token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ticker: "AAA",
      }),
      openPos({
        token: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ticker: "BBB",
      }),
    ];
    const kb = buildPositionsPageKeyboard(0, 1, WALLET, positions);
    expect(kb).not.toBeNull();
    expect(kb!.inline_keyboard).toHaveLength(2);

    const [rowA, rowB] = kb!.inline_keyboard;
    expect(rowA!.map((b) => b.text)).toEqual(["Buy AAA", "Sell AAA"]);
    expect(rowA![0]!.callback_data).toBe(
      `${POSITION_BUY_CALLBACK_CMD}:${positions[0]!.token}`,
    );
    expect(rowA![1]!.callback_data).toBe(
      `${POSITION_SELL_CALLBACK_CMD}:${positions[0]!.token}`,
    );
    expect(rowB!.map((b) => b.text)).toEqual(["Buy BBB", "Sell BBB"]);
    expect(rowB![0]!.callback_data).toBe(
      `${POSITION_BUY_CALLBACK_CMD}:${positions[1]!.token}`,
    );
    expect(rowB![1]!.callback_data).toBe(
      `${POSITION_SELL_CALLBACK_CMD}:${positions[1]!.token}`,
    );
  });

  it("appends the nav row after the per-position rows when paginating", () => {
    const positions = [
      openPos({
        token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ticker: "AAA",
      }),
    ];
    const kb = buildPositionsPageKeyboard(0, 3, WALLET, positions);
    expect(kb).not.toBeNull();
    expect(kb!.inline_keyboard).toHaveLength(2);
    const nav = kb!.inline_keyboard[1]!;
    expect(nav.map((b) => b.text)).toEqual(["Next →"]);
  });

  it("buy/sell button callback_data stays within the 64-byte ceiling", () => {
    const positions = [
      openPos({
        token: "0xffffffffffffffffffffffffffffffffffffffff",
        ticker: "Z",
      }),
    ];
    const kb = buildPositionsPageKeyboard(0, 1, WALLET, positions);
    for (const b of kb!.inline_keyboard.flat()) {
      expect(b.callback_data.length).toBeLessThanOrEqual(64);
    }
  });
});

const _typeShape: BotPositionsResponse = { open: [], realised: [] };
void _typeShape;
