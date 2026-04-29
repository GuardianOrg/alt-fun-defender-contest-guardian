// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPair {
    function getReserves() external view returns (uint256 tokenReserve, uint256 assetReserve);
    function k() external view returns (uint256);
    function mint(
        uint256 tokenReserve,
        uint256 assetReserve
    ) external returns (bool);
    function swap(
        uint256 tokenIn,
        uint256 tokenOut,
        uint256 assetIn,
        uint256 assetOut
    ) external returns (bool);
    function transferAsset(
        address recipient,
        uint256 amount
    ) external;
    function transferToken(
        address recipient,
        uint256 amount
    ) external;
    function tokenBalance() external view returns (uint256);
    function assetBalance() external view returns (uint256);
}
