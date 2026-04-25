import { describe, it, expect } from "bun:test";
import {
  aibtcNameToEmailLocal,
  aibtcNameToEmail,
  emailLocalToEmail,
} from "../names";

describe("aibtcNameToEmailLocal", () => {
  it("converts a 2-word name to a hyphenated lowercase slug", () => {
    expect(aibtcNameToEmailLocal("Steel Yeti")).toBe("steel-yeti");
    expect(aibtcNameToEmailLocal("Trustless Indra")).toBe("trustless-indra");
  });

  it("converts a 3-word name to a hyphenated lowercase slug", () => {
    expect(aibtcNameToEmailLocal("Sapphire Mars Echo")).toBe("sapphire-mars-echo");
  });

  it("collapses multiple internal whitespace characters", () => {
    expect(aibtcNameToEmailLocal("Steel   Yeti")).toBe("steel-yeti");
    expect(aibtcNameToEmailLocal("Steel\tYeti")).toBe("steel-yeti");
  });

  it("trims surrounding whitespace", () => {
    expect(aibtcNameToEmailLocal("  Steel Yeti  ")).toBe("steel-yeti");
  });
});

describe("aibtcNameToEmail", () => {
  it("composes the full address using EMAIL_DOMAIN", () => {
    expect(aibtcNameToEmail("Steel Yeti")).toBe(
      "steel-yeti@agentslovebitcoin.com"
    );
  });
});

describe("emailLocalToEmail", () => {
  it("composes a full address from an already-lowercased local part", () => {
    expect(emailLocalToEmail("steel-yeti")).toBe(
      "steel-yeti@agentslovebitcoin.com"
    );
  });

  it("lowercases the local part defensively", () => {
    expect(emailLocalToEmail("Steel-Yeti")).toBe(
      "steel-yeti@agentslovebitcoin.com"
    );
  });
});
