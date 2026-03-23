export const SmallTriangleDown: React.FC<{ color: string }> = ({ color }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="10"
      height="5"
      viewBox="0 0 10 5"
      fill="none"
    >
      <path d="M0 0L5 5L10 0H0Z" fill={color} />
    </svg>
  );
};
