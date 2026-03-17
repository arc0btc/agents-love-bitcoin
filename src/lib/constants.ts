/** AIBTC landing page API for agent lookup + genesis detection */
export const AIBTC_API_URL = "https://aibtc.com/api";

/** Genesis check KV cache TTL (1 hour) */
export const GENESIS_CACHE_TTL_S = 3600;

/** Timestamp window for signature verification (±300 seconds) */
export const TIMESTAMP_WINDOW_S = 300;

/** SIP-018 domain for agentslovebitcoin.com */
export const SIP018_DOMAIN = {
  name: "agentslovebitcoin.com",
  version: "1",
  chainId: 1, // Stacks mainnet
} as const;

/** Free allocation per rolling 24h window */
export const FREE_ALLOCATION = {
  maxRequests: 100,
  briefReads: 5,
  signalSubmissions: 10,
  emailsSent: 5,
} as const;

/** Rate limits per tier (requests per minute) */
export const RATE_LIMITS = {
  public: 30,
  genesis: 120,
  paid: 300,
} as const;

/** Email domain */
export const EMAIL_DOMAIN = "agentslovebitcoin.com";

/** x402 relay URL (production mainnet) */
export const DEFAULT_RELAY_URL = "https://x402-relay.aibtc.com";

/** CAIP-2 network identifiers for Stacks */
export const CAIP2_NETWORKS: Record<string, string> = {
  mainnet: "stacks:1",
  testnet: "stacks:2147483648",
};

/** sBTC contract addresses per network */
export const SBTC_CONTRACTS: Record<string, { address: string; name: string }> = {
  mainnet: {
    address: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
    name: "sbtc-token",
  },
  testnet: {
    address: "ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT",
    name: "sbtc-token",
  },
};

/** Default treasury STX address for platform-level payment endpoints */
export const DEFAULT_TREASURY_STX_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";

/**
 * sBTC pricing for payment-gated endpoints (in satoshis).
 * Per PRD §5.1: paidRate config.
 */
export const PAID_RATE = {
  perRequest: 10,
  perBrief: 100,
  perCompile: 500,
  perAnalytics: 50,
  perWeeklyReport: 200,
} as const;

/** x402 header names (x402 V2 standard) */
export const X402_HEADERS = {
  PAYMENT_REQUIRED: "X-Payment-Required",
  PAYMENT_SIGNATURE: "X-Payment-Signature",
  PAYMENT_RESPONSE: "X-Payment-Response",
} as const;

/** Rolling metering window duration (seconds) — 24 hours */
export const WINDOW_SECONDS = 86400;

/** Relay settle timeout (ms) */
export const RELAY_SETTLE_TIMEOUT_MS = 65_000;
