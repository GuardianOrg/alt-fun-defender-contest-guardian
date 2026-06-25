// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal view of `Router` used by `Factory.setRouter` to verify a
///         candidate router points back to this factory. Declared as an
///         interface so `Factory` need not import the concrete `Router`
///         (which imports `Factory`), avoiding a mutual import cycle.
interface IRouter {
    /// @notice The factory this router is bound to.
    /// @return The factory address recorded at the router's initialization.
    function factory() external view returns (address);
}
