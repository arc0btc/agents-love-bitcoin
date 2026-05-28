/**
 * Admin routes — protected by X-Admin-Key header.
 *
 * GET /api/admin/schema-health
 *   Introspects AgentDO and D1 for missing indexes and unexpected scan
 *   query plans. Returns a structured JSON response keyed by component.
 *   GlobalDO has been retired; the response shape is { agentDo, d1 }.
 */

import { Hono } from "hono";
import { okResponse } from "../lib/helpers";
import { D1_DIRECTORY_SCHEMA, D1_DIRECTORY_EXPECTED_INDEXES } from "../objects/d1-schema";
import { ensureD1Schema } from "../services/directory";
import type { Env, AppVariables } from "../lib/types";

const admin = new Hono<{ Bindings: Env; Variables: AppVariables }>();

admin.get("/admin/schema-health", async (c) => {
  // Inline admin-key check — matches the pattern in register.ts and rate-limit.ts
  const adminKey = c.req.header("X-Admin-Key");
  const isAdmin = Boolean(adminKey && c.env?.ADMIN_API_KEY && adminKey === c.env.ADMIN_API_KEY);
  if (!isAdmin) {
    return c.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Invalid or missing admin key" } },
      401
    );
  }

  // --- AgentDO health ---
  // Use a synthetic probe key so the DO self-initialises with an empty-but-healthy
  // schema regardless of registration count.
  const agentProbeKey = "schema-health-probe";

  const agentDoId = c.env.AGENT_DO.idFromName(agentProbeKey);
  const agentDo = c.env.AGENT_DO.get(agentDoId);

  const agentResp = await agentDo.fetch(
    new Request("http://internal/schema-health")
  );
  if (!agentResp.ok) {
    return c.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "AgentDO schema-health fetch failed" } },
      500
    );
  }
  const agentHealth = await agentResp.json() as {
    missingIndexes: string[];
    unexpectedScans: string[];
    plans: Record<string, unknown[]>;
    rowCounts: Record<string, number>;
  };

  // --- D1 directory health ---
  // Parse expected index names from D1_DIRECTORY_SCHEMA for drift detection.
  // We also detect UNIQUE constraints that create implicit indexes — these are
  // not named in the schema DDL but are enforced by SQLite's constraint machinery.
  function parseD1IndexNames(schema: string): Set<string> {
    const names = new Set<string>();
    const re = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\S+)/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(schema)) !== null) {
      names.add(match[1]);
    }
    return names;
  }

  let d1Health: {
    missingIndexes: string[];
    unexpectedScans: string[];
    plans: Record<string, unknown[]>;
    schemaExpected: string[];
  } | { error: string };

  try {
    await ensureD1Schema(c.env.DB);

    // Live named indexes in D1 (excludes sqlite_ internal ones)
    const liveResult = await c.env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
      .all<{ name: string }>();
    const liveNames = new Set((liveResult.results ?? []).map((r) => r.name));

    const parsedExpected = parseD1IndexNames(D1_DIRECTORY_SCHEMA);
    const missingIndexes = [...D1_DIRECTORY_EXPECTED_INDEXES].filter(
      (name) => !liveNames.has(name)
    );

    // Hot query plans — the two WHERE email_address = ? lookups
    const hotQueries: Record<string, { sql: string; params: unknown[] }> = {
      resolveByEmailLocalPart: {
        sql: "SELECT btc_address FROM address_resolution WHERE email_address = ?",
        params: ["test@agentslovebitcoin.com"],
      },
      isEmailLocalPartTaken: {
        sql: "SELECT 1 FROM address_resolution WHERE email_address = ? AND btc_address != ?",
        params: ["test@agentslovebitcoin.com", "bc1test"],
      },
    };

    const plans: Record<string, unknown[]> = {};
    const unexpectedScans: string[] = [];

    for (const [label, { sql, params }] of Object.entries(hotQueries)) {
      const planResult = await c.env.DB
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(...params)
        .all<{ detail?: string; [k: string]: unknown }>();

      const planRows = planResult.results ?? [];
      plans[label] = planRows;

      for (const row of planRows) {
        const detail = (row.detail ?? "").toUpperCase();
        const isBadScan =
          (detail.includes("SCAN") && !detail.includes("INDEX")) ||
          detail.includes("USE TEMP B-TREE");
        if (isBadScan) {
          unexpectedScans.push(`${label}: ${row.detail ?? ""}`);
        }
      }
    }

    d1Health = {
      missingIndexes,
      unexpectedScans,
      plans,
      schemaExpected: [...parsedExpected],
    };
  } catch (err: unknown) {
    d1Health = { error: err instanceof Error ? err.message : String(err) };
  }

  return okResponse(c, {
    agentDo: agentHealth,
    d1: d1Health,
  });
});

export default admin;
