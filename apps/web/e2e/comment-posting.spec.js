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
var test_1 = require("@playwright/test");
test_1.test.describe("Comment posting", function () {
    test_1.test.beforeEach(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var firstTokenRow;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: 
                // Navigate to a token detail page
                return [4 /*yield*/, page.goto("/")];
                case 1:
                    // Navigate to a token detail page
                    _c.sent();
                    firstTokenRow = page.locator("tr").filter({ hasText: /\$/ }).first();
                    return [4 /*yield*/, firstTokenRow.click({ timeout: 10000 })];
                case 2:
                    _c.sent();
                    return [4 /*yield*/, page.waitForURL(/\/token\/0x/)];
                case 3:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("displays the comments tab in bottom tabs", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var commentsTab;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    commentsTab = page.locator("button", { hasText: "comments" });
                    return [4 /*yield*/, (0, test_1.expect)(commentsTab).toBeVisible()];
                case 1:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("can switch to the comments tab", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var commentInput;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, page.locator("button", { hasText: "comments" }).click()];
                case 1:
                    _c.sent();
                    commentInput = page.locator('input[placeholder="connect wallet to comment"], input[placeholder="say something…"]');
                    return [4 /*yield*/, (0, test_1.expect)(commentInput).toBeVisible()];
                case 2:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("shows connect wallet placeholder when not connected", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, page.locator("button", { hasText: "comments" }).click()];
                case 1:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator('input[placeholder="connect wallet to comment"]')).toBeVisible()];
                case 2:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("displays post button", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var postBtn;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, page.locator("button", { hasText: "comments" }).click()];
                case 1:
                    _c.sent();
                    postBtn = page.locator("button", { hasText: "post" });
                    return [4 /*yield*/, (0, test_1.expect)(postBtn).toBeVisible()];
                case 2:
                    _c.sent();
                    // Post button should be disabled when input is empty
                    return [4 /*yield*/, (0, test_1.expect)(postBtn).toBeDisabled()];
                case 3:
                    // Post button should be disabled when input is empty
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("can type in comment input", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var commentInput;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, page.locator("button", { hasText: "comments" }).click()];
                case 1:
                    _c.sent();
                    commentInput = page.locator('input[placeholder="connect wallet to comment"], input[placeholder="say something…"]');
                    return [4 /*yield*/, commentInput.fill("Test comment from E2E")];
                case 2:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(commentInput).toHaveValue("Test comment from E2E")];
                case 3:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("shows all three tabs: trades, comments, holders", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "trades" })).toBeVisible()];
                case 1:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "comments" })).toBeVisible()];
                case 2:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "holders" })).toBeVisible()];
                case 3:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("trades tab is active by default", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: 
                // Trades table headers should be visible
                return [4 /*yield*/, (0, test_1.expect)(page.locator("th", { hasText: "Account" })).toBeVisible()];
                case 1:
                    // Trades table headers should be visible
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("th", { hasText: "Type" })).toBeVisible()];
                case 2:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("th", { hasText: "USDC" })).toBeVisible()];
                case 3:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("can switch between tabs", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var commentInput;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: 
                // Switch to comments
                return [4 /*yield*/, page.locator("button", { hasText: "comments" }).click()];
                case 1:
                    // Switch to comments
                    _c.sent();
                    commentInput = page.locator('input[placeholder="connect wallet to comment"], input[placeholder="say something…"]');
                    return [4 /*yield*/, (0, test_1.expect)(commentInput).toBeVisible()];
                case 2:
                    _c.sent();
                    // Switch to holders
                    return [4 /*yield*/, page.locator("button", { hasText: "holders" }).click()];
                case 3:
                    // Switch to holders
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=wallet").first()).toBeVisible()];
                case 4:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=% supply").first()).toBeVisible()];
                case 5:
                    _c.sent();
                    // Switch back to trades
                    return [4 /*yield*/, page.locator("button", { hasText: "trades" }).click()];
                case 6:
                    // Switch back to trades
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("th", { hasText: "Account" })).toBeVisible()];
                case 7:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
});
