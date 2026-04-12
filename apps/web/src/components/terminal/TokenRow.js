"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TokenRow;
var react_router_1 = require("react-router");
var TokenRow_module_css_1 = require("./TokenRow.module.css");
var routes_1 = require("../../app/routes");
var format_1 = require("../../utils/format");
var ProgressBar_1 = require("../shared/ProgressBar");
function TokenRow(_a) {
    var token = _a.token;
    var navigate = (0, react_router_1.useNavigate)();
    var isGraduating = token.status === "graduating";
    var isGraduated = token.status === "graduated";
    var isShort = token.direction === "short";
    var up = token.change24h >= 0;
    var buyW = Math.min(token.curveFilled - (token.leverageBoost > 0 ? token.leverageBoost : 0), token.curveFilled);
    var levW = token.curveFilled - buyW;
    var isLtMover = token.leverageBoost > 15;
    return (<div className={(0, format_1.cn)(TokenRow_module_css_1.default.row, isGraduating
            ? isShort
                ? TokenRow_module_css_1.default.graduatingShort
                : TokenRow_module_css_1.default.graduatingLong
            : (0, format_1.cn)(TokenRow_module_css_1.default.normalRow, isShort
                ? isLtMover
                    ? TokenRow_module_css_1.default.borderAmber
                    : TokenRow_module_css_1.default.borderRed
                : isLtMover
                    ? TokenRow_module_css_1.default.borderAmber
                    : TokenRow_module_css_1.default.borderMint))} onClick={function () { return navigate((0, routes_1.tokenPath)(token.address)); }}>
      {/* Icon */}
      <div className={TokenRow_module_css_1.default.iconCell}>
        {token.image ? (<img src={token.image} alt={token.name} className={TokenRow_module_css_1.default.tokenImage}/>) : (<span className={TokenRow_module_css_1.default.tokenEmoji}>{token.emoji}</span>)}
      </div>

      {/* Name + LT pair + graduating badge */}
      <div className={TokenRow_module_css_1.default.nameCell}>
        <div className={TokenRow_module_css_1.default.nameRow}>
          <span className={TokenRow_module_css_1.default.tokenName}>{token.name}</span>
          <span className={(0, format_1.cn)(TokenRow_module_css_1.default.leverageBadge, isShort ? TokenRow_module_css_1.default.leverageShort : TokenRow_module_css_1.default.leverageLong)}>
            {token.leverage}&times;
          </span>
          {isGraduating && (<span className={(0, format_1.cn)(TokenRow_module_css_1.default.gradBadge, isShort ? TokenRow_module_css_1.default.gradBadgeShort : TokenRow_module_css_1.default.gradBadgeLong)}>
              GRAD
            </span>)}
        </div>
        <span className={(0, format_1.cn)(TokenRow_module_css_1.default.ltName, isShort ? TokenRow_module_css_1.default.ltNameShort : TokenRow_module_css_1.default.ltNameLong)}>
          {token.ltName.toUpperCase()}
          {isGraduated && " \u00B7 GRADUATED"}
        </span>
      </div>

      {/* 24h change */}
      <div className={TokenRow_module_css_1.default.changeCell}>
        <span className={(0, format_1.cn)(TokenRow_module_css_1.default.changeValue, up ? TokenRow_module_css_1.default.changeUp : TokenRow_module_css_1.default.changeDown)}>
          {(0, format_1.formatPercent)(token.change24h)}
        </span>
      </div>

      {/* Progress bar */}
      <div className={TokenRow_module_css_1.default.progressCell}>
        <ProgressBar_1.default buyPercent={buyW} leveragePercent={levW} isShort={isShort} isGraduating={isGraduating}/>
      </div>

      {/* MCAP */}
      <div className={TokenRow_module_css_1.default.mcapCell}>
        <span className={TokenRow_module_css_1.default.mcapValue}>{(0, format_1.formatUsd)(token.mcapUsd)}</span>
      </div>
    </div>);
}
