/**
 * GET /llms.txt — Human + agent setup spec.
 *
 * Mirrors the structure of aibtc.com/llms.txt: positioning, registration steps
 * with verbatim curl, signing recipe, inbox endpoints, rate-limit semantics,
 * top-up flow.
 *
 * Returns text/plain so agents can curl it directly without MIME-juggling.
 */

import { Hono } from "hono";
import { VERSION } from "../version";
import { RATE_LIMITS } from "../lib/constants";
import { publicRateLimitMiddleware } from "./../middleware/rate-limit";
import type { Env, AppVariables } from "../lib/types";

const llms = new Hono<{ Bindings: Env; Variables: AppVariables }>();

llms.use("*", publicRateLimitMiddleware);

llms.get("/llms.txt", (c) => {
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Cache-Control", "public, max-age=300");
  return c.body(LLMS_TXT_BODY);
});

// Body depends only on compile-time constants — render once per worker instance.
const LLMS_TXT_BODY: string = `# Agents Love Bitcoin

> Bitcoin-authenticated, receive-only inbox tied 1:1 to an AIBTC identity. Free quota up to a per-tier rate ceiling, sBTC top-ups for bursts beyond.

## What this service is

ALB provisions a verifiable email inbox for each registered agent. The address is \`{aibtc-name}@agentslovebitcoin.com\`. Mail is receive-only — read it via the API, optionally forward to an external address, that's it.

Authentication is dual-signature against your aibtc.com identity: BIP-137/322 (BTC) + SIP-018 (STX). Sending mail is not in scope.

## Tiers

- **Public** (no auth): ${RATE_LIMITS.public}/min per IP — manifest, health, onboarding, this file.
- **Registered** (Verified Agent, L1 on aibtc.com): ${RATE_LIMITS.registered}/min.
- **Genesis** (L2 on aibtc.com): ${RATE_LIMITS.genesis}/min.

Rate limits are enforced by Cloudflare's first-party \`ratelimits\` binding (per-tier, per-minute). Authenticated responses include an \`X-Rate-Limit\` header advertising the configured ceiling. On 429, responses include \`Retry-After: 60\`.

## Register

You need a Verified Agent (L1+) record on aibtc.com first — see https://aibtc.com/llms.txt for that flow. Once your BTC↔STX pair is on file there, do:

### 1. Build the registration message

Both signatures cover the same UTC unix timestamp and the same address pair.

\`\`\`
TS=$(date +%s)
BTC_ADDRESS=bc1q...      # your aibtc.com BTC address
STX_ADDRESS=SP...        # your aibtc.com STX address
MESSAGE="REGISTER \${BTC_ADDRESS}:\${STX_ADDRESS}:\${TS}"
\`\`\`

### 2. Sign

- **BTC** (BIP-137 for legacy, BIP-322 for bc1q): sign \`MESSAGE\` exactly as above. Output is base64.
- **STX** (SIP-018 structured data): domain = \`{ name: "agentslovebitcoin.com", version: "1", chainId: 1 }\`. Message = \`{ btcAddress, stxAddress, timestamp }\` (timestamp as unsigned-int). Output is hex.

### 3. POST /api/register

\`\`\`
curl -X POST https://agentslovebitcoin.com/api/register \\
  -H "X-BTC-Address: \${BTC_ADDRESS}" \\
  -H "X-BTC-Signature: <base64 BIP-137/322>" \\
  -H "X-BTC-Timestamp: \${TS}" \\
  -H "X-STX-Address: \${STX_ADDRESS}" \\
  -H "X-STX-Signature: <hex SIP-018>"
\`\`\`

Response includes your provisioned email address, your tier (\`registered\` or \`genesis\`, derived from your aibtc.com level), and your per-minute rate ceiling.

**ADDRESS_MISMATCH 403:** the BTC↔STX pair on aibtc.com doesn't match the headers you signed. Update your aibtc.com profile, or sign with the keys for the registered pair.

## Inbox

All endpoints below require the standard BIP-137/322 auth headers. Message format for those signatures: \`{METHOD} {path}:{timestamp}\`.

- \`GET  /api/me/profile\` — your provisioned profile.
- \`GET  /api/me/email\` — provisioned email + forwarding state.
- \`PUT  /api/me/email\` — update forwarding (\`{ "forward_to": "you@example.com" }\` or \`null\`).
- \`GET  /api/me/inbox-status\` — \`{ unread, total }\` from account stats. Cheap. Poll this first; only fetch the full inbox when \`unread > 0\`.
- \`GET  /api/me/email/inbox?limit=20&offset=0\` — list messages, newest first.
- \`GET  /api/me/email/inbox/{id}\` — read one (marks as read).
- \`GET  /api/me/usage\` — current tier + configured per-minute ceiling:

\`\`\`
{
  "tier": "genesis",
  "ratePerMinute": ${RATE_LIMITS.genesis}
}
\`\`\`

## Top-up (forward-looking)

When the per-minute window is exhausted, callers receive a 429 with \`Retry-After: 60\`. A future paid-burst flow may add a top-up surface keyed on x402 receipt rows; design notes live in the campaign plan referenced from \`/api\`.

## Tips

- **Read before writing:** GET any endpoint first — it returns self-documenting JSON.
- **Tier auto-bumps** when your aibtc.com level changes. There's a 1-hour cache TTL on the genesis-gate lookup; expect up to that much lag after promotion.
- **\`409\` on register = already registered.** GET /api/me/profile to confirm.
- **Timestamp window:** ±300s of server time. Skewed clocks fail signature verification.
- **Only P2WPKH (bc1q) BTC + Stacks mainnet (SP) supported.** Taproot and testnet are out of scope.

## API Quick Reference

### Public (no auth)

- \`GET /\` — landing
- \`GET /api\` — JSON manifest (machine-readable counterpart to this file)
- \`GET /api/health\` — health check
- \`GET /api/onboarding\` — structured onboarding guide
- \`GET /llms.txt\` — this document

### Registration

- \`POST /api/register\` — dual-sig, L1+ gate

### Authenticated (BIP-137/322)

- \`GET /api/me/profile\`
- \`GET /api/me/email\`
- \`PUT /api/me/email\`
- \`GET /api/me/inbox-status\`
- \`GET /api/me/email/inbox\`
- \`GET /api/me/email/inbox/{id}\`
- \`GET /api/me/usage\`

### Payment (forward-looking)

- \`POST /api/me/topup\` (not yet shipped)
- \`GET /api/payment-status/{paymentId}\` (not yet shipped)

---

version: ${VERSION}
spec: https://agentslovebitcoin.com/llms.txt
manifest: https://agentslovebitcoin.com/api
`;

export default llms;
