// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {FPair} from "./FPair.sol";

/// @title FFactory
/// @notice Registry of bonding curve pairs. Manages fee configuration.
/// @dev Forked from Virtuals Protocol FFactory.sol. Uses AccessControl for role-gated pair creation.
contract FFactory is Initializable, AccessControlUpgradeable {
    bytes32 public constant BONDING_ROLE = keccak256("BONDING_ROLE");

    mapping(address => mapping(address => address)) private _pairs;
    address[] public allPairs;

    address public router;
    address public feeTo;
    uint256 public buyTax;
    uint256 public sellTax;

    event PairCreated(address indexed tokenA, address indexed tokenB, address pair, uint256 index);

    error ZeroAddress();
    error NoRouter();

    function initialize(address feeTo_, uint256 buyTax_, uint256 sellTax_) external initializer {
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        feeTo = feeTo_;
        buyTax = buyTax_;
        sellTax = sellTax_;
    }

    function createPair(address tokenA, address tokenB) external onlyRole(BONDING_ROLE) returns (address) {
        if (tokenA == address(0) || tokenB == address(0)) revert ZeroAddress();
        if (router == address(0)) revert NoRouter();

        FPair pair = new FPair(router, tokenA, tokenB);
        _pairs[tokenA][tokenB] = address(pair);
        _pairs[tokenB][tokenA] = address(pair);
        allPairs.push(address(pair));

        emit PairCreated(tokenA, tokenB, address(pair), allPairs.length);
        return address(pair);
    }

    function getPair(address tokenA, address tokenB) external view returns (address) {
        return _pairs[tokenA][tokenB];
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function setRouter(
        address router_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        router = router_;
    }

    function setFeeParams(address feeTo_, uint256 buyTax_, uint256 sellTax_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (feeTo_ == address(0)) revert ZeroAddress();
        feeTo = feeTo_;
        buyTax = buyTax_;
        sellTax = sellTax_;
    }
}
