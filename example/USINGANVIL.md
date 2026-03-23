# Using Anvil to duplicate blockchain

Anvil is a local blockchain that can be used to duplicate the blockchain. This is useful for testing and development.

To set it up you need to do three things:

- Adjust your wagmi.ts file to use the anvil chain
- Install foundry and run anvil from terminal
- Configure your wallet to use the anvil chain

## 1. Changes to wagmi.ts

Change your hyperEvm definition to this:

```typescript
export const hyperEvm = defineChain({
  id: 999123,
  name: "Anvil",
  nativeCurrency: { name: "Hyperliquid", symbol: "HYPE", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["http://127.0.0.1:8545"],
    },
  },
});
```

Key changes are id number (unique to your local anvil instance) and rpcUrls (pointing to your local anvil instance).

## 2. Install Foundry and run Anvil

First install foundry if not already installed.

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Then run anvil with the following command (making sure rpc and chain-id match your wagmi.ts file):

```bash
anvil --fork-url https://rpc.hyperliquid.xyz/evm --chain-id 999123
```

Each time you run this you create a copy of the blockchain locally that you can interact with.

## 3. Configure your wallet to use the anvil chain

I've been using the test wallets generated when you start a new anvil server. It logs something like this:

```
Available Accounts
==================

(0) 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000.000000000000000000 ETH)
(1) 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (10000.000000000000000000 ETH)
(2) 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC (10000.000000000000000000 ETH)
...

Private Keys
==================

(0) 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
(1) 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
(2) 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
...
```

I choose one of these and add it to my wallet. They come preloaded with 10,000 HYPE each.

You also need to add a custom chain network to your wallet. To do this navigate to 'add custom network' setting in your wallet and enter the correct details, e.g:

```
Chain ID: 999123
RPC URL: http://127.0.0.1:8545
Name: Anvil test chain (can be anything you like)
Symbol: HYPE
```

## Using this wallet

You can now use this wallet to interact with the anvil blockchain. Use the connnect wallet button on our site and ensure the right address and network is selected.

Currently, for liquidation points to work, you also need to ensure their is some data in the liquidation-raw-data file. This is a json file that contains the raw data for liquidations that have occurred on Hyperliquid. You can find this file in the src/data/liquidation-raw-data.json file.

## Nonce issues

Occasionally you may run into nonce issues. This is because the nonce of the account you're using is not being updated correctly. I was fixing this by manually adjusting my nonce number when signing the contract.

I was getting the current nonce number using command:

```bash
cast nonce <WALLET_ADDRESS_HERE> --rpc-url http://127.0.0.1:8545
```
