"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = PairSelector;
var PairSelector_module_css_1 = require("./PairSelector.module.css");
var StepHeader_1 = require("./StepHeader");
var colors_1 = require("../../config/colors");
var constants_1 = require("../../config/constants");
var assets_1 = require("../../services/mock/assets");
var format_1 = require("../../utils/format");
function ltChg(asset, lev, dir) {
    var data = assets_1.MOCK_ASSET_DATA[asset];
    return dir === "long" ? data.change24h * lev : -data.change24h * lev;
}
function PairSelector(_a) {
    var direction = _a.direction, asset = _a.asset, leverage = _a.leverage, onDirectionChange = _a.onDirectionChange, onAssetChange = _a.onAssetChange, onLeverageChange = _a.onLeverageChange;
    var isLong = direction === "long";
    var chg = ltChg(asset, leverage, direction);
    return (<div>
      <StepHeader_1.default step={1} title="Choose your pair" subtitle="Pick a direction and underlying asset."/>

      <div className={PairSelector_module_css_1.default.directionGrid}>
        <button className={(0, format_1.cn)(PairSelector_module_css_1.default.directionCard, isLong
            ? PairSelector_module_css_1.default.directionCardLongActive
            : PairSelector_module_css_1.default.directionCardInactive)} onClick={function () { return onDirectionChange("long"); }}>
          <div className={PairSelector_module_css_1.default.cardHeader}>
            <div className={(0, format_1.cn)(PairSelector_module_css_1.default.directionTitle, isLong ? PairSelector_module_css_1.default.directionTitleMint : PairSelector_module_css_1.default.directionTitleMuted)}>
              LONG
            </div>
            <svg width="52" height="28" viewBox="0 0 52 28" fill="none">
              <polyline points="0,24 10,20 20,14 30,10 40,5 52,2" stroke={isLong ? colors_1.COLORS.mint : (0, colors_1.rgba)(colors_1.COLORS.text, 0.15)} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <polygon points="0,28 0,24 10,20 20,14 30,10 40,5 52,2 52,28" fill={isLong ? (0, colors_1.rgba)(colors_1.COLORS.mint, 0.12) : (0, colors_1.rgba)(colors_1.COLORS.text, 0.03)}/>
            </svg>
          </div>
          <div className={PairSelector_module_css_1.default.cardDesc}>
            token moves up when underlying pumps
          </div>
          <div className={(0, format_1.cn)(PairSelector_module_css_1.default.cardBadge, isLong ? PairSelector_module_css_1.default.cardBadgeMintActive : PairSelector_module_css_1.default.cardBadgeInactive)}>
            bullish
          </div>
        </button>

        <button className={(0, format_1.cn)(PairSelector_module_css_1.default.directionCard, !isLong
            ? PairSelector_module_css_1.default.directionCardShortActive
            : PairSelector_module_css_1.default.directionCardInactive)} onClick={function () { return onDirectionChange("short"); }}>
          <div className={PairSelector_module_css_1.default.cardHeader}>
            <div className={(0, format_1.cn)(PairSelector_module_css_1.default.directionTitle, !isLong ? PairSelector_module_css_1.default.directionTitleRed : PairSelector_module_css_1.default.directionTitleMuted)}>
              SHORT
            </div>
            <svg width="52" height="28" viewBox="0 0 52 28" fill="none">
              <polyline points="0,4 10,7 20,12 30,17 40,22 52,26" stroke={!isLong ? colors_1.COLORS.red : (0, colors_1.rgba)(colors_1.COLORS.text, 0.15)} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <polygon points="0,0 0,4 10,7 20,12 30,17 40,22 52,26 52,0" fill={!isLong ? (0, colors_1.rgba)(colors_1.COLORS.red, 0.1) : (0, colors_1.rgba)(colors_1.COLORS.text, 0.03)}/>
            </svg>
          </div>
          <div className={PairSelector_module_css_1.default.cardDesc}>
            token moves up when underlying dumps
          </div>
          <div className={(0, format_1.cn)(PairSelector_module_css_1.default.cardBadge, !isLong ? PairSelector_module_css_1.default.cardBadgeRedActive : PairSelector_module_css_1.default.cardBadgeInactive)}>
            bearish
          </div>
        </button>
      </div>

      <label className={PairSelector_module_css_1.default.label}>Underlying asset</label>
      <div className={PairSelector_module_css_1.default.assetGrid}>
        {constants_1.UNDERLYING_ASSETS.map(function (a) {
            var data = assets_1.MOCK_ASSET_DATA[a];
            var up = data.change24h >= 0;
            var selected = a === asset;
            return (<button key={a} className={(0, format_1.cn)(PairSelector_module_css_1.default.assetButton, selected
                    ? isLong
                        ? PairSelector_module_css_1.default.assetButtonMintSelected
                        : PairSelector_module_css_1.default.assetButtonRedSelected
                    : PairSelector_module_css_1.default.assetButtonUnselected)} onClick={function () { return onAssetChange(a); }}>
              <div className={PairSelector_module_css_1.default.assetName}>{a}</div>
              <div className={(0, format_1.cn)(PairSelector_module_css_1.default.assetChg, up ? PairSelector_module_css_1.default.textMint : PairSelector_module_css_1.default.textRed)}>
                {up ? "+" : ""}
                {data.change24h.toFixed(2)}%
              </div>
            </button>);
        })}
      </div>

      <label className={PairSelector_module_css_1.default.leverageLabel}>Leverage</label>
      <div className={PairSelector_module_css_1.default.leverageRow}>
        {constants_1.LEVERAGE_OPTIONS.map(function (l) { return (<button key={l} className={(0, format_1.cn)(PairSelector_module_css_1.default.leverageButton, leverage === l
                ? isLong
                    ? PairSelector_module_css_1.default.leverageButtonMintSelected
                    : PairSelector_module_css_1.default.leverageButtonRedSelected
                : PairSelector_module_css_1.default.leverageButtonUnselected)} onClick={function () { return onLeverageChange(l); }}>
            {l}×
          </button>); })}
      </div>

      <div className={(0, format_1.cn)(PairSelector_module_css_1.default.summaryCard, isLong ? PairSelector_module_css_1.default.summaryCardMint : PairSelector_module_css_1.default.summaryCardRed)}>
        <div className={(0, format_1.cn)(PairSelector_module_css_1.default.summaryDot, isLong ? PairSelector_module_css_1.default.summaryDotMint : PairSelector_module_css_1.default.summaryDotRed)}/>
        <span className={PairSelector_module_css_1.default.summaryName}>
          {(0, format_1.getLtDisplayName)(asset, leverage, direction)}
        </span>
        <span className={PairSelector_module_css_1.default.summaryChg}>
          {chg >= 0 ? "+" : ""}
          {chg.toFixed(1)}% today
        </span>
      </div>

      <div className={PairSelector_module_css_1.default.hlBadge}>
        <svg width="16" height="12" viewBox="0 0 36 24" fill="none">
          <path d="M14 2 L2 12 L14 22" stroke={colors_1.COLORS.mint} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M22 2 L34 12 L22 22" stroke={colors_1.COLORS.mint} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        powered by Hyperliquid perps
      </div>
    </div>);
}
