/**
 * Metering middleware — per-minute rate gate.
 *
 * - `meteringMiddleware`: authenticated routes. Defers to AgentDO.checkAndIncrementRate
 *   which derives the tier from the agent's level and atomically counts within a
 *   60-second window. Credit-funded requests bypass the window cap entirely.
 * - `publicRateMiddleware`: no-auth routes. Per-IP cap at RATE_LIMITS.public via KV.
 *   Race-tolerant — KV has no atomic increment but a 30/min ceiling per IP is fine.
 *
 * Both surfaces emit X-Rate-Limit, X-Rate-Remaining, and X-Rate-Reset (seconds-until-reset).
 * On 429 the body carries a forward-compat payment hint pointing at /api/me/topup.
 */

import type { MiddlewareHandler } from "hono";
import { RATE_LIMITS, RATE_WINDOW_MS } from "../lib/constants";
import { errorResponse } from "../lib/helpers";
import { VERSION } from "../version";
import type { Env, AppVariables, PublicRateState, RateCheckResult } from "../lib/types";

type ALBMiddleware = MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }>;

function setRateHeaders(
  c: Parameters<ALBMiddleware>[0],
  ratePerMinute: number,
  requestsInWindow: number,
  resetAtMs: number
): void {
  const remaining = Math.max(0, ratePerMinute - requestsInWindow);
  const resetSeconds = Math.max(0, Math.ceil((resetAtMs - Date.now()) / 1000));
  c.header("X-Rate-Limit", String(ratePerMinute));
  c.header("X-Rate-Remaining", String(remaining));
  c.header("X-Rate-Reset", String(resetSeconds));
}

function rateLimited(
  c: Parameters<ALBMiddleware>[0],
  ratePerMinute: number,
  resetAtMs: number,
  message: string
): Response {
  setRateHeaders(c, ratePerMinute, ratePerMinute, resetAtMs);
  return c.json(
    {
      ok: false,
      error: { code: "RATE_LIMITED", message },
      // Forward-compat hint so clients can build retry-after-payment logic
      // against a stable contract before /api/me/topup ships.
      payment: {
        amountSats: 100,
        perCredits: 100,
        endpoint: "/api/me/topup",
      },
      data: {
        rate_per_minute: ratePerMinute,
        resets_at: new Date(resetAtMs).toISOString(),
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: VERSION,
        requestId: c.get("requestId") ?? "unknown",
      },
    },
    429
  );
}

/**
 * Per-minute rate gate for authenticated routes. Must run after btcAuthMiddleware.
 * Admin API key bypasses the gate entirely.
 */
export const meteringMiddleware: ALBMiddleware = async (c, next) => {
  const btcAddress = c.get("btcAddress");
  if (!btcAddress) {
    return errorResponse(c, "UNAUTHORIZED", "Authentication required for rate-gated endpoints", 401);
  }

  const adminKey = c.req.header("X-Admin-Key");
  if (adminKey && c.env.ADMIN_API_KEY && adminKey === c.env.ADMIN_API_KEY) {
    await next();
    return;
  }

  const agentDoId = c.env.AGENT_DO.idFromName(btcAddress);
  const agentDo = c.env.AGENT_DO.get(agentDoId);

  const resp = await agentDo.fetch(
    new Request("http://internal/rate/check", { method: "POST" })
  );
  if (!resp.ok) {
    return errorResponse(c, "INTERNAL_ERROR", "Rate gate unavailable", 500);
  }
  const result = await resp.json() as RateCheckResult;

  if (!result.allowed) {
    return rateLimited(
      c,
      result.ratePerMinute,
      result.resetAt,
      `Rate limit exceeded (${result.ratePerMinute}/min, ${result.tier} tier). Top up sBTC credits via /api/me/topup or wait for window reset.`
    );
  }

  // Stash so /api/me/usage can read it back without a second DO round-trip.
  c.set("rateResult", result);
  setRateHeaders(c, result.ratePerMinute, result.requestsInWindow, result.resetAt);
  await next();
};

/**
 * Per-IP rate gate for public no-auth routes. KV-backed, race-tolerant.
 * Falls open on KV errors — public endpoints (manifest/health/onboarding/llms)
 * are static enough that a brief KV outage shouldn't block discovery.
 */
export const publicRateMiddleware: ALBMiddleware = async (c, next) => {
  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? "unknown";
  const ratePerMinute = RATE_LIMITS.public;
  const now = Date.now();
  const kvKey = `pubrate:${ip}`;

  let state: PublicRateState | null = null;
  try {
    state = await c.env.ALB_KV.get<PublicRateState>(kvKey, "json");
  } catch {
    // KV read failed — fail open
    await next();
    return;
  }

  if (!state || now - state.windowStartedAt >= RATE_WINDOW_MS) {
    state = { windowStartedAt: now, requestsInWindow: 0 };
  }

  const resetAtMs = state.windowStartedAt + RATE_WINDOW_MS;

  if (state.requestsInWindow >= ratePerMinute) {
    return rateLimited(
      c,
      ratePerMinute,
      resetAtMs,
      `Rate limit exceeded (${ratePerMinute}/min, public tier). Register and authenticate for higher per-tier ceilings.`
    );
  }

  state.requestsInWindow += 1;
  setRateHeaders(c, ratePerMinute, state.requestsInWindow, resetAtMs);

  // Best-effort write — TTL ~2 windows so stale state self-cleans.
  c.executionCtx.waitUntil(
    c.env.ALB_KV.put(kvKey, JSON.stringify(state), {
      expirationTtl: Math.max(120, Math.ceil(RATE_WINDOW_MS / 1000) * 2),
    }).catch(() => {})
  );

  await next();
};
