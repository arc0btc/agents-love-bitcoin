/**
 * POST /api/register — Dual-sig BIP-322+SIP-018 registration with genesis gate and DO provisioning.
 *
 * Flow (from onboarding-flow-spec.md §4.2):
 * 1. Parse + validate headers (done by dualSigAuthMiddleware)
 * 2. Validate timestamp (done by dualSigAuthMiddleware)
 * 3. Verify BTC signature (done by dualSigAuthMiddleware)
 * 4. Verify STX signature (done by dualSigAuthMiddleware)
 * 5. Check genesis status (aibtc.com lookup + KV cache)
 * 6. Resolve deterministic agent name (landing-page API)
 * 7. Check existing registration (idempotent — return existing profile if found)
 * 8. Check name uniqueness
 * 9. Create AgentDO (profile + email + stats)
 * 10. Update GlobalDO (directory index + address resolution + stats)
 * 11. Return success (201 Created)
 */

import { Hono } from "hono";
import type { AibtcAgent } from "aibtc-genesis-gate";
import { resolveGenesisAgent } from "../services/agent-resolver";
import { resolveAgentName } from "../services/name-resolver";
import { dualSigAuthMiddleware } from "../middleware/auth";
import { okResponse, errorResponse, tierFromLevel } from "../lib/helpers";
import { aibtcNameToEmailLocal, aibtcNameToEmail } from "../lib/names";
import { RATE_LIMITS } from "../lib/constants";
import { VERSION } from "../version";
import type { Env, AppVariables, RegistrationData } from "../lib/types";

const register = new Hono<{ Bindings: Env; Variables: AppVariables }>();

register.post("/register", dualSigAuthMiddleware, async (c) => {
  const btcAddress = c.get("btcAddress")!;
  const stxAddress = c.get("stxAddress")!;

  // ── Step 5: Check genesis status (admin key bypasses the gate) ────────
  const adminKey = c.req.header("X-Admin-Key");
  const isAdmin = Boolean(adminKey && c.env.ADMIN_API_KEY && adminKey === c.env.ADMIN_API_KEY);

  let agent: AibtcAgent;
  if (isAdmin) {
    // Admin bypass: synthetic L1 record. Follows the registered path by default;
    // a real L2 record from aibtc.com is the only thing that grants genesis tier.
    agent = {
      btcAddress,
      stxAddress,
      aibtcName: null,
      bnsName: null,
      level: 1,
      levelName: "Verified Agent",
      erc8004AgentId: null,
      checkInCount: 0,
      lastActiveAt: null,
      verifiedAt: null,
    };
  } else {
    const resolved = await resolveGenesisAgent(btcAddress, c.env);
    if (!resolved.ok) {
      const statusMap: Record<string, 403 | 502> = {
        NOT_FOUND: 403,
        NOT_GENESIS: 403,
        UPSTREAM_ERROR: 502,
      };
      const status = statusMap[resolved.code] ?? 400;

      // Include onboarding guidance when the agent isn't recognized at L1+.
      if (resolved.code === "NOT_GENESIS" || resolved.code === "NOT_FOUND") {
        return c.json({
          ok: false,
          error: { code: "FORBIDDEN", message: "Registration requires a Verified Agent (L1+) record on aibtc.com. Complete identity verification first." },
          data: {
            current_level: resolved.level ?? 0,
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
        UPSTREAM_ERROR: "UPSTREAM_ERROR",
      };
      return errorResponse(c, codeMap[resolved.code] ?? resolved.code, resolved.error, status);
    }

    agent = resolved.agent;

    // Address cross-check: the BTC↔STX pair vouched for by aibtc.com must match
    // the dual-sig headers. Mismatch means the signing key controls one address
    // but aibtc.com has a different pair on file — point them back to the profile.
    if (agent.btcAddress !== btcAddress || agent.stxAddress !== stxAddress) {
      return c.json({
        ok: false,
        error: {
          code: "ADDRESS_MISMATCH",
          message: "Dual-sig addresses do not match the BTC↔STX pair on aibtc.com. Update your aibtc.com profile or sign with the keys for the registered pair.",
        },
        data: {
          aibtc_btc_address: agent.btcAddress,
          aibtc_stx_address: agent.stxAddress,
          submitted_btc_address: btcAddress,
          submitted_stx_address: stxAddress,
          profile_url: "https://aibtc.com/agents",
        },
        meta: {
          timestamp: new Date().toISOString(),
          version: VERSION,
          requestId: c.get("requestId"),
        },
      }, 403);
    }
  }

  // ── Step 6: Resolve deterministic agent name ─────────────────────────
  const nameResult = await resolveAgentName(btcAddress);
  if (!nameResult.ok) {
    return errorResponse(c, "NAME_RESOLUTION_ERROR", nameResult.error, 502);
  }
  const agentName = nameResult.name;
  const emailLocal = aibtcNameToEmailLocal(agentName);
  const emailAddress = aibtcNameToEmail(agentName);

  // ── Step 7: Check existing registration (idempotent) ──────────────────
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
        aibtc_name: agentName,
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
      api_access: buildApiAccess(agent.level),
      next_steps: buildNextSteps(),
    };

    return okResponse(c, data, 200);
  }

  // ── Step 8: Check email uniqueness ────────────────────────────────────
  const nameCheckResp = await globalDo.fetch(
    new Request(`http://internal/is-email-local-taken?local=${encodeURIComponent(emailLocal)}&exclude=${encodeURIComponent(btcAddress)}`)
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
        aibtcName: agentName,
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
        aibtcName: agentName,
        displayName: agent.bnsName ?? agentName,
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
      aibtc_name: agentName,
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
    api_access: buildApiAccess(agent.level),
    next_steps: buildNextSteps(),
  };

  return okResponse(c, data, 201);
});

function buildApiAccess(level: number): RegistrationData["api_access"] {
  const tier = tierFromLevel(level);
  return {
    tier,
    rate_limit: {
      max_requests_per_minute: RATE_LIMITS[tier],
    },
  };
}

function buildNextSteps(): RegistrationData["next_steps"] {
  return {
    check_profile: "GET /api/me/profile",
    check_email: "GET /api/me/email",
    check_inbox: "GET /api/me/email/inbox",
    check_usage: "GET /api/me/usage",
  };
}

export default register;
