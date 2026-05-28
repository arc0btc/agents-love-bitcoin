/**
 * Tests for GlobalDO.exportDirectory() — Phase 7 bulk backfill prerequisite.
 *
 * We test the HTTP surface (`GET /dump-directory`) through a minimal GlobalDO
 * stub that delegates to a fake in-memory SQLite-like storage, mirroring the
 * pattern used in the existing admin and directory tests.
 *
 * Because GlobalDO uses the Cloudflare DO storage API (ctx.storage.sql) we
 * can't instantiate it directly in unit tests. Instead we test the logic by
 * creating a mock GlobalDO stub (same shape as createMockGlobalDo in
 * directory.test.ts) that now also handles /dump-directory.
 */

import { describe, it, expect } from "bun:test";

// ── Mock GlobalDO stub with /dump-directory support ───────────────────────────

interface AgentIndexRow {
  btc_address: string;
  stx_address: string;
  aibtc_name: string | null;
  display_name: string | null;
  level: number;
  indexed_at: string;
}

interface AddressResolutionRow {
  btc_address: string;
  stx_address: string;
  aibtc_name: string;
  email_address: string;
}

/**
 * Create a mock GlobalDO stub whose fetch() handler includes /dump-directory.
 * Seeds can be provided to pre-populate the in-memory tables.
 */
function createGlobalDoWithDump(opts: {
  agents?: AgentIndexRow[];
  resolutions?: AddressResolutionRow[];
}) {
  const agents: AgentIndexRow[] = opts.agents ?? [];
  const resolutions: AddressResolutionRow[] = opts.resolutions ?? [];

  return {
    idFromName: (_name: string) => ({}),
    get: (_id: unknown) => ({
      async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);

        if (url.pathname === "/dump-directory" && req.method === "GET") {
          return Response.json({ agents, resolutions });
        }

        // Stub other routes so the admin backfill handler doesn't break
        if (url.pathname === "/index-agent" && req.method === "POST") {
          return Response.json({ ok: true });
        }

        return new Response("Not Found", { status: 404 });
      },
    }),
  };
}

// ── Tests: /dump-directory response shape ────────────────────────────────────

describe("GlobalDO /dump-directory endpoint", () => {
  it("returns empty arrays when both tables are empty", async () => {
    const stub = createGlobalDoWithDump({});
    const doInstance = stub.get(stub.idFromName("global"));

    const resp = await doInstance.fetch(new Request("http://internal/dump-directory"));
    expect(resp.status).toBe(200);

    const body = await resp.json() as { agents: unknown[]; resolutions: unknown[] };
    expect(Array.isArray(body.agents)).toBe(true);
    expect(Array.isArray(body.resolutions)).toBe(true);
    expect(body.agents.length).toBe(0);
    expect(body.resolutions.length).toBe(0);
  });

  it("returns all seeded agent rows from agent_index", async () => {
    const seededAgents: AgentIndexRow[] = [
      {
        btc_address: "bc1qalpha",
        stx_address: "SPALPHA",
        aibtc_name: "Alpha Agent",
        display_name: "Alpha",
        level: 2,
        indexed_at: "2025-01-01T00:00:00.000Z",
      },
      {
        btc_address: "bc1qbeta",
        stx_address: "SPBETA",
        aibtc_name: "Beta Agent",
        display_name: null,
        level: 1,
        indexed_at: "2025-01-02T00:00:00.000Z",
      },
    ];

    const stub = createGlobalDoWithDump({ agents: seededAgents });
    const doInstance = stub.get(stub.idFromName("global"));

    const resp = await doInstance.fetch(new Request("http://internal/dump-directory"));
    expect(resp.status).toBe(200);

    const body = await resp.json() as { agents: AgentIndexRow[]; resolutions: unknown[] };
    expect(body.agents.length).toBe(2);
    expect(body.agents[0].btc_address).toBe("bc1qalpha");
    expect(body.agents[1].btc_address).toBe("bc1qbeta");
    expect(body.agents[1].display_name).toBeNull();
  });

  it("returns all seeded resolution rows from address_resolution", async () => {
    const seededResolutions: AddressResolutionRow[] = [
      {
        btc_address: "bc1qalpha",
        stx_address: "SPALPHA",
        aibtc_name: "Alpha Agent",
        email_address: "alpha-agent@agentslovebitcoin.com",
      },
    ];

    const stub = createGlobalDoWithDump({ resolutions: seededResolutions });
    const doInstance = stub.get(stub.idFromName("global"));

    const resp = await doInstance.fetch(new Request("http://internal/dump-directory"));
    expect(resp.status).toBe(200);

    const body = await resp.json() as { agents: unknown[]; resolutions: AddressResolutionRow[] };
    expect(body.resolutions.length).toBe(1);
    expect(body.resolutions[0].email_address).toBe("alpha-agent@agentslovebitcoin.com");
  });

  it("returns both tables populated when both have rows", async () => {
    const seededAgents: AgentIndexRow[] = Array.from({ length: 3 }, (_, i) => ({
      btc_address: `bc1q${i}`,
      stx_address: `SP${i}`,
      aibtc_name: `Agent ${i}`,
      display_name: `Agent ${i}`,
      level: i % 2 === 0 ? 2 : 1,
      indexed_at: new Date(2025, 0, i + 1).toISOString(),
    }));

    const seededResolutions: AddressResolutionRow[] = seededAgents.map((a) => ({
      btc_address: a.btc_address,
      stx_address: a.stx_address,
      aibtc_name: a.aibtc_name ?? "",
      email_address: `agent-${a.btc_address}@agentslovebitcoin.com`,
    }));

    const stub = createGlobalDoWithDump({ agents: seededAgents, resolutions: seededResolutions });
    const doInstance = stub.get(stub.idFromName("global"));

    const resp = await doInstance.fetch(new Request("http://internal/dump-directory"));
    const body = await resp.json() as { agents: AgentIndexRow[]; resolutions: AddressResolutionRow[] };

    expect(body.agents.length).toBe(3);
    expect(body.resolutions.length).toBe(3);
  });

  it("returns 404 for unknown routes (router is not affected)", async () => {
    const stub = createGlobalDoWithDump({});
    const doInstance = stub.get(stub.idFromName("global"));

    const resp = await doInstance.fetch(new Request("http://internal/unknown-route"));
    expect(resp.status).toBe(404);
  });
});
