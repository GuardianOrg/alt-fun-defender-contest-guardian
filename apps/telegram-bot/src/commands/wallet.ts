import { sendMessage } from "../lib/telegram.js";
import type { CommandContext, CommandHandler } from "./types.js";

/**
 * v1 placeholder. The full custodial wallet flow (create, import, switch,
 * rename, export, withdraw) is specified in apps/telegram-bot/AGENTS.md and
 * lands once the KV namespace, AES-256-GCM encryption (MASTER_KEY), PIN
 * manager, and import/withdraw scenes are wired up. Until then, /wallet
 * acknowledges the command and lists what is coming so users don't see a
 * silent no-op.
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

export const walletCommand: CommandHandler = async (
  ctx: CommandContext,
): Promise<void> => {
  await sendMessage(
    ctx.env.TELEGRAM_BOT_TOKEN,
    ctx.message.chat.id,
    PLACEHOLDER_TEXT,
  );
};
