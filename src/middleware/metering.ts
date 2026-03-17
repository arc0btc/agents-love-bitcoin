/**
 * Metering middleware — tracks free allocation per agent via KV.
 *
 * Runs after btcAuthMiddleware. Checks rolling 24h window usage.
 * If free allocation exhausted, returns 402 Payment Required.
 * Sets X-Meter-* headers on every authenticated response.
 */

import type { MiddlewareHandler } from "hono";
import { FREE_ALLOCATION, PAID_RATE, X402_HEADERS, WINDOW_SECONDS } from "../lib/constants";
import { errorResponse } from "../lib/helpers";
import { VERSION } from "../version";
import type { Env, AppVariables, MeterState } from "../lib/types";
import { buildPaymentRequiredBody, getTreasuryAddress } from "../services/x402";

type ALBMiddleware = MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }>;

function isWindowExpired(windowStart: number): boolean {
  return Math.floor(Date.now() / 1000) - windowStart >= WINDOW_SECONDS;
}

function newWindowStart(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Metering middleware for genesis-tier endpoints.
 * Must run after btcAuthMiddleware (requires btcAddress on context).
 */
export const meteringMiddleware: ALBMiddleware = async (c, next) => {
  const btcAddress = c.get("btcAddress");
  if (!btcAddress) {
    return errorResponse(c, "UNAUTHORIZED", "Authentication required for metered endpoints", 401);
  }

  const kvKey = `meter:${btcAddress}`;
  let meter = await c.env.ALB_KV.get<MeterState>(kvKey, "json");

  // Fresh window if missing or expired
  if (!meter || isWindowExpired(meter.windowStart)) {
    meter = {
      windowStart: newWindowStart(),
      requests: 0,
      briefReads: 0,
      signalSubmissions: 0,
      emailsSent: 0,
    };
  }

  // Check free allocation — return x402 V2 compliant 402 when exhausted
  if (meter.requests >= FREE_ALLOCATION.maxRequests) {
    const resetAt = meter.windowStart + WINDOW_SECONDS;
    c.header("X-Meter-Limit", String(FREE_ALLOCATION.maxRequests));
    c.header("X-Meter-Remaining", "0");
    c.header("X-Meter-Reset", String(resetAt));

    // Build x402 V2 payment requirements
    const payTo = getTreasuryAddress(c.env);
    const body = buildPaymentRequiredBody(
      c.req.url,
      "API request beyond free allocation. Pay sBTC to continue.",
      payTo,
      PAID_RATE.perRequest,
      c.env
    );
    const paymentRequiredHeader = btoa(JSON.stringify(body));

    return c.json(
      {
        ...body,
        ok: false,
        error: {
          code: "PAYMENT_REQUIRED",
          message: `Free allocation exhausted (${FREE_ALLOCATION.maxRequests} requests/24h). Pay ${PAID_RATE.perRequest} satoshis (sBTC) per request to continue, or wait for window reset.`,
        },
        data: {
          remaining: 0,
          resets_at: new Date(resetAt * 1000).toISOString(),
          window: "24h_rolling",
        },
        meta: {
          timestamp: new Date().toISOString(),
          version: VERSION,
          requestId: c.get("requestId") ?? "unknown",
        },
      },
      402,
      { [X402_HEADERS.PAYMENT_REQUIRED]: paymentRequiredHeader }
    );
  }

  // Increment request count
  meter.requests += 1;
  const remaining = FREE_ALLOCATION.maxRequests - meter.requests;
  const resetAt = meter.windowStart + WINDOW_SECONDS;

  // Write updated meter back to KV (TTL = remaining window time)
  const ttlSeconds = Math.max(resetAt - Math.floor(Date.now() / 1000), 60);
  await c.env.ALB_KV.put(kvKey, JSON.stringify(meter), {
    expirationTtl: ttlSeconds,
  });

  // Set metering headers (available to downstream handlers and response)
  c.header("X-Meter-Limit", String(FREE_ALLOCATION.maxRequests));
  c.header("X-Meter-Remaining", String(remaining));
  c.header("X-Meter-Reset", String(resetAt));

  await next();
};

/**
 * Read the current meter state for an agent without incrementing.
 * Used by GET /api/me/usage.
 */
export async function getMeterState(
  kv: KVNamespace,
  btcAddress: string
): Promise<{ meter: MeterState; remaining: number; resetAt: number }> {
  const kvKey = `meter:${btcAddress}`;
  let meter = await kv.get<MeterState>(kvKey, "json");

  if (!meter || isWindowExpired(meter.windowStart)) {
    meter = {
      windowStart: newWindowStart(),
      requests: 0,
      briefReads: 0,
      signalSubmissions: 0,
      emailsSent: 0,
    };
  }

  const resetAt = meter.windowStart + WINDOW_SECONDS;
  const remaining = Math.max(0, FREE_ALLOCATION.maxRequests - meter.requests);

  return { meter, remaining, resetAt };
}
