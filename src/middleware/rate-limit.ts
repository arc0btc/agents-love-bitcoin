/**
 * Rate-limit middlewares backed by Cloudflare `ratelimits` bindings.
 *
 * - `publicRateLimitMiddleware`: no-auth routes (manifest / llms / onboarding).
 *   Keyed by client IP against `RL_PUBLIC`.
 * - `tieredRateLimitMiddleware`: authenticated routes. Resolves the agent's tier
 *   from `GlobalDO.agent_index.level` (cached in a worker-isolate `Map` for 60s
 *   so 99% of requests skip the DO round-trip) and consults the matching binding
 *   keyed by btc-address. Admin API key bypasses.
 *
 * The previous KV/AgentDO-based per-request counter is gone: counting happens
 * inside the binding, so there are no per-request KV writes and no DO writes
 * just for the rate gate.
 */
import type { MiddlewareHandler } from "hono";
import { getAgentTier } from "../services/directory";
import { errorResponse } from "../lib/helpers";
import { RATE_LIMITS } from "../lib/constants";
import type { Env, AppVariables, Tier } from "../lib/types";

type ALBMiddleware = MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }>;

const TIER_CACHE_TTL_MS = 60_000;
const tierCache = new Map<string, { tier: Tier; fetchedAt: number }>();

function rateLimited(
  c: Parameters<ALBMiddleware>[0],
  ratePerMinute: number,
  message: string
): Response {
  c.header("Retry-After", "60");
  c.header("X-Rate-Limit", String(ratePerMinute));
  return c.json(
    {
      ok: false,
      error: { code: "RATE_LIMITED", message },
      meta: {
        timestamp: new Date().toISOString(),
        version: "rate-limit",
        requestId: c.get("requestId") ?? "unknown",
      },
    },
    429
  );
}

/** Per-IP rate gate for public no-auth routes. */
export const publicRateLimitMiddleware: ALBMiddleware = async (c, next) => {
  const limiter = c.env.RL_PUBLIC;
  if (!limiter) {
    // Binding missing — fail open; manifest/health/onboarding/llms are static
    // enough that a brief gap shouldn't block discovery.
    return next();
  }

  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? "unknown";
  const { success } = await limiter.limit({ key: `pub:${ip}` });
  if (!success) {
    return rateLimited(
      c,
      RATE_LIMITS.public,
      `Rate limit exceeded (${RATE_LIMITS.public}/min, public tier). Register and authenticate for higher per-tier ceilings.`
    );
  }
  c.header("X-Rate-Limit", String(RATE_LIMITS.public));
  await next();
};

async function resolveTier(c: Parameters<ALBMiddleware>[0], btcAddress: string): Promise<Tier> {
  const cached = tierCache.get(btcAddress);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < TIER_CACHE_TTL_MS) {
    return cached.tier;
  }

  // Resolve via D1 directory service (falls back to GlobalDO on D1 miss)
  const tier = await getAgentTier(c.env, btcAddress);
  tierCache.set(btcAddress, { tier, fetchedAt: now });
  return tier;
}

/**
 * Per-tier rate gate for authenticated routes. Must run after btcAuthMiddleware.
 * Admin API key bypasses the gate.
 */
export const tieredRateLimitMiddleware: ALBMiddleware = async (c, next) => {
  const btcAddress = c.get("btcAddress");
  if (!btcAddress) {
    return errorResponse(c, "UNAUTHORIZED", "Authentication required for rate-gated endpoints", 401);
  }

  const adminKey = c.req.header("X-Admin-Key");
  if (adminKey && c.env.ADMIN_API_KEY && adminKey === c.env.ADMIN_API_KEY) {
    await next();
    return;
  }

  const tier = await resolveTier(c, btcAddress);
  const limiter = tier === "genesis" ? c.env.RL_GENESIS : c.env.RL_REGISTERED;
  const ratePerMinute = RATE_LIMITS[tier];

  if (!limiter) {
    // Binding missing — fail closed for authenticated routes; better to surface
    // a clear 503 than to silently disable the gate on production traffic.
    return errorResponse(c, "INTERNAL_ERROR", "Rate gate unavailable", 503);
  }

  const { success } = await limiter.limit({ key: `${tier}:${btcAddress}` });
  if (!success) {
    return rateLimited(
      c,
      ratePerMinute,
      `Rate limit exceeded (${ratePerMinute}/min, ${tier} tier).`
    );
  }
  c.header("X-Rate-Limit", String(ratePerMinute));
  c.set("rateTier", tier);
  await next();
};

