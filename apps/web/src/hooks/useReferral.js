"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useReferral = useReferral;
var react_1 = require("react");
var viem_1 = require("viem");
var REFERRAL_KEY = "launchpad_referrer";
function useReferral() {
    var _a = (0, react_1.useState)(function () {
        var stored = sessionStorage.getItem(REFERRAL_KEY);
        return stored && (0, viem_1.isAddress)(stored) ? stored : undefined;
    }), referral = _a[0], setReferral = _a[1];
    (0, react_1.useEffect)(function () {
        var params = new URLSearchParams(window.location.search);
        var ref = params.get("ref");
        if (ref && (0, viem_1.isAddress)(ref)) {
            sessionStorage.setItem(REFERRAL_KEY, ref);
            setReferral(ref);
            return;
        }
        var stored = sessionStorage.getItem(REFERRAL_KEY);
        setReferral(stored && (0, viem_1.isAddress)(stored) ? stored : undefined);
    }, []);
    return referral;
}
