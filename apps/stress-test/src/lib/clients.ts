import { HYPER_EVM } from "@launchpad/shared";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { AppConfig } from "../config.ts";

/**
 * Local viem `Chain` definition. We can't reuse the shared `HYPER_EVM`
 * constant directly because it's typed as a narrow object literal (no
 * `nativeCurrency`, no `rpcUrls.default` shape) — viem rejects it at the
 * client boundary. Same pattern the API keepers use
 * (`apps/api/src/lib/auto-graduation-buyer.ts`).
 */
const chain = {
  id: HYPER_EVM.id,
  name: HYPER_EVM.name,
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [HYPER_EVM.rpcUrl] } },
} as const satisfies Chain;

export type PublicClient = ReturnType<typeof createPublicClient>;
export type LocalAccount = ReturnType<typeof privateKeyToAccount>;
export type WalletClient = ReturnType<
  typeof createWalletClient<ReturnType<typeof http>, typeof chain, LocalAccount>
>;

export interface Clients {
  account: LocalAccount;
  publicClient: PublicClient;
  walletClient: WalletClient;
  chain: typeof chain;
}

export function buildClients(config: AppConfig): Clients {
  const account = privateKeyToAccount(config.privateKey);
  const transport = http(config.rpcUrl);
  return {
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport }),
    chain,
  };
}
