import React from "react";

import Tooltip from "./Tooltip";
import info from "../../../assets/info.svg";
interface InfoTooltipProps {
  content: string;
  size?: number;
}

const InfoTooltip = ({ content, size = 12 }: InfoTooltipProps) => {
  return (
    <Tooltip content={content}>
      <img src={info} alt="Information icon" width={size} height={size} />
    </Tooltip>
  );
};

export default React.memo(InfoTooltip);
