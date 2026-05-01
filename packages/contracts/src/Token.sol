// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {
    ERC20PermitUpgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title Token
/// @notice ERC20 launchpad token. Forked from Virtuals `FERC20.sol`.
/// @dev Fixed 1B supply. Owner (Bonding) is the only burner.
///      EIP-2612 permit lets `Zap` skip the first-sell pre-approve tx.
///      Initializer-based so it can be cloned via EIP-1167 minimal proxies
///      (~1.15M → ~280k per launch). Implementation is `_disableInitializers`'d
///      in the constructor so it can't be initialised directly.
contract Token is Initializable, ERC20Upgradeable, ERC20PermitUpgradeable, OwnableUpgradeable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        address owner_
    ) external initializer {
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        __Ownable_init(owner_);

        _mint(owner_, TOTAL_SUPPLY);
    }

    /// @notice Burn from any address. Owner only, no approval required.
    function burn(
        address from,
        uint256 amount
    ) external onlyOwner {
        _burn(from, amount);
    }
}
