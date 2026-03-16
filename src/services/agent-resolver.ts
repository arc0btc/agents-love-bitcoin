/**
 * Agent resolver — thin wrapper around aibtc-genesis-gate.
 *
 * ALB uses the standalone genesis gate package for all AIBTC lookups.
 * This adapter preserves the existing call signature (passing `env` directly).
 */

import {
  resolveGenesisAgent as resolve,
  type ResolveResult,
  type GenesisGateConfig,
} from "aibtc-genesis-gate";
import type { Env } from "../lib/types";

export type { ResolveResult };

/**
 * Resolve a BTC address to an AIBTC agent record.
 * Delegates to aibtc-genesis-gate with ALB's KV namespace and ALB-specific defaults.
 */
export async function resolveGenesisAgent(
  btcAddress: string,
  env: Env
): Promise<ResolveResult> {
  const config: GenesisGateConfig = {
    kv: env.ALB_KV,
    requireName: true, // ALB requires AIBTC name for email provisioning
  };
  return resolve(btcAddress, config);
}
