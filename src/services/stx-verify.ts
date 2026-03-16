/**
 * SIP-018 structured data signature verification for ALB registration.
 *
 * Ported from aibtcdev/x402-sponsor-relay stx-verify.ts.
 * ALB uses a custom domain ("agentslovebitcoin.com") and registration-specific message.
 */

import {
  publicKeyFromSignatureRsv,
  getAddressFromPublicKey,
  encodeStructuredDataBytes,
  tupleCV,
  uintCV,
  stringAsciiCV,
} from "@stacks/transactions";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@stacks/common";
import { SIP018_DOMAIN } from "../lib/constants";

export type StxVerifyResult =
  | { valid: true; stxAddress: string }
  | { valid: false; error: string };

/**
 * Verify a SIP-018 structured data signature for ALB registration.
 *
 * Domain: { name: "agentslovebitcoin.com", version: "1", chain-id: u1 }
 * Message: { action: "register", btc-address: "bc1q...", stx-address: "SP...", timestamp: u<unix> }
 */
export function verifySip018Registration(opts: {
  signature: string;
  btcAddress: string;
  stxAddress: string;
  timestamp: number;
}): StxVerifyResult {
  try {
    // Build SIP-018 domain tuple
    const domainTuple = tupleCV({
      name: stringAsciiCV(SIP018_DOMAIN.name),
      version: stringAsciiCV(SIP018_DOMAIN.version),
      "chain-id": uintCV(SIP018_DOMAIN.chainId),
    });

    // Build message tuple matching the registration spec
    const messageTuple = tupleCV({
      action: stringAsciiCV("register"),
      "btc-address": stringAsciiCV(opts.btcAddress),
      "stx-address": stringAsciiCV(opts.stxAddress),
      timestamp: uintCV(opts.timestamp),
    });

    // Encode structured data per SIP-018
    const encodedBytes = encodeStructuredDataBytes({
      message: messageTuple,
      domain: domainTuple,
    });

    // Hash the encoded bytes
    const hash = sha256(encodedBytes);
    const hashHex = bytesToHex(hash);

    // Recover public key from RSV signature
    const recoveredPubKey = publicKeyFromSignatureRsv(hashHex, opts.signature);

    // Derive Stacks address from recovered public key
    const recoveredAddress = getAddressFromPublicKey(recoveredPubKey, "mainnet");

    // Verify the recovered address matches the claimed address
    if (recoveredAddress !== opts.stxAddress) {
      return {
        valid: false,
        error: `STX signature address mismatch: expected ${opts.stxAddress}, recovered ${recoveredAddress}`,
      };
    }

    return { valid: true, stxAddress: recoveredAddress };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown SIP-018 verification error";
    return { valid: false, error: msg };
  }
}
