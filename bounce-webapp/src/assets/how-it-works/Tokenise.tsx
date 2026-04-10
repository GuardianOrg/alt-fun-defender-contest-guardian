const Tokenise: React.FC<{ color: string }> = ({ color }) => {
  return (
    <svg
      width="26"
      height="21"
      viewBox="0 0 26 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M26 2.00195L17.3333 2.00195L17.3333 10.502L8.66667 10.502L8.66667 19.002L7.43094e-07 19.002"
        stroke={color}
        strokeWidth="4"
      />
    </svg>
  );
};

export default Tokenise;
