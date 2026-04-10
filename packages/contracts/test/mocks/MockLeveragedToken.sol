// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Mock BounceTech Leveraged Token for testing
contract MockLeveragedToken is ERC20 {
    uint256 private _exchangeRate;
    uint256 private _targetLeverage;
    bool private _isLong;
    string private _underlyingSymbol;
    address public baseAsset; // USDC

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 exchangeRate_,
        uint256 targetLeverage_,
        bool isLong_,
        string memory underlyingSymbol_,
        address baseAsset_
    ) ERC20(name_, symbol_) {
        _exchangeRate = exchangeRate_;
        _targetLeverage = targetLeverage_;
        _isLong = isLong_;
        _underlyingSymbol = underlyingSymbol_;
        baseAsset = baseAsset_;
    }

    function mint(
        address to,
        uint256 baseAmount,
        uint256
    ) external returns (uint256 ltAmount) {
        ERC20(baseAsset).transferFrom(msg.sender, address(this), baseAmount);
        ltAmount = (baseAmount * 1e18) / _exchangeRate;
        _mint(to, ltAmount);
    }

    function redeem(
        address to,
        uint256 ltAmount,
        uint256
    ) external returns (uint256 baseAmount) {
        _burn(msg.sender, ltAmount);
        baseAmount = (ltAmount * _exchangeRate) / 1e18;
        ERC20(baseAsset).transfer(to, baseAmount);
    }

    function baseAssetBalance() external view returns (uint256) {
        return ERC20(baseAsset).balanceOf(address(this));
    }

    function exchangeRate() external view returns (uint256) {
        return _exchangeRate;
    }

    function targetLeverage() external view returns (uint256) {
        return _targetLeverage;
    }

    function isLong() external view returns (bool) {
        return _isLong;
    }

    function underlyingSymbol() external view returns (string memory) {
        return _underlyingSymbol;
    }

    function setExchangeRate(
        uint256 rate
    ) external {
        _exchangeRate = rate;
    }

    /// @dev Mint LT directly for testing (no USDC required)
    function mintDirect(
        address to,
        uint256 amount
    ) external {
        _mint(to, amount);
    }
}
