import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";

import {
  BondingAbi,
  FeeVaultAbi,
  TokenAbi,
  FactoryAbi,
  ZapAbi,
  BotFeeRouterAbi,
  UniswapV2PairAbi,
  CONTRACT_ADDRESSES,
  HYPER_EVM,
  BONDING_START_BLOCK,
} from "@launchpad/shared";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Factory-trigger events sourced directly from the typed Bonding ABI. We
 * used to hand-roll these as `parseAbiItem("event TokenLaunched(...)")`
 * strings, which drifted from the real Solidity events (extra `index`
 * param + missing `indexed` flags) and silently produced the wrong topic0
 * hash. Ponder's factory log filter then never matched any logs, so
 * dynamically-spawned sources (Token, HyperSwapPair) were never registered
 * and their handlers (`Token.Transfer`, `HyperSwapPair.Sync/Swap`) never
 * fired — the bug behind issue #418. Reading the events from the ABI
 * makes drift impossible by construction.
 */
const tokenLaunchedEvent = getAbiItem({ abi: BondingAbi, name: "TokenLaunched" });
const tokenGraduatedEvent = getAbiItem({ abi: BondingAbi, name: "TokenGraduated" });

const bondingAddress = CONTRACT_ADDRESSES.bonding as `0x${string}`;
const factoryAddress = CONTRACT_ADDRESSES.factory as `0x${string}`;
const zapAddress = CONTRACT_ADDRESSES.zap as `0x${string}`;
const feeVaultAddress = CONTRACT_ADDRESSES.feeVault as `0x${string}`;
const botFeeRouterAddress = (
  process.env.BOT_FEE_ROUTER_ADDRESS ?? CONTRACT_ADDRESSES.botFeeRouter
) as `0x${string}`;
const startBlock = Number(process.env.BONDING_START_BLOCK ?? BONDING_START_BLOCK);
/**
 * The bot-team `BotFeeRouter` typically deploys long after the core
 * Alt Fun contracts, so it gets its own start block — backfilling from
 * `BONDING_START_BLOCK` across an empty range would just burn RPC
 * budget for nothing. Override with `BOT_FEE_ROUTER_START_BLOCK` once
 * the router is live. Until the router address is set this value is
 * ignored (the source registers but matches no logs).
 */
const botFeeRouterStartBlock = Number(
  process.env.BOT_FEE_ROUTER_START_BLOCK ?? startBlock,
);

if (bondingAddress === ZERO_ADDRESS) {
  throw new Error(
    "Bonding contract address is not set — update CONTRACT_ADDRESSES in @launchpad/shared before running the indexer",
  );
}

export default createConfig({
  chains: {
    hyperevm: {
      id: HYPER_EVM.id,
      rpc: process.env.PONDER_RPC_URL_999,
      ethGetLogsBlockRange: 10_000,
    },
  },
  contracts: {
    Bonding: {
      chain: "hyperevm",
      abi: BondingAbi,
      address: bondingAddress,
      startBlock,
    },
    Factory: {
      chain: "hyperevm",
      abi: FactoryAbi,
      address: factoryAddress,
      startBlock,
    },
    Zap: {
      chain: "hyperevm",
      abi: ZapAbi,
      address: zapAddress,
      startBlock,
    },
    FeeVault: {
      chain: "hyperevm",
      abi: FeeVaultAbi,
      address: feeVaultAddress,
      startBlock,
    },
    /**
     * The `BotFeeRouter` is operated by the Telegram-bot team and not
     * yet deployed at the time of writing — `botFeeRouterAddress`
     * resolves to the zero sentinel from `CONTRACT_ADDRESSES`. The
     * source is registered unconditionally so the
     * `BotFeeRouter:BotRouterTrade` / `ReferralPaid` handlers can be
     * imported and type-check, but no logs match a zero address so
     * Ponder skips it at runtime. Set `BOT_FEE_ROUTER_ADDRESS` (plus
     * `BOT_FEE_ROUTER_START_BLOCK`) once the router ships and the
     * handlers below will start populating `walletBotPosition`,
     * `referrerStats`, and `botRouterTrade`.
     */
    BotFeeRouter: {
      chain: "hyperevm",
      abi: BotFeeRouterAbi,
      address: botFeeRouterAddress,
      startBlock: botFeeRouterStartBlock,
    },
    Token: {
      chain: "hyperevm",
      abi: TokenAbi,
      address: factory({
        address: bondingAddress,
        event: tokenLaunchedEvent,
        parameter: "token",
      }),
      startBlock,
    },
    HyperSwapPair: {
      chain: "hyperevm",
      abi: UniswapV2PairAbi,
      address: factory({
        address: bondingAddress,
        event: tokenGraduatedEvent,
        parameter: "pairAddress",
      }),
      startBlock,
    },
  },
});
