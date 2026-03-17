import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { hyperEVM } from './chains';

export const wagmiConfig = createConfig({
  chains: [hyperEVM],
  connectors: [injected()],
  transports: {
    [hyperEVM.id]: http(),
  },
});
