"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TokenTable;
var react_redux_1 = require("react-redux");
var TokenRow_1 = require("./TokenRow");
var TokenTable_module_css_1 = require("./TokenTable.module.css");
var useTokens_1 = require("../../hooks/useTokens");
var uiSlice_1 = require("../../state/uiSlice");
var format_1 = require("../../utils/format");
function ColumnHeader(_a) {
    var direction = _a.direction, count = _a.count;
    var isLong = direction === "long";
    return (<div className={TokenTable_module_css_1.default.columnHeader}>
      <div className={(0, format_1.cn)(TokenTable_module_css_1.default.directionBadge, isLong ? TokenTable_module_css_1.default.directionLong : TokenTable_module_css_1.default.directionShort)}>
        {isLong ? "\u25B2 LONG" : "\u25BC SHORT"}
      </div>
      <div className={TokenTable_module_css_1.default.countCell}>{count} tokens</div>
      <div className={TokenTable_module_css_1.default.sortActive}>TRENDING \u25BE</div>
      <div className={TokenTable_module_css_1.default.sortItem}>NEWEST</div>
      <div className={TokenTable_module_css_1.default.sortItem}>% FILLED</div>
    </div>);
}
function TableHead() {
    return (<div className={TokenTable_module_css_1.default.tableHead}>
      {["", "TOKEN", "24H", "PROGRESS", "MCAP"].map(function (h, i) { return (<div key={h || i} className={(0, format_1.cn)(TokenTable_module_css_1.default.headCell, (i === 2 || i === 4) && TokenTable_module_css_1.default.headCellRight)}>
          {h}
        </div>); })}
    </div>);
}
function TokenTable() {
    var _a, _b;
    var activeFilter = (0, react_redux_1.useSelector)(uiSlice_1.selectActiveFilter);
    var longTokens = (0, useTokens_1.useTokensByDirection)("long", activeFilter).data;
    var shortTokens = (0, useTokens_1.useTokensByDirection)("short", activeFilter).data;
    return (<div className={TokenTable_module_css_1.default.wrapper}>
      {/* LONG column */}
      <div className={TokenTable_module_css_1.default.column}>
        <ColumnHeader direction="long" count={(_a = longTokens === null || longTokens === void 0 ? void 0 : longTokens.length) !== null && _a !== void 0 ? _a : 0}/>
        <TableHead />
        <div className={TokenTable_module_css_1.default.scrollArea}>
          {longTokens === null || longTokens === void 0 ? void 0 : longTokens.map(function (t) { return (<TokenRow_1.default key={t.address} token={t}/>); })}
        </div>
      </div>

      {/* SHORT column */}
      <div className={TokenTable_module_css_1.default.columnShort}>
        <ColumnHeader direction="short" count={(_b = shortTokens === null || shortTokens === void 0 ? void 0 : shortTokens.length) !== null && _b !== void 0 ? _b : 0}/>
        <TableHead />
        <div className={TokenTable_module_css_1.default.scrollArea}>
          {shortTokens === null || shortTokens === void 0 ? void 0 : shortTokens.map(function (t) { return (<TokenRow_1.default key={t.address} token={t}/>); })}
        </div>
      </div>
    </div>);
}
