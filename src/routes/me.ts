/**
 * Authenticated /api/me/* routes — agent's own profile, email, and usage.
 *
 * All routes require BTC auth (btcAuthMiddleware) and metering.
 */

import { Hono } from "hono";
import { btcAuthMiddleware } from "../middleware/auth";
import { x402MeterOverflow } from "../middleware/x402";
import { meteringMiddleware, getMeterState } from "../middleware/metering";
import { okResponse, errorResponse } from "../lib/helpers";
import { FREE_ALLOCATION, PAID_RATE, RATE_LIMITS } from "../lib/constants";
import type { Env, AppVariables } from "../lib/types";

const me = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Auth + x402 overflow (accepts payment when free allocation exhausted) + metering
me.use("/me/*", btcAuthMiddleware, x402MeterOverflow({
  priceSats: PAID_RATE.perRequest,
  description: "API request beyond free allocation",
}), meteringMiddleware);

/** GET /api/me/profile — Agent's own profile. */
me.get("/me/profile", async (c) => {
  const btcAddress = c.get("btcAddress")!;

  // Check registration
  const globalDoId = c.env.GLOBAL_DO.idFromName("global");
  const globalDo = c.env.GLOBAL_DO.get(globalDoId);
  const regResp = await globalDo.fetch(
    new Request(`http://internal/is-registered/${btcAddress}`)
  );
  if (!regResp.ok) {
    return errorResponse(c, "INTERNAL_ERROR", "Failed to check registration status", 500);
  }
  const { registered } = await regResp.json() as { registered: boolean };

  if (!registered) {
    return errorResponse(
      c,
      "NOT_REGISTERED",
      "Agent not registered. POST /api/register first.",
      404
    );
  }

  const agentDoId = c.env.AGENT_DO.idFromName(btcAddress);
  const agentDo = c.env.AGENT_DO.get(agentDoId);

  const profileResp = await agentDo.fetch(new Request("http://internal/profile"));
  if (!profileResp.ok) {
    return errorResponse(c, "INTERNAL_ERROR", "Failed to fetch profile", 500);
  }
  const { profile } = await profileResp.json() as { profile: Record<string, unknown> | null };

  if (!profile) {
    return errorResponse(c, "NOT_FOUND", "Profile not found", 404);
  }

  return okResponse(c, { profile });
});

/** GET /api/me/email — Agent's provisioned email details. */
me.get("/me/email", async (c) => {
  const btcAddress = c.get("btcAddress")!;

  const globalDoId = c.env.GLOBAL_DO.idFromName("global");
  const globalDo = c.env.GLOBAL_DO.get(globalDoId);
  const regResp = await globalDo.fetch(
    new Request(`http://internal/is-registered/${btcAddress}`)
  );
  if (!regResp.ok) {
    return errorResponse(c, "INTERNAL_ERROR", "Failed to check registration status", 500);
  }
  const { registered } = await regResp.json() as { registered: boolean };

  if (!registered) {
    return errorResponse(
      c,
      "NOT_REGISTERED",
      "Agent not registered. POST /api/register first.",
      404
    );
  }

  const agentDoId = c.env.AGENT_DO.idFromName(btcAddress);
  const agentDo = c.env.AGENT_DO.get(agentDoId);

  const emailResp = await agentDo.fetch(new Request("http://internal/email"));
  if (!emailResp.ok) {
    return errorResponse(c, "INTERNAL_ERROR", "Failed to fetch email details", 500);
  }
  const { email } = await emailResp.json() as { email: Record<string, unknown> | null };

  if (!email) {
    return errorResponse(c, "NOT_FOUND", "Email not provisioned", 404);
  }

  return okResponse(c, { email });
});

