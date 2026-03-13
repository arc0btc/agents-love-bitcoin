/** SQLite schema for the AlbDO Durable Object */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  btc_address   TEXT PRIMARY KEY,
  stx_address   TEXT,
  display_name  TEXT,
  bns_name      TEXT,
  level         INTEGER NOT NULL DEFAULT 0,
  level_name    TEXT NOT NULL DEFAULT 'Unverified',
  erc8004_id    INTEGER,
  check_in_count INTEGER DEFAULT 0,
  last_active_at TEXT,
  verified_at   TEXT,
  cached_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkins (
  id            TEXT PRIMARY KEY,
  btc_address   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage (
  id            TEXT PRIMARY KEY,
  btc_address   TEXT,
  endpoint      TEXT NOT NULL,
  method        TEXT NOT NULL,
  status_code   INTEGER NOT NULL,
  response_ms   INTEGER,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkins_address ON checkins(btc_address);
CREATE INDEX IF NOT EXISTS idx_checkins_created ON checkins(created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_address ON api_usage(btc_address);
CREATE INDEX IF NOT EXISTS idx_api_usage_endpoint ON api_usage(endpoint);
CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage(created_at);
`;
