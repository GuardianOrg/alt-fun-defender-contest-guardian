"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var plugin_react_1 = require("@vitejs/plugin-react");
var vite_1 = require("vite");
// https://vite.dev/config/
exports.default = (0, vite_1.defineConfig)({
    plugins: [(0, plugin_react_1.default)()],
});
