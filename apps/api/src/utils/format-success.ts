import type { ApiDataSource, ApiSuccessResponse } from "@launchpad/shared";

const formatSuccess = <T>(
  data: T,
  dataSource?: ApiDataSource,
): ApiSuccessResponse<T> => {
  return {
    status: "success",
    data,
    error: null,
    ...(dataSource ? { dataSource } : {}),
  } as const;
};

export default formatSuccess;
