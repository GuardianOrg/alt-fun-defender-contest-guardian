"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SearchTrendingCard;
var react_1 = require("react");
var SearchModal_module_css_1 = require("./SearchModal.module.css");
var colors_1 = require("../../config/colors");
var format_1 = require("../../utils/format");
function normalizePoints(pts) {
    if (pts.length < 2)
        return "1,16 109,16";
    var mn = Math.min.apply(Math, pts);
    var mx = Math.max.apply(Math, pts);
    var norm = pts.map(function (p) { return ((p - mn) / (mx - mn || 1)) * 26 + 3; });
    return norm
        .map(function (y, i) { return "".concat((i / (norm.length - 1)) * 108 + 1, ",").concat(32 - y); })
        .join(" ");
}
function Sparkline(_a) {
    var up = _a.up, data = _a.data;
    var coords = (0, react_1.useMemo)(function () {
        if (data && data.length >= 2) {
            return normalizePoints(data);
        }
        var pts = Array.from({ length: 12 }, function (_, i) { return (up ? i * 2.2 : -i * 2); });
        return normalizePoints(pts);
    }, [up, data]);
    var col = up ? colors_1.COLORS.mint : colors_1.COLORS.red;
    return (<svg width="110" height="32" viewBox="0 0 110 32" preserveAspectRatio="none" className={SearchModal_module_css_1.default.sparkline}>
      <polygon points={"1,32 ".concat(coords, " 109,32")} fill={col} opacity="0.08"/>
      <polyline points={coords} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>);
}
function useIsVisible() {
    var ref = (0, react_1.useRef)(null);
    var _a = (0, react_1.useState)(false), visible = _a[0], setVisible = _a[1];
    (0, react_1.useEffect)(function () {
        var el = ref.current;
        if (!el)
            return;
        var observer = new IntersectionObserver(function (_a) {
            var entry = _a[0];
            if (entry.isIntersecting) {
                setVisible(true);
                observer.disconnect();
            }
        }, { threshold: 0 });
        observer.observe(el);
        return function () { return observer.disconnect(); };
    }, []);
    return { ref: ref, visible: visible };
}
function SearchTrendingCard(_a) {
    var token = _a.token, sparklineData = _a.sparklineData, onClick = _a.onClick, highlighted = _a.highlighted, onMouseEnter = _a.onMouseEnter;
    var cardRef = (0, react_1.useRef)(null);
    var up = token.change24h >= 0;
    var _b = useIsVisible(), visibilityRef = _b.ref, visible = _b.visible;
    (0, react_1.useEffect)(function () {
        if (highlighted && cardRef.current) {
            cardRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
    }, [highlighted]);
    var handleKeyDown = function (e) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
        }
    };
    return (<div ref={function (el) {
            cardRef.current = el;
            visibilityRef.current = el;
        }} className={(0, format_1.cn)(SearchModal_module_css_1.default.trendingCard, highlighted && SearchModal_module_css_1.default.trendingCardHighlighted)} role="button" tabIndex={0} onClick={onClick} onKeyDown={handleKeyDown} onMouseEnter={onMouseEnter} aria-label={"".concat(token.name, " \u2014 ").concat(token.ltName)}>
      <div className={SearchModal_module_css_1.default.trendingCardHeader}>
        <div className={SearchModal_module_css_1.default.trendingCardIcon}>
          {token.image ? (<img src={token.image} alt={token.name} className={SearchModal_module_css_1.default.trendingCardImg}/>) : (token.emoji)}
        </div>
        <div>
          <div className={SearchModal_module_css_1.default.trendingCardName}>{token.name}</div>
          <div className={SearchModal_module_css_1.default.trendingCardLtName}>{token.ltName}</div>
        </div>
      </div>
      <Sparkline up={up} data={visible ? sparklineData : undefined}/>
      <div className={SearchModal_module_css_1.default.trendingCardMcap}>
        $
        {token.mcapUsd >= 1000000
            ? "".concat((token.mcapUsd / 1000000).toFixed(2), "M")
            : "".concat((token.mcapUsd / 1000).toFixed(1), "K")}
      </div>
      <div className={(0, format_1.cn)(SearchModal_module_css_1.default.trendingCardChange, up ? SearchModal_module_css_1.default.changeUp : SearchModal_module_css_1.default.changeDown)}>
        {up ? "+" : ""}
        {token.change24h}%
      </div>
    </div>);
}
