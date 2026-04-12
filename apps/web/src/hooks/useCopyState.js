"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useCopyState = useCopyState;
var react_1 = require("react");
var format_1 = require("../utils/format");
function useCopyState(timeout) {
    if (timeout === void 0) { timeout = 2000; }
    var _a = (0, react_1.useState)(false), copied = _a[0], setCopied = _a[1];
    var timerRef = (0, react_1.useRef)(undefined);
    var copy = (0, react_1.useCallback)(function (text) {
        (0, format_1.copyToClipboard)(text);
        setCopied(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(function () { return setCopied(false); }, timeout);
    }, [timeout]);
    return { copied: copied, copy: copy };
}
