"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLORS = void 0;
exports.rgba = rgba;
exports.COLORS = {
    mint: "#4de8b4",
    red: "#f05050",
    amber: "#f0b429",
    text: "#eafaf4",
};
function rgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return "rgba(".concat(r, ",").concat(g, ",").concat(b, ",").concat(alpha, ")");
}
