/**
 * Admin routes — protected by X-Admin-Key header.
 *
 * GET /api/admin/schema-health
 *   Introspects GlobalDO and AgentDO for missing indexes and unexpected scan
 *   query plans. Returns a structured JSON response keyed by component so a
 *   D1 section can be appended naturally in Phase 5 without breaking callers.
 */

import { Hono } from "hono";
import { okResponse } from "../lib/helpers";
import type { Env, AppVariables } from "../lib/types";

const admin = new Hono<{ Bindings: Env; Variables: AppVariables }>();

admin.get("/admin/schema-health", async (c) => {
  // Inline admin-key check — matches the pattern in register.ts and rate-limit.ts
  const adminKey = c.req.header("X-Admin-Key");
  const isAdmin = Boolean(adminKey && c.env.ADMIN_API_KEY && adminKey === c.env.ADMIN_API_KEY);
  if (!isAdmin) {
    return c.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Invalid or missing admin key" } },
      401
    );
  }

  // --- GlobalDO health ---
  const globalDoId = c.env.GLOBAL_DO.idFromName("global");
  const globalDo = c.env.GLOBAL_DO.get(globalDoId);

  const globalResp = await globalDo.fetch(
    new Request("http://internal/schema-health")
  );
  if (!globalResp.ok) {
    return c.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "GlobalDO schema-health fetch failed" } },
      500
    );
  }
  const globalHealth = await globalResp.json() as {
    missingIndexes: string[];
    unexpectedScans: string[];
    plans: Record<string, unknown[]>;
    rowCounts: Record<string, number>;
  };

  // --- AgentDO health ---
  // Use the first registered agent's BTC address if one exists; otherwise use a
  // synthetic probe key ("schema-health-probe") so the DO self-initialises with
  // an empty-but-healthy schema regardless of registration count.
  let agentProbeKey = "schema-health-probe";
  if (globalHealth.rowCounts["agent_index"] > 0) {
    const firstAgentResp = await globalDo.fetch(
      new Request("http://internal/first-agent")
    );
    if (firstAgentResp.ok) {
      const { btcAddress } = await firstAgentResp.json() as { btcAddress: string };
      if (btcAddress) agentProbeKey = btcAddress;
    }
  }

  const agentDoId = c.env.AGENT_DO.idFromName(agentProbeKey);
  const agentDo = c.env.AGENT_DO.get(agentDoId);

  const agentResp = await agentDo.fetch(
    new Request("http://internal/schema-health")
  );
  if (!agentResp.ok) {
    return c.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "AgentDO schema-health fetch failed" } },
      500
    );
  }
  const agentHealth = await agentResp.json() as {
    missingIndexes: string[];
    unexpectedScans: string[];
    plans: Record<string, unknown[]>;
    rowCounts: Record<string, number>;
  };

  return okResponse(c, {
    globalDo: globalHealth,
    agentDo: agentHealth,
    // d1: {} — reserved for Phase 5
  });
});

export default admin;
