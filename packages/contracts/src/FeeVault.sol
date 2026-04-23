// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/// @title FeeVault
/// @notice Holds protocol and creator USDC fees accrued from allowlisted depositors (routers).
/// @dev Depositors `transfer` USDC to this vault and then call `accrue()` to update balances.
///      The vault does NOT pull USDC via `transferFrom`; it trusts the allowlist to pass truthful
///      amounts. The allowlist is owner-controlled, so the trust root is the same as for router
///      upgrades: if the owner whitelists a bad router it can already misroute user funds, so the
///      vault does not add a second layer of paranoia here. A balance-delta check could be added
///      in a future upgrade if we ever integrate third-party depositors.
///
///      Creator attribution is supplied by the depositor on each call (looked up via the
///      `Bonding` token registry) — the vault itself has no opinion about what a "creator" is.
contract FeeVault is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    IERC20 public usdc;

    /// @notice Protocol fee recipient. Receives payout on `claimProtocol()`.
    address public feeTo;

    /// @dev Depositors allowed to call `accrue`. Owner-managed via `addDepositor` /
    ///      `removeDepositor`. The set model mirrors `Bonding._routers` so a router upgrade
    ///      path is always open: whitelist the new router, migrate frontends, remove the old.
    EnumerableSet.AddressSet private _depositors;

    /// @notice Pending creator USDC balances. Cleared on `claim()`.
    mapping(address => uint256) public creatorBalance;

    /// @notice Pending protocol USDC balance. Cleared on `claimProtocol()`.
    uint256 public protocolBalance;

    /// @notice Lifetime gross creator USDC accrued (never decreases). Used for UI "total earned".
    mapping(address => uint256) public lifetimeCreatorEarned;

    /// @notice Lifetime gross protocol USDC accrued (never decreases).
    uint256 public lifetimeProtocolEarned;

    event FeeAccrued(
        address indexed token, address indexed creator, uint256 creatorAmount, uint256 protocolAmount, bool isBuy
    );
    event CreatorFeesClaimed(address indexed creator, uint256 amount);
    event ProtocolFeesClaimed(address indexed feeTo, uint256 amount);
    event DepositorAdded(address indexed depositor);
    event DepositorRemoved(address indexed depositor);
    event FeeToUpdated(address indexed feeTo);

    error NotDepositor();
    error NothingToClaim();
    error ZeroAddress();
    error DepositorAlreadyAdded();
    error DepositorNotFound();

    modifier onlyDepositor() {
        if (!_depositors.contains(msg.sender)) revert NotDepositor();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address usdc_,
        address feeTo_
    ) external initializer {
        if (usdc_ == address(0) || feeTo_ == address(0)) revert ZeroAddress();
        __Ownable_init(msg.sender);
        usdc = IERC20(usdc_);
        feeTo = feeTo_;
    }

    // ─── Accrual (depositor-only) ────────────────────────────────────────

    /// @notice Record a fee accrual. The caller MUST have transferred
    ///         `creatorAmount + protocolAmount` USDC to this vault prior to calling.
    /// @param token         Token the fee is attributed to (informational, emitted in event).
    /// @param creator       Creator receiving the creator share.
    /// @param creatorAmount Creator USDC share (6dp).
    /// @param protocolAmount Protocol USDC share (6dp).
    /// @param isBuy         Whether the trade was a buy (informational, emitted in event).
    function accrue(
        address token,
        address creator,
        uint256 creatorAmount,
        uint256 protocolAmount,
        bool isBuy
    ) external onlyDepositor {
        if (creatorAmount > 0) {
            creatorBalance[creator] += creatorAmount;
            lifetimeCreatorEarned[creator] += creatorAmount;
        }
        if (protocolAmount > 0) {
            protocolBalance += protocolAmount;
            lifetimeProtocolEarned += protocolAmount;
        }
        emit FeeAccrued(token, creator, creatorAmount, protocolAmount, isBuy);
    }

    // ─── Claims ──────────────────────────────────────────────────────────

    /// @notice Claim the caller's pending creator USDC. Reverts if zero.
    function claim() external nonReentrant returns (uint256 amount) {
        amount = creatorBalance[msg.sender];
        if (amount == 0) revert NothingToClaim();
        creatorBalance[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit CreatorFeesClaimed(msg.sender, amount);
    }

    /// @notice Send pending protocol USDC to the configured `feeTo`. Owner-only.
    function claimProtocol() external nonReentrant onlyOwner returns (uint256 amount) {
        amount = protocolBalance;
        if (amount == 0) revert NothingToClaim();
        protocolBalance = 0;
        usdc.safeTransfer(feeTo, amount);
        emit ProtocolFeesClaimed(feeTo, amount);
    }

    // ─── Admin ───────────────────────────────────────────────────────────

    function addDepositor(
        address depositor
    ) external onlyOwner {
        if (depositor == address(0)) revert ZeroAddress();
        if (!_depositors.add(depositor)) revert DepositorAlreadyAdded();
        emit DepositorAdded(depositor);
    }

    function removeDepositor(
        address depositor
    ) external onlyOwner {
        if (!_depositors.remove(depositor)) revert DepositorNotFound();
        emit DepositorRemoved(depositor);
    }

    function setFeeTo(
        address feeTo_
    ) external onlyOwner {
        if (feeTo_ == address(0)) revert ZeroAddress();
        feeTo = feeTo_;
        emit FeeToUpdated(feeTo_);
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function isDepositor(
        address depositor
    ) external view returns (bool) {
        return _depositors.contains(depositor);
    }

    function getDepositors() external view returns (address[] memory) {
        return _depositors.values();
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyOwner {}
}
