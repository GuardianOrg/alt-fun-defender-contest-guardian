"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SearchModal;
var SearchModal_module_css_1 = require("./SearchModal.module.css");
var SearchResultsList_1 = require("./SearchResultsList");
var SearchTrendingCard_1 = require("./SearchTrendingCard");
var useSearchModal_1 = require("../../hooks/useSearchModal");
var ModalOverlay_1 = require("../shared/ModalOverlay");
function SearchModal() {
    var _a = (0, useSearchModal_1.useSearchModal)(), open = _a.open, query = _a.query, setQuery = _a.setQuery, inputRef = _a.inputRef, trendingTokens = _a.trendingTokens, sparklineMap = _a.sparklineMap, filtered = _a.filtered, goToToken = _a.goToToken, close = _a.close;
    if (!open)
        return null;
    return (<ModalOverlay_1.default onClose={close}>
      <div className={SearchModal_module_css_1.default.modal}>
        <div className={SearchModal_module_css_1.default.searchBar}>
          <span className={SearchModal_module_css_1.default.searchIcon}>&#x2315;</span>
          <input ref={inputRef} className={SearchModal_module_css_1.default.searchInput} placeholder="Search tokens, tickers\u2026" value={query} onChange={function (e) { return setQuery(e.target.value); }} autoComplete="off"/>
          <span className={SearchModal_module_css_1.default.escBadge} onClick={close}>
            esc
          </span>
        </div>

        {!filtered ? (<div className={SearchModal_module_css_1.default.defaultContent}>
            <div className={SearchModal_module_css_1.default.sectionLabel}>TRENDING</div>
            <div className={SearchModal_module_css_1.default.trendingRow}>
              {trendingTokens.map(function (t) { return (<SearchTrendingCard_1.default key={t.address} token={t} sparklineData={sparklineMap.get(t.address)} onClick={function () { return goToToken(t.address); }}/>); })}
            </div>
            <div className={SearchModal_module_css_1.default.recentLabel}>RECENTLY VIEWED</div>
            <div className={SearchModal_module_css_1.default.recentText}>No recently viewed tokens</div>
            <div className={SearchModal_module_css_1.default.shortcuts}>
              <span className={SearchModal_module_css_1.default.shortcutItem}>
                <kbd className={SearchModal_module_css_1.default.kbd}>&#x21B5;</kbd>
                select
              </span>
              <span className={SearchModal_module_css_1.default.shortcutItem}>
                <kbd className={SearchModal_module_css_1.default.kbd}>esc</kbd>
                close
              </span>
            </div>
          </div>) : (<SearchResultsList_1.default results={filtered} onSelect={goToToken}/>)}
      </div>
    </ModalOverlay_1.default>);
}
