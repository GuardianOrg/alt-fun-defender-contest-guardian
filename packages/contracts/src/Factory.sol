// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Pair} from "./Pair.sol";

/// @title Factory
/// @notice Registry of bonding-curve pairs. Forked from Virtuals `FFactory.sol`.
/// @dev `router` is one-shot: `setRouter` reverts after the first pair is
///      created so every pair shares an immutable router address.
contract Factory is Initializable, AccessControlUpgradeable {
    bytes32 public constant BONDING_ROLE = keccak256("BONDING_ROLE");

    mapping(address => mapping(address => address)) private _pairs;
    uint256 public pairCount;

    mapping(address => address) public pairFor;
    mapping(address => address) public ltFor;

    address public router;

    event PairCreated(address indexed tokenA, address indexed tokenB, address indexed pair, uint256 index);
    event RouterUpdated(address indexed router);

    error ZeroAddress();
    error NoRouter();
    error PairExists();
    error RouterFrozen();

    function initialize() external initializer {
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function createPair(
        address tokenA,
        address tokenB
    ) external onlyRole(BONDING_ROLE) returns (address) {
        if (tokenA == address(0) || tokenB == address(0)) revert ZeroAddress();
        if (router == address(0)) revert NoRouter();
        if (_pairs[tokenA][tokenB] != address(0)) revert PairExists();

        Pair pair = new Pair(router, tokenA, tokenB);
        _pairs[tokenA][tokenB] = address(pair);
        _pairs[tokenB][tokenA] = address(pair);

        pairFor[tokenA] = address(pair);
        ltFor[tokenA] = tokenB;

        emit PairCreated(tokenA, tokenB, address(pair), ++pairCount);
        return address(pair);
    }

    function getPair(
        address tokenA,
        address tokenB
    ) external view returns (address) {
        return _pairs[tokenA][tokenB];
    }

    function setRouter(
        address router_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (router_ == address(0)) revert ZeroAddress();
        if (pairCount > 0) revert RouterFrozen();
        router = router_;
        emit RouterUpdated(router_);
    }
}
