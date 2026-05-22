export type ApiDataSource = "live" | "degraded";

export interface ApiSuccessResponse<T> {
  status: "success";
  data: T;
  error: null;
  dataSource?: ApiDataSource;
}

export interface ApiErrorResponse {
  status: "error";
  data: null;
  error: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
