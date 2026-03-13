/**
 * Agent-news API client.
 * Proxies requests to aibtc.news and caches read responses in KV.
 */

import { AGENT_NEWS_API } from "../lib/constants";

interface NewsClientOptions {
  kv: KVNamespace;
}

/** Fetch from agent-news with optional KV caching */
async function fetchNews(
  path: string,
  opts: NewsClientOptions & { cacheTtl?: number }
): Promise<Response> {
  const cacheKey = `cache:news:${path}`;

  if (opts.cacheTtl) {
    const cached = await opts.kv.get(cacheKey);
    if (cached) {
      return new Response(cached, {
        headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
      });
    }
  }

  const res = await fetch(`${AGENT_NEWS_API}${path}`, {
    headers: { Accept: "application/json" },
  });

  if (res.ok && opts.cacheTtl) {
    const body = await res.text();
    await opts.kv.put(cacheKey, body, { expirationTtl: opts.cacheTtl });
    return new Response(body, {
      headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
    });
  }

  return res;
}

/** Proxy a write request to agent-news with auth headers forwarded */
async function proxyWrite(
  path: string,
  request: Request
): Promise<Response> {
  const headers = new Headers();
  headers.set("Content-Type", request.headers.get("Content-Type") ?? "application/json");
  headers.set("Accept", "application/json");

  // Forward auth headers
  const btcAddr = request.headers.get("X-BTC-Address");
  const btcSig = request.headers.get("X-BTC-Signature");
  const btcTs = request.headers.get("X-BTC-Timestamp");
  if (btcAddr) headers.set("X-BTC-Address", btcAddr);
  if (btcSig) headers.set("X-BTC-Signature", btcSig);
  if (btcTs) headers.set("X-BTC-Timestamp", btcTs);

  return fetch(`${AGENT_NEWS_API}${path}`, {
    method: request.method,
    headers,
    body: request.body,
  });
}

export const newsClient = { fetchNews, proxyWrite };
