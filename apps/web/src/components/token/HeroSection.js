"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = HeroSection;
var HeroSection_module_css_1 = require("./HeroSection.module.css");
var useCopyState_1 = require("../../hooks/useCopyState");
var format_1 = require("../../utils/format");
function HeroSection(_a) {
    var _b, _c, _d;
    var token = _a.token;
    var _e = (0, useCopyState_1.useCopyState)(), copied = _e.copied, copyCA = _e.copy;
    var up = token.change24h >= 0;
    var shareToken = function () {
        var text = "".concat(token.emoji, " ").concat(token.name, " \u00B7 ").concat((0, format_1.formatPercent)(token.change24h), " today\n").concat(token.ltName, " \u2014 leveraged tokens");
        (0, format_1.copyToClipboard)(text);
    };
    return (<div className={HeroSection_module_css_1.default.wrapper}>
      <div className={HeroSection_module_css_1.default.avatar}>
        {token.image ? (<img src={token.image} alt={token.name} className={HeroSection_module_css_1.default.avatarImage}/>) : (token.emoji)}
      </div>

      <div className={HeroSection_module_css_1.default.nameBlock}>
        <div className={HeroSection_module_css_1.default.nameRow}>
          <div className={HeroSection_module_css_1.default.tokenName}>{token.name}</div>
          <span className={HeroSection_module_css_1.default.ltBadge}>⚡ {token.ltName}</span>
        </div>
        <div className={HeroSection_module_css_1.default.metaRow}>
          <span className={HeroSection_module_css_1.default.creatorLabel}>by {token.creatorAddress}</span>
          <div className={HeroSection_module_css_1.default.socialLinks}>
            {((_b = token.socialLinks) === null || _b === void 0 ? void 0 : _b.twitter) && (<a href={token.socialLinks.twitter.startsWith("http")
                ? token.socialLinks.twitter
                : "https://x.com/".concat(token.socialLinks.twitter.replace(/^@/, ""))} target="_blank" rel="noopener noreferrer" className={HeroSection_module_css_1.default.socialLink}>
                𝕏
              </a>)}
            {((_c = token.socialLinks) === null || _c === void 0 ? void 0 : _c.telegram) && (<a href={token.socialLinks.telegram.startsWith("http")
                ? token.socialLinks.telegram
                : "https://".concat(token.socialLinks.telegram)} target="_blank" rel="noopener noreferrer" className={HeroSection_module_css_1.default.socialLink}>
                TG
              </a>)}
            {((_d = token.socialLinks) === null || _d === void 0 ? void 0 : _d.website) && (<a href={token.socialLinks.website.startsWith("http")
                ? token.socialLinks.website
                : "https://".concat(token.socialLinks.website)} target="_blank" rel="noopener noreferrer" className={HeroSection_module_css_1.default.socialLink}>
                🌐
              </a>)}
          </div>
          <div className={HeroSection_module_css_1.default.caBlock} onClick={function () { return copyCA(token.address); }}>
            <span className={(0, format_1.cn)(HeroSection_module_css_1.default.caText, copied ? HeroSection_module_css_1.default.caTextCopied : HeroSection_module_css_1.default.caTextDefault)}>
              {copied
            ? "✓"
            : "".concat(token.address.slice(0, 4), "\u2026").concat(token.address.slice(-3), " \u2398")}
            </span>
          </div>
        </div>
      </div>

      <div className={HeroSection_module_css_1.default.divider}/>

      <div className={HeroSection_module_css_1.default.mcapBlock}>
        <div className={HeroSection_module_css_1.default.mcapValue}>{(0, format_1.formatUsd)(token.mcapUsd)}</div>
        <div className={HeroSection_module_css_1.default.changeRow}>
          <span className={(0, format_1.cn)(HeroSection_module_css_1.default.changeValue, up ? HeroSection_module_css_1.default.changeUp : HeroSection_module_css_1.default.changeDown)}>
            {(0, format_1.formatPercent)(token.change24h)}
          </span>
          <span className={HeroSection_module_css_1.default.changePeriod}>24h</span>
        </div>
      </div>

      <div className={HeroSection_module_css_1.default.divider}/>

      <div className={HeroSection_module_css_1.default.statsRow}>
        <span className={HeroSection_module_css_1.default.statValue}>
          Vol{" "}
          <span className={HeroSection_module_css_1.default.statHighlight}>
            {(0, format_1.formatUsd)(token.volume24h)}
          </span>
        </span>
        <span>
          Curve{" "}
          <span className={HeroSection_module_css_1.default.statHighlight}>{token.curveFilled}%</span>
        </span>
        <span>
          Lev <span className={HeroSection_module_css_1.default.statAmber}>{token.leverage}×</span>
        </span>
      </div>

      <div className={HeroSection_module_css_1.default.shareWrapper}>
        <button className={HeroSection_module_css_1.default.shareBtn} onClick={shareToken}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
          Share
        </button>
      </div>
    </div>);
}
