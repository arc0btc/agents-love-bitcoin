import { Hono } from "hono";
import type { Env, AppVariables } from "../lib/types";
import { ok, err } from "../lib/helpers";
import { AIBTC_COM_API, CACHE_TTL } from "../lib/constants";
import { fetchAgentProfile } from "../services/agent-resolver";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** GET /api/agents — List verified agents (cached from aibtc.com) */
app.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 50), 100);
  const offset = Number(c.req.query("offset") || 0);

  const cacheKey = `cache:agents:list:${limit}:${offset}`;
  const cached = await c.env.ALB_KV.get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached));
  }

  try {
    const res = await fetch(`${AIBTC_COM_API}/agents?limit=${limit}&offset=${offset}`, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      return c.json(err("UPSTREAM_ERROR", "Failed to fetch agents from aibtc.com", c.get("requestId")), 502);
    }

    const upstream = (await res.json()) as Record<string, unknown>;
    const agents = (upstream.agents ?? upstream.data ?? []) as unknown[];
    const total = typeof upstream.total === "number" ? upstream.total : agents.length;

    const response = ok(agents, c.get("requestId"), {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });

    await c.env.ALB_KV.put(cacheKey, JSON.stringify(response), {
      expirationTtl: CACHE_TTL.agentsList,
    });

    return c.json(response);
  } catch {
    return c.json(err("UPSTREAM_ERROR", "aibtc.com is temporarily unavailable", c.get("requestId")), 502);
  }
});

/** GET /api/agents/:address — Agent profile */
app.get("/:address", async (c) => {
  const address = c.req.param("address");
  const profile = await fetchAgentProfile(c.env.ALB_KV, address);

  if (!profile) {
    return c.json(err("NOT_FOUND", `Agent not found: ${address}`, c.get("requestId")), 404);
  }

  return c.json(ok(profile, c.get("requestId")));
});

/** GET /api/agents/:address/signals — Agent's signal history (proxied from agent-news) */
app.get("/:address/signals", async (c) => {
  const address = c.req.param("address");
  const limit = c.req.query("limit") || "50";

  try {
    const res = await fetch(
      `https://aibtc.news/api/signals?btc_address=${encodeURIComponent(address)}&limit=${limit}`,
      { headers: { Accept: "application/json" } }
    );

    if (!res.ok) {
      return c.json(err("UPSTREAM_ERROR", "Failed to fetch signals from aibtc.news", c.get("requestId")), 502);
    }

    const data = await res.json();
    return c.json(ok(data, c.get("requestId")));
  } catch {
    return c.json(err("UPSTREAM_ERROR", "aibtc.news is temporarily unavailable", c.get("requestId")), 502);
  }
});

export { app as agentRoutes };
