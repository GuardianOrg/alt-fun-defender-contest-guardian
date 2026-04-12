"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = RewardsTab;
var EarningsPanel_module_css_1 = require("./EarningsPanel.module.css");
var constants_1 = require("../../config/constants");
var format_1 = require("../../utils/format");
function RewardsTab(_a) {
    var earnings = _a.earnings, claiming = _a.claiming, claim = _a.claim, onTokenClick = _a.onTokenClick, onLaunch = _a.onLaunch;
    if (!earnings || earnings.tokens.length === 0) {
        return (<div className={EarningsPanel_module_css_1.default.emptyState}>
        <div className={EarningsPanel_module_css_1.default.emptyIcon}>&#x26A1;</div>
        <div className={EarningsPanel_module_css_1.default.textCenter}>
          <div className={EarningsPanel_module_css_1.default.emptyTitle}>No tokens created yet</div>
          <div className={EarningsPanel_module_css_1.default.emptyText}>
            Launch a levered token to start earning {constants_1.FEES.creatorSplit * 100}% of
            all trading volume on the bonding curve. Fees accrue in USDC and can
            be claimed anytime.
          </div>
        </div>
        <button className={EarningsPanel_module_css_1.default.launchBtn} onClick={onLaunch}>
          &#x26A1; Launch a token
        </button>
      </div>);
    }
    return (<>
      <div className={EarningsPanel_module_css_1.default.rewardsSummary}>
        <div className={EarningsPanel_module_css_1.default.rewardsGrid}>
          <div>
            <div className={EarningsPanel_module_css_1.default.rewardsLabel}>claimable</div>
            <div className={EarningsPanel_module_css_1.default.rewardsClaimable}>
              ${earnings.totalClaimable.toFixed(2)}
            </div>
          </div>
          <div>
            <div className={EarningsPanel_module_css_1.default.rewardsLabel}>total earned</div>
            <div className={EarningsPanel_module_css_1.default.rewardsTotalEarned}>
              ${earnings.totalEarned.toFixed(2)}
            </div>
          </div>
        </div>

        <button className={(0, format_1.cn)(EarningsPanel_module_css_1.default.claimBtn, earnings.totalClaimable > 0
            ? EarningsPanel_module_css_1.default.claimBtnActive
            : EarningsPanel_module_css_1.default.claimBtnDisabled, claiming && EarningsPanel_module_css_1.default.claiming)} onClick={function () { return claim(); }} disabled={earnings.totalClaimable <= 0 || claiming}>
          {claiming
            ? "Claiming\u2026"
            : earnings.totalClaimable > 0
                ? "Claim $".concat(earnings.totalClaimable.toFixed(2), " USDC")
                : "Nothing to claim"}
        </button>

        {claiming && (<div className={EarningsPanel_module_css_1.default.claimingIndicator}>
            <div className={EarningsPanel_module_css_1.default.claimingDot}/>
            Confirm in wallet&hellip;
          </div>)}

        <div className={EarningsPanel_module_css_1.default.prevClaimed}>
          <span>previously claimed</span>
          <span className={EarningsPanel_module_css_1.default.prevClaimedValue}>
            ${earnings.totalClaimed.toFixed(2)}
          </span>
        </div>
      </div>

      <div className={EarningsPanel_module_css_1.default.tokensSection}>
        <div className={EarningsPanel_module_css_1.default.tokensSectionLabel}>
          your tokens ({earnings.tokens.length})
        </div>

        <div className={EarningsPanel_module_css_1.default.tokensCards}>
          {earnings.tokens.map(function (t) { return (<div key={t.address} className={EarningsPanel_module_css_1.default.tokenCard} onClick={function () { return onTokenClick(t.address); }}>
              <div className={EarningsPanel_module_css_1.default.tokenCardHeader}>
                <span className={EarningsPanel_module_css_1.default.tokenCardEmoji}>{t.emoji}</span>
                <div className={EarningsPanel_module_css_1.default.tokenCardInfo}>
                  <div className={EarningsPanel_module_css_1.default.tokenCardName}>{t.name}</div>
                  <div className={EarningsPanel_module_css_1.default.tokenCardLtName}>{t.ltName}</div>
                </div>
                <div className={(0, format_1.cn)(EarningsPanel_module_css_1.default.statusBadge, t.status === "graduating" && EarningsPanel_module_css_1.default.statusGraduating, t.status === "graduated" && EarningsPanel_module_css_1.default.statusGraduated, t.status === "active" && EarningsPanel_module_css_1.default.statusActive)}>
                  {t.status}
                </div>
              </div>

              <div className={EarningsPanel_module_css_1.default.tokenCardGrid}>
                <div>
                  <div className={EarningsPanel_module_css_1.default.tokenCardStatLabel}>volume</div>
                  <div className={EarningsPanel_module_css_1.default.tokenCardStatValue}>
                    {(0, format_1.formatUsd)(t.totalVolumeUsd)}
                  </div>
                </div>
                <div>
                  <div className={EarningsPanel_module_css_1.default.tokenCardStatLabel}>earned</div>
                  <div className={EarningsPanel_module_css_1.default.tokenCardStatValue}>
                    ${t.feesEarnedUsd.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className={EarningsPanel_module_css_1.default.tokenCardStatLabel}>claimable</div>
                  <div className={EarningsPanel_module_css_1.default.tokenCardStatValueMint}>
                    ${t.feesClaimableUsd.toFixed(2)}
                  </div>
                </div>
              </div>

              {t.status !== "graduated" && (<div className={EarningsPanel_module_css_1.default.curveBar}>
                  <div className={EarningsPanel_module_css_1.default.curveTrack}>
                    <div className={(0, format_1.cn)(EarningsPanel_module_css_1.default.curveFill, "bar-glow-mint")} style={{ width: "".concat(t.curveFilled, "%") }}/>
                  </div>
                  <div className={EarningsPanel_module_css_1.default.curveLabel}>
                    {t.curveFilled}% filled
                  </div>
                </div>)}
            </div>); })}
        </div>
      </div>

      <div className={EarningsPanel_module_css_1.default.footer}>
        <div className={EarningsPanel_module_css_1.default.footerText}>
          <span className={EarningsPanel_module_css_1.default.footerHighlight}>
            {constants_1.FEES.creatorSplit * 100}%
          </span>{" "}
          of all curve volume goes to token creators. Fees accrue in USDC and
          can be claimed anytime.
        </div>
      </div>
    </>);
}
