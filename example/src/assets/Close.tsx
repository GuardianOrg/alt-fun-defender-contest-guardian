export const Close = (color: string, size: number) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
    >
      <path
        d="M0.344238 9.52121L3.29249 4.69073L3.24252 5.07384L0.460835 0.476562H2.97601L4.7916 3.65801H5.04146L6.75711 0.476562H9.12237L6.4906 5.05719L6.54057 4.72405L9.65539 9.52121H7.14021L4.99149 6.10656H4.74163L2.7095 9.52121H0.344238Z"
        fill={color}
      />
    </svg>
  );
};
