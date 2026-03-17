/**
 * Authentication middleware for ALB.
 *
 * - Standard API auth: BIP-137/322 signature verification (BTC only).
 * - Registration auth: Dual-sig (BIP-137/322 + SIP-018) for POST /api/register.
 *
 * Sets c.set("btcAddress") and c.set("stxAddress") on context.
 */

import type { MiddlewareHandler } from "hono";
import { verifyBtcSignature } from "../services/btc-verify";
import { verifySip018Registration } from "../services/stx-verify";
import { TIMESTAMP_WINDOW_S } from "../lib/constants";
import { errorResponse, isP2WPKH, isStacksMainnet, generateRequestId } from "../lib/helpers";
import type { Env, AppVariables } from "../lib/types";

type ALBMiddleware = MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }>;

/**
 * Middleware that injects a request ID into the context.
 */
export const requestIdMiddleware: ALBMiddleware = async (c, next) => {
  c.set("requestId", generateRequestId());
  await next();
};

/**
 * Standard BIP-137/322 auth middleware for authenticated endpoints.
 * Verifies: X-BTC-Address, X-BTC-Signature, X-BTC-Timestamp headers.
 * Message format: "{METHOD} {path}:{timestamp}"
 */
export const btcAuthMiddleware: ALBMiddleware = async (c, next) => {
  const btcAddress = c.req.header("X-BTC-Address");
  const btcSignature = c.req.header("X-BTC-Signature");
  const btcTimestamp = c.req.header("X-BTC-Timestamp");

  if (!btcAddress || !btcSignature || !btcTimestamp) {
    return errorResponse(c, "UNAUTHORIZED", "Missing required auth headers: X-BTC-Address, X-BTC-Signature, X-BTC-Timestamp", 401);
  }

  // Validate address format
  if (!isP2WPKH(btcAddress)) {
    return errorResponse(c, "VALIDATION_ERROR", "Only P2WPKH (bc1q) addresses supported. Taproot (bc1p) is not yet supported.", 400);
  }

  // Validate timestamp window
  const ts = parseInt(btcTimestamp, 10);
  if (isNaN(ts)) {
    return errorResponse(c, "UNAUTHORIZED", "Invalid timestamp format", 401);
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TIMESTAMP_WINDOW_S) {
    return errorResponse(c, "UNAUTHORIZED", "Timestamp expired (\u00b1300s window)", 401);
  }

  // Verify BTC signature
  const message = `${c.req.method} ${new URL(c.req.url).pathname}:${btcTimestamp}`;
  const result = verifyBtcSignature(btcAddress, btcSignature, message);
  if (!result.valid) {
    return errorResponse(c, "UNAUTHORIZED", "Invalid BTC signature", 401);
  }

  c.set("btcAddress", btcAddress);
  await next();
};

/**
 * Dual-sig auth middleware for POST /api/register.
 * Verifies both BIP-137/322 (BTC) and SIP-018 (STX) signatures.
 * Message format for BTC: "REGISTER {btc}:{stx}:{timestamp}"
 * SIP-018 domain: agentslovebitcoin.com
 */
export const dualSigAuthMiddleware: ALBMiddleware = async (c, next) => {
  const btcAddress = c.req.header("X-BTC-Address");
  const btcSignature = c.req.header("X-BTC-Signature");
  const btcTimestamp = c.req.header("X-BTC-Timestamp");
  const stxAddress = c.req.header("X-STX-Address");
  const stxSignature = c.req.header("X-STX-Signature");

  // Check all required headers
  if (!btcAddress || !btcSignature || !btcTimestamp || !stxAddress || !stxSignature) {
    return errorResponse(
      c,
      "UNAUTHORIZED",
      "Missing required auth headers: X-BTC-Address, X-BTC-Signature, X-BTC-Timestamp, X-STX-Address, X-STX-Signature",
      401
    );
  }

  // Validate BTC address format (P2WPKH only)
  if (!isP2WPKH(btcAddress)) {
    return errorResponse(c, "VALIDATION_ERROR", "Only P2WPKH (bc1q) addresses supported. Taproot (bc1p) is not yet supported.", 400);
  }

  // Validate STX address format (mainnet only)
  if (!isStacksMainnet(stxAddress)) {
    return errorResponse(c, "VALIDATION_ERROR", "Only Stacks mainnet (SP) addresses supported.", 400);
  }

  // Validate timestamp window
  const ts = parseInt(btcTimestamp, 10);
  if (isNaN(ts)) {
    return errorResponse(c, "UNAUTHORIZED", "Invalid timestamp format", 401);
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TIMESTAMP_WINDOW_S) {
    return errorResponse(c, "UNAUTHORIZED", "Timestamp expired (\u00b1300s window)", 401);
  }

  // Verify BTC signature (registration message format)
  const btcMessage = `REGISTER ${btcAddress}:${stxAddress}:${btcTimestamp}`;
  const btcResult = verifyBtcSignature(btcAddress, btcSignature, btcMessage);
  if (!btcResult.valid) {
    return errorResponse(c, "UNAUTHORIZED", "Invalid BTC signature", 401);
  }

  // Verify STX signature (SIP-018 structured data)
  const stxResult = verifySip018Registration({
    signature: stxSignature,
    btcAddress,
    stxAddress,
    timestamp: ts,
  });
  if (!stxResult.valid) {
    return errorResponse(c, "UNAUTHORIZED", "Invalid STX signature", 401);
  }

  c.set("btcAddress", btcAddress);
  c.set("stxAddress", stxAddress);
  await next();
};
