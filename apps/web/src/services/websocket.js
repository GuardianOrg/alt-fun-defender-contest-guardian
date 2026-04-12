"use strict";
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
exports.getWebSocketClient = getWebSocketClient;
var PING_INTERVAL_MS = 30000;
var INITIAL_RECONNECT_MS = 1000;
var MAX_RECONNECT_MS = 30000;
var WebSocketClient = /** @class */ (function () {
    function WebSocketClient(url) {
        Object.defineProperty(this, "ws", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "url", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "subscriptions", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "reconnectMs", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: INITIAL_RECONNECT_MS
        });
        Object.defineProperty(this, "reconnectTimer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "pingTimer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "disposed", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "subIdCounter", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        this.url = url;
    }
    Object.defineProperty(WebSocketClient.prototype, "connect", {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function () {
            var _this = this;
            if (this.disposed || !this.url)
                return;
            this.cleanup();
            try {
                this.ws = new WebSocket(this.url);
            }
            catch (_a) {
                this.scheduleReconnect();
                return;
            }
            this.ws.onopen = function () {
                _this.reconnectMs = INITIAL_RECONNECT_MS;
                _this.startPing();
                for (var _i = 0, _a = _this.subscriptions.values(); _i < _a.length; _i++) {
                    var sub = _a[_i];
                    _this.sendSubscribe(sub.channel, sub.token);
                }
            };
            this.ws.onmessage = function (event) {
                try {
                    var msg = JSON.parse(event.data);
                    if (msg.type === "pong" || msg.type === "subscribed" || msg.type === "unsubscribed") {
                        return;
                    }
                    if (msg.channel && msg.data !== undefined) {
                        for (var _i = 0, _a = _this.subscriptions.values(); _i < _a.length; _i++) {
                            var sub = _a[_i];
                            if (sub.channel === msg.channel) {
                                sub.handler(msg.data);
                            }
                        }
                    }
                }
                catch (_b) {
                    // ignore malformed messages
                }
            };
            this.ws.onclose = function () {
                _this.stopPing();
                if (!_this.disposed) {
                    _this.scheduleReconnect();
                }
            };
            this.ws.onerror = function () {
                var _a;
                (_a = _this.ws) === null || _a === void 0 ? void 0 : _a.close();
            };
        }
    });
    Object.defineProperty(WebSocketClient.prototype, "isConnected", {
        get: function () {
            var _a;
            return ((_a = this.ws) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.OPEN;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(WebSocketClient.prototype, "subscribe", {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function (channel, handler, token) {
            var _this = this;
            var _a;
            var id = String(++this.subIdCounter);
            this.subscriptions.set(id, { channel: channel, token: token, handler: handler });
            if (((_a = this.ws) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.OPEN) {
                this.sendSubscribe(channel, token);
            }
            return function () {
                var _a;
                _this.subscriptions.delete(id);
                if (((_a = _this.ws) === null || _a === void 0 ? void 0 : _a.readyState) !== WebSocket.OPEN)
                    return;
                var remaining = __spreadArray([], _this.subscriptions.values(), true);
                if (token) {
                    // Token-scoped: unsubscribe the token if no other sub references it
                    var tokenStillUsed = remaining.some(function (s) { return s.channel === channel && s.token === token; });
                    if (!tokenStillUsed) {
                        _this.sendUnsubscribe(channel, token);
                    }
                }
                else {
                    // Global: unsubscribe the channel (global flag) if no other global sub exists
                    var globalStillUsed = remaining.some(function (s) { return s.channel === channel && !s.token; });
                    if (!globalStillUsed) {
                        _this.sendUnsubscribe(channel);
                    }
                }
            };
        }
    });
    Object.defineProperty(WebSocketClient.prototype, "dispose", {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function () {
            this.disposed = true;
            this.cleanup();
            this.subscriptions.clear();
        }
    });
    Object.defineProperty(WebSocketClient.prototype, "sendSubscribe", {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function (channel, token) {
            var _a;
            var msg = { type: "subscribe", channel: channel };
            if (token)
                msg.token = token;
            (_a = this.ws) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify(msg));
        }
    });
    Object.defineProperty(WebSocketClient.prototype, "sendUnsubscribe", {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function (channel, token) {
            var _a;
            var msg = { type: "unsubscribe", channel: channel };
            if (token)
                msg.token = token;
            (_a = this.ws) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify(msg));
        }
    });
    Object.defineProperty(WebSocketClient.prototype, "startPing", {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function () {
            var _this = this;
            this.stopPing();
            this.pingTimer = setInterval(function () {
                var _a;
                if (((_a = _this.ws) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.OPEN) {
                    _this.ws.send(JSON.stringify({ type: "ping" }));
                }
            }, PING_INTERVAL_MS);
        }
    });
    Object.defineProperty(WebSocketClient.prototype, "stopPing", {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function () {
            if (this.pingTimer) {
                clearInterval(this.pingTimer);
                this.pingTimer = null;
            }
        }
    });
    Object.defineProperty(WebSocketClient.prototype, "scheduleReconnect", {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function () {
            var _this = this;
            if (this.disposed || this.reconnectTimer)
                return;
            this.reconnectTimer = setTimeout(function () {
                _this.reconnectTimer = null;
                _this.reconnectMs = Math.min(_this.reconnectMs * 2, MAX_RECONNECT_MS);
                _this.connect();
            }, this.reconnectMs);
        }
    });
    Object.defineProperty(WebSocketClient.prototype, "cleanup", {
        enumerable: false,
        configurable: true,
        writable: true,
        value: function () {
            this.stopPing();
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            if (this.ws) {
                this.ws.onopen = null;
                this.ws.onmessage = null;
                this.ws.onclose = null;
                this.ws.onerror = null;
                if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                    this.ws.close();
                }
                this.ws = null;
            }
        }
    });
    return WebSocketClient;
}());
var instance = null;
function getWebSocketClient() {
    if (instance)
        return instance;
    var wsUrl = import.meta.env.VITE_WS_URL;
    if (!wsUrl)
        return null;
    instance = new WebSocketClient(wsUrl);
    instance.connect();
    return instance;
}
