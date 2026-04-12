"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = TokenForm;
var react_1 = require("react");
var StepHeader_1 = require("./StepHeader");
var TokenForm_module_css_1 = require("./TokenForm.module.css");
var format_1 = require("../../utils/format");
function TokenForm(_a) {
    var name = _a.name, ticker = _a.ticker, description = _a.description, socialLinks = _a.socialLinks, onNameChange = _a.onNameChange, onTickerChange = _a.onTickerChange, onDescriptionChange = _a.onDescriptionChange, onSocialLinksChange = _a.onSocialLinksChange, onImageChange = _a.onImageChange;
    var _b = (0, react_1.useState)(false), socialOpen = _b[0], setSocialOpen = _b[1];
    var fileRef = (0, react_1.useRef)(null);
    var handleFile = function (e) {
        var _a;
        var file = (_a = e.target.files) === null || _a === void 0 ? void 0 : _a[0];
        if (!file)
            return;
        var reader = new FileReader();
        reader.onload = function (ev) {
            var _a;
            onImageChange(file, (_a = ev.target) === null || _a === void 0 ? void 0 : _a.result);
        };
        reader.readAsDataURL(file);
    };
    return (<div>
      <StepHeader_1.default step={2} title="Token details" subtitle="These can't be changed after launch."/>

      <div className={TokenForm_module_css_1.default.fieldGrid}>
        <div>
          <label className={TokenForm_module_css_1.default.label}>Token name</label>
          <input type="text" className={TokenForm_module_css_1.default.input} placeholder="e.g. HYPERBULL" value={name} onChange={function (e) { return onNameChange(e.target.value); }} maxLength={32}/>
        </div>
        <div>
          <label className={TokenForm_module_css_1.default.label}>Ticker</label>
          <input type="text" className={TokenForm_module_css_1.default.input} placeholder="e.g. HBULL" value={ticker} onChange={function (e) { return onTickerChange(e.target.value); }} maxLength={8}/>
        </div>
      </div>

      <div className={TokenForm_module_css_1.default.fieldBlock}>
        <label className={TokenForm_module_css_1.default.label}>
          Description <span className={TokenForm_module_css_1.default.optionalTag}>(optional)</span>
        </label>
        <textarea className={TokenForm_module_css_1.default.textarea} placeholder="What's the vibe?" maxLength={280} value={description} onChange={function (e) { return onDescriptionChange(e.target.value); }}/>
      </div>

      <label className={TokenForm_module_css_1.default.label}>Token image</label>
      <div className={TokenForm_module_css_1.default.uploadZone} onClick={function () { var _a; return (_a = fileRef.current) === null || _a === void 0 ? void 0 : _a.click(); }}>
        <div className={TokenForm_module_css_1.default.uploadIcon}>🖼</div>
        <div className={TokenForm_module_css_1.default.uploadText}>Click or drag to upload</div>
        <div className={TokenForm_module_css_1.default.uploadHint}>PNG, JPG, GIF · max 5MB</div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className={TokenForm_module_css_1.default.fileInput} onChange={handleFile}/>

      <div className={TokenForm_module_css_1.default.socialToggle} onClick={function () { return setSocialOpen(!socialOpen); }}>
        <span>🔗</span>
        <span className={TokenForm_module_css_1.default.socialLinkLabel}>Add social links</span>
        <span className={TokenForm_module_css_1.default.socialOptional}>(optional)</span>
        <span className={(0, format_1.cn)(TokenForm_module_css_1.default.chevron, socialOpen && TokenForm_module_css_1.default.chevronOpen)}>
          ›
        </span>
      </div>
      {socialOpen && (<div className={TokenForm_module_css_1.default.socialPanel}>
          <div className={TokenForm_module_css_1.default.socialFieldGrid}>
            <div>
              <label className={TokenForm_module_css_1.default.label}>Twitter / X</label>
              <input type="text" className={TokenForm_module_css_1.default.input} placeholder="@handle" value={socialLinks.twitter} onChange={function (e) { return onSocialLinksChange(__assign(__assign({}, socialLinks), { twitter: e.target.value })); }}/>
            </div>
            <div>
              <label className={TokenForm_module_css_1.default.label}>Telegram</label>
              <input type="text" className={TokenForm_module_css_1.default.input} placeholder="t.me/..." value={socialLinks.telegram} onChange={function (e) { return onSocialLinksChange(__assign(__assign({}, socialLinks), { telegram: e.target.value })); }}/>
            </div>
          </div>
          <div>
            <label className={TokenForm_module_css_1.default.label}>
              Website <span className={TokenForm_module_css_1.default.optionalTag}>(optional)</span>
            </label>
            <input type="text" className={TokenForm_module_css_1.default.input} placeholder="https://..." value={socialLinks.website} onChange={function (e) { return onSocialLinksChange(__assign(__assign({}, socialLinks), { website: e.target.value })); }}/>
          </div>
        </div>)}
    </div>);
}
