// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title FERC20
/// @notice ERC20 token created by the bonding curve launchpad.
/// @dev Forked from Virtuals Protocol FERC20.sol. Fixed 1B supply, owner-only burn,
///      and configurable maxTx limit (percentage of total supply).
///      Owner is the Bonding contract — only it can burn or adjust maxTx.
contract FERC20 is ERC20, Ownable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    uint256 public maxTxPercent;
    uint256 public maxTxAmount;

    mapping(address => bool) public isExcludedFromMaxTx;

    error ExceedsMaxTx();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxTxPercent_,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {
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
