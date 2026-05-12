import { describe, expect, it } from "vitest";

import { getErrorMessage } from "./format";

describe("getErrorMessage", () => {
  // viem's `ContractFunctionRevertedError` surfaces unknown 4-byte
  // selectors verbatim in the message. The `Clones.FailedDeployment()`
  // selector has no entry in the Bonding/Zap ABI (it lives in OZ's
  // `Clones` library), so prior to the explicit branch in
  // `getErrorMessage` users would see the raw `0xb06ebf3d` blob and
  // have no way to recover. This pins both the raw selector and the
  // decoded name to the same actionable copy.
  it("decodes the raw `0xb06ebf3d` selector to a name-collision message", () => {
    const message = getErrorMessage(
      new Error(
        'The contract function "createToken" reverted with the ' +
          'following signature: 0xb06ebf3d Unable to decode signature ' +
          '"0xb06ebf3d" as it was not found on the provided ABI.',
      ),
    );
    expect(message).toMatch(/already exists for your wallet/i);
    expect(message).toMatch(/change the name or ticker/i);
  });

  it("decodes the named `FailedDeployment` selector the same way", () => {
    const message = getErrorMessage(new Error("execution reverted: FailedDeployment()"));
    expect(message).toMatch(/already exists for your wallet/i);
  });

  // Some RPC/wallet error wrappers normalise the revert message casing
  // (e.g. lowercase the whole string before re-throwing). Without the
  // case-insensitive match the recovery path silently drops the user
  // back onto the raw error fallback.
  it("decodes a lowercased `faileddeployment` revert string", () => {
    const message = getErrorMessage(
      new Error("execution reverted: faileddeployment()"),
    );
    expect(message).toMatch(/already exists for your wallet/i);
  });

  // The min-amount selector predates this fix; included as a sanity
  // guard so the new branch doesn't shadow the existing one (both
  // strings match `/0x.*/`).
  it("still decodes the BounceTech min-amount selector", () => {
    const message = getErrorMessage(new Error("reverted with 0x05eb05ac"));
    expect(message).toMatch(/below minimum/i);
  });

  it("falls back to the raw error message for unknown reverts", () => {
    const message = getErrorMessage(new Error("something unfamiliar happened"));
    expect(message).toBe("something unfamiliar happened");
  });

  it("handles non-Error inputs without throwing", () => {
    expect(getErrorMessage("plain string error")).toBe("Transaction failed");
    expect(getErrorMessage(null)).toBe("Transaction failed");
  });
});
