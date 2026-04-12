"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SearchResultsList;
var react_1 = require("react");
var SearchModal_module_css_1 = require("./SearchModal.module.css");
var format_1 = require("../../utils/format");
function SearchResultsList(_a) {
    var results = _a.results, onSelect = _a.onSelect, highlightedIndex = _a.highlightedIndex, onHighlight = _a.onHighlight;
    var listRef = (0, react_1.useRef)(null);
    (0, react_1.useEffect)(function () {
        if (highlightedIndex < 0 || !listRef.current)
            return;
        var items = listRef.current.querySelectorAll("[data-result-index]");
        var target = items[highlightedIndex];
        if (target) {
            target.scrollIntoView({ block: "nearest" });
        }
    }, [highlightedIndex]);
    return (<div className={SearchModal_module_css_1.default.resultsWrap} ref={listRef}>
      {results.length > 0 ? (results.map(function (t, i) { return (<div key={t.address} data-result-index={i} className={(0, format_1.cn)(SearchModal_module_css_1.default.resultRow, i === highlightedIndex && SearchModal_module_css_1.default.resultRowHighlighted)} onClick={function () { return onSelect(t.address); }} onMouseEnter={function () { return onHighlight(i); }}>
            <div className={SearchModal_module_css_1.default.resultIcon}>{t.emoji}</div>
            <div>
              <div className={SearchModal_module_css_1.default.resultName}>{t.name}</div>
              <div className={SearchModal_module_css_1.default.resultLtName}>{t.ltName}</div>
            </div>
            <div className={SearchModal_module_css_1.default.resultRight}>
              <div className={(0, format_1.cn)(SearchModal_module_css_1.default.resultChange, t.change24h >= 0 ? SearchModal_module_css_1.default.changeUp : SearchModal_module_css_1.default.changeDown)}>
                {t.change24h >= 0 ? "+" : ""}
                {t.change24h}%
              </div>
              <div className={SearchModal_module_css_1.default.resultMcap}>
                $
                {t.mcapUsd >= 1000000
                ? "".concat((t.mcapUsd / 1000000).toFixed(2), "M")
                : "".concat((t.mcapUsd / 1000).toFixed(1), "K")}
              </div>
            </div>
          </div>); })) : (<div className={SearchModal_module_css_1.default.noResults}>No tokens found</div>)}
    </div>);
}
