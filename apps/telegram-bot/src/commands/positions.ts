import { fetchBalances, fetchPortfolio, isAddress } from "../lib/api.js";
import {
  callbackHandlers,
  type CallbackHandler,
} from "../lib/callbacks.js";
import {
  POSITIONS_PAGE_CALLBACK_CMD,
  buildPositionsPageKeyboard,
  formatPositionsResponse,
  joinPositions,
  renderPaginatedPage,
} from "../lib/format.js";
import { logger } from "../lib/logger.js";
import { editMessageText, sendMessage } from "../lib/telegram.js";
import type { Env } from "../lib/types.js";

const USAGE = "Usage: /positions <wallet_address>";

/**
 * v1: wallet address is required (no active-wallet selector yet — see
 * apps/telegram-bot/AGENTS.md "/wallet"). Balance + cost basis only; live
 * PnL is a deferred feature pending the enriched portfolio endpoint.
 *
 * Long lists paginate in-place via the `pp` callback handler below —
 * the AGENTS.md Telegram-platform-constraints rule "never send one
 * giant message" is enforced by sending only page 0 and attaching a
 * `[Next →]` button when the response would otherwise spill across
 * multiple chunks.
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
  const text = renderPaginatedPage(chunks, 0);
  const keyboard = buildPositionsPageKeyboard(0, chunks.length, wallet);
  const extra = keyboard ? { reply_markup: keyboard } : {};

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, extra);
};

/**
 * Inline-keyboard handler for `pp:<page>:<wallet>`. Re-fetches portfolio
 * + balances on every click (read-only, idempotent, ~zero-egress over
 * the service binding) and edits the originating message in-place so
 * the chat doesn't grow with every nav click.
 *
 * `editMessageText` failures are treated as no-ops:
 *   - 400 "message not found" — user deleted the original. The 30s
 *     auto-delete contract from `/wallet` export uses the same path;
 *     surfacing it as an error would be more confusing than a silent
 *     dismiss.
 *   - 400 "message is not modified" — user double-clicked the same
 *     page button. The intended state already holds; nothing to do.
 *   - Network or 5xx — dispatcher's answerCallbackQuery still
 *     dismisses the spinner; user can retry.
 */
export const handlePositionsPage: CallbackHandler = async ({
  env,
  query,
  args,
}) => {
  const [pageStr, wallet] = args;
  if (
    pageStr === undefined ||
    wallet === undefined ||
    !isAddress(wallet)
  ) {
    return { text: "Invalid page request." };
  }
  const requestedPage = Number.parseInt(pageStr, 10);
  if (!Number.isFinite(requestedPage) || requestedPage < 0) {
    return { text: "Invalid page request." };
  }

  if (!query.message) {
    // Inline-mode buttons or messages older than 48h have no
    // `message` field — there's nothing to edit.
    return { text: "Message no longer available." };
  }

  const [portfolioRes, balancesRes] = await Promise.all([
    fetchPortfolio(env, wallet),
    fetchBalances(env, wallet),
  ]);
  if (!portfolioRes.ok || !balancesRes.ok) {
    return { text: "Data temporarily unavailable — try again." };
  }

  const joined = joinPositions(
    portfolioRes.data.positions,
    balancesRes.data,
  );
  const chunks = formatPositionsResponse(joined, {
    approximate: portfolioRes.data.approximate,
  });
  // Clamp: positions may have shrunk since the button was rendered.
  const page = Math.min(requestedPage, chunks.length - 1);
  const text = renderPaginatedPage(chunks, page);
  const keyboard = buildPositionsPageKeyboard(page, chunks.length, wallet);
  const extra = keyboard ? { reply_markup: keyboard } : {};

  const res = await editMessageText(
    env.TELEGRAM_BOT_TOKEN,
    query.message.chat.id,
    query.message.message_id,
    text,
    extra,
  );
  if (!res.ok) {
    // No exception — the dispatcher's answerCallbackQuery will still
    // dismiss the spinner. Log for diagnostics only.
    logger.warn("editMessageText non-2xx", {
      status: res.status,
      queryId: query.id,
    });
  }
  return;
};

callbackHandlers.set(POSITIONS_PAGE_CALLBACK_CMD, handlePositionsPage);
