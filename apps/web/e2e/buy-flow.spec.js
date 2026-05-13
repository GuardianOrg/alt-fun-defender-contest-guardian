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
test_1.test.describe("Buy flow", function () {
    test_1.test.beforeEach(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var firstTokenRow;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: 
                // Navigate to a token detail page (uses first token from list)
                return [4 /*yield*/, page.goto("/")];
                case 1:
                    // Navigate to a token detail page (uses first token from list)
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
    (0, test_1.test)("displays the trade panel with BUY mode active by default", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var buyBtn, amountInput;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    buyBtn = page.locator("button", { hasText: "BUY" }).first();
                    return [4 /*yield*/, (0, test_1.expect)(buyBtn).toBeVisible()];
                case 1:
                    _c.sent();
                    amountInput = page.locator('input[type="number"][placeholder="0.00"]');
                    return [4 /*yield*/, (0, test_1.expect)(amountInput).toBeVisible()];
                case 2:
                    _c.sent();
                    // USDC denomination label should show
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=USDC").first()).toBeVisible()];
                case 3:
                    // USDC denomination label should show
                    _c.sent();
                    // Connect wallet button should show when not connected
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "CONNECT WALLET" })).toBeVisible()];
                case 4:
                    // Connect wallet button should show when not connected
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("can enter buy amount and see quote estimate", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var amountInput;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    amountInput = page.locator('input[type="number"][placeholder="0.00"]');
                    return [4 /*yield*/, amountInput.fill("100")];
                case 1:
                    _c.sent();
                    // Wait for quote to appear (debounced by 300ms)
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=You receive ≈")).toBeVisible({
                            timeout: 5000,
                        })];
                case 2:
                    // Wait for quote to appear (debounced by 300ms)
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("quick amount buttons set the input value", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var amountInput;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    amountInput = page.locator('input[type="number"][placeholder="0.00"]');
                    // Click the 100 quick amount button
                    return [4 /*yield*/, page.locator("button", { hasText: /^100$/ }).click()];
                case 1:
                    // Click the 100 quick amount button
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(amountInput).toHaveValue("100")];
                case 2:
                    _c.sent();
                    // Click the 500 quick amount button
                    return [4 /*yield*/, page.locator("button", { hasText: /^500$/ }).click()];
                case 3:
                    // Click the 500 quick amount button
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(amountInput).toHaveValue("500")];
                case 4:
                    _c.sent();
                    // Click the 1K quick amount button
                    return [4 /*yield*/, page.locator("button", { hasText: "1K" }).click()];
                case 5:
                    // Click the 1K quick amount button
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(amountInput).toHaveValue("1000")];
                case 6:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("reset button clears the input", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var amountInput;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    amountInput = page.locator('input[type="number"][placeholder="0.00"]');
                    return [4 /*yield*/, amountInput.fill("500")];
                case 1:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(amountInput).toHaveValue("500")];
                case 2:
                    _c.sent();
                    return [4 /*yield*/, page.locator("button", { hasText: "Reset" }).click()];
                case 3:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(amountInput).toHaveValue("")];
                case 4:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("shows minimum trade error for amounts below minimum", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var amountInput;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    amountInput = page.locator('input[type="number"][placeholder="0.00"]');
                    return [4 /*yield*/, amountInput.fill("5")];
                case 1:
                    _c.sent();
                    // Should show minimum trade error
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=Minimum trade")).toBeVisible({
                            timeout: 5000,
                        })];
                case 2:
                    // Should show minimum trade error
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("shows denomination as USDC in buy mode", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, (0, test_1.expect)(page.locator("text=Amount in USDC")).toBeVisible()];
                case 1:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("can open settings popup", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var gearBtn;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    gearBtn = page.locator("button").filter({ has: page.locator("svg circle") });
                    return [4 /*yield*/, gearBtn.click()];
                case 1:
                    _c.sent();
                    // Slippage options should appear
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=Slippage")).toBeVisible()];
                case 2:
                    // Slippage options should appear
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
});
