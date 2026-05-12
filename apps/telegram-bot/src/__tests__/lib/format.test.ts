import { describe, it, expect } from "vitest";

import {
  buildPositionsPageKeyboard,
  chunkPositionsMessage,
  formatFixed,
  formatPositionLine,
  formatPositionsResponse,
  formatTokenAmount,
  formatUsdc,
  joinPositions,
  POSITIONS_PAGE_CALLBACK_CMD,
  renderPaginatedPage,
  TELEGRAM_MESSAGE_LIMIT,
} from "../../lib/format.js";
import type { BalanceEntry, PortfolioPosition } from "../../lib/api.js";

const balance = (overrides: Partial<BalanceEntry> = {}): BalanceEntry => ({
  address: "0x1111111111111111111111111111111111111111",
  name: "Token One",
  ticker: "ONE",
  ltPair: "0xaaaa",
  leverage: 2,
  underlying: "HYPE",
  ltDirection: "long",
  balance: "1000000000000000000",
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

describe("joinPositions", () => {
  it("attaches cost basis by lowercased address", () => {
    const portfolio: PortfolioPosition[] = [
      {
        tokenAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        tokenAmount: "0",
        costBasisUsdc: "50000000",
      },
    ];
    const balances = [
      balance({
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        balance: "2000000000000000000",
      }),
    ];
    const joined = joinPositions(portfolio, balances);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({
      label: "Token One (ONE)",
      amount: "2000000000000000000",
      costBasisUsdc: "50000000",
    });
  });

  it("falls back to 0 cost basis for direct-transfer-only positions", () => {
    const balances = [balance()];
    const joined = joinPositions([], balances);
    expect(joined[0]!.costBasisUsdc).toBe("0");
  });

  it("ignores portfolio entries with no matching balance (filtered Alt-Fun-only)", () => {
    const portfolio: PortfolioPosition[] = [
      {
        tokenAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        tokenAmount: "0",
        costBasisUsdc: "999",
      },
    ];
    expect(joinPositions(portfolio, [])).toEqual([]);
  });
});

describe("formatPositionLine", () => {
  it("renders name, ticker, formatted amount, and formatted cost basis", () => {
    const line = formatPositionLine({
      address: "0xaaa",
      label: "Token One (ONE)",
      amount: "1500000000000000000",
      costBasisUsdc: "20000000",
    });
    expect(line).toBe("• Token One (ONE)\n  1.5 · cost basis $20");
  });

  it("truncates pathologically long labels so the line still fits Telegram's limit", () => {
    const giantLabel = "A".repeat(TELEGRAM_MESSAGE_LIMIT + 200);
    const line = formatPositionLine({
      address: "0xaaa",
      label: giantLabel,
      amount: "1000000000000000000",
      costBasisUsdc: "1000000",
    });
    expect(line.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(line.endsWith("· cost basis $1")).toBe(true);
    expect(line).toContain("…");
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

describe("formatPositionsResponse", () => {
  it("returns an empty-state message when no positions", () => {
    expect(formatPositionsResponse([], { approximate: false })).toEqual([
      "No open positions for this wallet.",
    ]);
  });

  it("includes header with count when positions present", () => {
    const joined = joinPositions([], [balance()]);
    const out = formatPositionsResponse(joined, { approximate: false });
    expect(out[0]).toContain("Open positions (1)");
    expect(out[0]).toContain("Token One (ONE)");
  });

  it("appends a truncation note when approximate=true", () => {
    const joined = joinPositions([], [balance()]);
    const out = formatPositionsResponse(joined, { approximate: true });
    expect(out.join("\n")).toContain("List truncated at 1000 positions");
  });

  it("chunks output into <=4096-char Telegram messages for large lists", () => {
    const many: BalanceEntry[] = Array.from({ length: 250 }, (_, i) =>
      balance({
        address: `0x${i.toString(16).padStart(40, "0")}`,
        name: `Long Token Name Number ${i}`,
        ticker: `LT${i}`,
      }),
    );
    const joined = joinPositions([], many);
    const out = formatPositionsResponse(joined, { approximate: false });
    expect(out.length).toBeGreaterThan(1);
    for (const chunk of out)
      expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
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
    // chunkPositionsMessage now caps chunks below TELEGRAM_MESSAGE_LIMIT to
    // reserve PAGINATION_FOOTER_BUDGET bytes for the trailing `Page X of Y`
    // footer. Simulate a multi-page output where each chunk is at the
    // tightest valid pre-footer size and confirm renderPaginatedPage still
    // emits a string that fits inside Telegram's hard 4096-char ceiling.
    const maxBody = "x".repeat(TELEGRAM_MESSAGE_LIMIT - 24);
    const chunks = [maxBody, maxBody, maxBody];
    for (const page of [0, 1, 2]) {
      const rendered = renderPaginatedPage(chunks, page);
      expect(rendered.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
      expect(rendered).toContain(`Page ${page + 1} of 3`);
    }
  });

  it("formatPositionsResponse chunks fit within the reserved budget so footer never overflows", () => {
    // End-to-end check: feed enough positions to force multi-page output,
    // then confirm every chunk + worst-case footer stays under the ceiling.
    const many: BalanceEntry[] = Array.from({ length: 250 }, (_, i) =>
      balance({
        address: `0x${i.toString(16).padStart(40, "0")}`,
        name: `Long Token Name Number ${i}`,
        ticker: `LT${i}`,
      }),
    );
    const joined = joinPositions([], many);
    const chunks = formatPositionsResponse(joined, { approximate: false });
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 0; i < chunks.length; i++) {
      const rendered = renderPaginatedPage(chunks, i);
      expect(rendered.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    }
  });
});

describe("buildPositionsPageKeyboard", () => {
  const WALLET = "0x1234567890abcdef1234567890abcdef12345678";

  it("returns null for single-page (avoids an empty inline strip)", () => {
    expect(buildPositionsPageKeyboard(0, 1, WALLET)).toBeNull();
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
});
