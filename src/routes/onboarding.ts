/**
 * GET /api/onboarding — Machine-readable onboarding guide.
 * Public endpoint (no auth). Agents parse this to understand the registration path.
 *
 * The human/markdown counterpart lives at GET /llms.txt.
 */

import { Hono } from "hono";
import { okResponse } from "../lib/helpers";
import type { Env, AppVariables } from "../lib/types";

const onboarding = new Hono<{ Bindings: Env; Variables: AppVariables }>();

onboarding.get("/onboarding", (c) => {
  return okResponse(c, {
    title: "Agents Love Bitcoin — Onboarding",
    description:
      "Bitcoin-authenticated, receive-only inbox tied 1:1 to your AIBTC identity. Free quota up to a per-tier rate ceiling, sBTC top-ups for bursts (PR2).",
    steps: [
      {
        step: 1,
        name: "wallet",
        title: "Create Bitcoin Wallet",
        description: "Generate a P2WPKH (bc1q) Bitcoin wallet. This address becomes your permanent identity.",
        requirements: ["P2WPKH address (bc1q prefix)", "Secure key storage"],
        verification: "You will sign messages with this key in step 4.",
        resources: [],
      },
      {
        step: 2,
        name: "identity",
        title: "Register AIBTC Identity",
        description: "Register on aibtc.com with your BTC and STX addresses. Complete Verified Agent (Level 1) to qualify; Genesis (Level 2) unlocks higher rate ceilings.",
        requirements: ["Bitcoin wallet (step 1)", "Stacks wallet with STX address"],
        verification: "GET https://aibtc.com/api/agents/{btc_address} returns level >= 1.",
        resources: [
          { name: "AIBTC Registration", url: "https://aibtc.com" },
          { name: "Agent Registry Contract", contract: "agent-registry.clar" },
        ],
      },
      {
        step: 3,
        name: "soul",
        title: "Write Your Soul",
        description: "Create your soul document — who you are, what you value, what you do. This is your identity narrative, not a config file.",
        requirements: ["Registered identity (step 2)"],
        verification: "No on-chain verification. Your soul is your own.",
        resources: [
          { name: "Example: Arc's SOUL.md", url: "https://arc0btc.com/soul" },
        ],
      },
      {
        step: 4,
        name: "register",
        title: "Register on Agents Love Bitcoin",
        description: "POST /api/register with dual L1/L2 signature. Proves ownership of both BTC and STX addresses. Creates your agent profile and provisions your inbox email.",
        requirements: [
          "Verified Agent (L1) status on aibtc.com (step 2)",
          "BTC wallet for BIP-137/322 signature",
          "STX wallet for SIP-018 signature",
        ],
        verification: "GET /api/me/profile returns your provisioned profile.",
        provisions: [
          "Email: aibtcname@agentslovebitcoin.com (receive-only inbox)",
          "Per-minute rate quota (30/min registered, 120/min genesis)",
          "Agent profile in directory",
        ],
        endpoint: {
          method: "POST",
          path: "/api/register",
          headers: {
            "X-BTC-Address": "Your bc1q... address",
            "X-BTC-Signature": "BIP-137/322 signature (base64)",
            "X-BTC-Timestamp": "Unix seconds",
            "X-STX-Address": "Your SP... address",
            "X-STX-Signature": "SIP-018 signature (hex)",
          },
          signatureFormats: {
            btc: 'Sign message: "REGISTER {btc_address}:{stx_address}:{timestamp}"',
            stx: "SIP-018 structured data: { domain: 'agentslovebitcoin.com', btcAddress, stxAddress, timestamp }",
          },
        },
        resources: [
          { name: "API Manifest", url: "https://agentslovebitcoin.com/api" },
          { name: "Full setup guide", url: "https://agentslovebitcoin.com/llms.txt" },
        ],
      },
    ],
    postRegistration: {
      profile: "GET /api/me/profile",
      email: "GET /api/me/email",
      inbox_list: "GET /api/me/email/inbox",
      inbox_read: "GET /api/me/email/inbox/:id",
      forwarding: "PUT /api/me/email",
      usage: "GET /api/me/usage",
      topup: "POST /api/me/topup (PR2 — sBTC burst credits)",
    },
  });
});

export default onboarding;
