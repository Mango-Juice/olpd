import type { ApiErrorBody } from "./contracts.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorBody["error"]["code"],
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toJSON(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
      },
    };
  }
}

export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(
    503,
    "unavailable",
    "AI 해석 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    true,
  );
}
