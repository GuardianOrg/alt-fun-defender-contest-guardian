// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {
    ERC20PermitUpgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title Token
/// @notice ERC20 token created by the bonding curve launchpad.
/// @dev Forked from Virtuals Protocol's `FERC20.sol`. Fixed 1B supply, owner-only burn,
///      and configurable maxTx limit (percentage of total supply).
///      Owner is the Bonding contract — only it can burn or adjust maxTx.
///      EIP-2612 permit is supported so `Zap` can pull tokens via a
///      signed message — killing the pre-approve tx on the first sell of any
///      newly-launched token. Domain: name = token name, version = "1".
///
///      This contract is initializer-based (not constructor-based) so it can be
///      cloned via EIP-1167 minimal proxies. Each launch deploys a 45-byte
///      proxy that delegatecalls into a single deployed implementation, slashing
///      per-token deployment gas (~1.15M → ~280k for clone + initialize). The
///      implementation itself is `_disableInitializers()`-locked in the
///      constructor so it cannot be initialised directly.
contract Token is Initializable, ERC20Upgradeable, ERC20PermitUpgradeable, OwnableUpgradeable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    uint256 public maxTxPercent;
    uint256 public maxTxAmount;

    mapping(address => bool) public isExcludedFromMaxTx;

    error ExceedsMaxTx();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        uint256 maxTxPercent_,
        address owner_
    ) external initializer {
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        __Ownable_init(owner_);

        _mint(owner_, TOTAL_SUPPLY);
        isExcludedFromMaxTx[owner_] = true;
        isExcludedFromMaxTx[address(this)] = true;
        _setMaxTxPercent(maxTxPercent_);
    }

    function setMaxTxPercent(
        uint256 pct
    ) external onlyOwner {
        _setMaxTxPercent(pct);
    }

    function excludeFromMaxTx(
        address account
    ) external onlyOwner {
        isExcludedFromMaxTx[account] = true;
    }

    /// @notice Burn tokens from any address. Owner only, no approval required.
    function burn(
        address from,
        uint256 amount
    ) external onlyOwner {
        _burn(from, amount);
    }

    function _setMaxTxPercent(
        uint256 pct
    ) internal {
        maxTxPercent = pct;
        maxTxAmount = (pct * TOTAL_SUPPLY) / 100;
    }

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (from != address(0) && to != address(0) && !isExcludedFromMaxTx[from]) {
            if (amount > maxTxAmount) revert ExceedsMaxTx();
        }
        super._update(from, to, amount);
    }
}
