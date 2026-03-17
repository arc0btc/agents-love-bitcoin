/**
 * BIP-322/137 Bitcoin signature verification for ALB.
 *
 * Ported from aibtcdev/landing-page bitcoin-verify.ts.
 * BIP-322 is the primary standard for native segwit (bc1q) addresses.
 * BIP-137 is kept as a fallback for legacy wallets that still produce
 * compact 65-byte signatures with segwit header bytes (39-42).
 * Supports P2WPKH (bc1q) only — taproot (bc1p) not supported per PRD.
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { hashSha256Sync } from "@stacks/encryption";
import {
  Transaction,
  p2wpkh,
  p2pkh,
  p2sh,
  Script,
  SigHash,
  RawWitness,
  RawTx,
  NETWORK as BTC_NETWORK,
} from "@scure/btc-signer";
import { hex } from "@scure/base";

const BITCOIN_MSG_PREFIX = "\x18Bitcoin Signed Message:\n";

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function encodeVarInt(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    buf[1] = n & 0xff;
    buf[2] = (n >> 8) & 0xff;
    return buf;
  }
  throw new Error("Message too long for varint encoding");
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function writeUint32LE(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = n & 0xff;
  buf[1] = (n >> 8) & 0xff;
  buf[2] = (n >> 16) & 0xff;
  buf[3] = (n >> 24) & 0xff;
  return buf;
}

function formatBitcoinMessage(message: string): Uint8Array {
  const prefixBytes = new TextEncoder().encode(BITCOIN_MSG_PREFIX);
  const messageBytes = new TextEncoder().encode(message);
  const lengthBytes = encodeVarInt(messageBytes.length);
  return concatBytes(prefixBytes, lengthBytes, messageBytes);
}

function doubleSha256(data: Uint8Array): Uint8Array {
  return hashSha256Sync(hashSha256Sync(data));
}

function parseDERSignature(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("parseDERSignature: expected 0x30 header");
  let pos = 2;
  if (der[pos] !== 0x02) throw new Error("parseDERSignature: expected 0x02 for r");
  pos++;
  const rLen = der[pos++];
  const rBytes = der.slice(rLen === 33 ? pos + 1 : pos, pos + rLen);
  pos += rLen;
  if (der[pos] !== 0x02) throw new Error("parseDERSignature: expected 0x02 for s");
  pos++;
  const sLen = der[pos++];
  const sBytes = der.slice(sLen === 33 ? pos + 1 : pos, pos + sLen);

  const compact = new Uint8Array(64);
  compact.set(rBytes, 32 - rBytes.length);
  compact.set(sBytes, 64 - sBytes.length);
  return compact;
}

function bip137RecoveryId(header: number): number {
  if (header >= 27 && header <= 30) return header - 27;
  if (header >= 31 && header <= 34) return header - 31;
  if (header >= 35 && header <= 38) return header - 35;
  if (header >= 39 && header <= 42) return header - 39;
  throw new Error(`Invalid BIP-137 header byte: ${header}`);
}

function isBip137Signature(sigBytes: Uint8Array): boolean {
  return sigBytes.length === 65 && sigBytes[0] >= 27 && sigBytes[0] <= 42;
}

// ---------------------------------------------------------------------------
// BIP-322 helpers
// ---------------------------------------------------------------------------

function bip322TaggedHash(message: string): Uint8Array {
  const tagBytes = new TextEncoder().encode("BIP0322-signed-message");
  const tagHash = hashSha256Sync(tagBytes);
  const msgBytes = new TextEncoder().encode(message);
  return hashSha256Sync(concatBytes(tagHash, tagHash, msgBytes));
}

function bip322TaggedHashLegacy(message: string): Uint8Array {
  const tagBytes = new TextEncoder().encode("BIP0322-signed-message");
  const tagHash = hashSha256Sync(tagBytes);
  const msgBytes = new TextEncoder().encode(message);
  const varint = encodeVarInt(msgBytes.length);
  return hashSha256Sync(concatBytes(tagHash, tagHash, varint, msgBytes));
}

function bip322BuildToSpendTxId(msgHash: Uint8Array, scriptPubKey: Uint8Array): Uint8Array {
  const scriptSig = concatBytes(new Uint8Array([0x00, 0x20]), msgHash);
  const rawTx = RawTx.encode({
    version: 0,
    inputs: [{
      txid: new Uint8Array(32),
      index: 0xffffffff,
      finalScriptSig: scriptSig,
      sequence: 0,
    }],
    outputs: [{ amount: 0n, script: scriptPubKey }],
    lockTime: 0,
  });
  return doubleSha256(rawTx).reverse();
}

function bip322VerifyP2WPKHCore(signatureBase64: string, address: string, msgHash: Uint8Array): boolean {
  const sigBytes = new Uint8Array(Buffer.from(signatureBase64, "base64"));
  const witnessItems = RawWitness.decode(sigBytes);

  if (witnessItems.length !== 2) return false;
  const ecdsaSigWithHashtype = witnessItems[0];
  const pubkeyBytes = witnessItems[1];
  if (pubkeyBytes.length !== 33) return false;

  const scriptPubKey = p2wpkh(pubkeyBytes, BTC_NETWORK).script;
  const toSpendTxid = bip322BuildToSpendTxId(msgHash, scriptPubKey);

  const toSignTx = new Transaction({ version: 0, lockTime: 0, allowUnknownOutputs: true });
  toSignTx.addInput({
    txid: toSpendTxid,
    index: 0,
    sequence: 0,
    witnessUtxo: { amount: 0n, script: scriptPubKey },
  });
  toSignTx.addOutput({ script: Script.encode(["RETURN"]), amount: 0n });

  const scriptCode = p2pkh(pubkeyBytes).script;
  const sighash = toSignTx.preimageWitnessV0(0, scriptCode, SigHash.ALL, 0n);

  const derSig = ecdsaSigWithHashtype.slice(0, -1);
  const compactSig = parseDERSignature(derSig);

  const sigValid = secp256k1.verify(compactSig, sighash, pubkeyBytes, { prehash: false });
  if (!sigValid) return false;

  return p2wpkh(pubkeyBytes, BTC_NETWORK).address === address;
}

// ---------------------------------------------------------------------------
// BIP-137 verification
// ---------------------------------------------------------------------------

function verifyBip137(address: string, message: string, signatureBase64: string): boolean {
  const sigBytes = new Uint8Array(Buffer.from(signatureBase64, "base64"));
  if (sigBytes.length !== 65) return false;

  const header = sigBytes[0];
  const rBytes = sigBytes.slice(1, 33);
  const sBytes = sigBytes.slice(33, 65);

  let recoveryId: number;
  try {
    recoveryId = bip137RecoveryId(header);
  } catch {
    return false;
  }

  const formattedMessage = formatBitcoinMessage(message);
  const messageHash = doubleSha256(formattedMessage);

  let recoveredPubKey: Uint8Array;
  try {
    const r = BigInt("0x" + hex.encode(rBytes));
    const s = BigInt("0x" + hex.encode(sBytes));
    const sig = new secp256k1.Signature(r, s, recoveryId);
    const recoveredPoint = sig.recoverPublicKey(messageHash);
    recoveredPubKey = recoveredPoint.toBytes(true);
  } catch {
    return false;
  }

  try {
    let derivedAddress: string | undefined;
    if (header >= 27 && header <= 34) {
      derivedAddress = p2pkh(recoveredPubKey, BTC_NETWORK).address;
    } else if (header >= 35 && header <= 38) {
      const inner = p2wpkh(recoveredPubKey, BTC_NETWORK);
      derivedAddress = p2sh(inner, BTC_NETWORK).address;
    } else if (header >= 39 && header <= 42) {
      derivedAddress = p2wpkh(recoveredPubKey, BTC_NETWORK).address;
    }
    return derivedAddress === address;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type BtcVerifyResult =
  | { valid: true }
  | { valid: false; error: string };

/**
 * Verify a Bitcoin signature (BIP-322 or BIP-137) for a given address and message.
 * Only P2WPKH (bc1q) addresses are supported.
 *
 * For native segwit (bc1q), BIP-322 is tried first — it is the correct standard.
 * BIP-137 is kept as a fallback for wallets that still produce compact 65-byte
 * signatures with segwit header bytes (39-42). For legacy/P2SH addresses,
 * BIP-137 is tried first since BIP-322 does not apply.
 */
