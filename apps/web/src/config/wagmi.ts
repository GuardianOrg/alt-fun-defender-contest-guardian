import { createConfig } from "@privy-io/wagmi";

import { hyperEVM } from "./chains";
import { hyperEvmTransport } from "./hyperEvmClient";

export const wagmiConfig = createConfig({
  chains: [hyperEVM],
  transports: {
    [hyperEVM.id]: hyperEvmTransport(),
  },
});
