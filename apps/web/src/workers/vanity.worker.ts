/// <reference lib="webworker" />

import { keccak_256 } from "@noble/hashes/sha3";

/**
 * Vanity-suffix miner. It stays in a worker so the keccak loop never blocks
 * React; the host stops once a launch-eligible suffix is found.
 */

interface InitMessage {
  type: "init";
  implementation: `0x${string}`;
  bondingProxy: `0x${string}`;
  creator: `0x${string}`;
  /** `keccak256(bytes(name))`, pre-hashed by the host. */
  nameHash: `0x${string}`;
  /** `keccak256(bytes(ticker))` of the user-entered ticker. */
  tickerHash: `0x${string}`;
  /** Initial trailing-zero target; hosts can raise it with `bumpTarget`. */
  initialTargetZeros: number;
  workerIndex: number;
  workerCount: number;
}

interface StopMessage {
  type: "stop";
}

interface BumpTargetMessage {
  type: "bumpTarget";
  /** New minimum trailing-zero count. Worker only raises, never lowers. */
  targetZeros: number;
}

type WorkerInbound = InitMessage | StopMessage | BumpTargetMessage;

/** Periodic non-cumulative progress tick. */
interface ProgressMessage {
  type: "progress";
  attemptsDelta: number;
}

/** Winner notification with actual trailing-zero count and recent attempts. */
interface FoundMessage {
  type: "found";
  salt: `0x${string}`;
  address: `0x${string}`;
  zeros: number;
  attemptsDelta: number;
}

export type WorkerOutbound = ProgressMessage | FoundMessage;

const HEX = "0123456789abcdef";

function bytesToHex(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) {
    const b = bytes[i];
    s += HEX[(b >> 4) & 0xf] + HEX[b & 0xf];
  }
  return s;
}

