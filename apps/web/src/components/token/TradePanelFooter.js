"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TradePanelFooter;
var TradePanel_module_css_1 = require("./TradePanel.module.css");
var useCopyState_1 = require("../../hooks/useCopyState");
var format_1 = require("../../utils/format");
function TradePanelFooter(_a) {
    var token = _a.token;
    var _b = (0, useCopyState_1.useCopyState)(), copied = _b.copied, copyCA = _b.copy;
    return (<div className={TradePanel_module_css_1.default.footer}>
      <div className={TradePanel_module_css_1.default.footerLeft}>
        <a className={TradePanel_module_css_1.default.footerCa} onClick={function () { return copyCA(token.address); }}>
          {copied
            ? "✓ copied"
            : "".concat(token.address.slice(0, 6), "\u2026").concat(token.address.slice(-4))}
        </a>
        <span className={TradePanel_module_css_1.default.footerDot}>·</span>
        <span className={TradePanel_module_css_1.default.footerLt}>{token.ltName}</span>
      </div>
      <span className={(0, format_1.cn)(TradePanel_module_css_1.default.footerStatus, token.status === "graduating"
            ? TradePanel_module_css_1.default.footerStatusGraduating
            : TradePanel_module_css_1.default.footerStatusDefault)}>
        {token.status}
        {token.status === "graduating" ? " ⚡" : ""}
      </span>
    </div>);
}
