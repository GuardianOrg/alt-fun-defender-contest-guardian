import { sendMessage } from "../lib/telegram.js";
import type { Env } from "../lib/types.js";

/**
 * v1 placeholder. The full custodial wallet flow (create, import, switch,
 * rename, export, withdraw) is specified in apps/telegram-bot/AGENTS.md and
 * lands once the PIN manager, inline-keyboard callback handlers, and
 * import/withdraw scenes are wired up on top of `lib/wallet.ts`. Until
 * then, /wallet acknowledges the command and lists what is coming so
 * users don't see a silent no-op.
 */
const PLACEHOLDER_TEXT = [
  "Wallet management is coming soon.",
  "",
  "Planned actions:",
  "• Create wallet",
  "• Import wallet (private key or mnemonic, including Privy export from the web app)",
  "• Switch active wallet",
  "• Rename wallet",
  "• Export private key (PIN required)",
  "• Withdraw to external address (PIN + confirm)",
  "",
  "This bot will never ask for your seed phrase or private key via DM until the import wizard is live.",
].join("\n");

export const handleWallet = async (
  env: Env,
  chatId: number,
): Promise<void> => {
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, PLACEHOLDER_TEXT);
};