/** GET /api/me/email/inbox — List inbox messages (paginated). */
me.get("/me/email/inbox", async (c) => {
  const btcAddress = c.get("btcAddress")!;

  const limit = parseInt(c.req.query("limit") ?? "20", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  const agentDoId = c.env.AGENT_DO.idFromName(btcAddress);
  const agentDo = c.env.AGENT_DO.get(agentDoId);

  const inboxResp = await agentDo.fetch(
    new Request(`http://internal/inbox?limit=${Math.min(Math.max(limit, 1), 100)}&offset=${Math.max(offset, 0)}`)
  );
  if (!inboxResp.ok) {
    return errorResponse(c, "INTERNAL_ERROR", "Failed to fetch inbox", 500);
  }
  const { messages, total } = await inboxResp.json() as {
    messages: Array<Record<string, unknown>>;
    total: number;
  };

  return okResponse(c, {
    messages,
    pagination: { total, limit, offset },
  });
});

/** GET /api/me/email/inbox/:id — Read a single inbox message (marks as read). */
me.get("/me/email/inbox/:id", async (c) => {
  const btcAddress = c.get("btcAddress")!;
  const messageId = c.req.param("id");

  const agentDoId = c.env.AGENT_DO.idFromName(btcAddress);
  const agentDo = c.env.AGENT_DO.get(agentDoId);

  const msgResp = await agentDo.fetch(
    new Request(`http://internal/inbox/${encodeURIComponent(messageId)}`)
  );

  if (!msgResp.ok) {
    return errorResponse(c, "NOT_FOUND", "Message not found", 404);
  }

  const { message } = await msgResp.json() as { message: Record<string, unknown> };
  return okResponse(c, { message });
});

/** PUT /api/me/email — Update email forwarding address. */
me.put("/me/email", async (c) => {
  const btcAddress = c.get("btcAddress")!;
  const body = await c.req.json() as { forward_to?: string | null };

  const agentDoId = c.env.AGENT_DO.idFromName(btcAddress);
  const agentDo = c.env.AGENT_DO.get(agentDoId);

  const updateResp = await agentDo.fetch(
    new Request("http://internal/email/forward", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forward_to: body.forward_to ?? null }),
    })
  );

  if (!updateResp.ok) {
    return errorResponse(c, "UPDATE_FAILED", "Failed to update email forwarding", 500);
  }

  const { email } = await updateResp.json() as { email: Record<string, unknown> };
  return okResponse(c, { email });
});

/** GET /api/me/usage — Current metering window and allocation status. */
me.get("/me/usage", async (c) => {
  const btcAddress = c.get("btcAddress")!;

  const { meter, remaining, resetAt } = await getMeterState(
    c.env.ALB_KV,
    btcAddress
  );

  // Also fetch account stats from AgentDO
  const agentDoId = c.env.AGENT_DO.idFromName(btcAddress);
  const agentDo = c.env.AGENT_DO.get(agentDoId);

  const statsResp = await agentDo.fetch(new Request("http://internal/stats"));
  const stats = await statsResp.json() as { stats: Record<string, number> };

  return okResponse(c, {
    tier: "genesis",
    window: {
      start: new Date(meter.windowStart * 1000).toISOString(),
      resets_at: new Date(resetAt * 1000).toISOString(),
      type: "24h_rolling",
    },
    allocation: {
      requests: {
        used: meter.requests,
        limit: FREE_ALLOCATION.maxRequests,
        remaining,
      },
      brief_reads: {
        used: meter.briefReads,
        limit: FREE_ALLOCATION.briefReads,
        remaining: Math.max(0, FREE_ALLOCATION.briefReads - meter.briefReads),
      },
      signal_submissions: {
        used: meter.signalSubmissions,
        limit: FREE_ALLOCATION.signalSubmissions,
        remaining: Math.max(0, FREE_ALLOCATION.signalSubmissions - meter.signalSubmissions),
      },
      emails_sent: {
        used: meter.emailsSent,
        limit: FREE_ALLOCATION.emailsSent,
        remaining: Math.max(0, FREE_ALLOCATION.emailsSent - meter.emailsSent),
      },
    },
    rate_limit: {
      max_requests_per_minute: RATE_LIMITS.genesis,
    },
    lifetime: stats.stats,
  });
});

export default me;
