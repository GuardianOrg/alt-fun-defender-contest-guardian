// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFPair {
    function getReserves() external view returns (uint256 reserve0, uint256 reserve1);
    function kLast() external view returns (uint256);
    function mint(
        uint256 reserve0,
        uint256 reserve1
    ) external returns (bool);
    function swap(
        uint256 amount0In,
        uint256 amount0Out,
        uint256 amount1In,
        uint256 amount1Out
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
