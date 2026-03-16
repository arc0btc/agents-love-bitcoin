/**
 * Payment-gated routes — endpoints that always require sBTC payment.
 *
 * Per PRD §3.3:
 * - GET  /api/briefs/:date        — Full brief for a specific date (past briefs)
 * - GET  /api/reports/weekly       — Weekly ecosystem report
 * - POST /api/briefs/compile       — Compile today's brief (heavy operation)
 * - GET  /api/analytics/signals    — Signal analytics dashboard data
 * - GET  /api/analytics/agents     — Agent activity analytics
 *
 * All require Genesis auth (btcAuthMiddleware) + x402 sBTC payment.
 * Payments go to the platform treasury address.
 */

import { Hono } from "hono";
import { btcAuthMiddleware } from "../middleware/auth";
import { x402PaymentGate } from "../middleware/x402";
import { PAID_RATE } from "../lib/constants";
import { okResponse, errorResponse } from "../lib/helpers";
import type { Env, AppVariables } from "../lib/types";

const AGENT_NEWS_API = "https://aibtc.news/api";

const paid = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ─────────────────────────────────────────────────────────────────────────────
// GET /briefs/:date — Full brief for a specific date
// ─────────────────────────────────────────────────────────────────────────────
paid.get(
  "/briefs/:date",
  btcAuthMiddleware,
  x402PaymentGate({
    priceSats: PAID_RATE.perBrief,
    description: "Full brief for a specific date (past briefs)",
  }),
  async (c) => {
    const date = c.req.param("date");

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return errorResponse(c, "VALIDATION_ERROR", "Invalid date format. Use YYYY-MM-DD.", 400);
    }

    // Proxy to agent-news
    try {
      const response = await fetch(`${AGENT_NEWS_API}/briefs/${date}`, {
        headers: {
          "X-BTC-Address": c.get("btcAddress"),
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return errorResponse(c, "NOT_FOUND", `No brief found for date ${date}`, 404);
        }
        return errorResponse(c, "UPSTREAM_ERROR", "Agent-news API unavailable", 502);
      }

      const data = await response.json();
      return okResponse(c, data);
    } catch {
      return errorResponse(c, "UPSTREAM_ERROR", "Failed to fetch brief from agent-news", 502);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /briefs/compile — Compile today's brief (heavy operation)
// ─────────────────────────────────────────────────────────────────────────────
paid.post(
  "/briefs/compile",
  btcAuthMiddleware,
  x402PaymentGate({
    priceSats: PAID_RATE.perCompile,
    description: "Compile today's brief (heavy operation)",
  }),
  async (c) => {
    try {
      const response = await fetch(`${AGENT_NEWS_API}/briefs/compile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BTC-Address": c.get("btcAddress"),
        },
      });

      if (!response.ok) {
        return errorResponse(c, "UPSTREAM_ERROR", "Brief compilation failed upstream", 502);
      }

      const data = await response.json();
      return okResponse(c, data, 201);
    } catch {
      return errorResponse(c, "UPSTREAM_ERROR", "Failed to compile brief via agent-news", 502);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/weekly — Weekly ecosystem report
// ─────────────────────────────────────────────────────────────────────────────
paid.get(
  "/reports/weekly",
  btcAuthMiddleware,
  x402PaymentGate({
    priceSats: PAID_RATE.perWeeklyReport,
    description: "Weekly AIBTC ecosystem report",
  }),
  async (c) => {
    try {
      const response = await fetch(`${AGENT_NEWS_API}/reports/weekly`, {
        headers: {
          "X-BTC-Address": c.get("btcAddress"),
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return errorResponse(c, "NOT_FOUND", "No weekly report available", 404);
        }
        return errorResponse(c, "UPSTREAM_ERROR", "Agent-news API unavailable", 502);
      }

      const data = await response.json();
      return okResponse(c, data);
    } catch {
      return errorResponse(c, "UPSTREAM_ERROR", "Failed to fetch weekly report", 502);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /analytics/signals — Signal analytics dashboard data
// ─────────────────────────────────────────────────────────────────────────────
paid.get(
  "/analytics/signals",
  btcAuthMiddleware,
  x402PaymentGate({
    priceSats: PAID_RATE.perAnalytics,
    description: "Signal analytics dashboard data",
  }),
  async (c) => {
    try {
      const response = await fetch(`${AGENT_NEWS_API}/analytics/signals`, {
        headers: {
          "X-BTC-Address": c.get("btcAddress"),
        },
      });

      if (!response.ok) {
        return errorResponse(c, "UPSTREAM_ERROR", "Analytics unavailable", 502);
      }

      const data = await response.json();
      return okResponse(c, data);
    } catch {
      return errorResponse(c, "UPSTREAM_ERROR", "Failed to fetch signal analytics", 502);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /analytics/agents — Agent activity analytics
// ─────────────────────────────────────────────────────────────────────────────
paid.get(
  "/analytics/agents",
  btcAuthMiddleware,
  x402PaymentGate({
    priceSats: PAID_RATE.perAnalytics,
    description: "Agent activity analytics",
  }),
  async (c) => {
    try {
      const response = await fetch(`${AGENT_NEWS_API}/analytics/agents`, {
        headers: {
          "X-BTC-Address": c.get("btcAddress"),
        },
      });

      if (!response.ok) {
        return errorResponse(c, "UPSTREAM_ERROR", "Analytics unavailable", 502);
      }

      const data = await response.json();
      return okResponse(c, data);
    } catch {
      return errorResponse(c, "UPSTREAM_ERROR", "Failed to fetch agent analytics", 502);
    }
  }
);

export default paid;
