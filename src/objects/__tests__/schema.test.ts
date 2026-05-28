import { describe, it, expect } from "bun:test";
import { GLOBAL_DO_SCHEMA } from "../schema";

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
