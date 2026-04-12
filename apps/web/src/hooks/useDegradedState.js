"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = useDegradedState;
var react_1 = require("react");
var api_1 = require("../services/api");
/**
 * Hook that tracks whether the API is returning degraded data
 * (i.e., the Ponder indexer is unavailable).
 * Listens for custom events dispatched by the API fetch layer.
 */
function useDegradedState() {
    var _a = (0, react_1.useState)(false), degraded = _a[0], setDegraded = _a[1];
    (0, react_1.useEffect)(function () {
        var handler = function (e) {
            var detail = e.detail;
            setDegraded(detail.degraded);
        };
        window.addEventListener(api_1.DEGRADED_EVENT, handler);
        return function () { return window.removeEventListener(api_1.DEGRADED_EVENT, handler); };
    }, []);
    return degraded;
}
