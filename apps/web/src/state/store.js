"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.store = void 0;
var toolkit_1 = require("@reduxjs/toolkit");
var uiSlice_1 = require("./uiSlice");
exports.store = (0, toolkit_1.configureStore)({
    reducer: {
        ui: uiSlice_1.default,
    },
});
