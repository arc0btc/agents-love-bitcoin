/**
 * GET /api — Self-documenting API manifest.
 * GET /api/health — Health check.
 */

import { Hono } from "hono";
import { VERSION } from "../version";
import { okResponse } from "../lib/helpers";
import type { Env, AppVariables } from "../lib/types";

const manifest = new Hono<{ Bindings: Env; Variables: AppVariables }>();

manifest.get("/", (c) => {
  return okResponse(c, {
    name: "Agents Love Bitcoin",
    version: VERSION,
    description:
      "Bitcoin-authenticated inbox for AIBTC agents. Receive-only; rate-limited free, sBTC top-up for bursts.",
    spec: "https://agentslovebitcoin.com/llms.txt",
    endpoints: {
      public: {
        "GET /api": "This manifest",
        "GET /api/health": "Health check",
        "GET /api/onboarding": "Machine-readable onboarding guide",
        "GET /llms.txt": "Human + agent setup spec (markdown)",
      },
      registration: {
        "POST /api/register": "Register with dual L1/L2 signature (BIP-137 + SIP-018), L1+ on aibtc.com",
      },
      authenticated: {
        "GET /api/me/profile": "Your agent profile",
        "GET /api/me/email": "Your provisioned inbox details",
        "PUT /api/me/email": "Update forwarding address",
        "GET /api/me/email/inbox": "List inbox messages",
        "GET /api/me/email/inbox/:id": "Read a single inbox message",
        "GET /api/me/usage": "Current per-minute rate window + credit balance",
      },
      payment: {
        "POST /api/me/topup": "Submit signed sBTC tx for burst credits (PR2)",
        "GET /api/payment-status/:paymentId": "Poll relay confirmation (PR2)",
      },
    },
    tiers: {
      public: { rate_per_minute: 30, note: "no-auth endpoints" },
      registered: { rate_per_minute: 30, note: "L1 Verified Agent on aibtc.com" },
      genesis: { rate_per_minute: 120, note: "L2 Genesis on aibtc.com" },
    },
    auth: {
      standard: "BIP-137/322 via X-BTC-Address, X-BTC-Signature, X-BTC-Timestamp headers",
      registration: "Dual L1/L2: standard + X-STX-Address, X-STX-Signature (SIP-018)",
      requirement: "Verified Agent (level >= 1) on aibtc.com",
    },
    payment: {
      protocol: "x402 V2 (sBTC on Stacks) — top-up flow lands in PR2",
      relay: "https://x402-relay.aibtc.com",
      token: "sBTC",
    },
    onboarding: "https://agentslovebitcoin.com/api/onboarding",
  });
});

manifest.get("/health", (c) => {
  return okResponse(c, {
    status: "ok",
    version: VERSION,
    timestamp: new Date().toISOString(),
  });
});

export default manifest;
