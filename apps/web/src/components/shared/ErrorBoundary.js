"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var react_1 = require("react");
var ErrorBoundary = /** @class */ (function (_super) {
    __extends(ErrorBoundary, _super);
    function ErrorBoundary() {
        var _this = _super !== null && _super.apply(this, arguments) || this;
        Object.defineProperty(_this, "state", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: { hasError: false }
        });
        return _this;
    }
    Object.defineProperty(ErrorBoundary, "getDerivedStateFromError", {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function () {
            return { hasError: true };
        }
    });
    Object.defineProperty(ErrorBoundary.prototype, "componentDidCatch", {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function (error, errorInfo) {
            console.error("[ErrorBoundary] Uncaught error:", {
                message: error.message,
                stack: error.stack,
                componentStack: errorInfo.componentStack,
            });
        }
    });
    Object.defineProperty(ErrorBoundary.prototype, "render", {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function () {
            var _this = this;
            if (this.state.hasError) {
                if (this.props.fallback !== undefined) {
                    return this.props.fallback;
                }
                return (<div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        height: "100%",
                        color: "var(--txt-3)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 14,
                        flexDirection: "column",
                        gap: "1rem",
                    }}>
          <div>Something went wrong.</div>
          <button onClick={function () { return _this.setState({ hasError: false }); }} style={{
                        background: "var(--bg-2)",
                        border: "1px solid var(--border)",
                        color: "var(--mint)",
                        padding: "0.5rem 1rem",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontFamily: "var(--font-mono)",
                    }}>
            Retry
          </button>
        </div>);
            }
            return this.props.children;
        }
    });
    return ErrorBoundary;
}(react_1.Component));
exports.default = ErrorBoundary;
