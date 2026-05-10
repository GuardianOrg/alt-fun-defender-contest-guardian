import { describe, it, expect } from "vitest";

import { validateWebhookPayload } from "../lib/webhook-validators.js";

const ADDR = "0x1234567890abcdef1234567890abcdef12345678";
const ADDR2 = "0xabcdefABCDEF1234567890abcdef1234567890ab";

describe("validateWebhookPayload", () => {
  describe("envelope", () => {
    it("rejects unknown event types", () => {
      expect(validateWebhookPayload("newToken", {}, undefined)).toMatch(
        /Unsupported webhook event/,
      );
      expect(validateWebhookPayload("price", {}, undefined)).toMatch(
        /Unsupported webhook event/,
      );
      expect(validateWebhookPayload("", {}, undefined)).toMatch(
        /Unsupported webhook event/,
      );
    });

    it("rejects malformed top-level tokenAddress", () => {
      expect(validateWebhookPayload("trade", {}, "not-an-address")).toMatch(
        /tokenAddress must be a 0x/,
      );
      expect(validateWebhookPayload("trade", {}, 42)).toMatch(
        /tokenAddress must be a 0x/,
      );
    });

    it("allows omitted top-level tokenAddress", () => {
      expect(
        validateWebhookPayload(
          "trade",
          {
            id: "tx-0",
            tokenAddress: ADDR,
            timestamp: "1700000000",
            curveSupply: "1000",
            ltReserve: "2000",
          },
          undefined,
        ),
      ).toBeNull();
    });
  });

  describe("trade — chart-state variant", () => {
    it("accepts a well-formed payload", () => {
      expect(
        validateWebhookPayload(
          "trade",
          {
            id: "tx-1",
            tokenAddress: ADDR,
            timestamp: "1700000000",
            curveSupply: "750000000000000000000000000",
            ltReserve: "4000000000",
          },
          ADDR,
        ),
      ).toBeNull();
    });

    it("rejects non-decimal reserves", () => {
      expect(
        validateWebhookPayload(
          "trade",
          {
            id: "tx-1",
            tokenAddress: ADDR,
            timestamp: "1700000000",
            curveSupply: "<script>alert(1)</script>",
            ltReserve: "4000000000",
          },
          ADDR,
        ),
      ).toMatch(/curveSupply/);
    });

    it("rejects non-string id", () => {
      expect(
        validateWebhookPayload(
          "trade",
          {
            id: 42,
            tokenAddress: ADDR,
            timestamp: "1700000000",
            curveSupply: "1",
            ltReserve: "1",
          },
          ADDR,
        ),
      ).toMatch(/data\.id/);
    });
  });

  describe("trade — trade-list variant", () => {
    it("accepts a well-formed buy", () => {
      expect(
        validateWebhookPayload(
          "trade",
          {
            id: "tx-2",
            tokenAddress: ADDR,
            timestamp: "1700000000",
            usdcAmount: "1000000",
            tokenAmount: "500000000000000000",
            trader: ADDR2,
            isBuy: true,
          },
          ADDR,
        ),
      ).toBeNull();
    });

    it("rejects malformed trader address", () => {
      expect(
        validateWebhookPayload(
          "trade",
          {
            id: "tx-2",
            tokenAddress: ADDR,
            timestamp: "1700000000",
            usdcAmount: "1000000",
            tokenAmount: "500000000000000000",
            trader: "javascript:alert(1)",
            isBuy: true,
          },
          ADDR,
        ),
      ).toMatch(/trader/);
    });

    it("rejects isBuy as string", () => {
      expect(
        validateWebhookPayload(
          "trade",
          {
            id: "tx-2",
            tokenAddress: ADDR,
            timestamp: "1700000000",
            usdcAmount: "1000000",
            tokenAmount: "500000000000000000",
            trader: ADDR2,
            isBuy: "true",
          },
          ADDR,
        ),
      ).toMatch(/isBuy/);
    });
  });

  describe("trade — variant discrimination", () => {
    it("rejects hybrid payloads carrying fields from both variants", () => {
      expect(
        validateWebhookPayload(
          "trade",
          {
            id: "tx-3",
            tokenAddress: ADDR,
            timestamp: "1700000000",
            usdcAmount: "1",
            tokenAmount: "1",
            trader: ADDR2,
            isBuy: true,
            curveSupply: "1",
            ltReserve: "1",
          },
          ADDR,
        ),
      ).toMatch(/either a trade-list or chart-state variant/);
    });

    it("rejects a payload satisfying neither variant", () => {
      expect(
        validateWebhookPayload(
          "trade",
          {
            id: "tx-4",
            tokenAddress: ADDR,
            timestamp: "1700000000",
          },
          ADDR,
        ),
      ).toMatch(/either a trade-list or chart-state variant/);
    });
  });

  describe("trade — type guards", () => {
    it("rejects non-objects", () => {
      expect(validateWebhookPayload("trade", null, ADDR)).toMatch(/object/);
      expect(validateWebhookPayload("trade", "string", ADDR)).toMatch(/object/);
      expect(validateWebhookPayload("trade", [1, 2, 3], ADDR)).toMatch(/object/);
    });

    it("rejects malformed token address", () => {
      expect(
        validateWebhookPayload(
          "trade",
          {
            id: "tx-5",
            tokenAddress: "0x123",
            timestamp: "1700000000",
            curveSupply: "1",
            ltReserve: "1",
          },
          ADDR,
        ),
      ).toMatch(/data\.tokenAddress/);
    });
  });

  describe("graduation", () => {
    it("accepts graduating phase", () => {
      expect(
        validateWebhookPayload(
          "graduation",
          {
            phase: "graduating",
            tokenAddress: ADDR,
            tokensForLP: "250000000000000000000000000",
            ltFromPair: "4000000000",
            lpBurned: "0",
            unsoldBurned: "0",
            timestamp: "1700000000",
          },
          ADDR,
        ),
      ).toBeNull();
    });

    it("accepts graduated phase", () => {
      expect(
        validateWebhookPayload(
          "graduation",
          {
            phase: "graduated",
            tokenAddress: ADDR,
            pairAddress: ADDR2,
            liquidity: "1000",
            tokensInLP: "1000",
            lpBurned: "0",
            unsoldBurned: "0",
            timestamp: "1700000000",
          },
          ADDR,
        ),
      ).toBeNull();
    });

    it("rejects unknown phases", () => {
      expect(
        validateWebhookPayload(
          "graduation",
          {
            phase: "completed",
            tokenAddress: ADDR,
            timestamp: "1700000000",
          },
          ADDR,
        ),
      ).toMatch(/phase/);
    });

    it("rejects graduated phase with malformed pairAddress", () => {
      expect(
        validateWebhookPayload(
          "graduation",
          {
            phase: "graduated",
            tokenAddress: ADDR,
            pairAddress: "not-hex",
            liquidity: "1",
            tokensInLP: "1",
            lpBurned: "0",
            unsoldBurned: "0",
            timestamp: "1700000000",
          },
          ADDR,
        ),
      ).toMatch(/pairAddress/);
    });
  });
});
