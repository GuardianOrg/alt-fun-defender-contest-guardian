const formatError = (error: string) => {
  return {
    status: "error",
    error,
    data: null,
  } as const;
};

export default formatError;
