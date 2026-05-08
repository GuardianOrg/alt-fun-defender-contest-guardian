/**
 * Regression coverage for issue #418.
 *
 * Ponder's `factory({ event, parameter })` source resolves the topic0 hash
 * from the AbiEvent passed to it. If the event's parameter list (count or
 * types) drifts from the on-chain Solidity event, the topic0 silently goes
 * wrong and the factory log filter matches **zero** logs — meaning every
 * dynamically-spawned source's handlers (`Token.Transfer`,
 * `HyperSwapPair.Sync/Swap`) silently never fire. There is no runtime
 * error, just empty data.
 *
 * The original bug: `parseAbiItem("event TokenLaunched(... uint256 k, uint256 index)")`
 * had an extra trailing `uint256 index` parameter that the real Bonding
 * contract doesn't emit. Result: `tokenBalance` table stayed empty for
 * every token in production for weeks.
 *
 * The fix: source the factory events directly from `BondingAbi` via
 * `getAbiItem`. These tests assert that contract — i.e. that the events
 * Ponder is filtering on are exactly the ones the contract actually emits,
 * keyed by topic0.
 */
import { describe, it, expect } from "vitest";
import { getAbiItem, toEventSelector, type AbiEvent } from "viem";
import { BondingAbi } from "@launchpad/shared";

import ponderConfig from "../ponder.config";

type FactoryAddress = {
  readonly event: AbiEvent;
  readonly parameter: string;
};

function getFactoryAddress(name: "Token" | "HyperSwapPair"): FactoryAddress {
  const contract = ponderConfig.contracts[name] as { address: unknown };
  const address = contract.address as Record<string, unknown> | null | undefined;
  if (!address || typeof address !== "object" || !("event" in address)) {
    throw new Error(`${name} contract is not configured with a factory address`);
  }
  return address as unknown as FactoryAddress;
}

describe("ponder.config factory subscriptions", () => {
  it("Token source filters on the real Bonding.TokenLaunched topic0", () => {
    const factoryAddress = getFactoryAddress("Token");
    const realEvent = getAbiItem({ abi: BondingAbi, name: "TokenLaunched" });

    expect(factoryAddress.event.type).toBe("event");
    expect(factoryAddress.event.name).toBe("TokenLaunched");
    expect(factoryAddress.parameter).toBe("token");
    // Topic0 equality is the load-bearing assertion: it's exactly what
    // Ponder uses to match logs against this factory subscription.
    expect(toEventSelector(factoryAddress.event)).toBe(toEventSelector(realEvent));
  });

  it("Token factory parameter resolves to an indexed address topic", () => {
    // Ponder reads the factory `parameter` value from the matched log's
    // *topics* (not data) when the parameter is indexed. Guard that the
    // configured parameter actually IS indexed in the real ABI — otherwise
    // every factory match would resolve to garbage / zero address.
    const realEvent = getAbiItem({ abi: BondingAbi, name: "TokenLaunched" });
    const tokenInput = realEvent.inputs.find((i) => i.name === "token");
    expect(tokenInput).toBeDefined();
    expect(tokenInput!.type).toBe("address");
    expect((tokenInput as { indexed?: boolean }).indexed).toBe(true);
  });

  it("HyperSwapPair source filters on the real Bonding.TokenGraduated topic0", () => {
    const factoryAddress = getFactoryAddress("HyperSwapPair");
    const realEvent = getAbiItem({ abi: BondingAbi, name: "TokenGraduated" });

    expect(factoryAddress.event.type).toBe("event");
    expect(factoryAddress.event.name).toBe("TokenGraduated");
    expect(factoryAddress.parameter).toBe("pairAddress");
    expect(toEventSelector(factoryAddress.event)).toBe(toEventSelector(realEvent));
  });

  it("HyperSwapPair factory parameter resolves to an indexed address topic", () => {
    const realEvent = getAbiItem({ abi: BondingAbi, name: "TokenGraduated" });
    const pairInput = realEvent.inputs.find((i) => i.name === "pairAddress");
    expect(pairInput).toBeDefined();
    expect(pairInput!.type).toBe("address");
    expect((pairInput as { indexed?: boolean }).indexed).toBe(true);
  });
});
