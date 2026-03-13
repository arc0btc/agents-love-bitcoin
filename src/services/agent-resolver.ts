/**
 * Agent name and profile resolution with KV caching.
 * Ported from agent-news, extended with genesis level check.
 */

import { AIBTC_COM_API, CACHE_TTL } from "../lib/constants";
import type { AgentProfile } from "../lib/types";

export interface AgentInfo {
  name: string | null;
  btcAddress: string | null;
}

/** Resolve display name for a single BTC address */
export async function resolveAgentName(
  kv: KVNamespace,
  btcAddress: string
): Promise<AgentInfo> {
  const cacheKey = `agent-name:${btcAddress}`;
  const cached = await kv.get(cacheKey);

  if (cached !== null) {
    if (cached.startsWith("{")) {
      return JSON.parse(cached) as AgentInfo;
    }
    return { name: cached || null, btcAddress: null };
  }

  try {
    const res = await fetch(`${AIBTC_COM_API}/agents/${encodeURIComponent(btcAddress)}`, {
      headers: { Accept: "application/json" },
    });

    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const agent = data?.agent as Record<string, unknown> | undefined;
      const displayName =
        (agent?.displayName as string | undefined) ||
        (agent?.name as string | undefined) ||
        null;
      const canonicalBtc = (agent?.btcAddress as string | undefined) || null;

      const info: AgentInfo = { name: displayName, btcAddress: canonicalBtc };
      await kv.put(cacheKey, JSON.stringify(info), { expirationTtl: CACHE_TTL.agentName });
      return info;
    }
  } catch {
    // Network error — don't cache
  }

  return { name: null, btcAddress: null };
}

/** Fetch full agent profile from aibtc.com */
export async function fetchAgentProfile(
  kv: KVNamespace,
  btcAddress: string
): Promise<AgentProfile | null> {
  const cacheKey = `agent-profile:${btcAddress}`;
  const cached = await kv.get<AgentProfile>(cacheKey, "json");
  if (cached) return cached;

  try {
    const res = await fetch(`${AIBTC_COM_API}/agents/${encodeURIComponent(btcAddress)}`, {
      headers: { Accept: "application/json" },
    });

    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const agent = data?.agent as Record<string, unknown> | undefined;
      if (!agent) return null;

      const profile: AgentProfile = {
        btcAddress: (agent.btcAddress as string) || btcAddress,
        stxAddress: (agent.stxAddress as string) || null,
        displayName: (agent.displayName as string) || (agent.name as string) || null,
        bnsName: (agent.bnsName as string) || null,
        level: typeof agent.level === "number" ? agent.level : 0,
        levelName: (agent.levelName as string) || "Unverified",
        erc8004Id: typeof agent.erc8004AgentId === "number" ? agent.erc8004AgentId : null,
        checkInCount: typeof agent.checkInCount === "number" ? agent.checkInCount : 0,
        lastActiveAt: (agent.lastActiveAt as string) || null,
        verifiedAt: (agent.verifiedAt as string) || null,
      };

      await kv.put(cacheKey, JSON.stringify(profile), { expirationTtl: CACHE_TTL.agentProfile });
      return profile;
    }
  } catch {
    // Network error
  }

  return null;
}

/** Batch resolve agent names */
export async function resolveAgentNames(
  kv: KVNamespace,
  addresses: string[]
): Promise<Map<string, AgentInfo>> {
  const unique = [...new Set(addresses)];
  const infoMap = new Map<string, AgentInfo>();

  const results = await Promise.allSettled(
    unique.map(async (addr) => {
      const info = await resolveAgentName(kv, addr);
      return { addr, info };
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      infoMap.set(result.value.addr, result.value.info);
    }
  }

  return infoMap;
}
