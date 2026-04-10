import React from "react";

export const Copy: React.FC<{ color: string; size?: number }> = React.memo(
  ({ color, size = 20 }) => {
    return (
      <svg
        width={size}
        height={size * 1.05}
        viewBox="0 0 20 21"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g clipPath="url(#clip0_4459_63575)">
          <path
            d="M13.3327 1.64453H3.33268C2.41602 1.64453 1.66602 2.39453 1.66602 3.3112V14.9779H3.33268V3.3112H13.3327V1.64453ZM15.8327 4.97786H6.66602C5.74935 4.97786 4.99935 5.72786 4.99935 6.64453V18.3112C4.99935 19.2279 5.74935 19.9779 6.66602 19.9779H15.8327C16.7493 19.9779 17.4993 19.2279 17.4993 18.3112V6.64453C17.4993 5.72786 16.7493 4.97786 15.8327 4.97786ZM15.8327 18.3112H6.66602V6.64453H15.8327V18.3112Z"
            fill={color}
          />
        </g>
        <defs>
          <clipPath id="clip0_4459_63575">
            <rect
              width="20"
              height="20"
              fill="white"
              transform="translate(0 0.8125)"
            />
          </clipPath>
        </defs>
      </svg>
    );
  },
);
