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
test_1.test.describe("Token creation flow", function () {
    test_1.test.beforeEach(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, page.goto("/create")];
                case 1:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("displays the create page with all form sections", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, (0, test_1.expect)(page.locator("text=Create an altcoin")).toBeVisible()];
                case 1:
                    _c.sent();
                    // Pair selector: direction cards
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "LONG" })).toBeVisible()];
                case 2:
                    // Pair selector: direction cards
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "SHORT" })).toBeVisible()];
                case 3:
                    _c.sent();
                    // Asset buttons
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "HYPE" })).toBeVisible()];
                case 4:
                    // Asset buttons
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "ETH" })).toBeVisible()];
                case 5:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "BTC" })).toBeVisible()];
                case 6:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "SOL" })).toBeVisible()];
                case 7:
                    _c.sent();
                    // Leverage buttons
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "2×" })).toBeVisible()];
                case 8:
                    // Leverage buttons
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "3×" })).toBeVisible()];
                case 9:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "5×" })).toBeVisible()];
                case 10:
                    _c.sent();
                    // Token form fields
                    return [4 /*yield*/, (0, test_1.expect)(page.locator('input[placeholder="e.g. HYPERBULL"]')).toBeVisible()];
                case 11:
                    // Token form fields
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator('input[placeholder="e.g. HBULL"]')).toBeVisible()];
                case 12:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator('textarea[placeholder="What\'s the vibe?"]')).toBeVisible()];
                case 13:
                    _c.sent();
                    // Image upload zone
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=Click or drag to upload")).toBeVisible()];
                case 14:
                    // Image upload zone
                    _c.sent();
                    // Seed buy section
                    return [4 /*yield*/, (0, test_1.expect)(page.locator('input[placeholder="0.00"][type="number"]')).toBeVisible()];
                case 15:
                    // Seed buy section
                    _c.sent();
                    // Launch button (prompts wallet connect when not connected)
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "CONNECT WALLET TO LAUNCH" })).toBeVisible()];
                case 16:
                    // Launch button (prompts wallet connect when not connected)
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("can select direction, asset, and leverage", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: 
                // Select SHORT direction
                return [4 /*yield*/, page.locator("button", { hasText: "SHORT" }).click()];
                case 1:
                    // Select SHORT direction
                    _c.sent();
                    // Select ETH asset
                    return [4 /*yield*/, page.locator("button", { hasText: "ETH" }).click()];
                case 2:
                    // Select ETH asset
                    _c.sent();
                    // Select 3x leverage
                    return [4 /*yield*/, page.locator("button", { hasText: "3×" }).click()];
                case 3:
                    // Select 3x leverage
                    _c.sent();
                    // Verify summary card updates (shows LT name)
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=ETH3S")).toBeVisible()];
                case 4:
                    // Verify summary card updates (shows LT name)
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("can fill in token name, ticker, and description", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var nameInput, tickerInput, descriptionInput;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    nameInput = page.locator('input[placeholder="e.g. HYPERBULL"]');
                    tickerInput = page.locator('input[placeholder="e.g. HBULL"]');
                    descriptionInput = page.locator('textarea[placeholder="What\'s the vibe?"]');
                    return [4 /*yield*/, nameInput.fill("TestBull")];
                case 1:
                    _c.sent();
                    return [4 /*yield*/, tickerInput.fill("TBULL")];
                case 2:
                    _c.sent();
                    return [4 /*yield*/, descriptionInput.fill("A test token for E2E testing")];
                case 3:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(nameInput).toHaveValue("TestBull")];
                case 4:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(tickerInput).toHaveValue("TBULL")];
                case 5:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(descriptionInput).toHaveValue("A test token for E2E testing")];
                case 6:
                    _c.sent();
                    // Live preview should reflect the name
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=TestBull").first()).toBeVisible()];
                case 7:
                    // Live preview should reflect the name
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("can expand and fill social links", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var twitterInput, telegramInput, websiteInput;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: 
                // Click social links toggle
                return [4 /*yield*/, page
                        .locator("text=Add social links")
                        .click()];
                case 1:
                    // Click social links toggle
                    _c.sent();
                    twitterInput = page.locator('input[placeholder="@handle"]');
                    telegramInput = page.locator('input[placeholder="t.me/..."]');
                    websiteInput = page.locator('input[placeholder="https://..."]');
                    return [4 /*yield*/, (0, test_1.expect)(twitterInput).toBeVisible()];
                case 2:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(telegramInput).toBeVisible()];
                case 3:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(websiteInput).toBeVisible()];
                case 4:
                    _c.sent();
                    return [4 /*yield*/, twitterInput.fill("@testtoken")];
                case 5:
                    _c.sent();
                    return [4 /*yield*/, telegramInput.fill("t.me/testtoken")];
                case 6:
                    _c.sent();
                    return [4 /*yield*/, websiteInput.fill("https://testtoken.com")];
                case 7:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(twitterInput).toHaveValue("@testtoken")];
                case 8:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(telegramInput).toHaveValue("t.me/testtoken")];
                case 9:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(websiteInput).toHaveValue("https://testtoken.com")];
                case 10:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("can set seed buy amount", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var seedInput;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    seedInput = page.locator('input[placeholder="0.00"][type="number"]');
                    return [4 /*yield*/, seedInput.fill("100")];
                case 1:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(seedInput).toHaveValue("100")];
                case 2:
                    _c.sent();
                    // Seed info should appear
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=$100.00 USDC")).toBeVisible()];
                case 3:
                    // Seed info should appear
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("image upload zone accepts file input", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var fileInput;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    fileInput = page.locator('input[type="file"][accept="image/*"]');
                    return [4 /*yield*/, (0, test_1.expect)(fileInput).toBeAttached()];
                case 1:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("launch button shows connect wallet when not connected", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var launchBtn;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    launchBtn = page.locator("button", {
                        hasText: "CONNECT WALLET TO LAUNCH",
                    });
                    return [4 /*yield*/, (0, test_1.expect)(launchBtn).toBeVisible()];
                case 1:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(launchBtn).toBeEnabled()];
                case 2:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
});
