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
import { VERSION } from "./version";
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
      version: VERSION,
      requestId: c.get("requestId") ?? "unknown",
    },
  }, 404);
});

// Global error handler — catches unhandled exceptions from route handlers
app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err);
  const isDOError = message.includes("idFromName") || message.includes("storage.sql") || message.includes("Cannot read propert");
  return c.json({
    ok: false,
    error: {
      code: isDOError ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR",
      message: isDOError
        ? "Infrastructure not ready. Durable Object bindings unavailable — redeploy required."
        : "An unexpected error occurred.",
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: VERSION,
      requestId: c.get("requestId") ?? "unknown",
    },
  }, 500);
});

export default {
  fetch: app.fetch,
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleEmail(message, env));
  },
};
