/**
 * Name resolver — deterministic agent name lookup via landing-page API.
 *
 * Calls the AIBTC landing-page `/api/get-name` endpoint to resolve a BTC
 * address to its deterministic agent name. This name is used for email
 * provisioning instead of the genesis gate aibtcName, ensuring addresses
 * always map to the same slug regardless of when they register.
 */

import { AIBTC_API_URL } from "../lib/constants";

export type NameResolveResult = {
  ok: true;
  name: string;
} | {
  ok: false;
  error: string;
};

/**
 * Resolve a BTC address to its deterministic AIBTC agent name.
 * Calls the landing-page `/api/get-name` endpoint.
 */
export async function resolveAgentName(btcAddress: string): Promise<NameResolveResult> {
  const url = `${AIBTC_API_URL}/get-name?address=${encodeURIComponent(btcAddress)}`;

  try {
    const resp = await fetch(url, {
      headers: { "Accept": "application/json" },
    });

    if (!resp.ok) {
      return { ok: false, error: `Landing page API returned ${resp.status}` };
    }

    const data = await resp.json() as { name?: string; error?: string };

    if (!data.name) {
      return { ok: false, error: data.error ?? "No name returned for address" };
    }

    return { ok: true, name: data.name };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Name resolution failed: ${message}` };
  }
}

/**
 * Convert a name to a URL-safe email slug.
 * Lowercases, replaces non-alphanumeric with hyphens, trims hyphens.
 */
export function toEmailSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
