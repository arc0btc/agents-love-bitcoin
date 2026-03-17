/**
 * POST /api/register — Dual-sig BIP-322+SIP-018 registration with genesis gate and DO provisioning.
 *
 * Flow (from onboarding-flow-spec.md §4.2):
 * 1. Parse + validate headers (done by dualSigAuthMiddleware)
 * 2. Validate timestamp (done by dualSigAuthMiddleware)
 * 3. Verify BTC signature (done by dualSigAuthMiddleware)
 * 4. Verify STX signature (done by dualSigAuthMiddleware)
 * 5. Check genesis status (aibtc.com lookup + KV cache)
 * 6. Check existing registration (idempotent — return existing profile if found)
 * 7. Fetch AIBTC name
 * 8. Check name uniqueness
 * 9. Create AgentDO (profile + email + stats)
 * 10. Update GlobalDO (directory index + address resolution + stats)
 * 11. Return success (201 Created)
 */

import { Hono } from "hono";
import { resolveGenesisAgent } from "../services/agent-resolver";
import { dualSigAuthMiddleware } from "../middleware/auth";
import { okResponse, errorResponse } from "../lib/helpers";
import { EMAIL_DOMAIN, FREE_ALLOCATION, RATE_LIMITS } from "../lib/constants";
import { VERSION } from "../version";
import type { Env, AppVariables, RegistrationData } from "../lib/types";

const register = new Hono<{ Bindings: Env; Variables: AppVariables }>();