/** Strict hex decoder so malformed inputs fail before the hot loop. */
function hexToBytes(hex: string, expectedBytes: number, label: string): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  const expectedChars = expectedBytes * 2;
  if (clean.length !== expectedChars) {
    throw new Error(
      `vanity.worker: ${label} must be ${expectedChars} hex chars (got ${clean.length})`,
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error(`vanity.worker: ${label} contains non-hex characters`);
  }
  const out = new Uint8Array(expectedBytes);
  for (let i = 0; i < expectedBytes; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function hexToBytes20(hex: string, label: string): Uint8Array {
  return hexToBytes(hex, 20, label);
}

function hexToBytes32(hex: string, label: string): Uint8Array {
  return hexToBytes(hex, 32, label);
}

const EIP1167_PREFIX_HEX = "3d602d80600a3d3981f3363d3d373d3d3d363d73";
const EIP1167_SUFFIX_HEX = "5af43d82803e903d91602b57fd5bf3";

function buildInitCode(implBytes: Uint8Array): Uint8Array {
  const prefix = hexToBytes20(`0x${EIP1167_PREFIX_HEX}`, "EIP1167 prefix");
  const suffixBytes = new Uint8Array(EIP1167_SUFFIX_HEX.length / 2);
  for (let i = 0; i < suffixBytes.length; i++) {
    suffixBytes[i] = parseInt(
      EIP1167_SUFFIX_HEX.slice(i * 2, i * 2 + 2),
      16,
    );
  }
  const out = new Uint8Array(prefix.length + 20 + suffixBytes.length);
  out.set(prefix, 0);
  out.set(implBytes, prefix.length);
  out.set(suffixBytes, prefix.length + 20);
  return out;
}

/** Count trailing zero nibbles in the CREATE2 address without allocating. */
function countAddressTrailingZeros(addrHash: Uint8Array): number {
  let zeros = 0;
  for (let i = 31; i >= 12; i--) {
    const b = addrHash[i];
    const lo = b & 0xf;
    if (lo !== 0) return zeros;
    zeros++;
    const hi = (b >> 4) & 0xf;
    if (hi !== 0) return zeros;
    zeros++;
  }
  return zeros;
}

let stopped = false;
// `init` resets this; bumps only raise it. `Infinity` before init.
let targetZeros = Number.POSITIVE_INFINITY;
// Guard against duplicate `init` while a loop is still draining.
let mining = false;

/** Iterations between yields; balances throughput with stop/bump latency. */
const CHUNK_SIZE = 50000;

/** Yield without `setTimeout(0)`'s nested 4ms clamp. */
const yieldChannel = new MessageChannel();
function yieldToTaskQueue(): Promise<void> {
  return new Promise<void>((resolve) => {
    yieldChannel.port1.onmessage = () => resolve();
    yieldChannel.port2.postMessage(null);
  });
}

self.addEventListener("message", (event: MessageEvent<WorkerInbound>) => {
  const msg = event.data;
  if (msg.type === "stop") {
    stopped = true;
    return;
  }
  if (msg.type === "bumpTarget") {
    if (msg.targetZeros > targetZeros) {
      targetZeros = msg.targetZeros;
    }
    return;
  }
  if (msg.type !== "init") return;

  // Duplicate `init` must not reconfigure globals read by the running loop.
  if (mining) return;

  stopped = false;
  targetZeros = msg.initialTargetZeros;

  const implBytes = hexToBytes20(msg.implementation, "implementation");
  const deployerBytes = hexToBytes20(msg.bondingProxy, "bondingProxy");
  const creatorBytes = hexToBytes20(msg.creator, "creator");
  const nameHashBytes = hexToBytes32(msg.nameHash, "nameHash");
  const tickerHashBytes = hexToBytes32(msg.tickerHash, "tickerHash");

  const initCode = buildInitCode(implBytes);
  const initCodeHash = keccak_256(initCode);

  const mixBuf = new Uint8Array(128);
  mixBuf.set(creatorBytes, 12);
  mixBuf.set(nameHashBytes, 32);
  mixBuf.set(tickerHashBytes, 64);

  const predictBuf = new Uint8Array(85);
  predictBuf[0] = 0xff;
  predictBuf.set(deployerBytes, 1);
  predictBuf.set(initCodeHash, 1 + 20 + 32);

  const saltBuf = new Uint8Array(32);
  crypto.getRandomValues(saltBuf);

  mining = true;
  void runMiner({
    mixBuf,
    predictBuf,
    saltBuf,
    counterLo: msg.workerIndex >>> 0,
    stride: Math.max(msg.workerCount, 1),
  }).finally(() => {
    mining = false;
  });
});

interface MinerState {
  mixBuf: Uint8Array;
  predictBuf: Uint8Array;
  saltBuf: Uint8Array;
  counterLo: number;
  stride: number;
}

/** Chunked mining loop so `bumpTarget`/`stop` messages can drain between bursts. */
async function runMiner(state: MinerState): Promise<void> {
  let { counterLo } = state;
  const { stride, mixBuf, predictBuf, saltBuf } = state;

  while (!stopped) {
    let iterationsInChunk = 0;
    let attemptsSinceProgress = 0;

    while (!stopped && iterationsInChunk < CHUNK_SIZE) {
      saltBuf[28] = (counterLo >>> 24) & 0xff;
      saltBuf[29] = (counterLo >>> 16) & 0xff;
      saltBuf[30] = (counterLo >>> 8) & 0xff;
      saltBuf[31] = counterLo & 0xff;

      mixBuf.set(saltBuf, 96);
      const mixed = keccak_256(mixBuf);

      predictBuf.set(mixed, 1 + 20);
      const addrHash = keccak_256(predictBuf);

      const actualZeros = countAddressTrailingZeros(addrHash);

      if (actualZeros >= targetZeros) {
        const fullAddr = `0x${bytesToHex(addrHash, 12, 32)}` as `0x${string}`;
        const fullSalt = `0x${bytesToHex(saltBuf, 0, 32)}` as `0x${string}`;
        const found: FoundMessage = {
          type: "found",
          salt: fullSalt,
          address: fullAddr,
          zeros: actualZeros,
          // Include the winning attempt itself.
          attemptsDelta: attemptsSinceProgress + 1,
        };
        (self as DedicatedWorkerGlobalScope).postMessage(found);
        attemptsSinceProgress = 0;
        // Avoid re-emitting at the same threshold before host broadcast lands.
        targetZeros = actualZeros + 1;
      } else {
        attemptsSinceProgress++;
      }

      iterationsInChunk++;
      counterLo = (counterLo + stride) >>> 0;
    }

    // Drain partial progress before yielding.
    if (attemptsSinceProgress > 0) {
      const progress: ProgressMessage = {
        type: "progress",
        attemptsDelta: attemptsSinceProgress,
      };
      (self as DedicatedWorkerGlobalScope).postMessage(progress);
    }

    if (stopped) return;

    // Yield. Pending `bumpTarget` / `stop` messages drain here.
    await yieldToTaskQueue();
  }
}
