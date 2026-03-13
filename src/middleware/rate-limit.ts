import type { Context, Next } from "hono";
import type { Env, AppVariables } from "../lib/types";
import { err } from "../lib/helpers";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  key: string;
  maxRequests: number;
  windowSeconds: number;
}

/**
 * KV-based sliding window rate limiter.
 * Ported from agent-news. Keys by CF-Connecting-IP.
 */
export function createRateLimitMiddleware(opts: RateLimitOptions) {
  return async function rateLimitMiddleware(
    c: Context<{ Bindings: Env; Variables: AppVariables }>,
    next: Next
  ): Promise<void | Response> {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const rlKey = `ratelimit:${opts.key}:${ip}`;

    const record =
      (await c.env.ALB_KV.get<RateLimitRecord>(rlKey, "json")) ?? {
        count: 0,
        resetAt: 0,
      };

    const now = Date.now();

    if (now > record.resetAt) {
      record.count = 1;
      record.resetAt = now + opts.windowSeconds * 1000;
    } else {
      record.count += 1;
    }

    if (record.count > opts.maxRequests) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000);
      const logger = c.get("logger");
      logger.warn("rate limit exceeded", {
        key: opts.key,
        ip,
        count: record.count,
        max: opts.maxRequests,
      });
      c.header("Retry-After", String(retryAfter));
      return c.json(err("RATE_LIMITED", `Rate limited. Try again in ${retryAfter}s`, c.get("requestId")), 429);
    }

    await c.env.ALB_KV.put(rlKey, JSON.stringify(record), {
      expirationTtl: opts.windowSeconds,
    });

    return next();
  };
}
