"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = LivePreview;
var react_1 = require("react");
var LivePreview_module_css_1 = require("./LivePreview.module.css");
var colors_1 = require("../../config/colors");
var constants_1 = require("../../config/constants");
var assets_1 = require("../../services/mock/assets");
var format_1 = require("../../utils/format");
function LivePreview(_a) {
    var name = _a.name, ticker = _a.ticker, direction = _a.direction, asset = _a.asset, leverage = _a.leverage, imagePreview = _a.imagePreview;
    var canvasRef = (0, react_1.useRef)(null);
    var isLong = direction === "long";
    var ltName = (0, format_1.getLtDisplayName)(asset, leverage, direction);
    var displayName = ticker
        ? "".concat((name || "YOUR TOKEN").toUpperCase(), " (").concat(ticker.toUpperCase(), ")")
        : (name || "your token").toUpperCase();
    var data = assets_1.MOCK_ASSET_DATA[asset];
    var assetChg = data.change24h;
    var isUp = assetChg >= 0;
    (0, react_1.useEffect)(function () {
        var canvas = canvasRef.current;
        if (!canvas)
            return;
        var ctx = canvas.getContext("2d");
        if (!ctx)
            return;
        var W = canvas.width;
        var H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        var color = isUp ? colors_1.COLORS.mint : colors_1.COLORS.red;
        var pts = Array.from({ length: 60 }, function (_, i) {
            var noise = (Math.random() - 0.48) * 1.8;
            var trend = (assetChg / 100) * (i / 60) * 0.8;
            return noise + trend;
        });
        var v = 0;
        var lineData = pts.map(function (p) {
            v += p;
            return v;
        });
        var mn = Math.min.apply(Math, lineData);
        var mx = Math.max.apply(Math, lineData);
        var norm = lineData.map(function (p) { return ((p - mn) / (mx - mn || 1)) * 26 + 3; });
        var grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, isUp ? (0, colors_1.rgba)(colors_1.COLORS.mint, 0.18) : (0, colors_1.rgba)(colors_1.COLORS.red, 0.14));
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath();
        ctx.moveTo(1, 32);
        norm.forEach(function (y, i) {
            return ctx.lineTo((i / (norm.length - 1)) * (W - 2) + 1, 32 - y);
        });
        ctx.lineTo(W - 1, 32);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.beginPath();
        norm.forEach(function (y, i) {
            return i === 0
                ? ctx.moveTo(1, 32 - y)
                : ctx.lineTo((i / (norm.length - 1)) * (W - 2) + 1, 32 - y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "round";
        ctx.stroke();
    }, [asset, isUp, assetChg]);
    return (<div className={LivePreview_module_css_1.default.wrapper}>
      <div className={LivePreview_module_css_1.default.content}>
        <div className={LivePreview_module_css_1.default.previewLabel}>
          <div className={LivePreview_module_css_1.default.liveDot}/>
          live preview
        </div>

        <div className={(0, format_1.cn)(LivePreview_module_css_1.default.tokenCard, isLong ? LivePreview_module_css_1.default.tokenCardLong : LivePreview_module_css_1.default.tokenCardShort)}>
          <div className={LivePreview_module_css_1.default.tokenCardHeader}>
            <div className={LivePreview_module_css_1.default.tokenImage}>
              {imagePreview ? (<img src={imagePreview} className={LivePreview_module_css_1.default.tokenImageImg} alt=""/>) : (<span className={LivePreview_module_css_1.default.tokenImagePlaceholder}>?</span>)}
            </div>
            <div className={LivePreview_module_css_1.default.tokenInfo}>
              <div className={LivePreview_module_css_1.default.tokenName}>{displayName}</div>
              <div className={LivePreview_module_css_1.default.tokenBadgeRow}>
                <span className={(0, format_1.cn)(LivePreview_module_css_1.default.tokenBadge, isLong ? LivePreview_module_css_1.default.tokenBadgeLong : LivePreview_module_css_1.default.tokenBadgeShort)}>
                  ⚡ {ltName}
                </span>
              </div>
            </div>
          </div>

          <div className={LivePreview_module_css_1.default.miniStats}>
            <div className={LivePreview_module_css_1.default.miniStatCell}>
              <div className={LivePreview_module_css_1.default.miniStatValue}>{leverage}×</div>
              <div className={LivePreview_module_css_1.default.miniStatLabel}>leverage</div>
            </div>
            <div className={LivePreview_module_css_1.default.miniStatCell}>
              <div className={LivePreview_module_css_1.default.miniStatValue}>{asset}</div>
              <div className={LivePreview_module_css_1.default.miniStatLabel}>underlying</div>
            </div>
            <div className={LivePreview_module_css_1.default.miniStatCellLast}>
              <div className={(0, format_1.cn)(LivePreview_module_css_1.default.miniStatValue, isLong ? LivePreview_module_css_1.default.textMint : LivePreview_module_css_1.default.textRed)}>
                {isLong ? "LONG" : "SHORT"}
              </div>
              <div className={LivePreview_module_css_1.default.miniStatLabel}>direction</div>
            </div>
          </div>
        </div>

        <div className={LivePreview_module_css_1.default.chartCard}>
          <div className={LivePreview_module_css_1.default.chartHeader}>
            <div>
              <div className={LivePreview_module_css_1.default.chartTitle}>{asset} / USD</div>
              <div className={LivePreview_module_css_1.default.chartSubtitle}>
                your token moves {leverage}× this
              </div>
            </div>
            <div className={(0, format_1.cn)(LivePreview_module_css_1.default.chartChgBadge, isUp ? LivePreview_module_css_1.default.chartChgBadgeUp : LivePreview_module_css_1.default.chartChgBadgeDown)}>
              {isUp ? "+" : ""}
              {assetChg.toFixed(2)}%
            </div>
          </div>
          <div className={LivePreview_module_css_1.default.chartBody}>
            <canvas ref={canvasRef} width={328} height={120} className={LivePreview_module_css_1.default.canvas}/>
          </div>
        </div>

        <div className={(0, format_1.cn)(LivePreview_module_css_1.default.infoBox, isLong ? LivePreview_module_css_1.default.infoBoxLong : LivePreview_module_css_1.default.infoBoxShort)}>
          <b className={(0, format_1.cn)(LivePreview_module_css_1.default.infoBold, isLong ? LivePreview_module_css_1.default.textMint : LivePreview_module_css_1.default.textRed)}>
            {ltName}
          </b>{" "}
          — if {asset} {isLong ? "rises" : "falls"} 10%, your token moves{" "}
          {isLong ? "up" : "down"} ~{leverage * 10}% with zero buys.
        </div>

        <div className={LivePreview_module_css_1.default.howSection}>
          <div className={LivePreview_module_css_1.default.howTitle}>how it works</div>
          {[
            { icon: "1", text: "Token deploys to bonding curve" },
            { icon: "2", text: "Users buy/sell with USDC atomically" },
            { icon: "3", text: "At ".concat((0, format_1.formatUsd)(constants_1.GRADUATION_THRESHOLD_USD), " MCAP, token graduates to DEX") },
        ].map(function (step) { return (<div key={step.icon} className={LivePreview_module_css_1.default.howStep}>
              <div className={LivePreview_module_css_1.default.howStepIcon}>{step.icon}</div>
              {step.text}
            </div>); })}
        </div>
      </div>
    </div>);
}
