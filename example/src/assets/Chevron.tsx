export const Chevron: React.FC<{ color: string; strokeWidth?: number }> = ({
  color,
  strokeWidth = 1.5, // default width
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="7"
      height="5"
      viewBox="0 0 7 5"
      fill="none"
    >
      <path
        d="M6.5 3.75781L3.5 0.757813L0.5 3.75781"
        stroke={color}
        strokeWidth={strokeWidth}
      />
    </svg>
  );
};
