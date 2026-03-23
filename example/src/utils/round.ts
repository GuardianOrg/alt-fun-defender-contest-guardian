const round = (value: number, decimals: number) => {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
};

export default round;
