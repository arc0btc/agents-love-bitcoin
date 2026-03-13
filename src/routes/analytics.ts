import { Hono } from "hono";
import type { Env, AppVariables } from "../lib/types";
import { ok } from "../lib/helpers";
import { requireAuth, requireGenesis } from "../middleware/auth";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// All analytics routes require Genesis-level auth
app.use("/*", requireAuth(), requireGenesis());

/** GET /api/analytics/signals — Signal analytics */
app.get("/signals", async (c) => {
  const since = c.req.query("since");
  const doId = c.env.ALB_DO.idFromName("singleton");
  const stub = c.env.ALB_DO.get(doId);

  const data = await stub.getSignalAnalytics(since);
  return c.json(ok(data, c.get("requestId")));
});

/** GET /api/analytics/agents — Agent activity analytics */
app.get("/agents", async (c) => {
  const since = c.req.query("since");
  const doId = c.env.ALB_DO.idFromName("singleton");
  const stub = c.env.ALB_DO.get(doId);

  const data = await stub.getAgentAnalytics(since);
  return c.json(ok(data, c.get("requestId")));
});

export { app as analyticsRoutes };
