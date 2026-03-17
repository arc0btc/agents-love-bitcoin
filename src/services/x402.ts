/**
 * x402 payment service — builds 402 responses and verifies payments via relay.
 *
 * Aligned with x402-sponsor-relay V2 facilitator API and the x402 V2 spec.
 * Pattern adapted from aibtcdev/landing-page inbox x402 integration.
 */

import {
  DEFAULT_RELAY_URL,
  CAIP2_NETWORKS,
  SBTC_CONTRACTS,
  DEFAULT_TREASURY_STX_ADDRESS,
  RELAY_SETTLE_TIMEOUT_MS,
  X402_HEADERS,
} from "../lib/constants";
import type {
  Env,
  PaymentRequirementsV2,
  PaymentRequiredBodyV2,
  PaymentPayloadV2,
  SettlementResponseV2,
} from "../lib/types";

/**
 * Build x402 V2 payment requirements for a given endpoint.
 *
 * @param payTo - Recipient STX address (treasury for platform endpoints, agent for agent-specific)
 * @param amountSats - Required amount in satoshis
 * @param env - Worker environment bindings
 */
export function buildPaymentRequirements(
  payTo: string,
  amountSats: number,
  env: Env
): PaymentRequirementsV2 {
  const network = env.STACKS_NETWORK ?? "mainnet";
  const networkCAIP2 = CAIP2_NETWORKS[network] ?? CAIP2_NETWORKS.mainnet;
  const sbtcContract = SBTC_CONTRACTS[network] ?? SBTC_CONTRACTS.mainnet;

  return {
    scheme: "exact",
    network: networkCAIP2,
    amount: String(amountSats),
    asset: `stacks:${network === "mainnet" ? "1" : "2147483648"}/sip010:${sbtcContract.address}.${sbtcContract.name}`,
    payTo,
    maxTimeoutSeconds: 60,
  };
}

/**
 * Build the full 402 Payment Required response body.
 */
export function buildPaymentRequiredBody(
  url: string,
  description: string,
  payTo: string,
  amountSats: number,
  env: Env
): PaymentRequiredBodyV2 {
  const requirements = buildPaymentRequirements(payTo, amountSats, env);
  return {
    x402Version: 2,
    resource: {
      url,
      description,
      mimeType: "application/json",
    },
    accepts: [requirements],
  };
}

/**
 * Resolve the treasury STX address from env or default.
 */
export function getTreasuryAddress(env: Env): string {
  return env.TREASURY_STX_ADDRESS ?? DEFAULT_TREASURY_STX_ADDRESS;
}

/**
 * Parse the payment-signature header (base64-encoded JSON, with plain JSON fallback).
 */
export function parsePaymentSignature(header: string): PaymentPayloadV2 | null {
  try {
    const decoded = atob(header);
    return JSON.parse(decoded) as PaymentPayloadV2;
  } catch {
    try {
      return JSON.parse(header) as PaymentPayloadV2;
    } catch {
      return null;
    }
  }
}

/** Result of payment verification */
export interface PaymentVerification {
  success: boolean;
  payerStxAddress?: string;
  paymentTxid?: string;
  error?: string;
  settleResult?: SettlementResponseV2;
}

/**
 * Verify an x402 sBTC payment by settling via the relay.
 *
 * Supports both sponsored (routed to /relay) and non-sponsored (routed to /settle)
 * transactions. Follows the pattern from landing-page/lib/inbox/x402-verify.ts.
 */
export async function verifyPayment(
  paymentPayload: PaymentPayloadV2,
  recipientStxAddress: string,
  amountSats: number,
  env: Env
): Promise<PaymentVerification> {
  const relayUrl = env.X402_RELAY_URL ?? DEFAULT_RELAY_URL;
  const network = env.STACKS_NETWORK ?? "mainnet";
  const networkCAIP2 = CAIP2_NETWORKS[network] ?? CAIP2_NETWORKS.mainnet;

  if (!paymentPayload.payload?.transaction) {
    return {
      success: false,
      error: "Missing transaction in payment payload",
    };
  }

  const txHex = paymentPayload.payload.transaction;

  // Build payment requirements for validation
  const paymentRequirements = buildPaymentRequirements(
    recipientStxAddress,
    amountSats,
    env
  );

  // Route sponsored transactions to /relay, non-sponsored to /settle
  const isSponsored = Boolean(paymentPayload.extensions?.sponsored);
  const relayEndpoint = isSponsored ? "relay" : "settle";

  try {
    const settleResponse = await fetch(`${relayUrl}/${relayEndpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentPayload: {
          x402Version: 2,
          payload: { transaction: txHex },
          ...(paymentPayload.extensions
            ? { extensions: paymentPayload.extensions }
            : {}),
        },
        paymentRequirements,
      }),
      signal: AbortSignal.timeout(RELAY_SETTLE_TIMEOUT_MS),
    });

    const settleResult = (await settleResponse.json()) as SettlementResponseV2;

    if (!settleResult.success) {
      return {
        success: false,
        error: settleResult.errorReason ?? "Payment settlement failed",
        settleResult,
      };
    }

    return {
      success: true,
      payerStxAddress: settleResult.payer,
      paymentTxid: settleResult.transaction,
      settleResult,
    };
  } catch (err) {
    return {
      success: false,
      error: `Relay settlement error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Encode a payment-response header (base64 JSON per x402 V2 spec).
 */
export function encodePaymentResponse(
  payer: string,
  txid: string,
  env: Env
): string {
  const network = env.STACKS_NETWORK ?? "mainnet";
  const networkCAIP2 = CAIP2_NETWORKS[network] ?? CAIP2_NETWORKS.mainnet;
  return btoa(
    JSON.stringify({
      success: true,
      payer,
      transaction: txid,
      network: networkCAIP2,
    })
  );
}
