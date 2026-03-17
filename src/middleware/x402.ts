/**
 * x402 payment middleware — gates endpoints behind sBTC payment.
 *
 * Two middleware variants:
 * 1. `x402PaymentGate(config)` — Always requires payment (premium endpoints).
 * 2. `x402MeterOverflow(config)` — Free allocation first, payment when exhausted.
 *
 * Flow:
 * - Check for `payment-signature` header (base64-encoded PaymentPayloadV2)
 * - If present: verify via relay /settle, set x402Payer/x402Txid on context, continue
 * - If absent: return 402 with payment-required header (base64 PaymentRequiredBodyV2)
 *
 * Aligned with x402-sponsor-relay V2 facilitator API.
 */

import type { MiddlewareHandler } from "hono";
import { X402_HEADERS, FREE_ALLOCATION, WINDOW_SECONDS } from "../lib/constants";
import { errorResponse } from "../lib/helpers";
import { VERSION } from "../version";
import type { Env, AppVariables } from "../lib/types";
import {
  buildPaymentRequiredBody,
  getTreasuryAddress,
  parsePaymentSignature,
  verifyPayment,
  encodePaymentResponse,
} from "../services/x402";

type ALBMiddleware = MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }>;

interface X402GateConfig {
  /** Price in satoshis for this endpoint */
  priceSats: number;
  /** Description for the 402 response */
  description: string;
  /**
   * Payment recipient. Defaults to treasury address.
   * Set to "dynamic" to use the agent's STX address from context.
   */
  payTo?: "treasury" | "dynamic";
}

/**
 * Always-pay middleware for premium/payment-gated endpoints.
 * Every request must include a valid x402 payment.
 *
 * Usage:
 * ```ts
 * app.get("/api/briefs/:date", btcAuthMiddleware, x402PaymentGate({
 *   priceSats: 100,
 *   description: "Full brief for a specific date",
 * }), handler);
 * ```
 */
export function x402PaymentGate(config: X402GateConfig): ALBMiddleware {
  return async (c, next) => {
    const btcAddress = c.get("btcAddress");
    if (!btcAddress) {
      return errorResponse(c, "UNAUTHORIZED", "Authentication required", 401);
    }

    const payTo = resolvePayTo(config.payTo, c);
    const url = c.req.url;

    // Check for payment-signature header
    const paymentSigHeader = c.req.header(X402_HEADERS.PAYMENT_SIGNATURE);

    if (!paymentSigHeader) {
      return return402(c, url, config.description, payTo, config.priceSats);
    }

    // Parse and verify payment
    const paymentPayload = parsePaymentSignature(paymentSigHeader);
    if (!paymentPayload) {
      return errorResponse(
        c,
        "VALIDATION_ERROR",
        "Invalid payment-signature header (expected base64-encoded JSON)",
        400
      );
    }

    const result = await verifyPayment(
      paymentPayload,
      payTo,
      config.priceSats,
      c.env
    );

    if (!result.success) {
      // Payment failed — return 402 with error details
      const body = buildPaymentRequiredBody(
        url,
        config.description,
        payTo,
        config.priceSats,
        c.env
      );
      const header = btoa(JSON.stringify(body));
      return c.json(
        {
          ...body,
          ok: false,
          error: {
            code: "PAYMENT_REQUIRED",
            message: result.error ?? "Payment verification failed",
          },
          meta: {
            timestamp: new Date().toISOString(),
            version: VERSION,
            requestId: c.get("requestId") ?? "unknown",
          },
        },
        402,
        { [X402_HEADERS.PAYMENT_REQUIRED]: header }
      );
    }

    // Payment verified — set context and continue
    if (result.payerStxAddress) c.set("x402Payer", result.payerStxAddress);
    if (result.paymentTxid) c.set("x402Txid", result.paymentTxid);

    // Set payment-response header on the way out
    await next();

    if (result.payerStxAddress && result.paymentTxid) {
      c.header(
        X402_HEADERS.PAYMENT_RESPONSE,
        encodePaymentResponse(result.payerStxAddress, result.paymentTxid, c.env)
      );
    }
  };
}

