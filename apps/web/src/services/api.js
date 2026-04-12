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
exports.API_BASE = void 0;
exports.fetchTokens = fetchTokens;
exports.fetchToken = fetchToken;
exports.searchTokens = searchTokens;
exports.createTokenApi = createTokenApi;
exports.fetchComments = fetchComments;
exports.postComment = postComment;
exports.uploadImage = uploadImage;
exports.fetchOhlcv = fetchOhlcv;
exports.fetchHolders = fetchHolders;
exports.fetchLeveragedTokens = fetchLeveragedTokens;
var shared_1 = require("@launchpad/shared");
exports.API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8787";
function apiFetch(path, init) {
    return __awaiter(this, void 0, void 0, function () {
        var res, json;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, fetch("".concat(exports.API_BASE).concat(path), init)];
                case 1:
                    res = _b.sent();
                    return [4 /*yield*/, res.json()];
                case 2:
                    json = (_b.sent());
                    if (json.status === "error" || json.data === null) {
                        throw new Error((_a = json.error) !== null && _a !== void 0 ? _a : "API error");
                    }
                    return [2 /*return*/, json.data];
            }
        });
    });
}
function fetchTokens(limit, offset) {
    if (limit === void 0) { limit = 50; }
    if (offset === void 0) { offset = 0; }
    return apiFetch("/api/v1/tokens?limit=".concat(limit, "&offset=").concat(offset));
}
function fetchToken(address) {
    return apiFetch("/api/v1/tokens/".concat(address));
}
function searchTokens(query) {
    return apiFetch("/api/v1/tokens/search?q=".concat(encodeURIComponent(query)));
}
function createTokenApi(data) {
    return apiFetch("/api/v1/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
}
function fetchComments(tokenAddress, limit, offset) {
    if (limit === void 0) { limit = 50; }
    if (offset === void 0) { offset = 0; }
    return apiFetch("/api/v1/tokens/".concat(tokenAddress, "/comments?limit=").concat(limit, "&offset=").concat(offset));
}
function postComment(tokenAddress, author, content, signature, timestamp) {
    return apiFetch("/api/v1/tokens/".concat(tokenAddress, "/comments"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: author, content: content, signature: signature, timestamp: timestamp }),
    });
}
function uploadImage(file) {
    var formData = new FormData();
    formData.append("file", file);
    return apiFetch("/api/v1/images", {
        method: "POST",
        body: formData,
    });
}
function fetchOhlcv(address, interval) {
    if (interval === void 0) { interval = "1h"; }
    return apiFetch("/api/v1/trades/ohlcv/".concat(address, "?interval=").concat(interval));
}
function fetchHolders(address, limit) {
    if (limit === void 0) { limit = 20; }
    return apiFetch("/api/v1/holders/".concat(address, "?limit=").concat(limit));
}
// BounceTech Indexing API helpers
function bounceTechFetch(path, init) {
    return __awaiter(this, void 0, void 0, function () {
        var res;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, fetch("".concat(shared_1.BOUNCE_INDEXING_API).concat(path), init)];
                case 1:
                    res = _a.sent();
                    if (!res.ok) {
                        throw new Error("BounceTech API error: ".concat(res.status, " ").concat(res.statusText));
                    }
                    return [4 /*yield*/, res.json()];
                case 2: return [2 /*return*/, (_a.sent())];
            }
        });
    });
}
function fetchLeveragedTokens() {
    return bounceTechFetch("/leveraged-tokens");
}
