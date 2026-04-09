import { FEES, MOCK_TOKEN_PRICE } from "../config/constants";

/**
 * Trade router service — models the atomic USDC-in/token-out flow.
 *
 * All trades go through the TX Router contract which handles:
 *   BUY:  USDC → mint LT → deposit LT into bonding curve → memecoin out
 *   SELL: memecoin → withdraw LT from curve → redeem LT → USDC out
 *
 * Users never touch or see the LT. Everything is denominated in USDC.
 * All calls route through the Referral Module for fee attribution.
 */

export type TransactionStep = "idle" | "approving" | "confirmed" | "error";
export type TxStep = TransactionStep | "executing";
export type LaunchStep = TransactionStep | "deploying";

export interface BuyQuote {
  tokensOut: string;
  curveFee: number;
  totalFee: number;
  priceImpactPct: number;
  youPay: number;
  youReceive: string;
}

export interface SellQuote {
  usdcOut: number;
  curveFee: number;
  ltRedemptionFee: number;
  totalFee: number;
  priceImpactPct: number;
  youReceive: number;
}

export interface ITradeRouterService {
  getQuoteBuy(curveAddress: string, usdcAmount: number): Promise<BuyQuote>;
  getQuoteSell(
    curveAddress: string,
    tokenAmount: number,
    tokenPriceUsd: number,
  ): Promise<SellQuote>;
}

/**
 * Mock implementation — calculates estimates client-side.
 * Production implementation will call Router.getQuoteBuy / getQuoteSell onchain.
 */
const mockTradeRouter: ITradeRouterService = {
  async getQuoteBuy(_curveAddress, usdcAmount) {
    const curveFee = usdcAmount * FEES.curveBuy;
    const netUsdc = usdcAmount - curveFee;
    const tokensOut = netUsdc / MOCK_TOKEN_PRICE;
    const mockMcap = MOCK_TOKEN_PRICE * 1e9;
    const priceImpact = (usdcAmount / mockMcap) * 100;

    return {
      tokensOut: tokensOut.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      }),
      curveFee,
      totalFee: curveFee,
      priceImpactPct: parseFloat(priceImpact.toFixed(2)),
      youPay: usdcAmount,
      youReceive: `${(tokensOut / 1e6).toFixed(1)}M`,
    };
  },

  async getQuoteSell(_curveAddress, tokenAmount, tokenPriceUsd) {
    const grossUsdc = tokenAmount * tokenPriceUsd;
    const curveFee = grossUsdc * FEES.curveSell;
    const ltRedemptionFee = grossUsdc * FEES.ltRedemption * 2;
    const totalFee = curveFee + ltRedemptionFee;
    const netUsdc = grossUsdc - totalFee;
    const mockMcap = MOCK_TOKEN_PRICE * 1e9;
    const priceImpact = (grossUsdc / mockMcap) * 100;

    return {
      usdcOut: netUsdc,
      curveFee,
      ltRedemptionFee,
      totalFee,
      priceImpactPct: parseFloat(priceImpact.toFixed(2)),
      youReceive: netUsdc,
    };
  },
};

export const tradeRouterService: ITradeRouterService = mockTradeRouter;