/**
 * Meter-overflow middleware for genesis-tier endpoints.
 *
 * Replaces the bare 402 in metering middleware with a proper x402 V2 response.
 * Runs after btcAuthMiddleware. If the agent has free allocation remaining,
 * passes through (metering middleware handles counting). If exhausted,
 * checks for payment-signature and either verifies payment or returns 402.
 *
 * Usage:
 * ```ts
 * app.get("/api/signals", btcAuthMiddleware, x402MeterOverflow({
 *   priceSats: 10,
 *   description: "API request beyond free allocation",
 * }), meteringMiddleware, handler);
 * ```
 */
export function x402MeterOverflow(config: X402GateConfig): ALBMiddleware {
  return async (c, next) => {
    const btcAddress = c.get("btcAddress");
    if (!btcAddress) {
      return errorResponse(c, "UNAUTHORIZED", "Authentication required", 401);
    }

    // Check if agent has free allocation remaining
    const kvKey = `meter:${btcAddress}`;
    const meter = await c.env.ALB_KV.get<{
      windowStart: number;
      requests: number;
    }>(kvKey, "json");

    const now = Math.floor(Date.now() / 1000);
    const windowExpired = !meter || now - meter.windowStart >= WINDOW_SECONDS;
    const hasFreeCalls = windowExpired || meter.requests < FREE_ALLOCATION.maxRequests;

    if (hasFreeCalls) {
      // Free allocation available — let metering middleware handle counting
      await next();
      return;
    }

    // Free allocation exhausted — check for payment
    const payTo = resolvePayTo(config.payTo, c);
    const url = c.req.url;

    const paymentSigHeader = c.req.header(X402_HEADERS.PAYMENT_SIGNATURE);

    if (!paymentSigHeader) {
      return return402(c, url, config.description, payTo, config.priceSats);
    }

    const paymentPayload = parsePaymentSignature(paymentSigHeader);
    if (!paymentPayload) {
      return errorResponse(
        c,
        "VALIDATION_ERROR",
        "Invalid payment-signature header (expected base64-encoded JSON)",
        400
      );
    }

    const result = await verifyPayment(
      paymentPayload,
      payTo,
      config.priceSats,
      c.env
    );

    if (!result.success) {
      return return402(c, url, config.description, payTo, config.priceSats);
    }

    // Payment verified — set context, skip metering, continue to handler
    if (result.payerStxAddress) c.set("x402Payer", result.payerStxAddress);
    if (result.paymentTxid) c.set("x402Txid", result.paymentTxid);

    await next();

    if (result.payerStxAddress && result.paymentTxid) {
      c.header(
        X402_HEADERS.PAYMENT_RESPONSE,
        encodePaymentResponse(result.payerStxAddress, result.paymentTxid, c.env)
      );
    }
  };
}

/** Build and return a 402 response with x402 V2 payment requirements. */
function return402(
  c: Parameters<ALBMiddleware>[0],
  url: string,
  description: string,
  payTo: string,
  priceSats: number
): Response {
  const body = buildPaymentRequiredBody(url, description, payTo, priceSats, c.env);
  const header = btoa(JSON.stringify(body));
  return c.json(
    {
      ...body,
      ok: false,
      error: {
        code: "PAYMENT_REQUIRED",
        message: `Payment of ${priceSats} satoshis (sBTC) required. Include payment-signature header with base64-encoded PaymentPayloadV2.`,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: VERSION,
        requestId: (c.get("requestId") as string) ?? "unknown",
      },
    },
    402,
    { [X402_HEADERS.PAYMENT_REQUIRED]: header }
  );
}

/** Resolve the payment recipient address. */
function resolvePayTo(
  mode: "treasury" | "dynamic" | undefined,
  c: Parameters<ALBMiddleware>[0]
): string {
  if (mode === "dynamic") {
    // Use the authenticated agent's STX address (for agent-specific payments)
    // Falls back to treasury if STX address not available
    const stxAddr = c.get("stxAddress") as string | undefined;
    return stxAddr ?? getTreasuryAddress(c.env);
  }
  return getTreasuryAddress(c.env);
}
