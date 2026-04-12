"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = CommandBar;
var react_redux_1 = require("react-redux");
var CommandBar_module_css_1 = require("./CommandBar.module.css");
var uiSlice_1 = require("../../state/uiSlice");
var format_1 = require("../../utils/format");
var TABS = [
    { label: "TRENDING", filter: "trending" },
    { label: "NEW", filter: "new" },
    { label: "\u26A1 LT MOVERS", filter: "lt-movers" },
    { label: "GRADUATING", filter: "graduating" },
    { label: "GRADUATED", filter: "graduated" },
    { label: "ALL", filter: "all" },
];
function CommandBar(_a) {
    var tokenCount = _a.tokenCount;
    var activeFilter = (0, react_redux_1.useSelector)(uiSlice_1.selectActiveFilter);
    var dispatch = (0, react_redux_1.useDispatch)();
    return (<div className={CommandBar_module_css_1.default.bar}>
      <span className={CommandBar_module_css_1.default.viewLabel}>VIEW</span>
      {TABS.map(function (tab) { return (<button key={tab.filter} className={(0, format_1.cn)(CommandBar_module_css_1.default.tab, activeFilter === tab.filter && CommandBar_module_css_1.default.tabActive)} onClick={function () { return dispatch((0, uiSlice_1.setActiveFilter)(tab.filter)); }}>
          {tab.label}
          {activeFilter === tab.filter && <span className={CommandBar_module_css_1.default.indicator}/>}
        </button>); })}
      <div className={CommandBar_module_css_1.default.liveSection}>
        <div className={CommandBar_module_css_1.default.liveDot}/>
        <span className={CommandBar_module_css_1.default.liveText}>{tokenCount} tokens live</span>
      </div>
    </div>);
}
