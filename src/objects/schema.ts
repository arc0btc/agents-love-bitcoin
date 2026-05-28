/**
 * SQLite schema for the AgentDO Durable Object.
 *
 * AGENT_DO_EXPECTED_INDEXES must stay in sync with the CREATE INDEX statements
 * below. The schema-health endpoint and its tests use the set to detect drift.
 */

export const AGENT_DO_SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  btc_address    TEXT PRIMARY KEY,
  stx_address    TEXT NOT NULL,
  display_name   TEXT,
  bns_name       TEXT,
  aibtc_name     TEXT,
  level          INTEGER NOT NULL DEFAULT 2,
  level_name     TEXT NOT NULL DEFAULT 'Genesis',
  erc8004_id     INTEGER,
  mcp_verified   INTEGER DEFAULT 0,
  mcp_version    TEXT,
  cached_at      TEXT NOT NULL,
  registered_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email (
  email_address  TEXT PRIMARY KEY,
  forward_to     TEXT,
  active         INTEGER DEFAULT 1,
  provisioned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkins (
  id             TEXT PRIMARY KEY,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inbox (
  id             TEXT PRIMARY KEY,
  from_address   TEXT NOT NULL,
  subject        TEXT,
  body_text      TEXT,
  body_html      TEXT,
  received_at    TEXT NOT NULL,
  read_at        TEXT
);

CREATE TABLE IF NOT EXISTS account_stats (
  stat_key       TEXT PRIMARY KEY,
  stat_value     INTEGER DEFAULT 0,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkins_created ON checkins(created_at);
CREATE INDEX IF NOT EXISTS idx_inbox_received ON inbox(received_at);
`;

/** Index names declared in AGENT_DO_SCHEMA. */
export const AGENT_DO_EXPECTED_INDEXES = new Set([
  "idx_checkins_created",
  "idx_inbox_received",
]);
