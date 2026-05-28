import { describe, it, expect } from "bun:test";
import { AGENT_DO_SCHEMA, AGENT_DO_EXPECTED_INDEXES } from "../schema";

describe("AGENT_DO_SCHEMA", () => {
  it("does not contain api_usage", () => {
    expect(AGENT_DO_SCHEMA).not.toContain("api_usage");
  });
});

/**
 * Drift guard — parses the schema string for every CREATE INDEX statement
 * and asserts that AGENT_DO_EXPECTED_INDEXES matches exactly. A test failure
 * here means a new index was added (or removed) without updating the set.
 */
describe("AGENT_DO_EXPECTED_INDEXES drift guard", () => {
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
