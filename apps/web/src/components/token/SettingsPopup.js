"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SettingsPopup;
var react_1 = require("react");
var TradePanel_module_css_1 = require("./TradePanel.module.css");
var constants_1 = require("../../config/constants");
var format_1 = require("../../utils/format");
function SettingsPopup(_a) {
    var slippage = _a.slippage, onSlippageChange = _a.onSlippageChange, onClose = _a.onClose;
    var ref = (0, react_1.useRef)(null);
    var _b = (0, react_1.useState)(String(slippage * 100)), custom = _b[0], setCustom = _b[1];
    (0, react_1.useEffect)(function () {
        var handler = function (e) {
            if (ref.current && !ref.current.contains(e.target))
                onClose();
        };
        document.addEventListener("mousedown", handler);
        return function () { return document.removeEventListener("mousedown", handler); };
    }, [onClose]);
    var presets = constants_1.SLIPPAGE_OPTIONS.map(function (s) { return s * 100; });
    var applyCustom = function (val) {
        setCustom(val);
        var n = parseFloat(val);
        if (!isNaN(n) && n > 0 && n <= 50) {
            onSlippageChange(n / 100);
        }
    };
    return (<div ref={ref} className={TradePanel_module_css_1.default.settingsPopup}>
      <div className={TradePanel_module_css_1.default.settingsHeader}>
        <span className={TradePanel_module_css_1.default.settingsTitle}>Settings</span>
        <button className={TradePanel_module_css_1.default.settingsCloseBtn} onClick={onClose}>
          [Close]
        </button>
      </div>

      <div>
        <div className={TradePanel_module_css_1.default.slippageLabel}>Max slippage (%)</div>
        <div className={TradePanel_module_css_1.default.slippageInputWrap}>
          <input className={TradePanel_module_css_1.default.slippageInput} type="number" value={custom} onChange={function (e) { return applyCustom(e.target.value); }} min="0.1" max="50" step="0.1"/>
          <span className={TradePanel_module_css_1.default.percentSign}>%</span>
        </div>
        <div className={TradePanel_module_css_1.default.slippageHint}>
          Maximum price change you&apos;re willing to accept when placing
          trades.
        </div>
        <div className={TradePanel_module_css_1.default.presetRow}>
          {presets.map(function (p) { return (<button key={p} className={(0, format_1.cn)(TradePanel_module_css_1.default.presetBtn, slippage === p / 100 && TradePanel_module_css_1.default.presetBtnActive)} onClick={function () {
                onSlippageChange(p / 100);
                setCustom(String(p));
            }}>
              {p}%
            </button>); })}
        </div>
      </div>
    </div>);
}