export function verifyBtcSignature(
  btcAddress: string,
  signature: string,
  message: string
): BtcVerifyResult {
  try {
    const sigBytes = new Uint8Array(Buffer.from(signature, "base64"));
    const isSegwit = btcAddress.startsWith("bc1q") || btcAddress.startsWith("tb1q");

    // For non-segwit addresses, try BIP-137 first (the only applicable standard).
    if (!isSegwit && isBip137Signature(sigBytes)) {
      const verified = verifyBip137(btcAddress, message, signature);
      return verified ? { valid: true } : { valid: false, error: "Invalid BIP-137 signature" };
    }

    // BIP-322 P2WPKH path — primary for bc1q addresses.
    if (bip322VerifyP2WPKHCore(signature, btcAddress, bip322TaggedHash(message))) {
      return { valid: true };
    }
    // Legacy hash fallback (older signing tools prepend varint length).
    if (bip322VerifyP2WPKHCore(signature, btcAddress, bip322TaggedHashLegacy(message))) {
      return { valid: true };
    }

    // BIP-137 fallback for bc1q — some wallets still produce compact signatures
    // with segwit header bytes (39-42) instead of BIP-322 witness format.
    if (isSegwit && isBip137Signature(sigBytes)) {
      const verified = verifyBip137(btcAddress, message, signature);
      if (verified) return { valid: true };
    }

    return { valid: false, error: "Signature verification failed (tried BIP-322 and BIP-137)" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown verification error";
    return { valid: false, error: msg };
  }
}
