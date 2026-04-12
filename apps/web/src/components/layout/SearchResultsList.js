"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SearchResultsList;
var SearchModal_module_css_1 = require("./SearchModal.module.css");
var format_1 = require("../../utils/format");
function SearchResultsList(_a) {
    var results = _a.results, onSelect = _a.onSelect;
    return (<div className={SearchModal_module_css_1.default.resultsWrap}>
      {results.length > 0 ? (results.map(function (t) { return (<div key={t.address} className={SearchModal_module_css_1.default.resultRow} onClick={function () { return onSelect(t.address); }}>
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
