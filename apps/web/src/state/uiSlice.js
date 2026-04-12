"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectActiveFilter = exports.selectEarningsOpen = exports.selectSearchOpen = exports.setActiveFilter = exports.setEarningsOpen = exports.setSearchOpen = void 0;
var toolkit_1 = require("@reduxjs/toolkit");
var initialState = {
    searchOpen: false,
    earningsOpen: false,
    activeFilter: "trending",
};
var uiSlice = (0, toolkit_1.createSlice)({
    name: "ui",
    initialState: initialState,
    reducers: {
        setSearchOpen: function (state, action) {
            state.searchOpen = action.payload;
        },
        setEarningsOpen: function (state, action) {
            state.earningsOpen = action.payload;
        },
        setActiveFilter: function (state, action) {
            state.activeFilter = action.payload;
        },
    },
});
exports.setSearchOpen = (_a = uiSlice.actions, _a.setSearchOpen), exports.setEarningsOpen = _a.setEarningsOpen, exports.setActiveFilter = _a.setActiveFilter;
var selectSearchOpen = function (state) { return state.ui.searchOpen; };
exports.selectSearchOpen = selectSearchOpen;
var selectEarningsOpen = function (state) { return state.ui.earningsOpen; };
exports.selectEarningsOpen = selectEarningsOpen;
var selectActiveFilter = function (state) { return state.ui.activeFilter; };
exports.selectActiveFilter = selectActiveFilter;
exports.default = uiSlice.reducer;