register.post("/register", dualSigAuthMiddleware, async (c) => {
  const btcAddress = c.get("btcAddress")!;
  const stxAddress = c.get("stxAddress")!;

  // ── Step 5: Check genesis status ──────────────────────────────────────
  const resolved = await resolveGenesisAgent(btcAddress, c.env);
  if (!resolved.ok) {
    const statusMap: Record<string, 400 | 403 | 502> = {
      NOT_FOUND: 403,
      NOT_GENESIS: 403,
      NO_NAME: 400,
      UPSTREAM_ERROR: 502,
    };
    const status = statusMap[resolved.code] ?? 400;

    // Include onboarding guidance for non-genesis agents
    if (resolved.code === "NOT_GENESIS" || resolved.code === "NOT_FOUND") {
      return c.json({
        ok: false,
        error: { code: "FORBIDDEN", message: resolved.error },
        data: {
          current_level: resolved.level ?? 0,
          required_level: 2,
          onboarding_url: "https://agentslovebitcoin.com/api/onboarding",
        },
        meta: {
          timestamp: new Date().toISOString(),
          version: VERSION,
          requestId: c.get("requestId"),
        },
      }, status);
    }

    const codeMap: Record<string, string> = {
      NO_NAME: "VALIDATION_ERROR",
      UPSTREAM_ERROR: "UPSTREAM_ERROR",
    };
    return errorResponse(c, codeMap[resolved.code] ?? resolved.code, resolved.error, status);
  }

  const agent = resolved.agent;
  const aibtcName = agent.aibtcName!;
  const emailAddress = `${aibtcName}@${EMAIL_DOMAIN}`;

  // ── Step 6: Check existing registration (idempotent) ──────────────────
  const globalDoId = c.env.GLOBAL_DO.idFromName("global");
  const globalDo = c.env.GLOBAL_DO.get(globalDoId);

  const isRegResp = await globalDo.fetch(
    new Request(`http://internal/is-registered/${btcAddress}`)
  );
  if (!isRegResp.ok) {
    return errorResponse(c, "INTERNAL_ERROR", "Failed to check registration status", 500);
  }
  const { registered } = await isRegResp.json() as { registered: boolean };

  if (registered) {
    // Return existing profile (idempotent)
    const agentDoId = c.env.AGENT_DO.idFromName(btcAddress);
    const agentDo = c.env.AGENT_DO.get(agentDoId);

    const profileResp = await agentDo.fetch(new Request("http://internal/profile"));
    if (!profileResp.ok) {
      return errorResponse(c, "INTERNAL_ERROR", "Failed to fetch agent profile", 500);
    }
    const { profile } = await profileResp.json() as { profile: Record<string, unknown> | null };

    const emailResp = await agentDo.fetch(new Request("http://internal/email"));
    if (!emailResp.ok) {
      return errorResponse(c, "INTERNAL_ERROR", "Failed to fetch agent email config", 500);
    }
    const { email } = await emailResp.json() as { email: Record<string, unknown> | null };

    const data: RegistrationData = {
      agent: {
        btc_address: btcAddress,
        stx_address: stxAddress,
        aibtc_name: aibtcName,
        bns_name: agent.bnsName,
        level: agent.level,
        level_name: agent.levelName,
        erc8004_id: agent.erc8004AgentId,
        registered_at: (profile?.registered_at as string) ?? new Date().toISOString(),
      },
      email: {
        address: (email?.email_address as string) ?? emailAddress,
        status: "active",
        provisioned_at: (email?.provisioned_at as string) ?? new Date().toISOString(),
      },
      api_access: buildApiAccess(),
      next_steps: buildNextSteps(),
    };

    return okResponse(c, data, 200);
  }

  // ── Step 7-8: Check name uniqueness ───────────────────────────────────
  const nameCheckResp = await globalDo.fetch(
    new Request(`http://internal/is-name-taken?name=${encodeURIComponent(aibtcName)}&exclude=${encodeURIComponent(btcAddress)}`)
  );
  if (!nameCheckResp.ok) {
    return errorResponse(c, "INTERNAL_ERROR", "Failed to check name uniqueness", 500);
  }
  const { taken } = await nameCheckResp.json() as { taken: boolean };
  if (taken) {
    return errorResponse(
      c,
      "CONFLICT",
      `Email ${emailAddress} already provisioned to another agent`,
      409
    );
  }

  // ── Step 9: Create AgentDO ────────────────────────────────────────────
  const agentDoId = c.env.AGENT_DO.idFromName(btcAddress);
  const agentDo = c.env.AGENT_DO.get(agentDoId);

  const registerResp = await agentDo.fetch(
    new Request("http://internal/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        btcAddress,
        stxAddress,
        aibtcName,
        bnsName: agent.bnsName,
        level: agent.level,
        levelName: agent.levelName,
        erc8004Id: agent.erc8004AgentId,
        emailAddress,
      }),
    })
  );

  if (!registerResp.ok) {
    return errorResponse(c, "INTERNAL_ERROR", "Failed to create agent profile", 500);
  }

  const { profile, email } = await registerResp.json() as {
    profile: { registered_at: string };
    email: { email_address: string; provisioned_at: string };
  };

  // ── Step 10: Update GlobalDO ──────────────────────────────────────────
  const indexResp = await globalDo.fetch(
    new Request("http://internal/index-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        btcAddress,
        stxAddress,
        aibtcName,
        displayName: agent.bnsName ?? aibtcName,
        level: agent.level,
        emailAddress,
      }),
    })
  );

  if (!indexResp.ok) {
    return errorResponse(c, "INTERNAL_ERROR", "Agent registered but global indexing failed — retry registration", 500);
  }

  // ── Step 11: Return success ───────────────────────────────────────────
  const data: RegistrationData = {
    agent: {
      btc_address: btcAddress,
      stx_address: stxAddress,
      aibtc_name: aibtcName,
      bns_name: agent.bnsName,
      level: agent.level,
      level_name: agent.levelName,
      erc8004_id: agent.erc8004AgentId,
      registered_at: profile.registered_at,
    },
    email: {
      address: email.email_address,
      status: "active",
      provisioned_at: email.provisioned_at,
    },
    api_access: buildApiAccess(),
    next_steps: buildNextSteps(),
  };

  return okResponse(c, data, 201);
});

function buildApiAccess(): RegistrationData["api_access"] {
  const resetTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return {
    tier: "genesis",
    free_allocation: {
      max_requests: FREE_ALLOCATION.maxRequests,
      brief_reads: FREE_ALLOCATION.briefReads,
      signal_submissions: FREE_ALLOCATION.signalSubmissions,
      emails_sent: FREE_ALLOCATION.emailsSent,
      window: "24h_rolling",
      resets_at: resetTime,
    },
    rate_limit: {
      max_requests_per_minute: RATE_LIMITS.genesis,
    },
  };
}

function buildNextSteps(): RegistrationData["next_steps"] {
  return {
    check_profile: "GET /api/me",
    check_email: "GET /api/me/email",
    check_usage: "GET /api/me/usage",
    file_signal: "POST /api/signals",
    checkin: "POST /api/checkin",
    verify_mcp: "POST /api/mcp/verify (optional)",
  };
}

export default register;
