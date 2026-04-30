// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IBounceFactory
/// @notice Minimal interface for the BounceTech Leveraged Token Factory.
/// @dev We only consume `ltExists` — the registry of LTs that BounceTech itself
///      deployed via `Factory.createLt`. This is the canonical on-chain source
///      of truth for "is this address a real BounceTech LT?", and lets us
///      gate `Bonding.launch` without maintaining our own admin allowlist.
///
///      Mainnet address: `0xeD8bCDe433EB7c4B69DB1235483bf0Edb726Fc1B`
///      (see `bounce-tech/bounce-npm`).
///
///      Source:
///      https://github.com/bounce-tech/bounce-smart-contracts/blob/main/src/Factory.sol
interface IBounceFactory {
    /// @notice True iff `ltAddress_` was deployed via this factory's `createLt`.
    /// @dev Becomes `false` again if BounceTech `redeployLt`s the LT (the old
    ///      address is unregistered). For our purposes, that's fine — the
    ///      old address is dead anyway and we should not allow new launches
    ///      against it.
    function ltExists(
        address ltAddress_
    ) external view returns (bool);
}
