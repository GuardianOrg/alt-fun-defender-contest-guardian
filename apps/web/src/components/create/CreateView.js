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
exports.default = CreateView;
var react_1 = require("react");
var react_router_1 = require("react-router");
var CreateView_module_css_1 = require("./CreateView.module.css");
var LivePreview_1 = require("./LivePreview");
var PairSelector_1 = require("./PairSelector");
var SeedBuy_1 = require("./SeedBuy");
var TokenForm_1 = require("./TokenForm");
var routes_1 = require("../../app/routes");
var useCreateToken_1 = require("../../hooks/useCreateToken");
var useWallet_1 = require("../../hooks/useWallet");
var format_1 = require("../../utils/format");
function CreateView() {
    var _this = this;
    var navigate = (0, react_router_1.useNavigate)();
    var _a = (0, react_1.useState)("long"), direction = _a[0], setDirection = _a[1];
    var _b = (0, react_1.useState)("HYPE"), asset = _b[0], setAsset = _b[1];
    var _c = (0, react_1.useState)(2), leverage = _c[0], setLeverage = _c[1];
    var _d = (0, react_1.useState)(""), name = _d[0], setName = _d[1];
    var _e = (0, react_1.useState)(""), ticker = _e[0], setTicker = _e[1];
    var _f = (0, react_1.useState)(""), description = _f[0], setDescription = _f[1];
    var _g = (0, react_1.useState)({ twitter: "", telegram: "", website: "" }), socialLinks = _g[0], setSocialLinks = _g[1];
    var _h = (0, react_1.useState)(""), seedAmount = _h[0], setSeedAmount = _h[1];
    var _j = (0, react_1.useState)(null), imagePreview = _j[0], setImagePreview = _j[1];
    var _k = (0, react_1.useState)(), imageFile = _k[0], setImageFile = _k[1];
    var _l = (0, useWallet_1.useWallet)(), isConnected = _l.isConnected, connect = _l.connect;
    var _m = (0, useCreateToken_1.useCreateToken)(), launchStep = _m.step, launchError = _m.error, launchWarning = _m.warning, tokenAddress = _m.tokenAddress, create = _m.create;
    var seedAmt = parseFloat(seedAmount) || 0;
    var isBusy = launchStep === "approving" || launchStep === "deploying";
    (0, react_1.useEffect)(function () {
        if (launchStep === "confirmed" && tokenAddress) {
            var timer_1 = setTimeout(function () {
                navigate((0, routes_1.tokenPath)(tokenAddress));
            }, 1500);
            return function () { return clearTimeout(timer_1); };
        }
    }, [launchStep, tokenAddress, navigate]);
    var handleSubmit = function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!isConnected) {
                        connect();
                        return [2 /*return*/];
                    }
                    if (!name.trim() || !ticker.trim())
                        return [2 /*return*/];
                    return [4 /*yield*/, create({
                            name: name.trim(),
                            ticker: ticker.trim(),
                            description: description.trim(),
                            direction: direction,
                            underlying: asset,
                            leverage: leverage,
                            imageFile: imageFile,
                            seedBuyUsd: seedAmt,
                            socialLinks: [socialLinks.twitter, socialLinks.telegram, socialLinks.website].filter(Boolean),
                        })];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); };
    var buttonLabel = function () {
        if (!isConnected)
            return "CONNECT WALLET TO LAUNCH";
        if (launchStep === "approving")
            return "APPROVING USDC…";
        if (launchStep === "deploying")
            return "DEPLOYING…";
        if (launchStep === "confirmed")
            return "✓ TOKEN LAUNCHED";
        if (launchStep === "error")
            return "⚡ RETRY LAUNCH";
        return "⚡ LAUNCH TOKEN";
    };
    return (<div className={CreateView_module_css_1.default.layout}>
      <div className={CreateView_module_css_1.default.formColumn}>
        <div className={CreateView_module_css_1.default.pageHeader}>
          <div className={CreateView_module_css_1.default.eyebrow}>new token</div>
          <div className={CreateView_module_css_1.default.heading}>Create a levered token</div>
          <div className={CreateView_module_css_1.default.subheading}>
            Choose a direction, pick your underlying, set your leverage, and
            deploy to the bonding curve in one transaction.
          </div>
        </div>

        <div className={CreateView_module_css_1.default.steps}>
          <PairSelector_1.default direction={direction} asset={asset} leverage={leverage} onDirectionChange={setDirection} onAssetChange={setAsset} onLeverageChange={setLeverage}/>

          <div className={CreateView_module_css_1.default.divider}/>

          <TokenForm_1.default name={name} ticker={ticker} description={description} socialLinks={socialLinks} onNameChange={setName} onTickerChange={setTicker} onDescriptionChange={setDescription} onSocialLinksChange={setSocialLinks} onImageChange={function (file, preview) {
            setImageFile(file !== null && file !== void 0 ? file : undefined);
            setImagePreview(preview);
        }}/>

          <div className={CreateView_module_css_1.default.divider}/>

          <SeedBuy_1.default seedAmount={seedAmount} onSeedChange={setSeedAmount}/>

          <div className={CreateView_module_css_1.default.ctaArea}>
            {launchError && (<div className={CreateView_module_css_1.default.errorBanner}>
                <span className={CreateView_module_css_1.default.errorIcon}>⚠</span>
                {launchError}
              </div>)}

            {launchStep === "confirmed" && launchWarning && (<div className={CreateView_module_css_1.default.warningBanner}>
                <span className={CreateView_module_css_1.default.warningIcon}>⚠</span>
                {launchWarning}
              </div>)}

            {launchStep === "confirmed" && (<div className={CreateView_module_css_1.default.successBanner}>
                <span>✓</span>
                Token deployed! Redirecting…
              </div>)}

            <button className={(0, format_1.cn)(CreateView_module_css_1.default.launchButton, launchStep === "confirmed"
            ? CreateView_module_css_1.default.launchButtonConfirmed
            : CreateView_module_css_1.default.launchButtonActive, isBusy && CreateView_module_css_1.default.launchButtonBusy)} onClick={handleSubmit} disabled={isBusy || launchStep === "confirmed"}>
              {buttonLabel()}
            </button>

            {isBusy && (<div className={CreateView_module_css_1.default.busyRow}>
                <div className={CreateView_module_css_1.default.busyDot}/>
                {launchStep === "approving"
                ? "Approve USDC spend in your wallet…"
                : "Confirm deployment in your wallet…"}
              </div>)}

            {launchStep === "idle" && (<div className={CreateView_module_css_1.default.idleHint}>
                {seedAmt > 0
                ? "You will approve $".concat(seedAmt.toFixed(2), " USDC, then confirm deployment")
                : "You will be asked to confirm in your wallet"}
              </div>)}

            {seedAmt > 0 && launchStep === "idle" && (<div className={CreateView_module_css_1.default.seedInfo}>
                Seed buy of{" "}
                <span className={CreateView_module_css_1.default.mintHighlight}>
                  ${seedAmt.toFixed(2)} USDC
                </span>{" "}
                is routed atomically through the TX Router — you receive tokens
                directly.
              </div>)}
          </div>
        </div>
      </div>

      <LivePreview_1.default name={name} ticker={ticker} direction={direction} asset={asset} leverage={leverage} imagePreview={imagePreview}/>
    </div>);
}
