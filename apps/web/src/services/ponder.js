"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPonderTokens = fetchPonderTokens;
exports.fetchPonderToken = fetchPonderToken;
exports.fetchPonderTrades = fetchPonderTrades;
var PONDER_URL = import.meta.env.VITE_PONDER_URL || "http://localhost:42069";
function ponderQuery(query, variables) {
    return __awaiter(this, void 0, void 0, function () {
        var res, json;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, fetch(PONDER_URL, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ query: query, variables: variables }),
                    })];
                case 1:
                    res = _b.sent();
                    if (!res.ok) {
                        throw new Error("Ponder query failed: ".concat(res.status));
                    }
                    return [4 /*yield*/, res.json()];
                case 2:
                    json = (_b.sent());
                    if ((_a = json.errors) === null || _a === void 0 ? void 0 : _a.length) {
                        throw new Error(json.errors[0].message);
                    }
                    return [2 /*return*/, json.data];
            }
        });
    });
}
function fetchPonderTokens() {
    return __awaiter(this, arguments, void 0, function (limit) {
        var data;
        if (limit === void 0) { limit = 50; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, ponderQuery("query($limit: Int!) {\n      tokens(limit: $limit, orderBy: \"timestamp\", orderDirection: \"desc\") {\n        items {\n          address name symbol creator ltToken k\n          curveSupply ltReserve graduated graduatedAt\n          pairAddress blockNumber timestamp\n        }\n      }\n    }", { limit: limit })];
                case 1:
                    data = _a.sent();
                    return [2 /*return*/, data.tokens.items];
            }
        });
    });
}
function fetchPonderToken(address) {
    return __awaiter(this, void 0, void 0, function () {
        var data;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, ponderQuery("query($address: String!) {\n      token(address: $address) {\n        address name symbol creator ltToken k\n        curveSupply ltReserve graduated graduatedAt\n        pairAddress blockNumber timestamp\n      }\n    }", { address: address })];
                case 1:
                    data = _a.sent();
                    return [2 /*return*/, data.token];
            }
        });
    });
}
function fetchPonderTrades(tokenAddress_1) {
    return __awaiter(this, arguments, void 0, function (tokenAddress, limit) {
        var data_1, data;
        if (limit === void 0) { limit = 50; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!tokenAddress) return [3 /*break*/, 2];
                    return [4 /*yield*/, ponderQuery("query($tokenAddress: String!, $limit: Int!) {\n        trades(\n          where: { tokenAddress: $tokenAddress }\n          limit: $limit\n          orderBy: \"timestamp\"\n          orderDirection: \"desc\"\n        ) {\n          items {\n            id tokenAddress trader isBuy ltAmount tokenAmount\n            curveSupply ltReserve blockNumber timestamp\n          }\n        }\n      }", { tokenAddress: tokenAddress, limit: limit })];
                case 1:
                    data_1 = _a.sent();
                    return [2 /*return*/, data_1.trades.items];
                case 2: return [4 /*yield*/, ponderQuery("query($limit: Int!) {\n      trades(limit: $limit, orderBy: \"timestamp\", orderDirection: \"desc\") {\n        items {\n          id tokenAddress trader isBuy ltAmount tokenAmount\n          curveSupply ltReserve blockNumber timestamp\n        }\n      }\n    }", { limit: limit })];
                case 3:
                    data = _a.sent();
                    return [2 /*return*/, data.trades.items];
            }
        });
    });
}
