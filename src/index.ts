import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, AppVariables } from "./lib/types";
import { loggerMiddleware } from "./middleware/logger";
import { createRateLimitMiddleware } from "./middleware/rate-limit";
import { RATE_LIMITS } from "./lib/constants";
import { manifestRoutes } from "./routes/manifest";
import { agentRoutes } from "./routes/agents";
import { signalRoutes } from "./routes/signals";
import { beatRoutes } from "./routes/beats";
import { briefRoutes } from "./routes/briefs";
import { checkinRoutes } from "./routes/checkin";
import { analyticsRoutes } from "./routes/analytics";

export { AlbDO } from "./objects/alb-do";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ── Global middleware ──
app.use("*", cors());
app.use("*", loggerMiddleware);

// Public rate limit on all /api routes
app.use("/api/*", createRateLimitMiddleware({ key: "public", ...RATE_LIMITS.public }));

// ── Route mounting ──
app.route("/api", manifestRoutes);
app.route("/api/agents", agentRoutes);
app.route("/api/signals", signalRoutes);
app.route("/api/beats", beatRoutes);
app.route("/api/briefs", briefRoutes);
app.route("/api/checkin", checkinRoutes);
app.route("/api/analytics", analyticsRoutes);

// ── 404 fallback for /api ──
app.all("/api/*", (c) => {
  return c.json(
    {
      ok: false,
      error: { code: "NOT_FOUND", message: `No route: ${c.req.method} ${c.req.path}` },
      meta: { timestamp: new Date().toISOString(), version: "1.0.0", requestId: c.get("requestId") ?? "unknown" },
    },
    404
  );
});

export default app;
