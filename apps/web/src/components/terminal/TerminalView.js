"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TerminalView;
var CommandBar_1 = require("./CommandBar");
var RightPanel_1 = require("./RightPanel");
var Sidebar_1 = require("./Sidebar");
var TerminalView_module_css_1 = require("./TerminalView.module.css");
var TokenTable_1 = require("./TokenTable");
var useTokens_1 = require("../../hooks/useTokens");
function TerminalView() {
    var _a;
    var tokens = (0, useTokens_1.useTokens)().data;
    return (<div className={TerminalView_module_css_1.default.wrapper}>
      <Sidebar_1.default />
      <div className={TerminalView_module_css_1.default.mainContent}>
        <CommandBar_1.default tokenCount={(_a = tokens === null || tokens === void 0 ? void 0 : tokens.length) !== null && _a !== void 0 ? _a : 0}/>
        <TokenTable_1.default />
      </div>
      <RightPanel_1.default />
    </div>);
}
