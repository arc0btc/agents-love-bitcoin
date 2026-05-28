/**
 * Validates D1_DIRECTORY_SCHEMA against a REAL SQLite engine (bun:sqlite).
 *
 * Regression guard for the bug where ensureD1Schema() ran the schema via
 * D1's db.exec(), which splits its input on newlines and runs each line as a
 * separate statement — silently failing on multi-line CREATE TABLE DDL so the
 * D1 tables were never created in production. The in-memory D1 mock used by the
 * service tests treats DDL as a no-op, so it could never catch this. Here we
 * apply the exact statements production runs (via splitSchemaStatements) to a
 * real engine, so an unsplittable / invalid schema fails the suite.
 */

import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { D1_DIRECTORY_SCHEMA, D1_DIRECTORY_EXPECTED_INDEXES } from "../d1-schema";
import { splitSchemaStatements } from "../../services/directory";

function applySchema(): Database {
  const db = new Database(":memory:");
  // Mirrors ensureD1Schema(): each split statement is compiled and run on its
  // own. Throws if any statement is not independently valid SQL.
  for (const stmt of splitSchemaStatements(D1_DIRECTORY_SCHEMA)) {
    db.run(stmt);
  }
  return db;
}

describe("D1_DIRECTORY_SCHEMA applies to a real SQLite engine", () => {
  it("creates the agents and address_resolution tables", () => {
    const db = applySchema();
    const tables = (
      db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        .all() as Array<{ name: string }>
    )
      .map((r) => r.name)
      .sort();
    expect(tables).toEqual(["address_resolution", "agents"]);
    db.close();
  });

  it("creates every index named in D1_DIRECTORY_EXPECTED_INDEXES", () => {
    const db = applySchema();
    const indexes = new Set(
      (
        db
          .query(
            "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
          )
          .all() as Array<{ name: string }>
      ).map((r) => r.name)
    );
    for (const expected of D1_DIRECTORY_EXPECTED_INDEXES) {
      expect(indexes.has(expected)).toBe(true);
    }
    db.close();
  });

  it("enforces UNIQUE(email_address) on address_resolution", () => {
    const db = applySchema();
    db.run(
      `INSERT INTO address_resolution (btc_address, stx_address, aibtc_name, email_address)
       VALUES ('bc1a', 'SP1', 'alpha', 'dup@agentslovebitcoin.com')`
    );
    expect(() =>
      db.run(
        `INSERT INTO address_resolution (btc_address, stx_address, aibtc_name, email_address)
         VALUES ('bc1b', 'SP2', 'beta', 'dup@agentslovebitcoin.com')`
      )
    ).toThrow();
    db.close();
  });

  it("is re-runnable (CREATE ... IF NOT EXISTS is idempotent)", () => {
    const db = applySchema();
    // Second application must not throw.
    for (const stmt of splitSchemaStatements(D1_DIRECTORY_SCHEMA)) {
      db.run(stmt);
    }
    db.close();
  });
});
