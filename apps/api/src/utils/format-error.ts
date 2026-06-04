import type { ApiErrorResponse } from "@launchpad/shared";

const formatError = (error: string): ApiErrorResponse => {
  return {
    status: "error",
    error,
    data: null,
  } as const;
};

export default formatError;
