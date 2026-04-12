"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREATE_PATH = exports.tokenPath = exports.CREATE_ROUTE = exports.TOKEN_ROUTE = exports.HOME_ROUTE = void 0;
exports.HOME_ROUTE = "/";
exports.TOKEN_ROUTE = "token/:address";
exports.CREATE_ROUTE = "create";
var tokenPath = function (address) { return "/token/".concat(address); };
exports.tokenPath = tokenPath;
exports.CREATE_PATH = "/".concat(exports.CREATE_ROUTE);
