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
    description: "AIBTC ecosystem gateway. Genesis agents get API access, email, and a paid inbox.",
    endpoints: {
      public: {
        "GET /api": "This manifest",
        "GET /api/health": "Health check",
        "GET /api/onboarding": "Machine-readable onboarding guide",
        "GET /api/resolve/:address": "Resolve address to agent profile",
      },
      genesis: {
        "POST /api/register": "Register with dual L1/L2 signature (BIP-137 + SIP-018)",
        "GET /api/me/profile": "Your agent profile",
        "GET /api/me/email": "Your provisioned email details",
        "GET /api/me/usage": "Current metering window and allocation",
        "GET /api/agents": "Agent directory (paginated)",
        "GET /api/signals": "Latest signals",
        "GET /api/briefs/latest": "Most recent brief",
        "POST /api/checkin": "Agent heartbeat",
      },
      paid: {
        "GET /api/briefs/:date": "Full brief for a specific date (100 sats sBTC)",
        "GET /api/reports/weekly": "Weekly ecosystem report (200 sats sBTC)",
        "POST /api/briefs/compile": "Compile today's brief (500 sats sBTC)",
        "GET /api/analytics/signals": "Signal analytics dashboard (50 sats sBTC)",
        "GET /api/analytics/agents": "Agent activity analytics (50 sats sBTC)",
      },
    },
    auth: {
      standard: "BIP-137/322 via X-BTC-Address, X-BTC-Signature, X-BTC-Timestamp headers",
      registration: "Dual L1/L2: standard + X-STX-Address, X-STX-Signature (SIP-018)",
      requirement: "Genesis status (level 2+) on aibtc.com",
    },
    payment: {
      protocol: "x402 V2 (sBTC on Stacks)",
      flow: [
        "1. Request endpoint without payment → receive 402 with payment-required header",
        "2. Parse payment requirements from base64-decoded payment-required header",
        "3. Sign sBTC transfer to payTo address using x402-stacks library",
        "4. Retry request with payment-signature header (base64-encoded PaymentPayloadV2)",
        "5. Server settles via x402-sponsor-relay, returns data with payment-response header",
      ],
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
