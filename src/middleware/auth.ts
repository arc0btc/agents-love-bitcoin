import type { Context, Next } from "hono";
import type { Env, AppVariables } from "../lib/types";
import { extractAuthHeaders, verifyTimestamp, verifyBIP322Simple } from "../services/auth";
import { CACHE_TTL } from "../lib/constants";
import { err } from "../lib/helpers";

/**
 * BIP-137/322 auth middleware.
 * Extracts and verifies signature headers. Sets `btcAddress` in context on success.
 */
export function requireAuth() {
  return async function authMiddleware(
    c: Context<{ Bindings: Env; Variables: AppVariables }>,
    next: Next
  ): Promise<void | Response> {
    const authHeaders = extractAuthHeaders(c.req.raw.headers);
    if (!authHeaders) {
      return c.json(
        err("UNAUTHORIZED", "Missing authentication headers: X-BTC-Address, X-BTC-Signature, X-BTC-Timestamp", c.get("requestId")),
        401
      );
    }

    if (!verifyTimestamp(authHeaders.timestamp)) {
      return c.json(
        err("UNAUTHORIZED", "Timestamp is outside the allowed window (±5 minutes)", c.get("requestId")),
        401
      );
    }

    const message = `${c.req.method} ${new URL(c.req.url).pathname}:${authHeaders.timestamp}`;
    if (!verifyBIP322Simple(authHeaders.address, message, authHeaders.signature)) {
      return c.json(
        err("UNAUTHORIZED", 'Invalid signature. Sign: "METHOD /path:timestamp" using BIP-137 or BIP-322.', c.get("requestId")),
        401
      );
    }

    c.set("btcAddress", authHeaders.address);
    return next();
  };
}

/**
 * Genesis-level check middleware. Must be used after requireAuth().
 * Checks KV cache first, then fetches from aibtc.com.
 */
export function requireGenesis() {
  return async function genesisMiddleware(
    c: Context<{ Bindings: Env; Variables: AppVariables }>,
    next: Next
  ): Promise<void | Response> {
    const address = c.get("btcAddress");
    if (!address) {
      return c.json(err("UNAUTHORIZED", "Authentication required", c.get("requestId")), 401);
    }

    const cacheKey = `genesis:${address}`;
    const cached = await c.env.ALB_KV.get<{ level: number }>(cacheKey, "json");

    if (cached) {
      if (cached.level >= 2) {
        c.set("isGenesis", true);
        return next();
      }
      return c.json(err("FORBIDDEN", "Genesis agent status required (level >= 2)", c.get("requestId")), 403);
    }

    // Cache miss — check aibtc.com
    try {
      const res = await fetch(`https://aibtc.com/api/agents/${encodeURIComponent(address)}`, {
        headers: { Accept: "application/json" },
      });

      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        const agent = data?.agent as Record<string, unknown> | undefined;
        const level = typeof agent?.level === "number" ? agent.level : 0;

        await c.env.ALB_KV.put(cacheKey, JSON.stringify({ level }), {
          expirationTtl: CACHE_TTL.genesisCheck,
        });

        if (level >= 2) {
          c.set("isGenesis", true);
          return next();
        }
        return c.json(err("FORBIDDEN", "Genesis agent status required (level >= 2)", c.get("requestId")), 403);
      }
    } catch {
      // Network error — deny by default
    }

    return c.json(err("FORBIDDEN", "Unable to verify Genesis status", c.get("requestId")), 403);
  };
}

/**
 * Admin auth middleware. Checks X-Admin-Key header against ADMIN_API_KEY secret.
 */
export function requireAdmin() {
  return async function adminMiddleware(
    c: Context<{ Bindings: Env; Variables: AppVariables }>,
    next: Next
  ): Promise<void | Response> {
    const key = c.req.header("X-Admin-Key");
    if (!key || !c.env.ADMIN_API_KEY || key !== c.env.ADMIN_API_KEY) {
      return c.json(err("UNAUTHORIZED", "Invalid or missing admin key", c.get("requestId")), 401);
    }
    return next();
  };
}
