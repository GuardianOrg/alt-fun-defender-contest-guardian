"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = CreatorBadge;
var react_1 = require("react");
var CreatorBadge_module_css_1 = require("./CreatorBadge.module.css");
var constants_1 = require("../../config/constants");
var useCreatorEarnings_1 = require("../../hooks/useCreatorEarnings");
var useWallet_1 = require("../../hooks/useWallet");
var format_1 = require("../../utils/format");
function CreatorBadge(_a) {
    var token = _a.token;
    var address = (0, useWallet_1.useWallet)().address;
    var _b = (0, useCreatorEarnings_1.useCreatorEarnings)(), earnings = _b.earnings, claiming = _b.claiming, claim = _b.claim;
    var _c = (0, react_1.useState)(false), expanded = _c[0], setExpanded = _c[1];
    var isCreator = !!address && token.creatorAddress.toLowerCase() === address.toLowerCase();
    if (!isCreator)
        return null;
    var tokenData = earnings === null || earnings === void 0 ? void 0 : earnings.tokens.find(function (t) { return t.address.toLowerCase() === token.address.toLowerCase(); });
    return (<div className={CreatorBadge_module_css_1.default.wrapper}>
      <button className={CreatorBadge_module_css_1.default.header} onClick={function () { return setExpanded(!expanded); }}>
        <div className={CreatorBadge_module_css_1.default.headerLeft}>
          <span className={CreatorBadge_module_css_1.default.badge}>creator</span>
          <span className={CreatorBadge_module_css_1.default.claimable}>
            {tokenData
            ? "$".concat(tokenData.feesClaimableUsd.toFixed(2), " claimable")
            : "Your token"}
          </span>
        </div>
        <span className={CreatorBadge_module_css_1.default.chevron}>{expanded ? "▴" : "▾"}</span>
      </button>

      {expanded && tokenData && (<div className={CreatorBadge_module_css_1.default.details}>
          <div className={CreatorBadge_module_css_1.default.statsGrid}>
            <div>
              <div className={CreatorBadge_module_css_1.default.statLabel}>volume</div>
              <div className={CreatorBadge_module_css_1.default.statValue}>
                ${tokenData.totalVolumeUsd.toLocaleString()}
              </div>
            </div>
            <div>
              <div className={CreatorBadge_module_css_1.default.statLabel}>earned</div>
              <div className={CreatorBadge_module_css_1.default.statValue}>
                ${tokenData.feesEarnedUsd.toFixed(2)}
              </div>
            </div>
            <div>
              <div className={CreatorBadge_module_css_1.default.statLabel}>claimable</div>
              <div className={CreatorBadge_module_css_1.default.statMint}>
                ${tokenData.feesClaimableUsd.toFixed(2)}
              </div>
            </div>
          </div>

          <button className={(0, format_1.cn)(CreatorBadge_module_css_1.default.claimBtn, tokenData.feesClaimableUsd > 0
                ? CreatorBadge_module_css_1.default.claimBtnActive
                : CreatorBadge_module_css_1.default.claimBtnDisabled, claiming && CreatorBadge_module_css_1.default.claimBtnBusy)} disabled={tokenData.feesClaimableUsd <= 0 || claiming} onClick={function () { return claim(token.address); }}>
            {claiming
                ? "Claiming…"
                : tokenData.feesClaimableUsd > 0
                    ? "Claim $".concat(tokenData.feesClaimableUsd.toFixed(2))
                    : "Nothing to claim"}
          </button>

          <div className={CreatorBadge_module_css_1.default.hint}>
            You earn {constants_1.FEES.creatorSplit * 100}% of all volume on this curve. Fees settle in USDC.
          </div>
        </div>)}
    </div>);
}
