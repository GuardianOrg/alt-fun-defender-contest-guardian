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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = BottomTabs;
var react_1 = require("react");
var shared_1 = require("@launchpad/shared");
var wagmi_1 = require("wagmi");
var BottomTabs_module_css_1 = require("./BottomTabs.module.css");
var useTradeFeed_1 = require("../../hooks/useTradeFeed");
var useWallet_1 = require("../../hooks/useWallet");
var api_1 = require("../../services/api");
var tradeService_1 = require("../../services/tradeService");
var format_1 = require("../../utils/format");
function TradesTab(_a) {
    var token = _a.token;
    var trades = (0, useTradeFeed_1.useTokenTrades)(token.address);
    var ticker = token.ticker;
    return (<table className={BottomTabs_module_css_1.default.tradesTable}>
      <thead className={BottomTabs_module_css_1.default.tradesHead}>
        <tr className={BottomTabs_module_css_1.default.tradesHeaderRow}>
          <th className={BottomTabs_module_css_1.default.thLeft}>Account</th>
          <th className={BottomTabs_module_css_1.default.thLeftSmall}>Type</th>
          <th className={BottomTabs_module_css_1.default.thRight}>USDC</th>
          <th className={BottomTabs_module_css_1.default.thRight}>{ticker}</th>
          <th className={BottomTabs_module_css_1.default.thRight}>Time</th>
          <th className={BottomTabs_module_css_1.default.thRightWide}>Txn</th>
        </tr>
      </thead>
      <tbody>
        {trades.map(function (t) {
            var mockTxn = t.id.slice(0, 6);
            var isBuy = t.side === "BUY";
            return (<tr key={t.id} className={BottomTabs_module_css_1.default.tradeRow}>
              <td className={BottomTabs_module_css_1.default.tdLeft}>
                <div className={BottomTabs_module_css_1.default.walletCell}>
                  <div className={BottomTabs_module_css_1.default.walletAvatarPlaceholder}/>
                  <span className={BottomTabs_module_css_1.default.walletAddress}>
                    {t.walletAddress}
                  </span>
                </div>
              </td>
              <td className={(0, format_1.cn)(BottomTabs_module_css_1.default.tdType, isBuy ? BottomTabs_module_css_1.default.tdTypeBuy : BottomTabs_module_css_1.default.tdTypeSell)}>
                {isBuy ? "Buy" : "Sell"}
              </td>
              <td className={BottomTabs_module_css_1.default.tdUsdc}>${t.amountUsd.toLocaleString()}</td>
              <td className={(0, format_1.cn)(BottomTabs_module_css_1.default.tdTokens, isBuy ? BottomTabs_module_css_1.default.tdTokensBuy : BottomTabs_module_css_1.default.tdTokensSell)}>
                {t.tokensAmount}
              </td>
              <td className={BottomTabs_module_css_1.default.tdTime}>{t.timestamp}</td>
              <td className={BottomTabs_module_css_1.default.tdTxn}>
                <span className={BottomTabs_module_css_1.default.txnLink}>{mockTxn}</span>
              </td>
            </tr>);
        })}
      </tbody>
    </table>);
}
function CommentsTab(_a) {
    var _this = this;
    var token = _a.token;
    var _b = (0, react_1.useState)([]), comments = _b[0], setComments = _b[1];
    var _c = (0, react_1.useState)(""), input = _c[0], setInput = _c[1];
    var _d = (0, react_1.useState)(false), posting = _d[0], setPosting = _d[1];
    var _e = (0, react_1.useState)(null), postError = _e[0], setPostError = _e[1];
    var _f = (0, useWallet_1.useWallet)(), address = _f.address, isConnected = _f.isConnected, connect = _f.connect;
    var walletClient = (0, wagmi_1.useWalletClient)().data;
    (0, react_1.useEffect)(function () {
        (0, api_1.fetchComments)(token.address)
            .then(function (apiComments) {
            setComments(apiComments.map(function (c) { return ({
                id: String(c.id),
                emoji: "💬",
                address: (0, format_1.shortenAddress)(c.author),
                timeAgo: (0, format_1.formatTimeAgo)(c.createdAt),
                text: c.content,
            }); }));
        })
            .catch(function () {
            tradeService_1.tradeService.getComments(token.address).then(setComments);
        });
    }, [token.address]);
    var handlePost = (0, react_1.useCallback)(function () { return __awaiter(_this, void 0, void 0, function () {
        var txt, timestamp, message, signature, created_1, err_1, message;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    txt = input.trim();
                    if (!txt)
                        return [2 /*return*/];
                    if (!isConnected || !address) {
                        connect();
                        return [2 /*return*/];
                    }
                    if (!walletClient)
                        return [2 /*return*/];
                    setPosting(true);
                    setPostError(null);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, 5, 6]);
                    timestamp = Date.now();
                    message = (0, shared_1.buildCommentMessage)(token.address, txt, timestamp);
                    return [4 /*yield*/, walletClient.signMessage({ message: message })];
                case 2:
                    signature = _a.sent();
                    return [4 /*yield*/, (0, api_1.postComment)(token.address, address, txt, signature, timestamp)];
                case 3:
                    created_1 = _a.sent();
                    setComments(function (prev) { return __spreadArray([
                        {
                            id: String(created_1.id),
                            emoji: "💬",
                            address: (0, format_1.shortenAddress)(address),
                            timeAgo: "just now",
                            text: created_1.content,
                        }
                    ], prev, true); });
                    setInput("");
                    return [3 /*break*/, 6];
                case 4:
                    err_1 = _a.sent();
                    message = err_1 instanceof Error && err_1.message.includes("rate")
                        ? "Rate limited, try again in 30 seconds."
                        : "Failed to post comment. Please try again.";
                    setPostError(message);
                    return [3 /*break*/, 6];
                case 5:
                    setPosting(false);
                    return [7 /*endfinally*/];
                case 6: return [2 /*return*/];
            }
        });
    }); }, [input, isConnected, address, walletClient, token.address, connect]);
    return (<div className={BottomTabs_module_css_1.default.commentsWrap}>
      <div className={BottomTabs_module_css_1.default.commentsList}>
        {comments.map(function (c) { return (<div key={c.id} className={BottomTabs_module_css_1.default.commentRow}>
            <div className={BottomTabs_module_css_1.default.commentAvatar}>{c.emoji}</div>
            <div>
              <div>
                <span className={BottomTabs_module_css_1.default.commentAddress}>{c.address}</span>
                <span className={BottomTabs_module_css_1.default.commentTime}>{c.timeAgo}</span>
              </div>
              <div className={BottomTabs_module_css_1.default.commentText}>{c.text}</div>
            </div>
          </div>); })}
      </div>
      {postError && (<div className={BottomTabs_module_css_1.default.commentError}>{postError}</div>)}
      <div className={BottomTabs_module_css_1.default.commentInputRow}>
        <input className={BottomTabs_module_css_1.default.commentInput} placeholder={isConnected ? "say something…" : "connect wallet to comment"} value={input} onChange={function (e) { return setInput(e.target.value); }} onKeyDown={function (e) { return e.key === "Enter" && handlePost(); }} disabled={posting}/>
        <button className={BottomTabs_module_css_1.default.commentPostBtn} onClick={handlePost} disabled={posting || !input.trim()}>
          {posting ? "…" : "post"}
        </button>
      </div>
    </div>);
}
function HoldersTab(_a) {
    var holders = _a.holders;
    var maxSupply = Math.max.apply(Math, __spreadArray(__spreadArray([], holders.map(function (h) { return h.percentSupply; }), false), [1], false));
    return (<div className={BottomTabs_module_css_1.default.holdersWrap}>
      <div className={BottomTabs_module_css_1.default.holdersHeader}>
        <div>#</div>
        <div>wallet</div>
        <div>tokens</div>
        <div>% supply</div>
        <div>bar</div>
      </div>
      {holders.map(function (h) { return (<div key={h.rank} className={BottomTabs_module_css_1.default.holderRow}>
          <div className={BottomTabs_module_css_1.default.holderRank}>{h.rank}</div>
          <div className={BottomTabs_module_css_1.default.holderAddress}>
            {h.address}
            {h.isCreator && (<span className={BottomTabs_module_css_1.default.holderCreator}>creator</span>)}
          </div>
          <div className={BottomTabs_module_css_1.default.holderTokens}>{h.tokens}</div>
          <div className={BottomTabs_module_css_1.default.holderPercent}>{h.percentSupply}%</div>
          <div>
            <div className={BottomTabs_module_css_1.default.barTrack}>
              <div className={(0, format_1.cn)(BottomTabs_module_css_1.default.barFill, "bar-glow-mint")} style={{ width: "".concat((h.percentSupply / maxSupply) * 100, "%") }}/>
            </div>
          </div>
        </div>); })}
    </div>);
}
function BottomTabs(_a) {
    var token = _a.token;
    var _b = (0, react_1.useState)("trades"), activeTab = _b[0], setActiveTab = _b[1];
    var _c = (0, react_1.useState)([]), holders = _c[0], setHolders = _c[1];
    (0, react_1.useEffect)(function () {
        tradeService_1.tradeService.getHolders(token.address).then(setHolders);
    }, [token.address]);
    return (<>
      <div className={BottomTabs_module_css_1.default.tabBar}>
        {["trades", "comments", "holders"].map(function (tab) { return (<button key={tab} className={(0, format_1.cn)(BottomTabs_module_css_1.default.tabBtn, activeTab === tab && BottomTabs_module_css_1.default.tabBtnActive)} onClick={function () { return setActiveTab(tab); }}>
            {tab}
            {activeTab === tab && <span className={BottomTabs_module_css_1.default.tabIndicator}/>}
          </button>); })}
      </div>
      <div className={BottomTabs_module_css_1.default.tabContent}>
        {activeTab === "trades" && <TradesTab token={token}/>}
        {activeTab === "comments" && <CommentsTab token={token}/>}
        {activeTab === "holders" && <HoldersTab holders={holders}/>}
      </div>
    </>);
}
