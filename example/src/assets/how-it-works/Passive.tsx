const Passive: React.FC<{ color: string }> = ({ color }) => {
  return (
    <svg
      width="35"
      height="12"
      viewBox="0 0 35 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2 6.00195C7.16667 0.66862 12.3333 0.66862 17.5 6.00195C22.6667 11.3353 27.8333 11.3353 33 6.00195"
        stroke={color}
        strokeWidth="4"
      />
    </svg>
  );
};

export default Passive;
