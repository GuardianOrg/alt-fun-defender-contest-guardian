// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {Bonding} from "../src/Bonding.sol";
import {FERC20} from "../src/FERC20.sol";
import {LaunchpadRouter} from "../src/LaunchpadRouter.sol";
import {DeployHelper} from "./DeployHelper.sol";

/// @notice Permit-UX test suite for LaunchpadRouter.
/// @dev Covers the `*WithPermit` variants added so first-time users can skip
///      the pre-approve tx. Verifies happy paths, the front-run-DoS swallow,
///      expired deadlines, and the FERC20 sell path.
contract LaunchpadRouterPermitTest is DeployHelper {
    LaunchpadRouter public launchpadRouter;

    Vm.Wallet internal signer;

    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function setUp() public {
        _deployCore();

        LaunchpadRouter routerImpl = new LaunchpadRouter();
        bytes memory routerInit =
            abi.encodeCall(LaunchpadRouter.initialize, (address(bonding), address(usdc), address(hyperswapRouter)));
        launchpadRouter = LaunchpadRouter(address(new ERC1967Proxy(address(routerImpl), routerInit)));

        bonding.addRouter(address(launchpadRouter));

        usdc.mint(address(lt), 1_000_000 ether);

        signer = vm.createWallet("permit-signer");
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _signPermit(
        IERC20Permit token,
        address owner_,
        uint256 privKey,
        address spender,
        uint256 value,
        uint256 deadline
    ) internal view returns (LaunchpadRouter.PermitData memory p) {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, owner_, spender, value, token.nonces(owner_), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privKey, digest);
        p = LaunchpadRouter.PermitData({value: value, deadline: deadline, v: v, r: r, s: s});
    }

    function _launchParams() internal view returns (Bonding.LaunchParams memory) {
        return Bonding.LaunchParams({
            name: "TestToken",
            ticker: "TEST",
            description: "Permit UX test token",
            image: "https://img.test/logo.png",
            urls: ["https://x.com/test", "", "", "https://test.com"],
            ltAddress: address(lt),
            purchaseAmount: 0
        });
    }

    function _createTokenNoSeed() internal returns (address tokenAddr) {
        vm.prank(creator);
        tokenAddr = launchpadRouter.createToken(_launchParams(), 0);
    }

    // ─── buyWithPermit ───────────────────────────────────────────────────

    function test_buyWithPermit_noPriorAllowance() public {
        address tokenAddr = _createTokenNoSeed();

        uint256 amount = 50 ether;
        usdc.mint(signer.addr, amount);

        LaunchpadRouter.PermitData memory p = _signPermit(
            IERC20Permit(address(usdc)),
            signer.addr,
            signer.privateKey,
            address(launchpadRouter),
            amount,
            block.timestamp + 1 hours
        );

        assertEq(usdc.allowance(signer.addr, address(launchpadRouter)), 0, "pre: zero allowance");

        vm.prank(signer.addr);
        uint256 tokensOut = launchpadRouter.buyWithPermit(tokenAddr, amount, 0, address(0), p);

        assertGt(tokensOut, 0, "tokens received");
        assertEq(IERC20(tokenAddr).balanceOf(signer.addr), tokensOut, "tokens delivered to signer");
        assertEq(usdc.balanceOf(signer.addr), 0, "usdc consumed");
    }

    function test_buyWithPermit_infiniteValueLeavesStandingAllowance() public {
        address tokenAddr = _createTokenNoSeed();

        uint256 amount = 50 ether;
        usdc.mint(signer.addr, amount * 2);

        LaunchpadRouter.PermitData memory p = _signPermit(
            IERC20Permit(address(usdc)),
            signer.addr,
            signer.privateKey,
            address(launchpadRouter),
            type(uint256).max,
            block.timestamp + 1 hours
        );

        vm.prank(signer.addr);
        launchpadRouter.buyWithPermit(tokenAddr, amount, 0, address(0), p);

        // Second buy should succeed without any further signature / approval.
        vm.prank(signer.addr);
        uint256 tokensOut2 = launchpadRouter.buy(tokenAddr, amount, 0, address(0));
        assertGt(tokensOut2, 0, "repeat buy works on standing infinite allowance");
    }

    function test_buyWithPermit_frontRun_isAbsorbed() public {
        address tokenAddr = _createTokenNoSeed();

        uint256 amount = 50 ether;
        usdc.mint(signer.addr, amount);

        LaunchpadRouter.PermitData memory p = _signPermit(
            IERC20Permit(address(usdc)),
            signer.addr,
            signer.privateKey,
            address(launchpadRouter),
            amount,
            block.timestamp + 1 hours
        );

        // Attacker front-runs the permit directly against the USDC token. This
        // consumes the nonce but applies the allowance — the exact DoS the
        // try/catch in `_tryPermit` defuses.
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        IERC20Permit(address(usdc)).permit(signer.addr, address(launchpadRouter), amount, p.deadline, p.v, p.r, p.s);

        assertEq(usdc.allowance(signer.addr, address(launchpadRouter)), amount, "allowance set by front-run");

        vm.prank(signer.addr);
        uint256 tokensOut = launchpadRouter.buyWithPermit(tokenAddr, amount, 0, address(0), p);
        assertGt(tokensOut, 0, "buy succeeds despite consumed nonce");
    }

    function test_buyWithPermit_expiredDeadline_reverts() public {
        address tokenAddr = _createTokenNoSeed();

        uint256 amount = 50 ether;
        usdc.mint(signer.addr, amount);

        uint256 deadline = block.timestamp - 1;
        LaunchpadRouter.PermitData memory p = _signPermit(
            IERC20Permit(address(usdc)), signer.addr, signer.privateKey, address(launchpadRouter), amount, deadline
        );

        // Permit reverts (expired), try/catch absorbs it. Allowance remains
        // zero, so the subsequent `safeTransferFrom` inside `_buyInternal`
        // reverts. We don't assert the exact revert — just that the tx fails.
        vm.prank(signer.addr);
        vm.expectRevert();
        launchpadRouter.buyWithPermit(tokenAddr, amount, 0, address(0), p);
    }

    // ─── sellWithPermit (FERC20) ─────────────────────────────────────────

    function test_sellWithPermit_ferc20_noPriorAllowance() public {
        address tokenAddr = _createTokenNoSeed();

        // Seed the signer with some FERC20 via a regular buy.
        uint256 buyUsdc = 100 ether;
        usdc.mint(signer.addr, buyUsdc);
        vm.startPrank(signer.addr);
        usdc.approve(address(launchpadRouter), buyUsdc);
        uint256 tokensOwned = launchpadRouter.buy(tokenAddr, buyUsdc, 0, address(0));
        vm.stopPrank();

        assertGt(tokensOwned, 0, "seeded signer has tokens");
        assertEq(IERC20(tokenAddr).allowance(signer.addr, address(launchpadRouter)), 0, "pre: zero token allowance");

        LaunchpadRouter.PermitData memory p = _signPermit(
            IERC20Permit(tokenAddr),
            signer.addr,
            signer.privateKey,
            address(launchpadRouter),
            tokensOwned,
            block.timestamp + 1 hours
        );

        uint256 usdcBefore = usdc.balanceOf(signer.addr);
        vm.prank(signer.addr);
        uint256 usdcOut = launchpadRouter.sellWithPermit(tokenAddr, tokensOwned, 0, p);

        assertGt(usdcOut, 0, "usdc received");
        assertEq(usdc.balanceOf(signer.addr), usdcBefore + usdcOut, "usdc delivered");
        assertEq(IERC20(tokenAddr).balanceOf(signer.addr), 0, "tokens consumed");
    }

    // ─── createTokenWithPermit ───────────────────────────────────────────

    function test_createTokenWithPermit_withSeedBuy() public {
        uint256 seedUsdc = 25 ether;
        usdc.mint(signer.addr, seedUsdc);

        LaunchpadRouter.PermitData memory p = _signPermit(
            IERC20Permit(address(usdc)),
            signer.addr,
            signer.privateKey,
            address(launchpadRouter),
            seedUsdc,
            block.timestamp + 1 hours
        );

        vm.prank(signer.addr);
        address tokenAddr = launchpadRouter.createTokenWithPermit(_launchParams(), seedUsdc, p);

        assertTrue(tokenAddr != address(0), "token deployed");
        assertGt(IERC20(tokenAddr).balanceOf(signer.addr), 0, "creator received seed tokens");
        assertEq(usdc.balanceOf(signer.addr), 0, "usdc consumed by seed buy");
    }

    function test_createTokenWithPermit_noSeedBuy_ignoresPermit() public {
        // Permit with bogus values — since seed amount is 0, permit is never
        // invoked, so this must still succeed.
        LaunchpadRouter.PermitData memory p =
            LaunchpadRouter.PermitData({value: 0, deadline: 0, v: 0, r: bytes32(0), s: bytes32(0)});

        vm.prank(creator);
        address tokenAddr = launchpadRouter.createTokenWithPermit(_launchParams(), 0, p);
        assertTrue(tokenAddr != address(0), "token deployed without seed");
    }
}
