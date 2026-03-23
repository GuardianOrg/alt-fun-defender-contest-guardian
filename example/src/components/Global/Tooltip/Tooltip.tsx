import {
  Tooltip as MuiTooltip,
  tooltipClasses,
  type TooltipProps,
} from "@mui/material";
import { styled } from "@mui/material/styles";

const StyledTooltip = styled(({ className, ...props }: TooltipProps) => (
  <MuiTooltip {...props} arrow classes={{ popper: className }} />
))(() => ({
  [`& .${tooltipClasses.tooltip}`]: {
    backgroundColor: "var(--white-or-secondary-550)",
    color: "var(--main)",
    fontFamily: "Sora, sans-serif",
    fontSize: "1.1rem",
    fontWeight: "400",
    borderRadius: "0.8rem",
    margin: "0.8rem",
    padding: "0.8rem 1.2rem",
    maxWidth: "30rem",
    textAlign: "center",
    boxShadow: "0px 0px 0.4rem 0px var(--box-shadow-header)",
    border: "1px solid var(--grey-200-or-secondary-300)",
  },
  [`& .${tooltipClasses.arrow}`]: {
    color: "var(--white-or-secondary-550)",
    "&:before": {
      border: "1px solid var(--grey-200-or-secondary-300)",
    },
  },
}));

export default function Tooltip({
  content,
  children,
}: {
  content: string;
  children: React.ReactElement;
}) {
  return (
    <StyledTooltip
      title={content}
      placement="top"
      enterTouchDelay={0}
      leaveTouchDelay={2000}
    >
      {children}
    </StyledTooltip>
  );
}
