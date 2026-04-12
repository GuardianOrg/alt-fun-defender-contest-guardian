"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = PasswordGate;
var react_1 = require("react");
var PasswordGate_module_css_1 = require("./PasswordGate.module.css");
var PASS = import.meta.env.VITE_GATE_PASSWORD;
var STORAGE_KEY = "lp_auth";
var isLocalhost = function () {
    return window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";
};
function PasswordGate(_a) {
    var children = _a.children;
    var _b = (0, react_1.useState)(function () { return !PASS || isLocalhost() || sessionStorage.getItem(STORAGE_KEY) === "1"; }), authed = _b[0], setAuthed = _b[1];
    var _c = (0, react_1.useState)(""), value = _c[0], setValue = _c[1];
    var _d = (0, react_1.useState)(false), error = _d[0], setError = _d[1];
    var submit = function (e) {
        e.preventDefault();
        if (value === PASS) {
            sessionStorage.setItem(STORAGE_KEY, "1");
            setAuthed(true);
        }
        else {
            setError(true);
            setTimeout(function () { return setError(false); }, 1500);
        }
    };
    if (authed)
        return <>{children}</>;
    return (<div className={PasswordGate_module_css_1.default.wrapper}>
      <form onSubmit={submit} className={PasswordGate_module_css_1.default.form}>
        <div className={PasswordGate_module_css_1.default.logoText}>
          <span className={PasswordGate_module_css_1.default.logoMint}>LAUNCH</span>
          <span className={PasswordGate_module_css_1.default.logoTxt}>PAD</span>
        </div>
        <div className={PasswordGate_module_css_1.default.subtitle}>internal preview</div>

        <input className={PasswordGate_module_css_1.default.input} type="password" placeholder="Password" value={value} onChange={function (e) { return setValue(e.target.value); }} autoFocus/>

        {error && <div className={PasswordGate_module_css_1.default.error}>Wrong password</div>}

        <button type="submit" className={PasswordGate_module_css_1.default.submitBtn}>
          Enter
        </button>
      </form>
    </div>);
}
