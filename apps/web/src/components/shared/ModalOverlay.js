"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ModalOverlay;
var ModalOverlay_module_css_1 = require("./ModalOverlay.module.css");
function ModalOverlay(_a) {
    var children = _a.children, onClose = _a.onClose;
    var handleClick = function (e) {
        if (e.target === e.currentTarget)
            onClose();
    };
    return (<div className={ModalOverlay_module_css_1.default.overlay} onClick={handleClick}>
      {children}
    </div>);
}
