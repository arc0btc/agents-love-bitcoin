import type { Context } from "hono";
import { VERSION } from "../version";
import type { ApiResponse } from "./types";

/** Generate a unique request ID */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/** Build a success response */
export function okResponse<T>(c: Context, data: T, status: 200 | 201 = 200): Response {
  const requestId = c.get("requestId") as string ?? generateRequestId();
  const body: ApiResponse<T> = {
    ok: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      version: VERSION,
      requestId,
    },
  };
  return c.json(body, status);
}

/** Build an error response */
export function errorResponse(
  c: Context,
  code: string,
  message: string,
  status: 400 | 401 | 402 | 403 | 404 | 409 | 429 | 500 | 502 | 503 = 400
): Response {
  const requestId = c.get("requestId") as string ?? generateRequestId();
  const body: ApiResponse = {
    ok: false,
    error: { code, message },
    meta: {
      timestamp: new Date().toISOString(),
      version: VERSION,
      requestId,
    },
  };
  return c.json(body, status);
}

/** Validate that an address is P2WPKH (bc1q) */
export function isP2WPKH(address: string): boolean {
  return address.startsWith("bc1q") || address.startsWith("tb1q");
}

/** Validate that an address is a valid Stacks mainnet address */
export function isStacksMainnet(address: string): boolean {
  return address.startsWith("SP");
}
