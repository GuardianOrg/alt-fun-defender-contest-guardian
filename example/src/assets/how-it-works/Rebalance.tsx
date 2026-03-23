const Rebalance: React.FC<{ color: string }> = ({ color }) => {
  return (
    <svg
      width="24"
      height="17"
      viewBox="0 0 24 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 17.002V9.50195M12 9.50195L2 2.00195M12 9.50195L22 2.00195"
        stroke={color}
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default Rebalance;
