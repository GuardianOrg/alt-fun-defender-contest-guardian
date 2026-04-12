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
exports.default = TradePanel;
var react_1 = require("react");
var shared_1 = require("@launchpad/shared");
var viem_1 = require("viem");
var wagmi_1 = require("wagmi");
var CreatorBadge_1 = require("./CreatorBadge");
var SettingsPopup_1 = require("./SettingsPopup");
var TradePanel_module_css_1 = require("./TradePanel.module.css");
var constants_1 = require("../../config/constants");
var abis_1 = require("../../contracts/abis");
var addresses_1 = require("../../contracts/addresses");
var useCopyState_1 = require("../../hooks/useCopyState");
var useReferral_1 = require("../../hooks/useReferral");
var useTradeRouter_1 = require("../../hooks/useTradeRouter");
var useWallet_1 = require("../../hooks/useWallet");
var tradeRouter_1 = require("../../services/tradeRouter");
var format_1 = require("../../utils/format");
function TradePanel(_a) {
    var _this = this;
    var _b;
    var token = _a.token;
    var _c = (0, react_1.useState)("buy"), mode = _c[0], setMode = _c[1];
    var _d = (0, react_1.useState)(""), amount = _d[0], setAmount = _d[1];
    var _e = (0, react_1.useState)(0.02), slippage = _e[0], setSlippage = _e[1];
    var _f = (0, useCopyState_1.useCopyState)(), copied = _f.copied, copyCA = _f.copy;
    var _g = (0, react_1.useState)(false), settingsOpen = _g[0], setSettingsOpen = _g[1];
    var _h = (0, react_1.useState)(null), buyQuote = _h[0], setBuyQuote = _h[1];
    var _j = (0, react_1.useState)(null), sellQuote = _j[0], setSellQuote = _j[1];
    var _k = (0, react_1.useState)(null), maxBalance = _k[0], setMaxBalance = _k[1];
    var address = (0, wagmi_1.useAccount)().address;
    var publicClient = (0, wagmi_1.usePublicClient)();
    var _l = (0, useWallet_1.useWallet)(), isConnected = _l.isConnected, connect = _l.connect;
    var referrer = (0, useReferral_1.useReferral)();
    var _m = (0, useTradeRouter_1.useTradeRouter)(), step = _m.step, txHash = _m.txHash, error = _m.error, executeBuy = _m.executeBuy, executeSell = _m.executeSell, reset = _m.reset;
    var amtNum = parseFloat(amount) || 0;
    var usdcAmount = mode === "buy"
        ? amtNum
        : (sellQuote ? sellQuote.usdcOut : 0);
    var belowMinimum = amtNum > 0 && mode === "buy" && usdcAmount < shared_1.MIN_USDC_AMOUNT;
    var sellBelowMinimum = amtNum > 0 && mode === "sell" && sellQuote != null && sellQuote.usdcOut < shared_1.MIN_USDC_AMOUNT;
    var sellExceedsBuffer = amtNum > 0 && mode === "sell" && sellQuote != null && sellQuote.exceedsBuffer;
    (0, react_1.useEffect)(function () {
        if (!amtNum || amtNum <= 0) {
            setBuyQuote(null);
            setSellQuote(null);
            return;
        }
        var controller = new AbortController();
        var timeout = setTimeout(function () { return __awaiter(_this, void 0, void 0, function () {
            var quote, quote, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 5, , 6]);
                        if (!(mode === "buy")) return [3 /*break*/, 2];
                        return [4 /*yield*/, tradeRouter_1.tradeRouterService.getQuoteBuy(token.address, amtNum)];
                    case 1:
                        quote = _b.sent();
                        if (!controller.signal.aborted)
                            setBuyQuote(quote);
                        return [3 /*break*/, 4];
                    case 2: return [4 /*yield*/, tradeRouter_1.tradeRouterService.getQuoteSell(token.address, amtNum)];
                    case 3:
                        quote = _b.sent();
                        if (!controller.signal.aborted)
                            setSellQuote(quote);
                        _b.label = 4;
                    case 4: return [3 /*break*/, 6];
                    case 5:
                        _a = _b.sent();
                        return [3 /*break*/, 6];
                    case 6: return [2 /*return*/];
                }
            });
        }); }, 300);
        return function () {
            controller.abort();
            clearTimeout(timeout);
        };
    }, [amtNum, mode, token.address]);
    var loadBalance = (0, react_1.useCallback)(function () { return __awaiter(_this, void 0, void 0, function () {
        var balance, balance, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!address || !publicClient)
                        return [2 /*return*/];
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 6, , 7]);
                    if (!(mode === "buy")) return [3 /*break*/, 3];
                    return [4 /*yield*/, publicClient.readContract({
                            address: addresses_1.ADDRESSES.usdc,
                            abi: abis_1.erc20Abi,
                            functionName: "balanceOf",
                            args: [address],
                        })];
                case 2:
                    balance = _b.sent();
                    setMaxBalance((0, viem_1.formatUnits)(balance, addresses_1.USDC_DECIMALS));
                    return [3 /*break*/, 5];
                case 3: return [4 /*yield*/, publicClient.readContract({
                        address: token.address,
                        abi: abis_1.erc20Abi,
                        functionName: "balanceOf",
                        args: [address],
                    })];
                case 4:
                    balance = _b.sent();
                    setMaxBalance((0, viem_1.formatUnits)(balance, 18));
                    _b.label = 5;
                case 5: return [3 /*break*/, 7];
                case 6:
                    _a = _b.sent();
                    setMaxBalance(null);
                    return [3 /*break*/, 7];
                case 7: return [2 /*return*/];
            }
        });
    }); }, [address, publicClient, mode, token.address]);
    (0, react_1.useEffect)(function () {
        if (isConnected)
            loadBalance();
    }, [isConnected, loadBalance]);
    var doTrade = function () {
        if (!isConnected) {
            connect();
            return;
        }
        if (!amtNum)
            return;
        if (mode === "buy") {
            executeBuy(token.address, amtNum, slippage, referrer);
        }
        else {
            var tokenAmountWei = (0, viem_1.parseUnits)(amtNum.toFixed(18), 18);
            executeSell(token.address, tokenAmountWei, slippage);
        }
    };
    (0, react_1.useEffect)(function () {
        if (step === "confirmed") {
            loadBalance();
            var t_1 = setTimeout(function () {
                reset();
                setAmount("");
            }, 3000);
            return function () { return clearTimeout(t_1); };
        }
    }, [step, reset, loadBalance]);
    var isBusy = step === "approving" || step === "executing";
    var buttonLabel = function () {
        if (!isConnected)
            return "CONNECT WALLET";
        if (belowMinimum || sellBelowMinimum)
            return "MINIMUM $".concat(shared_1.MIN_USDC_AMOUNT, " USDC");
        if (sellExceedsBuffer)
            return "EXCEEDS AVAILABLE LIQUIDITY";
        if (step === "approving")
            return mode === "sell" ? "APPROVING TOKEN…" : "APPROVING USDC…";
        if (step === "executing")
            return mode === "buy" ? "BUYING…" : "SELLING…";
        if (step === "confirmed")
            return "CONFIRMED";
        if (step === "error")
            return "RETRY";
        return "".concat(mode === "buy" ? "BUY" : "SELL", " ").concat(token.name);
    };
    var ticker = token.ticker;
    var is5x = token.leverage === 5;
    return (<div className={TradePanel_module_css_1.default.panel}>
      {is5x && (<div className={TradePanel_module_css_1.default.volWarning}>
          ⚠ 5× leverage — significantly more volatility decay, recommended for short-term
        </div>)}

      {token.status === "graduating" && (<div className={TradePanel_module_css_1.default.graduatingBanner}>
          <div className={TradePanel_module_css_1.default.bannerDot}/>
          graduating · {token.curveFilled}% filled
          <div className={TradePanel_module_css_1.default.bannerDot}/>
        </div>)}

      <div className={TradePanel_module_css_1.default.toggleBar}>
        <div className={TradePanel_module_css_1.default.toggleGrid}>
          <button className={(0, format_1.cn)(TradePanel_module_css_1.default.modeBtn, mode === "buy" && TradePanel_module_css_1.default.modeBtnBuyActive)} onClick={function () {
            setMode("buy");
            setAmount("");
            reset();
        }}>
            BUY
            {mode === "buy" && <span className={TradePanel_module_css_1.default.modeIndicatorMint}/>}
          </button>
          <button className={(0, format_1.cn)(TradePanel_module_css_1.default.modeBtn, mode === "sell" && TradePanel_module_css_1.default.modeBtnSellActive)} onClick={function () {
            setMode("sell");
            setAmount("");
            reset();
        }}>
            SELL
            {mode === "sell" && <span className={TradePanel_module_css_1.default.modeIndicatorRed}/>}
          </button>
        </div>

        <div className={TradePanel_module_css_1.default.gearWrap}>
          <button className={(0, format_1.cn)(TradePanel_module_css_1.default.gearBtn, settingsOpen && TradePanel_module_css_1.default.gearBtnActive)} onClick={function () { return setSettingsOpen(!settingsOpen); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          </button>

          {settingsOpen && (<SettingsPopup_1.default slippage={slippage} onSlippageChange={setSlippage} onClose={function () { return setSettingsOpen(false); }}/>)}
        </div>
      </div>

      <div className={TradePanel_module_css_1.default.formBody}>
        <div className={TradePanel_module_css_1.default.denomToggle}>
          {mode === "buy" ? "Amount in USDC" : "Amount in ".concat(ticker)}
        </div>

        <div className={TradePanel_module_css_1.default.amountWrap}>
          <input className={TradePanel_module_css_1.default.amountInput} type="number" placeholder="0.00" value={amount} onChange={function (e) { return setAmount(e.target.value); }} disabled={isBusy}/>
          <div className={TradePanel_module_css_1.default.denomTag}>
            <span className={TradePanel_module_css_1.default.denomLabel}>
              {mode === "buy" ? "USDC" : ticker}
            </span>
            <div className={(0, format_1.cn)(TradePanel_module_css_1.default.coinIcon, mode === "buy" ? TradePanel_module_css_1.default.coinUsdc : TradePanel_module_css_1.default.coinRed)}>
              {mode === "buy" ? ("$") : token.image ? (<img src={token.image} alt="" className={TradePanel_module_css_1.default.coinImg}/>) : (token.emoji)}
            </div>
          </div>
        </div>

        <div className={TradePanel_module_css_1.default.quickRow}>
          <button className={TradePanel_module_css_1.default.resetBtn} onClick={function () { return setAmount(""); }} disabled={isBusy}>
            Reset
          </button>
          {constants_1.QUICK_AMOUNTS.map(function (qa) { return (<button key={qa} className={(0, format_1.cn)(TradePanel_module_css_1.default.quickBtn, amount === String(qa) && TradePanel_module_css_1.default.quickBtnActive)} onClick={function () {
                setAmount(String(qa));
            }} disabled={isBusy}>
              {qa >= 1000 ? "".concat(qa / 1000, "K") : qa}
            </button>); })}
          <button className={TradePanel_module_css_1.default.maxBtn} onClick={function () {
            if (maxBalance) {
                var walletBal = parseFloat(maxBalance);
                if (mode === "buy") {
                    setAmount(String(Math.floor(walletBal * 100) / 100));
                }
                else if (sellQuote && Number.isFinite(sellQuote.maxSellableTokens)) {
                    var capped = Math.min(walletBal, sellQuote.maxSellableTokens);
                    setAmount(String(Math.max(0, capped)));
                }
                else {
                    setAmount(String(walletBal));
                }
            }
        }} disabled={isBusy || !maxBalance}>
            Max
          </button>
        </div>

        {amtNum > 0 && (<div className={TradePanel_module_css_1.default.estimate}>
            {mode === "buy" ? (<>
                ≈ you receive{" "}
                <span className={TradePanel_module_css_1.default.estimateValue}>
                  {(_b = buyQuote === null || buyQuote === void 0 ? void 0 : buyQuote.tokensOut) !== null && _b !== void 0 ? _b : "…"}
                </span>{" "}
                <span className={TradePanel_module_css_1.default.estimateMint}>{ticker}</span>
                {buyQuote && buyQuote.priceImpactPct > 1 && (<span className={TradePanel_module_css_1.default.impactWarning}>
                    {" "}({buyQuote.priceImpactPct.toFixed(1)}% impact)
                  </span>)}
              </>) : (<>
                ≈ you receive{" "}
                <span className={TradePanel_module_css_1.default.estimateValue}>
                  ${sellQuote
                    ? sellQuote.youReceive.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                    })
                    : "…"}
                </span>{" "}
                <span className={TradePanel_module_css_1.default.estimateLabel}>USDC</span>
                {sellQuote && sellQuote.priceImpactPct > 1 && (<span className={TradePanel_module_css_1.default.impactWarning}>
                    {" "}({sellQuote.priceImpactPct.toFixed(1)}% impact)
                  </span>)}
              </>)}
          </div>)}

        {sellExceedsBuffer && sellQuote && (<div className={TradePanel_module_css_1.default.bufferWarning}>
            <span className={TradePanel_module_css_1.default.bufferWarningTitle}>Sell amount exceeds available liquidity</span>
            <span>
              Max sellable now:{" "}
              <span className={TradePanel_module_css_1.default.bufferWarningMax}>
                {sellQuote.maxSellableTokens.toLocaleString(undefined, {
                maximumFractionDigits: 2,
            })}
              </span>{" "}
              {ticker}
              {" "}(~${sellQuote.bufferUsdc.toLocaleString(undefined, {
                maximumFractionDigits: 2,
            })} USDC available)
            </span>
            <span className={TradePanel_module_css_1.default.bufferWarningHint}>
              Sell in smaller amounts. Liquidity replenishes in ~10s after each sell.
            </span>
          </div>)}

        {(belowMinimum || sellBelowMinimum) && (<div className={TradePanel_module_css_1.default.errorBox}>
            <span className={TradePanel_module_css_1.default.errorIcon}>⚠</span>
            Minimum trade is ${shared_1.MIN_USDC_AMOUNT} USDC (BounceTech LT requirement)
          </div>)}

        {error && (<div className={TradePanel_module_css_1.default.errorBox}>
            <span className={TradePanel_module_css_1.default.errorIcon}>⚠</span>
            {error}
          </div>)}

        {step === "confirmed" && txHash && (<div className={TradePanel_module_css_1.default.confirmedBox}>✓ Transaction confirmed</div>)}

        <button className={(0, format_1.cn)(TradePanel_module_css_1.default.ctaBtn, step === "confirmed"
            ? TradePanel_module_css_1.default.ctaConfirmed
            : mode === "buy"
                ? TradePanel_module_css_1.default.ctaBuy
                : TradePanel_module_css_1.default.ctaSell, isBusy && TradePanel_module_css_1.default.ctaBusy)} onClick={doTrade} disabled={isBusy || step === "confirmed" || belowMinimum || sellBelowMinimum || sellExceedsBuffer}>
          {buttonLabel()}
        </button>

        {isBusy && (<div className={TradePanel_module_css_1.default.busyHint}>
            <div className={TradePanel_module_css_1.default.liveDot}/>
            {step === "approving"
                ? mode === "sell"
                    ? "Waiting for token approval in wallet…"
                    : "Waiting for USDC approval in wallet…"
                : "Confirm transaction in wallet…"}
          </div>)}
      </div>

      <CreatorBadge_1.default token={token}/>

      <div className={TradePanel_module_css_1.default.footer}>
        <div className={TradePanel_module_css_1.default.footerLeft}>
          <a className={TradePanel_module_css_1.default.footerCa} onClick={function () { return copyCA(token.address); }}>
            {copied
            ? "✓ copied"
            : "".concat(token.address.slice(0, 6), "\u2026").concat(token.address.slice(-4))}
          </a>
          <span className={TradePanel_module_css_1.default.footerDot}>·</span>
          <span className={TradePanel_module_css_1.default.footerLt}>{token.ltName}</span>
        </div>
        <span className={(0, format_1.cn)(TradePanel_module_css_1.default.footerStatus, token.status === "graduating"
            ? TradePanel_module_css_1.default.footerStatusGraduating
            : TradePanel_module_css_1.default.footerStatusDefault)}>
          {token.status}
          {token.status === "graduating" ? " ⚡" : ""}
        </span>
      </div>
    </div>);
}
