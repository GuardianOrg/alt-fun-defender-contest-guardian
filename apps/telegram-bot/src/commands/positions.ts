import { fetchBalances, fetchPortfolio, isAddress } from "../lib/api.js";
import { formatPositionsResponse, joinPositions } from "../lib/format.js";
import { sendMessage } from "../lib/telegram.js";
import type { Env } from "../lib/types.js";

const USAGE = "Usage: /positions <wallet_address>";

/**
 * v1: wallet address is required (no active-wallet selector yet — see
 * apps/telegram-bot/AGENTS.md "/wallet"). Balance + cost basis only; live
 * PnL is a deferred feature pending the enriched portfolio endpoint.
 */
export const handlePositions = async (
  env: Env,
  chatId: number,
  args: string,
): Promise<void> => {
  const wallet = args.trim().split(/\s+/)[0] ?? "";
  if (wallet === "") {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, USAGE);
    return;
  }
  if (!isAddress(wallet)) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      "Invalid wallet address. Expected a 0x-prefixed 40-character hex address.",
    );
    return;
  }

  // Both reads in parallel — they touch independent indexer queries.
  const [portfolioRes, balancesRes] = await Promise.all([
    fetchPortfolio(env, wallet),
    fetchBalances(env, wallet),
  ]);

  if (!portfolioRes.ok || !balancesRes.ok) {
    const message =
      portfolioRes.ok === false && portfolioRes.kind === "invalid_address"
        ? "Invalid wallet address."
        : balancesRes.ok === false && balancesRes.kind === "invalid_address"
          ? "Invalid wallet address."
          : "Data temporarily unavailable — try again in a moment.";
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, message);
    return;
  }

  const joined = joinPositions(
    portfolioRes.data.positions,
    balancesRes.data,
  );
  const chunks = formatPositionsResponse(joined, {
    approximate: portfolioRes.data.approximate,
  });

  for (const chunk of chunks) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, chunk);
  }
};
