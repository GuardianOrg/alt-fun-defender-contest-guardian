// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IBounceGlobalStorage
/// @notice Minimal interface for BounceTech's `GlobalStorage` contract — the
///         protocol's central registry that points at every other module
///         (factory, treasury, fee handler, etc.).
/// @dev We only need `factory()` so we can resolve the live BounceTech
///      `Factory` at every `Bonding.launch` and consult its `ltExists`
///      mapping. Going through `GlobalStorage` (rather than caching the
///      factory address ourselves) means a BounceTech-driven `setFactory`
///      flows through to us with zero ops on our side — the next launch
///      automatically reads from the new factory.
///
///      Mainnet address: `0xa07d06383c1863c8A54d427aC890643d76cc03ff`
///      (see `bounce-tech/bounce-npm`).
///
///      Source:
///      https://github.com/bounce-tech/bounce-smart-contracts/blob/main/src/GlobalStorage.sol
interface IBounceGlobalStorage {
    /// @notice Current BounceTech `Factory` address.
    /// @dev Exposed as `IFactory public override factory` on the upstream
    ///      contract; we type the return as `address` so the caller can
    ///      ABI-cast to whatever interface they need (here, `IBounceFactory`).
    function factory() external view returns (address);
}
