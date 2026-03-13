import { VERSION } from "../version";
import type { ApiResponse } from "./types";

/** Build a success response envelope */
export function ok<T>(data: T, requestId: string, pagination?: ApiResponse<T>["pagination"]): ApiResponse<T> {
  return {
    ok: true,
    data,
    ...(pagination ? { pagination } : {}),
    meta: {
      timestamp: new Date().toISOString(),
      version: VERSION,
      requestId,
    },
  };
}

/** Build an error response envelope */
export function err(code: string, message: string, requestId: string): ApiResponse<never> {
  return {
    ok: false,
    error: { code, message },
    meta: {
      timestamp: new Date().toISOString(),
      version: VERSION,
      requestId,
    },
  };
}
