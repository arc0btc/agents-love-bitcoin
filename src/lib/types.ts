import type { Context } from "hono";

/** Cloudflare Worker environment bindings */
export interface Env {
  ALB_KV: KVNamespace;
  AGENT_DO: DurableObjectNamespace;
  GLOBAL_DO: DurableObjectNamespace;
  ADMIN_API_KEY?: string;
  /** x402 relay URL (defaults to mainnet relay) */
  X402_RELAY_URL?: string;
  /** Stacks network: "mainnet" or "testnet" */
  STACKS_NETWORK?: string;
  /** Platform treasury STX address for analytics endpoints */
  TREASURY_STX_ADDRESS?: string;
}

/** Variables set on Hono context by middleware */
export interface AppVariables {
  btcAddress: string;
  stxAddress: string;
  requestId: string;
  /** Set by x402 middleware when payment is verified */
  x402Payer?: string;
  /** Set by x402 middleware when payment txid is available */
  x402Txid?: string;
}

/** Typed Hono context */
export type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

/** Standard API response */
export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
  meta: { timestamp: string; version: string; requestId: string };
}

/** Agent record from aibtc.com */
export interface AibtcAgentRecord {
  btcAddress: string;
  stxAddress: string;
  aibtcName: string | null;
  bnsName: string | null;
  level: number;
  levelName: string;
  erc8004AgentId: number | null;
  checkInCount: number;
  lastActiveAt: string | null;
  verifiedAt: string | null;
}

/** KV metering state per agent (rolling 24h window) */
export interface MeterState {
  windowStart: number;
  requests: number;
  briefReads: number;
  signalSubmissions: number;
  emailsSent: number;
}

/** Cached genesis status in KV */
export interface GenesisCache {
  level: number;
  stxAddress: string;
  aibtcName: string | null;
  bnsName: string | null;
  erc8004AgentId: number | null;
  cachedAt: string;
}

/** x402 V2 payment requirements (sent in 402 response) */
export interface PaymentRequirementsV2 {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
}

/** x402 V2 payment-required response body */
export interface PaymentRequiredBodyV2 {
  x402Version: 2;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepts: PaymentRequirementsV2[];
}

/** x402 V2 payment payload (sent in payment-signature header) */
export interface PaymentPayloadV2 {
  x402Version: 2;
  payload: {
    transaction: string;
  };
  accepted: PaymentRequirementsV2;
  extensions?: Record<string, unknown>;
}

/** x402 V2 settlement response from relay */
export interface SettlementResponseV2 {
  success: boolean;
  payer?: string;
  transaction?: string;
  network?: string;
  errorReason?: string;
}

/** Registration response data */
export interface RegistrationData {
  agent: {
    btc_address: string;
    stx_address: string;
    aibtc_name: string;
    bns_name: string | null;
    level: number;
    level_name: string;
    erc8004_id: number | null;
    registered_at: string;
  };
  email: {
    address: string;
    status: "active";
    provisioned_at: string;
  };
  api_access: {
    tier: "genesis";
    free_allocation: {
      max_requests: number;
      brief_reads: number;
      signal_submissions: number;
      emails_sent: number;
      window: "24h_rolling";
      resets_at: string;
    };
    rate_limit: {
      max_requests_per_minute: number;
    };
  };
  next_steps: {
    check_profile: string;
    check_email: string;
    check_usage: string;
    file_signal: string;
    checkin: string;
    verify_mcp: string;
  };
}
