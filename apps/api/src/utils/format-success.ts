const formatSuccess = <T>(data: T) => {
  return {
    status: "success",
    data,
    error: null,
  } as const;
};

export default formatSuccess;
