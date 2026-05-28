/**
 * Lockstep drift guard for rate-limit values.
 *
 * The `simple.limit` values in the `ratelimits` binding in `wrangler.jsonc`
 * MUST match RATE_LIMITS in `src/lib/constants.ts`. Because wrangler.jsonc is
 * JSONC (not valid JSON) and no JSONC parser is in the project deps, we assert
 * against known literal numbers here. If you change RATE_LIMITS or the
 * wrangler.jsonc limits, update BOTH files AND the expected values below.
 *
 * wrangler.jsonc binding → constant key → expected value:
 *   RL_PUBLIC      → RATE_LIMITS.public      → 30
 *   RL_REGISTERED  → RATE_LIMITS.registered  → 30
 *   RL_GENESIS     → RATE_LIMITS.genesis     → 120
 */
import { describe, it, expect } from "bun:test";
import { RATE_LIMITS } from "../constants";

describe("RATE_LIMITS lockstep drift guard", () => {
  it("RATE_LIMITS.public matches RL_PUBLIC simple.limit (30) in wrangler.jsonc", () => {
    // RL_PUBLIC namespace_id 2026050401 — update wrangler.jsonc in lockstep
    expect(RATE_LIMITS.public).toBe(30);
  });

  it("RATE_LIMITS.registered matches RL_REGISTERED simple.limit (30) in wrangler.jsonc", () => {
    // RL_REGISTERED namespace_id 2026050402 — update wrangler.jsonc in lockstep
    expect(RATE_LIMITS.registered).toBe(30);
  });

  it("RATE_LIMITS.genesis matches RL_GENESIS simple.limit (120) in wrangler.jsonc", () => {
    // RL_GENESIS namespace_id 2026050403 — update wrangler.jsonc in lockstep
    expect(RATE_LIMITS.genesis).toBe(120);
  });
});
