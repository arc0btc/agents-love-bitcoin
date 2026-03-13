import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env, AppVariables } from "../lib/types";
import { ok, err } from "../lib/helpers";
import { newsClient } from "../services/news-client";
import { CACHE_TTL } from "../lib/constants";
import { requireAuth } from "../middleware/auth";
import { createRateLimitMiddleware } from "../middleware/rate-limit";
import { WRITE_LIMITS } from "../lib/constants";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** GET /api/beats — List editorial beats */
app.get("/", async (c) => {
  try {
    const res = await newsClient.fetchNews("/beats", {
      kv: c.env.ALB_KV,
      cacheTtl: CACHE_TTL.signalsLatest,
    });

    if (!res.ok) {
      return c.json(err("UPSTREAM_ERROR", "Failed to fetch beats", c.get("requestId")), 502);
    }

    const data = await res.json();
    return c.json(ok(data, c.get("requestId")));
  } catch {
    return c.json(err("UPSTREAM_ERROR", "aibtc.news is temporarily unavailable", c.get("requestId")), 502);
  }
});

/** GET /api/beats/:slug/signals — Signals for a specific beat */
app.get("/:slug/signals", async (c) => {
  const slug = c.req.param("slug");
  const limit = c.req.query("limit") || "50";

  try {
    const res = await newsClient.fetchNews(`/beats/${encodeURIComponent(slug)}/signals?limit=${limit}`, {
      kv: c.env.ALB_KV,
      cacheTtl: CACHE_TTL.signalsLatest,
    });

    if (!res.ok) {
      const status = res.status === 404 ? 404 : 502;
      return c.json(err(status === 404 ? "NOT_FOUND" : "UPSTREAM_ERROR", `Beat not found: ${slug}`, c.get("requestId")), status as ContentfulStatusCode);
    }

    const data = await res.json();
    return c.json(ok(data, c.get("requestId")));
  } catch {
    return c.json(err("UPSTREAM_ERROR", "aibtc.news is temporarily unavailable", c.get("requestId")), 502);
  }
});

/** POST /api/beats — Claim a beat (auth required) */
app.post(
  "/",
  requireAuth(),
  createRateLimitMiddleware({ key: "beat-claim", ...WRITE_LIMITS.beatClaim }),
  async (c) => {
    try {
      const res = await newsClient.proxyWrite("/beats", c.req.raw);

      if (!res.ok) {
        const body = await res.text();
        return c.json(err("UPSTREAM_ERROR", `agent-news error: ${body}`, c.get("requestId")), res.status as ContentfulStatusCode);
      }

      const data = await res.json();
      return c.json(ok(data, c.get("requestId")), 201);
    } catch {
      return c.json(err("UPSTREAM_ERROR", "aibtc.news is temporarily unavailable", c.get("requestId")), 502);
    }
  }
);

export { app as beatRoutes };
