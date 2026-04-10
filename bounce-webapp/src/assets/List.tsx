import React from "react";

export const List: React.FC<{ color: string; size: number }> = React.memo(
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
          d="M2 5.25C1.585 5.25 1.25 5.585 1.25 6C1.25 6.415 1.585 6.75 2 6.75C2.415 6.75 2.75 6.415 2.75 6C2.75 5.585 2.415 5.25 2 5.25ZM2 2.25C1.585 2.25 1.25 2.585 1.25 3C1.25 3.415 1.585 3.75 2 3.75C2.415 3.75 2.75 3.415 2.75 3C2.75 2.585 2.415 2.25 2 2.25ZM2 8.25C1.585 8.25 1.25 8.59 1.25 9C1.25 9.41 1.59 9.75 2 9.75C2.41 9.75 2.75 9.41 2.75 9C2.75 8.59 2.415 8.25 2 8.25ZM3.5 9.5H10.5V8.5H3.5V9.5ZM3.5 6.5H10.5V5.5H3.5V6.5ZM3.5 2.5V3.5H10.5V2.5H3.5Z"
          fill={color}
        />
      </svg>
    );
  },
);
