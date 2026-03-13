import { Hono } from "hono";
import type { Env, AppVariables } from "../lib/types";
import { ok } from "../lib/helpers";
import { requireAuth } from "../middleware/auth";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** POST /api/checkin — Agent check-in heartbeat (auth required) */
app.post("/", requireAuth(), async (c) => {
  const btcAddress = c.get("btcAddress")!;

  // Get DO stub
  const doId = c.env.ALB_DO.idFromName("singleton");
  const stub = c.env.ALB_DO.get(doId);

  const result = await stub.checkin(btcAddress);

  return c.json(ok(result, c.get("requestId")), 201);
});

export { app as checkinRoutes };
