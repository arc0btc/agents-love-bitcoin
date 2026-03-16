/**
 * Agents Love Bitcoin — Cloudflare Worker entry point.
 *
 * Hono app with per-address Durable Objects, dual-sig auth, and genesis gating.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestIdMiddleware } from "./middleware/auth";
import manifestRoutes from "./routes/manifest";
import registerRoutes from "./routes/register";
import onboardingRoutes from "./routes/onboarding";
import meRoutes from "./routes/me";
import paidRoutes from "./routes/paid";
import { handleEmail } from "./email";
import type { Env, AppVariables } from "./lib/types";

// Re-export Durable Object classes for wrangler
export { AgentDO } from "./objects/agent-do";
export { GlobalDO } from "./objects/global-do";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Global middleware
app.use("*", cors());
app.use("*", requestIdMiddleware);

// Mount routes under /api
app.route("/api", manifestRoutes);
app.route("/api", onboardingRoutes);
app.route("/api", registerRoutes);
app.route("/api", meRoutes);
app.route("/api", paidRoutes);

// Catch-all 404
app.all("*", (c) => {
  return c.json({
    ok: false,
    error: { code: "NOT_FOUND", message: "Endpoint not found" },
    meta: {
      timestamp: new Date().toISOString(),
      version: "0.1.0",
      requestId: c.get("requestId") ?? "unknown",
    },
  }, 404);
});

export default {
  fetch: app.fetch,
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleEmail(message, env));
  },
};
