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
exports.default = SearchModal;
var react_1 = require("react");
var react_query_1 = require("@tanstack/react-query");
var react_redux_1 = require("react-redux");
var react_router_1 = require("react-router");
var SearchModal_module_css_1 = require("./SearchModal.module.css");
var routes_1 = require("../../app/routes");
var colors_1 = require("../../config/colors");
var useTokens_1 = require("../../hooks/useTokens");
var api_1 = require("../../services/api");
var tokenService_1 = require("../../services/tokenService");
var uiSlice_1 = require("../../state/uiSlice");
var format_1 = require("../../utils/format");
var ModalOverlay_1 = require("../shared/ModalOverlay");
function normalizePoints(pts) {
    if (pts.length < 2)
        return "1,16 109,16";
    var mn = Math.min.apply(Math, pts);
    var mx = Math.max.apply(Math, pts);
    var norm = pts.map(function (p) { return ((p - mn) / (mx - mn || 1)) * 26 + 3; });
    return norm
        .map(function (y, i) { return "".concat((i / (norm.length - 1)) * 108 + 1, ",").concat(32 - y); })
        .join(" ");
}
function Sparkline(_a) {
    var up = _a.up, data = _a.data;
    var coords = (0, react_1.useMemo)(function () {
        if (data && data.length >= 2) {
            return normalizePoints(data);
        }
        var pts = Array.from({ length: 12 }, function (_, i) { return (up ? i * 2.2 : -i * 2); });
        return normalizePoints(pts);
    }, [up, data]);
    var col = up ? colors_1.COLORS.mint : colors_1.COLORS.red;
    return (<svg width="110" height="32" viewBox="0 0 110 32" preserveAspectRatio="none" className={SearchModal_module_css_1.default.sparkline}>
      <polygon points={"1,32 ".concat(coords, " 109,32")} fill={col} opacity="0.08"/>
      <polyline points={coords} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>);
}
function TrendingCard(_a) {
    var token = _a.token, sparklineData = _a.sparklineData, onClick = _a.onClick;
    var up = token.change24h >= 0;
    return (<div className={SearchModal_module_css_1.default.trendingCard} onClick={onClick}>
      <div className={SearchModal_module_css_1.default.trendingCardHeader}>
        <div className={SearchModal_module_css_1.default.trendingCardIcon}>
          {token.image ? (<img src={token.image} alt={token.name} className={SearchModal_module_css_1.default.trendingCardImg}/>) : (token.emoji)}
        </div>
        <div>
          <div className={SearchModal_module_css_1.default.trendingCardName}>{token.name}</div>
          <div className={SearchModal_module_css_1.default.trendingCardLtName}>{token.ltName}</div>
        </div>
      </div>
      <Sparkline up={up} data={sparklineData}/>
      <div className={SearchModal_module_css_1.default.trendingCardMcap}>
        $
        {token.mcapUsd >= 1000000
            ? "".concat((token.mcapUsd / 1000000).toFixed(2), "M")
            : "".concat((token.mcapUsd / 1000).toFixed(1), "K")}
      </div>
      <div className={(0, format_1.cn)(SearchModal_module_css_1.default.trendingCardChange, up ? SearchModal_module_css_1.default.changeUp : SearchModal_module_css_1.default.changeDown)}>
        {up ? "+" : ""}
        {token.change24h}%
      </div>
    </div>);
}
function SearchModal() {
    var _this = this;
    var open = (0, react_redux_1.useSelector)(uiSlice_1.selectSearchOpen);
    var dispatch = (0, react_redux_1.useDispatch)();
    var _a = (0, react_1.useState)(""), query = _a[0], setQuery = _a[1];
    var inputRef = (0, react_1.useRef)(null);
    var navigate = (0, react_router_1.useNavigate)();
    var tokens = (0, useTokens_1.useTokens)().data;
    var trendingTokens = (0, react_1.useMemo)(function () { var _a; return (_a = tokens === null || tokens === void 0 ? void 0 : tokens.slice(0, 5)) !== null && _a !== void 0 ? _a : []; }, [tokens]);
    var sparklineQueries = (0, react_query_1.useQueries)({
        queries: trendingTokens.map(function (t) { return ({
            queryKey: ["sparkline", t.address],
            queryFn: function () { return __awaiter(_this, void 0, void 0, function () {
                var candles;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, (0, api_1.fetchOhlcv)(t.address, "1h")];
                        case 1:
                            candles = _a.sent();
                            return [2 /*return*/, candles.map(function (c) { return c.close; })];
                    }
                });
            }); },
            staleTime: 60000,
            enabled: open && !query.trim(),
        }); }),
    });
    var sparklineMap = (0, react_1.useMemo)(function () {
        var map = new Map();
        trendingTokens.forEach(function (t, i) {
            var _a;
            var data = (_a = sparklineQueries[i]) === null || _a === void 0 ? void 0 : _a.data;
            if (data && data.length >= 2) {
                map.set(t.address, data);
            }
        });
        return map;
    }, [trendingTokens, sparklineQueries]);
    var _b = (0, react_1.useState)(null), searchResults = _b[0], setSearchResults = _b[1];
    (0, react_1.useEffect)(function () {
        if (!query.trim()) {
            setSearchResults(null);
            return;
        }
        var cancelled = false;
        var timer = setTimeout(function () { return __awaiter(_this, void 0, void 0, function () {
            var results, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, (0, api_1.searchTokens)(query)];
                    case 1:
                        results = _b.sent();
                        if (cancelled)
                            return [2 /*return*/];
                        setSearchResults(results.map(function (r) {
                            var _a;
                            return ({
                                address: r.address,
                                name: r.name,
                                ticker: r.ticker,
                                emoji: "",
                                description: r.description,
                                direction: (0, tokenService_1.deriveDirection)(r),
                                underlying: (0, tokenService_1.deriveUnderlying)(r),
                                leverage: (_a = r.leverage) !== null && _a !== void 0 ? _a : 2,
                                ltName: (0, tokenService_1.ltDisplayName)(r),
                                mcapUsd: 0,
                                change24h: 0,
                                buyMomentum: 0,
                                leverageBoost: 0,
                                curveFilled: 0,
                                curveRaisedUsd: 0,
                                volume24h: 0,
                                athUsd: 0,
                                status: (0, tokenService_1.deriveStatus)(r),
                                creatorAddress: r.creator,
                                createdAt: r.createdAt,
                            });
                        }));
                        return [3 /*break*/, 3];
                    case 2:
                        _a = _b.sent();
                        if (!cancelled)
                            setSearchResults(null);
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        }); }, 250);
        return function () {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query]);
    (0, react_1.useEffect)(function () {
        var handler = function (e) {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                dispatch((0, uiSlice_1.setSearchOpen)(true));
            }
            if (e.key === "Escape")
                dispatch((0, uiSlice_1.setSearchOpen)(false));
        };
        document.addEventListener("keydown", handler);
        return function () { return document.removeEventListener("keydown", handler); };
    }, [dispatch]);
    (0, react_1.useEffect)(function () {
        if (open)
            setTimeout(function () { var _a; return (_a = inputRef.current) === null || _a === void 0 ? void 0 : _a.focus(); }, 60);
        else
            setQuery("");
    }, [open]);
    if (!open)
        return null;
    var filtered = query.trim() ? searchResults : null;
    var goToToken = function (address) {
        dispatch((0, uiSlice_1.setSearchOpen)(false));
        navigate((0, routes_1.tokenPath)(address));
    };
    return (<ModalOverlay_1.default onClose={function () { return dispatch((0, uiSlice_1.setSearchOpen)(false)); }}>
      <div className={SearchModal_module_css_1.default.modal}>
        <div className={SearchModal_module_css_1.default.searchBar}>
          <span className={SearchModal_module_css_1.default.searchIcon}>&#x2315;</span>
          <input ref={inputRef} className={SearchModal_module_css_1.default.searchInput} placeholder="Search tokens, tickers\u2026" value={query} onChange={function (e) { return setQuery(e.target.value); }} autoComplete="off"/>
          <span className={SearchModal_module_css_1.default.escBadge} onClick={function () { return dispatch((0, uiSlice_1.setSearchOpen)(false)); }}>
            esc
          </span>
        </div>

        {!filtered ? (<div className={SearchModal_module_css_1.default.defaultContent}>
            <div className={SearchModal_module_css_1.default.sectionLabel}>TRENDING</div>
            <div className={SearchModal_module_css_1.default.trendingRow}>
              {trendingTokens.map(function (t) { return (<TrendingCard key={t.address} token={t} sparklineData={sparklineMap.get(t.address)} onClick={function () { return goToToken(t.address); }}/>); })}
            </div>
            <div className={SearchModal_module_css_1.default.recentLabel}>RECENTLY VIEWED</div>
            <div className={SearchModal_module_css_1.default.recentText}>No recently viewed tokens</div>
            <div className={SearchModal_module_css_1.default.shortcuts}>
              <span className={SearchModal_module_css_1.default.shortcutItem}>
                <kbd className={SearchModal_module_css_1.default.kbd}>&#x21B5;</kbd>
                select
              </span>
              <span className={SearchModal_module_css_1.default.shortcutItem}>
                <kbd className={SearchModal_module_css_1.default.kbd}>esc</kbd>
                close
              </span>
            </div>
          </div>) : (<div className={SearchModal_module_css_1.default.resultsWrap}>
            {filtered.length > 0 ? (filtered.map(function (t) { return (<div key={t.address} className={SearchModal_module_css_1.default.resultRow} onClick={function () { return goToToken(t.address); }}>
                  <div className={SearchModal_module_css_1.default.resultIcon}>{t.emoji}</div>
                  <div>
                    <div className={SearchModal_module_css_1.default.resultName}>{t.name}</div>
                    <div className={SearchModal_module_css_1.default.resultLtName}>{t.ltName}</div>
                  </div>
                  <div className={SearchModal_module_css_1.default.resultRight}>
                    <div className={(0, format_1.cn)(SearchModal_module_css_1.default.resultChange, t.change24h >= 0 ? SearchModal_module_css_1.default.changeUp : SearchModal_module_css_1.default.changeDown)}>
                      {t.change24h >= 0 ? "+" : ""}
                      {t.change24h}%
                    </div>
                    <div className={SearchModal_module_css_1.default.resultMcap}>
                      $
                      {t.mcapUsd >= 1000000
                    ? "".concat((t.mcapUsd / 1000000).toFixed(2), "M")
                    : "".concat((t.mcapUsd / 1000).toFixed(1), "K")}
                    </div>
                  </div>
                </div>); })) : (<div className={SearchModal_module_css_1.default.noResults}>No tokens found</div>)}
          </div>)}
      </div>
    </ModalOverlay_1.default>);
}
