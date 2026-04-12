import { describe, it, expect } from "vitest";

import type {
  Token,
  Trade,
  Creator,
  TokenStatus,
  TradeType,
  ApiResponse,
  PaginatedResponse,
  LeveragedTokenInfo,
  LiveLeveragedToken,
  SupportedAsset,
  SupportedLeverage,
  TokenCreationPayload,
} from "../index.js";

/**
 * Type-level compile tests. If these types fail to import or the assignments
 * below produce a TypeScript error, the build will catch it. The runtime
 * assertions are intentionally trivial — the value is in the type checking.
 */
describe("type exports compile correctly", () => {
  it("Token type is assignable", () => {
    const token: Token = {
      address: "0x1",
      name: "Test",
      ticker: "TST",
      description: "d",
      imageUrl: "https://example.com/img.png",
      ltPair: "HYPE",
      ltDirection: "long",
      leverage: 2,
      creator: "0x2",
      status: "curve",
      marketCap: 0,
      marketCapUsd: 0,
      priceUsd: 0,
      change24h: 0,
      volume24h: 0,
      curveFilled: 0,
      curveTarget: 0,
      createdAt: 0,
    };
    expect(token).toBeDefined();
  });

  it("Trade type is assignable", () => {
    const trade: Trade = {
      txHash: "0xabc",
      tokenAddress: "0x1",
      trader: "0x2",
      type: "buy",
      amountUsd: 100,
      tokenAmount: 1000,
      priceUsd: 0.1,
      timestamp: 0,
    };
    expect(trade).toBeDefined();
  });

  it("Creator type is assignable", () => {
    const creator: Creator = {
      address: "0x1",
      tokensCreated: 1,
      totalEarnings: 0,
      totalVolume: 0,
    };
    expect(creator).toBeDefined();
  });

  it("TokenStatus literals are valid", () => {
    const statuses: TokenStatus[] = ["curve", "graduating", "graduated"];
    expect(statuses).toHaveLength(3);
  });

  it("TradeType literals are valid", () => {
    const types: TradeType[] = ["buy", "sell"];
    expect(types).toHaveLength(2);
  });

  it("ApiResponse generic works", () => {
    const resp: ApiResponse<string> = { data: "ok", success: true };
    expect(resp.data).toBe("ok");
  });

  it("PaginatedResponse generic works", () => {
    const resp: PaginatedResponse<number> = {
      data: [1, 2],
      total: 2,
      page: 1,
      pageSize: 10,
      hasMore: false,
    };
    expect(resp.data).toHaveLength(2);
  });

  it("SupportedAsset type is assignable from literal", () => {
    const asset: SupportedAsset = "HYPE";
    expect(asset).toBe("HYPE");
  });

  it("SupportedLeverage type is assignable from literal", () => {
    const lev: SupportedLeverage = 2;
    expect(lev).toBe(2);
  });

  it("LeveragedTokenInfo type is assignable", () => {
    const info: LeveragedTokenInfo = {
      address: "0x0000000000000000000000000000000000000001",
      symbol: "HYPE2L",
      name: "HYPE 2x Long",
      targetAsset: "HYPE",
      targetLeverage: 2,
      isLong: true,
      decimals: 18,
    };
    expect(info).toBeDefined();
  });

  it("LiveLeveragedToken extends LeveragedTokenInfo", () => {
    const lt: LiveLeveragedToken = {
      address: "0x0000000000000000000000000000000000000001",
      symbol: "HYPE2L",
      name: "HYPE 2x Long",
      targetAsset: "HYPE",
      targetLeverage: 2,
      isLong: true,
      decimals: 18,
      mintPaused: false,
      exchangeRate: "1",
      totalSupply: "1000",
      totalAssets: "1000",
    };
    expect(lt).toBeDefined();
  });

  it("TokenCreationPayload type is assignable", () => {
    const payload: TokenCreationPayload = {
      address: "0x1",
      name: "Test",
      ticker: "TST",
      description: "d",
      imageUrl: "https://example.com/img.png",
      ltPair: "HYPE",
      ltDirection: "long",
      leverage: 2,
      creator: "0x2",
    };
    expect(payload).toBeDefined();
  });
});
