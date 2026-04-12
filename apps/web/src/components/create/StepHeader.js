"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = StepHeader;
var StepHeader_module_css_1 = require("./StepHeader.module.css");
var format_1 = require("../../utils/format");
function StepHeader(_a) {
    var step = _a.step, title = _a.title, subtitle = _a.subtitle, _b = _a.total, total = _b === void 0 ? 3 : _b, _c = _a.active, active = _c === void 0 ? true : _c;
    return (<div className={StepHeader_module_css_1.default.wrapper}>
      <div className={StepHeader_module_css_1.default.indicator}>
        <div className={(0, format_1.cn)(StepHeader_module_css_1.default.stepCircle, active ? StepHeader_module_css_1.default.stepCircleActive : StepHeader_module_css_1.default.stepCircleInactive)}>
          {step}
        </div>
        {step < total && <div className={StepHeader_module_css_1.default.connector}/>}
      </div>
      <div className={StepHeader_module_css_1.default.content}>
        <div className={StepHeader_module_css_1.default.title}>{title}</div>
        <div className={StepHeader_module_css_1.default.subtitle}>{subtitle}</div>
      </div>
    </div>);
}
