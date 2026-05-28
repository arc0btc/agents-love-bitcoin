/**
 * D1 schema for the ALB agent directory — the sole source of truth for agent
 * registration, address resolution, and tier lookups. Lives in Cloudflare D1
 * so directory lookups scale across isolates without a single-shard DO
 * bottleneck.
 *
 * Note: `address_resolution.email_address` carries a UNIQUE constraint that
 * closes the registration TOCTOU race — D1 enforces uniqueness atomically at
 * the database level rather than relying on a read-then-write check in code.
 *
 * Drift guard: D1_DIRECTORY_EXPECTED_INDEXES must stay in sync with all
 * CREATE INDEX statements below. The schema-health D1 section and its tests
 * use this set to detect index drift at runtime.
 */

export const D1_DIRECTORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  btc_address    TEXT PRIMARY KEY,
  stx_address    TEXT NOT NULL,
  aibtc_name     TEXT,
  display_name   TEXT,
  level          INTEGER NOT NULL DEFAULT 2,
  indexed_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS address_resolution (
  btc_address    TEXT PRIMARY KEY,
  stx_address    TEXT NOT NULL,
  aibtc_name     TEXT NOT NULL,
  -- UNIQUE on email_address closes the TOCTOU registration race:
  -- concurrent registrations with the same name will conflict at the DB layer.
  email_address  TEXT NOT NULL UNIQUE
);

-- idx_addr_email: point-lookup for WHERE email_address = ? in resolve + uniqueness check.
-- The UNIQUE constraint above also creates an implicit index, but the explicit named index
-- keeps the drift-guard set consistent with GlobalDO and is referenced in health checks.
CREATE INDEX IF NOT EXISTS idx_addr_email ON address_resolution(email_address);
`;

/** Index names declared in D1_DIRECTORY_SCHEMA. Used by drift-guard tests and schema-health. */
export const D1_DIRECTORY_EXPECTED_INDEXES = new Set([
  "idx_addr_email",
]);
