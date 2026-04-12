export type DataSource = "live" | "degraded";

const formatSuccess = <T>(data: T, dataSource?: DataSource) => {
  return {
    status: "success",
    data,
    error: null,
    ...(dataSource ? { dataSource } : {}),
  } as const;
};

export default formatSuccess;
