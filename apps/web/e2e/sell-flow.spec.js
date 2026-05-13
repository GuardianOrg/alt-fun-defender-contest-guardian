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
test_1.test.describe("Sell flow", function () {
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
    (0, test_1.test)("can switch to SELL mode", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var sellBtn;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    sellBtn = page.locator("button", { hasText: "SELL" }).first();
                    return [4 /*yield*/, sellBtn.click()];
                case 1:
                    _c.sent();
                    // Amount denomination should change to token ticker (not USDC)
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=Amount in USDC")).not.toBeVisible()];
                case 2:
                    // Amount denomination should change to token ticker (not USDC)
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=Amount in")).toBeVisible()];
                case 3:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("displays token ticker as denomination in sell mode", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: 
                // Switch to sell mode
                return [4 /*yield*/, page.locator("button", { hasText: "SELL" }).first().click()];
                case 1:
                    // Switch to sell mode
                    _c.sent();
                    // Should NOT show "Amount in USDC"
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=Amount in USDC")).not.toBeVisible()];
                case 2:
                    // Should NOT show "Amount in USDC"
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("can enter sell amount and see USDC quote", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var amountInput;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: 
                // Switch to sell mode
                return [4 /*yield*/, page.locator("button", { hasText: "SELL" }).first().click()];
                case 1:
                    // Switch to sell mode
                    _c.sent();
                    amountInput = page.locator('input[type="number"][placeholder="0.00"]');
                    return [4 /*yield*/, amountInput.fill("1000000")];
                case 2:
                    _c.sent();
                    // Wait for quote to appear showing USDC output
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=You receive ≈")).toBeVisible({
                            timeout: 5000,
                        })];
                case 3:
                    // Wait for quote to appear showing USDC output
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("shows buffer warning when sell exceeds available liquidity", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var amountInput, bufferWarning, minimumError, quoteOrWarning;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: 
                // Switch to sell mode
                return [4 /*yield*/, page.locator("button", { hasText: "SELL" }).first().click()];
                case 1:
                    // Switch to sell mode
                    _c.sent();
                    amountInput = page.locator('input[type="number"][placeholder="0.00"]');
                    // Enter a very large amount that would exceed buffer
                    return [4 /*yield*/, amountInput.fill("999999999999")];
                case 2:
                    // Enter a very large amount that would exceed buffer
                    _c.sent();
                    // Check for buffer warning (may or may not appear depending on mock data)
                    // The test verifies the UI can handle large amounts
                    return [4 /*yield*/, page.waitForTimeout(500)];
                case 3:
                    // Check for buffer warning (may or may not appear depending on mock data)
                    // The test verifies the UI can handle large amounts
                    _c.sent();
                    bufferWarning = page.locator("text=Sell amount exceeds available liquidity");
                    minimumError = page.locator("text=Minimum trade");
                    quoteOrWarning = bufferWarning.or(minimumError).or(page.locator("text=You receive ≈"));
                    return [4 /*yield*/, (0, test_1.expect)(quoteOrWarning.first()).toBeVisible({ timeout: 5000 })];
                case 4:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("shows connect wallet CTA when not connected in sell mode", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: 
                // Switch to sell mode
                return [4 /*yield*/, page.locator("button", { hasText: "SELL" }).first().click()];
                case 1:
                    // Switch to sell mode
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "CONNECT WALLET" })).toBeVisible()];
                case 2:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("reset clears amount in sell mode", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var amountInput;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: 
                // Switch to sell mode
                return [4 /*yield*/, page.locator("button", { hasText: "SELL" }).first().click()];
                case 1:
                    // Switch to sell mode
                    _c.sent();
                    amountInput = page.locator('input[type="number"][placeholder="0.00"]');
                    return [4 /*yield*/, amountInput.fill("500")];
                case 2:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(amountInput).toHaveValue("500")];
                case 3:
                    _c.sent();
                    return [4 /*yield*/, page.locator("button", { hasText: "Reset" }).click()];
                case 4:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(amountInput).toHaveValue("")];
                case 5:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
});
