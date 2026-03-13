import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env, AppVariables } from "../lib/types";
import { ok, err } from "../lib/helpers";
import { newsClient } from "../services/news-client";
import { CACHE_TTL, WRITE_LIMITS } from "../lib/constants";
import { requireAuth, requireGenesis } from "../middleware/auth";
import { createRateLimitMiddleware } from "../middleware/rate-limit";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** GET /api/briefs — List compiled briefs */
app.get("/", async (c) => {
  try {
    const res = await newsClient.fetchNews("/briefs", {
      kv: c.env.ALB_KV,
      cacheTtl: CACHE_TTL.briefsLatest,
    });

    if (!res.ok) {
      return c.json(err("UPSTREAM_ERROR", "Failed to fetch briefs", c.get("requestId")), 502);
    }

    const data = await res.json();
    return c.json(ok(data, c.get("requestId")));
  } catch {
    return c.json(err("UPSTREAM_ERROR", "aibtc.news is temporarily unavailable", c.get("requestId")), 502);
  }
});

/** GET /api/briefs/latest — Most recent brief */
app.get("/latest", async (c) => {
  try {
    const res = await newsClient.fetchNews("/briefs/latest", {
      kv: c.env.ALB_KV,
      cacheTtl: CACHE_TTL.briefsLatest,
    });

    if (!res.ok) {
      return c.json(err("NOT_FOUND", "No briefs available", c.get("requestId")), 404);
    }

    const data = await res.json();
    return c.json(ok(data, c.get("requestId")));
  } catch {
    return c.json(err("UPSTREAM_ERROR", "aibtc.news is temporarily unavailable", c.get("requestId")), 502);
  }
});

/** GET /api/briefs/:date — Brief for a specific date */
app.get("/:date", async (c) => {
  const date = c.req.param("date");

  try {
    const res = await newsClient.fetchNews(`/briefs/${encodeURIComponent(date)}`, {
      kv: c.env.ALB_KV,
      cacheTtl: CACHE_TTL.briefsLatest,
    });

    if (!res.ok) {
      return c.json(err("NOT_FOUND", `Brief not found for date: ${date}`, c.get("requestId")), 404);
    }

    const data = await res.json();
    return c.json(ok(data, c.get("requestId")));
  } catch {
    return c.json(err("UPSTREAM_ERROR", "aibtc.news is temporarily unavailable", c.get("requestId")), 502);
  }
});

/** POST /api/briefs/compile — Compile today's brief (Genesis only) */
app.post(
  "/compile",
  requireAuth(),
  requireGenesis(),
  createRateLimitMiddleware({ key: "brief-compile", ...WRITE_LIMITS.briefCompile }),
  async (c) => {
    try {
      const res = await newsClient.proxyWrite("/briefs/compile", c.req.raw);

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

export { app as briefRoutes };
