/**
 * Authenticated /api/me/* routes — agent's own profile, email, and usage.
 *
 * All routes require BTC auth and pass through the per-tier rate-limit gate.
 * `/api/me/usage` is a status surface that reports the agent's tier and the
 * configured per-minute ceiling; per-request remaining counts are no longer
 * tracked locally now that enforcement lives in the Cloudflare `ratelimits`
 * binding.
 */

import { Hono } from "hono";
import { btcAuthMiddleware } from "../middleware/auth";
import { tieredRateLimitMiddleware } from "../middleware/rate-limit";
import { okResponse, errorResponse } from "../lib/helpers";
import { RATE_LIMITS } from "../lib/constants";
import type { Env, AppVariables } from "../lib/types";

const me = new Hono<{ Bindings: Env; Variables: AppVariables }>();

me.use("/me/*", btcAuthMiddleware, tieredRateLimitMiddleware);

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

/**
 * GET /api/me/inbox-status — Wake-up bit for poll-driven runtimes.
 *
 * Returns `{ unread, total }` straight from AgentDO `account_stats` with no
 * inbox-table touch. Runtimes call this before the full inbox fetch and
 * skip the heavier query when `unread === 0`.
 */
me.get("/me/inbox-status", async (c) => {
  const btcAddress = c.get("btcAddress")!;
  const agentDoId = c.env.AGENT_DO.idFromName(btcAddress);
  const agentDo = c.env.AGENT_DO.get(agentDoId);

  const resp = await agentDo.fetch(new Request("http://internal/inbox-status"));
  if (!resp.ok) {
    return errorResponse(c, "INTERNAL_ERROR", "Failed to fetch inbox status", 500);
  }
  const status = await resp.json() as { unread: number; total: number };
  return okResponse(c, status);
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

/**
 * GET /api/me/usage — Current tier + configured per-minute ceiling.
 *
 * Counters live inside the Cloudflare `ratelimits` binding, which doesn't
 * expose remaining counts. We surface what we can: the agent's tier and the
 * documented ceiling. Agents budget themselves locally; the binding enforces.
 */
me.get("/me/usage", (c) => {
  const tier = c.get("rateTier");
  if (!tier) {
    return errorResponse(c, "INTERNAL_ERROR", "Rate state unavailable", 500);
  }
  return okResponse(c, {
    tier,
    ratePerMinute: RATE_LIMITS[tier],
  });
});

export default me;
