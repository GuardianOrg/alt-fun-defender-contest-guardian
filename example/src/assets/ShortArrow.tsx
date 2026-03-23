export const ShortArrow: React.FC<{ color: string; size: number }> = ({
  color,
  size,
}) => {
  return (
    <svg
      className="arrow"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      style={{ color }}
    >
      <path
        d="M10 2.705L9.295 2L3.5 7.795V4.5H2.5V9.5H7.5V8.5H4.205L10 2.705Z"
        fill="currentColor"
        transform="translate(12 0) scale(-1 1)"
      />
    </svg>
  );
};
