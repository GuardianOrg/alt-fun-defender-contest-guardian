"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ModalOverlay;
var react_1 = require("react");
var ModalOverlay_module_css_1 = require("./ModalOverlay.module.css");
function ModalOverlay(_a) {
    var children = _a.children, onClose = _a.onClose, ariaLabelledBy = _a.ariaLabelledBy;
    var overlayRef = (0, react_1.useRef)(null);
    var handleClick = function (e) {
        if (e.target === e.currentTarget)
            onClose();
    };
    var trapFocus = (0, react_1.useCallback)(function (e) {
        if (e.key !== "Tab" || !overlayRef.current)
            return;
        var focusable = overlayRef.current.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0)
            return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        }
        else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }, []);
    (0, react_1.useEffect)(function () {
        document.addEventListener("keydown", trapFocus);
        return function () { return document.removeEventListener("keydown", trapFocus); };
    }, [trapFocus]);
    return (<div ref={overlayRef} className={ModalOverlay_module_css_1.default.overlay} role="dialog" aria-modal="true" aria-labelledby={ariaLabelledBy} onClick={handleClick}>
      {children}
    </div>);
}
