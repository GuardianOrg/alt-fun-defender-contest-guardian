import type { Address, PublicClient } from "viem";

const ATTEMPTS = 7;
const MAX_DELAY = 10_000;
const INITIAL_DELAY = 100;

const waitForTransaction = async (
  publicClient: PublicClient | undefined,
  hash: Address,
) => {
  if (!publicClient) throw new Error("Public client unavailable");

  let delay = INITIAL_DELAY;
  let attempts = 0;
  while (attempts < ATTEMPTS) {
    try {
      await publicClient.waitForTransactionReceipt({ hash });
      return;
    } catch (error) {
      if (attempts === ATTEMPTS - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
      if (delay > MAX_DELAY) {
        delay = MAX_DELAY;
      }
      attempts++;
    }
  }
};

export default waitForTransaction;
