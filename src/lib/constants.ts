// ── Upstream API URLs ──
export const AGENT_NEWS_API = "https://aibtc.news/api";
export const AIBTC_COM_API = "https://aibtc.com/api";
export const X402_RELAY_URL = "https://x402-relay.aibtc.com";

// ── Rate limit configs (per-minute windows) ──
export const RATE_LIMITS = {
  public: { maxRequests: 60, windowSeconds: 60 },
  agent: { maxRequests: 120, windowSeconds: 60 },
  genesis: { maxRequests: 300, windowSeconds: 60 },
} as const;

// ── Cache TTLs (seconds) ──
export const CACHE_TTL = {
  genesisCheck: 3600,       // 1 hour
  agentName: 86400,         // 24 hours
  agentsList: 120,          // 2 minutes
  agentProfile: 3600,       // 1 hour
  signalsLatest: 60,        // 1 minute
  briefsLatest: 300,        // 5 minutes
} as const;

// ── Write rate limits (per-hour) ──
export const WRITE_LIMITS = {
  signals: { maxRequests: 10, windowSeconds: 3600 },
  briefCompile: { maxRequests: 1, windowSeconds: 86400 },
  beatClaim: { maxRequests: 5, windowSeconds: 86400 },
} as const;
