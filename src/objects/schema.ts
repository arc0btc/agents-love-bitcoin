/**
 * SQLite schemas for AgentDO and GlobalDO Durable Objects.
 * Matches PRD §4.3 and §4.4 exactly.
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

CREATE TABLE IF NOT EXISTS api_usage (
  id             TEXT PRIMARY KEY,
  endpoint       TEXT NOT NULL,
  method         TEXT NOT NULL,
  status_code    INTEGER NOT NULL,
  response_ms    INTEGER,
  paid           INTEGER DEFAULT 0,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_stats (
  stat_key       TEXT PRIMARY KEY,
  stat_value     INTEGER DEFAULT 0,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkins_created ON checkins(created_at);
CREATE INDEX IF NOT EXISTS idx_inbox_received ON inbox(received_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_endpoint ON api_usage(endpoint);
CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage(created_at);
`;

export const GLOBAL_DO_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_index (
  btc_address    TEXT PRIMARY KEY,
  stx_address    TEXT NOT NULL,
  aibtc_name     TEXT,
  display_name   TEXT,
  level          INTEGER NOT NULL DEFAULT 2,
  mcp_verified   INTEGER DEFAULT 0,
  last_active_at TEXT,
  indexed_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS address_resolution (
  btc_address    TEXT PRIMARY KEY,
  stx_address    TEXT NOT NULL,
  aibtc_name     TEXT NOT NULL,
  email_address  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS global_stats (
  stat_key       TEXT PRIMARY KEY,
  stat_value     INTEGER DEFAULT 0,
  updated_at     TEXT NOT NULL
);
`;
