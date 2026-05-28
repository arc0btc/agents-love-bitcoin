import { describe, it, expect } from "bun:test";
import {
  GLOBAL_DO_SCHEMA,
  AGENT_DO_SCHEMA,
  GLOBAL_DO_EXPECTED_INDEXES,
  AGENT_DO_EXPECTED_INDEXES,
} from "../schema";

describe("GLOBAL_DO_SCHEMA", () => {
  it("contains the idx_addr_email index name", () => {
    expect(GLOBAL_DO_SCHEMA).toContain("idx_addr_email");
  });

  it("contains the full idx_addr_email CREATE INDEX DDL", () => {
    expect(GLOBAL_DO_SCHEMA).toContain(
      "CREATE INDEX IF NOT EXISTS idx_addr_email ON address_resolution(email_address)"
    );
  });
});

/**
 * Drift guard — parses the schema strings for every CREATE INDEX statement
 * and asserts that the EXPECTED_INDEXES sets match exactly. A test failure
 * here means a new index was added (or removed) without updating the sets.
 */
describe("EXPECTED_INDEXES drift guard", () => {
  /** Extract index names from a schema string via regex on CREATE INDEX DDL. */
  function parseIndexNames(schema: string): Set<string> {
    const names = new Set<string>();
    // Matches: CREATE INDEX IF NOT EXISTS <name> ...
    // or:      CREATE UNIQUE INDEX IF NOT EXISTS <name> ...
    const re = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\S+)/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(schema)) !== null) {
      names.add(match[1]);
    }
    return names;
  }

  it("GLOBAL_DO_EXPECTED_INDEXES matches CREATE INDEX statements in GLOBAL_DO_SCHEMA", () => {
    const parsed = parseIndexNames(GLOBAL_DO_SCHEMA);
    // Every parsed name must be in the expected set
    for (const name of parsed) {
      expect(GLOBAL_DO_EXPECTED_INDEXES.has(name)).toBe(true);
    }
    // Every expected name must appear in the schema
    for (const name of GLOBAL_DO_EXPECTED_INDEXES) {
      expect(parsed.has(name)).toBe(true);
    }
    // Sizes must be equal (catches both missing and extra entries)
    expect(parsed.size).toBe(GLOBAL_DO_EXPECTED_INDEXES.size);
  });

  it("AGENT_DO_EXPECTED_INDEXES matches CREATE INDEX statements in AGENT_DO_SCHEMA", () => {
    const parsed = parseIndexNames(AGENT_DO_SCHEMA);
    for (const name of parsed) {
      expect(AGENT_DO_EXPECTED_INDEXES.has(name)).toBe(true);
    }
    for (const name of AGENT_DO_EXPECTED_INDEXES) {
      expect(parsed.has(name)).toBe(true);
    }
    expect(parsed.size).toBe(AGENT_DO_EXPECTED_INDEXES.size);
  });
});
