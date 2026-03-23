import React from "react";

export const Grid: React.FC<{ color: string; size: number }> = React.memo(
  ({ color, size }) => {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 12 12"
        fill="none"
      >
        <path
          d="M10 1H2C1.45 1 1 1.45 1 2V10C1 10.55 1.45 11 2 11H10C10.55 11 11 10.55 11 10V2C11 1.45 10.55 1 10 1ZM4 10H2V8H4V10ZM4 7H2V5H4V7ZM4 4H2V2H4V4ZM7 10H5V8H7V10ZM7 7H5V5H7V7ZM7 4H5V2H7V4ZM10 10H8V8H10V10ZM10 7H8V5H10V7ZM10 4H8V2H10V4Z"
          fill={color}
        />
      </svg>
    );
  },
);
