import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import adminRoutes from "../admin";
import type { Env, AppVariables } from "../../lib/types";

// Minimal Hono app that mounts the admin router — no real DO bindings needed
// to test the auth gate, because the check fires before any DO is touched.
const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
app.route("/api", adminRoutes);

describe("GET /api/admin/schema-health — auth gate", () => {
  it("returns 401 without X-Admin-Key header", async () => {
    const res = await app.request("/api/admin/schema-health");
    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when X-Admin-Key header is present but ADMIN_API_KEY is not set in env", async () => {
    // No ADMIN_API_KEY in the env → isAdmin is false regardless of header value
    const res = await app.request(
      "/api/admin/schema-health",
      { headers: { "X-Admin-Key": "any-key" } }
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when X-Admin-Key does not match ADMIN_API_KEY", async () => {
    const res = await app.request(
      "/api/admin/schema-health",
      { headers: { "X-Admin-Key": "wrong-key" } },
      { ADMIN_API_KEY: "correct-key" } as unknown as Env
    );
    expect(res.status).toBe(401);
  });
});
