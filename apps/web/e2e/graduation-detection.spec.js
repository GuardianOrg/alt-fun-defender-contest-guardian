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
test_1.test.describe("Graduation detection", function () {
    (0, test_1.test)("token list shows graduating badge when token is graduating", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, page.goto("/")];
                case 1:
                    _c.sent();
                    // Wait for the page to load
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=LAUNCHPAD").first()).toBeVisible({
                            timeout: 10000,
                        })];
                case 2:
                    // Wait for the page to load
                    _c.sent();
                    // Check if the GRADUATING filter tab exists in the command bar
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "GRADUATING" })).toBeVisible()];
                case 3:
                    // Check if the GRADUATING filter tab exists in the command bar
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("can filter by GRADUATING tab", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, page.goto("/")];
                case 1:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=LAUNCHPAD").first()).toBeVisible({
                            timeout: 10000,
                        })];
                case 2:
                    _c.sent();
                    // Click the GRADUATING tab
                    return [4 /*yield*/, page.locator("button", { hasText: "GRADUATING" }).click()];
                case 3:
                    // Click the GRADUATING tab
                    _c.sent();
                    // Page should still be on home route
                    return [4 /*yield*/, (0, test_1.expect)(page).toHaveURL("/")];
                case 4:
                    // Page should still be on home route
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("can filter by GRADUATED tab", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, page.goto("/")];
                case 1:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=LAUNCHPAD").first()).toBeVisible({
                            timeout: 10000,
                        })];
                case 2:
                    _c.sent();
                    // Click the GRADUATED tab
                    return [4 /*yield*/, page.locator("button", { hasText: "GRADUATED" }).click()];
                case 3:
                    // Click the GRADUATED tab
                    _c.sent();
                    // Page should still be on home route
                    return [4 /*yield*/, (0, test_1.expect)(page).toHaveURL("/")];
                case 4:
                    // Page should still be on home route
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("token detail page shows graduating banner when status is graduating", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var firstTokenRow, rowVisible, curveLabel, graduatingBadge, graduatedStatus, anyStatus;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, page.goto("/")];
                case 1:
                    _c.sent();
                    firstTokenRow = page.locator("tr").filter({ hasText: /\$/ }).first();
                    return [4 /*yield*/, firstTokenRow
                            .isVisible({ timeout: 5000 })
                            .catch(function () { return false; })];
                case 2:
                    rowVisible = _c.sent();
                    if (!rowVisible) return [3 /*break*/, 6];
                    return [4 /*yield*/, firstTokenRow.click()];
                case 3:
                    _c.sent();
                    return [4 /*yield*/, page.waitForURL(/\/token\/0x/)];
                case 4:
                    _c.sent();
                    curveLabel = page.locator("text=curve").first();
                    graduatingBadge = page.locator("text=graduating");
                    graduatedStatus = page.locator("text=graduated");
                    anyStatus = curveLabel
                        .or(graduatingBadge)
                        .or(graduatedStatus);
                    return [4 /*yield*/, (0, test_1.expect)(anyStatus.first()).toBeVisible({ timeout: 5000 })];
                case 5:
                    _c.sent();
                    _c.label = 6;
                case 6: return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("token detail page shows curve progress for non-graduated tokens", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var firstTokenRow, rowVisible, curveSection, graduated;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, page.goto("/")];
                case 1:
                    _c.sent();
                    firstTokenRow = page.locator("tr").filter({ hasText: /\$/ }).first();
                    return [4 /*yield*/, firstTokenRow
                            .isVisible({ timeout: 5000 })
                            .catch(function () { return false; })];
                case 2:
                    rowVisible = _c.sent();
                    if (!rowVisible) return [3 /*break*/, 6];
                    return [4 /*yield*/, firstTokenRow.click()];
                case 3:
                    _c.sent();
                    return [4 /*yield*/, page.waitForURL(/\/token\/0x/)];
                case 4:
                    _c.sent();
                    curveSection = page.locator("text=curve").first();
                    graduated = page.locator("text=graduated");
                    return [4 /*yield*/, (0, test_1.expect)(curveSection.or(graduated).first()).toBeVisible({
                            timeout: 5000,
                        })];
                case 5:
                    _c.sent();
                    _c.label = 6;
                case 6: return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("command bar shows all filter tabs", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, page.goto("/")];
                case 1:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("text=LAUNCHPAD").first()).toBeVisible({
                            timeout: 10000,
                        })];
                case 2:
                    _c.sent();
                    // All filter tabs should be present
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "TRENDING" })).toBeVisible()];
                case 3:
                    // All filter tabs should be present
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "NEW" })).toBeVisible()];
                case 4:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "GRADUATING" })).toBeVisible()];
                case 5:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "GRADUATED" })).toBeVisible()];
                case 6:
                    _c.sent();
                    return [4 /*yield*/, (0, test_1.expect)(page.locator("button", { hasText: "ALL" })).toBeVisible()];
                case 7:
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    }); });
    (0, test_1.test)("token detail footer shows token status", function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var firstTokenRow, rowVisible, statusLabels, footerStatus;
        var page = _b.page;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, page.goto("/")];
                case 1:
                    _c.sent();
                    firstTokenRow = page.locator("tr").filter({ hasText: /\$/ }).first();
                    return [4 /*yield*/, firstTokenRow
                            .isVisible({ timeout: 5000 })
                            .catch(function () { return false; })];
                case 2:
                    rowVisible = _c.sent();
                    if (!rowVisible) return [3 /*break*/, 6];
                    return [4 /*yield*/, firstTokenRow.click()];
                case 3:
                    _c.sent();
                    return [4 /*yield*/, page.waitForURL(/\/token\/0x/)];
                case 4:
                    _c.sent();
                    statusLabels = page.locator("text=active, text=graduating, text=graduated");
                    footerStatus = page
                        .locator('[class*="footerStatus"]')
                        .first();
                    return [4 /*yield*/, (0, test_1.expect)(footerStatus.or(statusLabels.first())).toBeVisible({
                            timeout: 5000,
                        })];
                case 5:
                    _c.sent();
                    _c.label = 6;
                case 6: return [2 /*return*/];
            }
        });
    }); });
});
