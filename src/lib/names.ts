/**
 * AIBTC name format helpers.
 *
 * Format invariant
 * ────────────────
 * Display names are deterministic, capitalized phrases of 2+ words separated
 * by single spaces, sourced from the landing-page name service. Examples:
 *
 *   "Steel Yeti"          (2-word)
 *   "Trustless Indra"     (2-word)
 *   "Sapphire Mars Echo"  (3-word, when needed)
 *
 * Email local parts are the lowercased words joined by a single hyphen:
 *
 *   "Steel Yeti"          → "steel-yeti"
 *   "Sapphire Mars Echo"  → "sapphire-mars-echo"
 *
 * Because the input is constrained (alphanumeric words, single-space
 * separated), the conversion is deterministic and lossless. Nothing else in
 * the codebase should reinvent this transform — call `aibtcNameToEmailLocal`.
 */

import { EMAIL_DOMAIN } from "./constants";

/** Display name as returned by the landing-page `/api/get-name` service. */
export type AibtcName = string;

/** Local part of an AIBTC email address (e.g. `steel-yeti`). */
export type EmailLocalPart = string;

/** Full AIBTC email address (e.g. `steel-yeti@agentslovebitcoin.com`). */
export type AibtcEmail = string;

/**
 * Convert an AIBTC display name to its email local part.
 * `"Steel Yeti"` → `"steel-yeti"`
 */
export function aibtcNameToEmailLocal(name: AibtcName): EmailLocalPart {
  return name.trim().toLowerCase().split(/\s+/).join("-");
}

/**
 * Convert an AIBTC display name to a full email address.
 * `"Steel Yeti"` → `"steel-yeti@agentslovebitcoin.com"`
 */
export function aibtcNameToEmail(name: AibtcName): AibtcEmail {
  return `${aibtcNameToEmailLocal(name)}@${EMAIL_DOMAIN}`;
}

/**
 * Compose an email address from a local part received via Cloudflare Email
 * Routing (which has already lowercased the input).
 * `"steel-yeti"` → `"steel-yeti@agentslovebitcoin.com"`
 */
export function emailLocalToEmail(local: EmailLocalPart): AibtcEmail {
  return `${local.toLowerCase()}@${EMAIL_DOMAIN}`;
}
