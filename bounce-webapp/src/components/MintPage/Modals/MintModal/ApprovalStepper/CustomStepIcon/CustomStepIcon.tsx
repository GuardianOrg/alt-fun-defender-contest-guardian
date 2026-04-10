import styles from "../ApprovalStepper.module.css";

import type { StepIconProps } from "@mui/material/StepIcon";

const CustomStepIcon = ({ completed, icon }: StepIconProps) => {
  return (
    <svg
      className={`${styles.stepIcon} MuiStepIcon-root Mui-active`}
      viewBox="0 0 24 24"
      width="24"
      height="24"
    >
      <circle cx="12" cy="12" r="12" fill="#6753f1" />
      {completed ? (
        <path d="M10 17l-5-5 1.4-1.4L10 14.2l7.6-7.6L19 8l-9 9z" fill="#fff" />
      ) : (
        <text
          className="MuiStepIcon-text"
          x="12"
          y="12"
          fill="#fff"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {icon}
        </text>
      )}
    </svg>
  );
};

export default CustomStepIcon;
