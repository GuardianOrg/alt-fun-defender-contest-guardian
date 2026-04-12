export const UniswapV2PairAbi = [
  {
    "type": "event",
    "name": "Swap",
    "inputs": [
      { "name": "sender", "type": "address", "indexed": true },
      { "name": "amount0In", "type": "uint256", "indexed": false },
      { "name": "amount1In", "type": "uint256", "indexed": false },
      { "name": "amount0Out", "type": "uint256", "indexed": false },
      { "name": "amount1Out", "type": "uint256", "indexed": false },
      { "name": "to", "type": "address", "indexed": true }
    ]
  },
  {
    "type": "event",
    "name": "Sync",
    "inputs": [
      { "name": "reserve0", "type": "uint112", "indexed": false },
      { "name": "reserve1", "type": "uint112", "indexed": false }
    ]
  },
  {
    "type": "function",
    "name": "getReserves",
    "inputs": [],
    "outputs": [
      { "name": "reserve0", "type": "uint112" },
      { "name": "reserve1", "type": "uint112" },
      { "name": "blockTimestampLast", "type": "uint32" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "token0",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "token1",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view"
  }
] as const;
