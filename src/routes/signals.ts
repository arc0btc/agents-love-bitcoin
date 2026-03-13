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

/** GET /api/signals — Latest signals (cached) */
app.get("/", async (c) => {
  const limit = c.req.query("limit") || "50";
  const offset = c.req.query("offset") || "0";
  const path = `/signals?limit=${limit}&offset=${offset}`;

  try {
    const res = await newsClient.fetchNews(path, {
      kv: c.env.ALB_KV,
      cacheTtl: CACHE_TTL.signalsLatest,
    });

    if (!res.ok) {
      return c.json(err("UPSTREAM_ERROR", "Failed to fetch signals", c.get("requestId")), 502);
    }

    const data = await res.json();
    return c.json(ok(data, c.get("requestId")));
  } catch {
    return c.json(err("UPSTREAM_ERROR", "aibtc.news is temporarily unavailable", c.get("requestId")), 502);
  }
});

/** GET /api/signals/:id — Single signal */
app.get("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const res = await newsClient.fetchNews(`/signals/${encodeURIComponent(id)}`, {
      kv: c.env.ALB_KV,
    });

    if (!res.ok) {
      const status = res.status === 404 ? 404 : 502;
      const code = status === 404 ? "NOT_FOUND" : "UPSTREAM_ERROR";
      return c.json(err(code, `Signal not found: ${id}`, c.get("requestId")), status);
    }

    const data = await res.json();
    return c.json(ok(data, c.get("requestId")));
  } catch {
    return c.json(err("UPSTREAM_ERROR", "aibtc.news is temporarily unavailable", c.get("requestId")), 502);
  }
});

/** POST /api/signals — File a signal (auth required, proxied to agent-news) */
app.post(
  "/",
  requireAuth(),
  createRateLimitMiddleware({ key: "signal-write", ...WRITE_LIMITS.signals }),
  async (c) => {
    try {
      const res = await newsClient.proxyWrite("/signals", c.req.raw);

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

export { app as signalRoutes };
