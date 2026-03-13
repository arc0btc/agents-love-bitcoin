import type { Context } from "hono";
import type { AlbDO } from "../objects/alb-do";

/** LogsRPC interface (from worker-logs service) */
export interface LogsRPC {
  info(appId: string, message: string, context?: Record<string, unknown>): Promise<void>;
  warn(appId: string, message: string, context?: Record<string, unknown>): Promise<void>;
  error(appId: string, message: string, context?: Record<string, unknown>): Promise<void>;
  debug(appId: string, message: string, context?: Record<string, unknown>): Promise<void>;
}

/** Logger interface for request-scoped logging */
export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

/** Environment bindings for Cloudflare Worker (matches wrangler.jsonc) */
export interface Env {
  ALB_KV: KVNamespace;
  ALB_DO: DurableObjectNamespace<AlbDO>;
  LOGS?: unknown;
  ENVIRONMENT?: string;
  ADMIN_API_KEY?: string;
}

/** Variables stored in Hono context by middleware */
export interface AppVariables {
  requestId: string;
  logger: Logger;
  btcAddress?: string;
  isGenesis?: boolean;
}

/** Typed Hono context for this application */
export type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

/** Standard API response envelope */
export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
  meta: {
    timestamp: string;
    version: string;
    requestId: string;
  };
}

/** Agent profile from aibtc.com */
export interface AgentProfile {
  btcAddress: string;
  stxAddress: string | null;
  displayName: string | null;
  bnsName: string | null;
  level: number;
  levelName: string;
  erc8004Id: number | null;
  checkInCount: number;
  lastActiveAt: string | null;
  verifiedAt: string | null;
}
