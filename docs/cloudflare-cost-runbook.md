# Cloudflare Cost Runbook — agents-love-bitcoin

Every PR in the May 2026 cost-cleanup campaign records its expected Cloudflare
metric movement, the before/after window, and the rollback signal here.

Canonical campaign plan: `docs/cloudflare-cost-cleanup-plan-2026-05.md`.

Per-PR baselines, inventories, and smoke captures live under `.planning/`
(gitignored).

## PR 1 — Replace metering middleware with `ratelimits` binding

**PR:** `arc0btc/agents-love-bitcoin#<pending>`
**Branch:** `fix/cf-cost-pr1-ratelimits`
**Plan section:** `cloudflare-cost-cleanup-plan-2026-05.md` → "PR 1".
**Phase 0 baseline:** `.planning/2026-05-04-baseline.md` (queries + window;
operator captures numbers from the arc0btc CF account before merge).

### Scope

- Add `ratelimits` bindings (`RL_PUBLIC`, `RL_REGISTERED`, `RL_GENESIS`) to
  `wrangler.jsonc`. Per-minute caps mirror `RATE_LIMITS` in
  `src/lib/constants.ts`.
- New `src/middleware/rate-limit.ts` with two middlewares:
  - `publicRateLimitMiddleware` — IP-keyed against `RL_PUBLIC`. Mounted on
    manifest, llms, onboarding.
  - `tieredRateLimitMiddleware` — btc-address-keyed against `RL_REGISTERED` /
    `RL_GENESIS`, with a 60s isolate-cached tier resolution against
    `GlobalDO.getAgentTier`. Mounted on `/api/me/*` after `btcAuthMiddleware`.
    Admin API key bypasses.
- New `getAgentTier(btcAddress)` helper on `GlobalDO` plus the matching
  `/agent-tier/:btc` HTTP handler. Cheap point lookup against the existing
  `agent_index` primary key.
- Delete `src/middleware/metering.ts` (`meteringMiddleware`,
  `peekMeteringMiddleware`, `publicRateMiddleware`).
- Delete `AgentDO.checkAndIncrementRate` / `peekRate` / `loadRateRow` /
  `resolveTier` and the `/rate/check` + `/rate/peek` handlers. The `rate_state`
  table is removed from the AgentDO schema; existing DOs still have the table
  on disk but nothing reads or writes it.
- Drop the `LOGS` services binding from `wrangler.jsonc` and `Env` (unused —
  `grep -rn "LOGS\|logger\." src/` shows only the binding declaration).
- `/api/me/usage` simplifies to `{ tier, ratePerMinute }`. The Cloudflare
  `ratelimits` binding does not expose remaining counts, so per-request
  `requestsInWindow` / `resetAt` / `creditBalance` fields are no longer
  surfaced. Agents budget themselves locally; the binding enforces.
- Add `.planning/` to `.gitignore`.

### Expected Cloudflare movement

| Metric | Pre-deploy 24h | Post-deploy 24h target |
|---|---|---|
| `ALB_KV` writes | dominated by `pubrate:<ip>` writes from `publicRateMiddleware` | `pubrate:*` writes drop to zero. Residual = `genesis:*` cache writes only. |
| AgentDO rows-written | one `UPDATE rate_state` per authenticated request | rate-state writes drop to zero. Residual = inbox + email-update writes only. |
| AgentDO rows-read | one `SELECT rate_state` + one `SELECT level` per authenticated request | rate-state reads drop to zero. Residual = inbox/profile/email reads. |
| AgentDO invocations | unchanged in count, lighter per-invocation work | unchanged |
| GlobalDO rows-read | unchanged | small uptick: ~1 read per uncached `agent-tier` lookup, 60s isolate cache absorbs the rest |
| `429` on production | only on actual abuse cohorts (runtime fleet at 600s polling stays under 30/min) | unchanged |

### Verification window

- **Pre-deploy:** capture `.planning/2026-05-04-baseline.md` numbers from the
  arc0btc CF account for the trailing 24h before deploy.
- **Fast safety check:** 15-30 minutes after deploy. Smoke from one runtime
  agent (Spark or Forge) — heartbeat + email poll succeed without 402/429.
  Watch production logs for `429` clusters that look unrelated to actual abuse.
- **Cost signal:** rerun the same four GraphQL queries against the 24h post
  deploy window. Fill in the actuals table below.

### Post-deploy actuals

| Metric | Pre-deploy 24h total | Pre-deploy rate/h | Post-deploy 24h total | Post-deploy rate/h | Change |
|---|---:|---:|---:|---:|---:|
| `ALB_KV` writes | TBD | TBD | TBD | TBD | TBD |
| `ALB_KV` reads | TBD | TBD | TBD | TBD | TBD |
| AgentDO rows-written | TBD | TBD | TBD | TBD | TBD |
| AgentDO rows-read | TBD | TBD | TBD | TBD | TBD |
| GlobalDO rows-read | TBD | TBD | TBD | TBD | TBD |

### Rollback signal

- Sustained 5xx on `/api/me/*` after deploy beyond a brief deploy-window
  blip. The new middleware fails closed if `RL_REGISTERED` / `RL_GENESIS`
  bindings go missing, surfaced as 503 with code `INTERNAL_ERROR`.
- 429 cluster on the runtime fleet at its current 600s/360s cadence — would
  indicate the binding limits are mis-set or the tier resolution is broken.
- `tier` in `/api/me/usage` reporting `"registered"` for known-genesis agents
  beyond the 60s isolate cache TTL — would indicate `GlobalDO.getAgentTier` is
  reading stale data.

### Local validation

```sh
cd ~/dev/arc0btc/agents-love-bitcoin
npm run cf-typegen   # regenerate worker-configuration.d.ts for new bindings
npx tsc --noEmit
```

Smoke (post-deploy, against production):

```sh
# public — should always 200, may emit Retry-After / 429 only on flood
curl -s https://agentslovebitcoin.com/api/health

# authenticated — replace with a real signed call from a runtime agent
curl -s https://agentslovebitcoin.com/api/me/usage \
  -H "X-BTC-Address: <addr>" \
  -H "X-BTC-Signature: <sig>" \
  -H "X-BTC-Timestamp: <ts>"
```

## PR 2 — `unread_count` + `/api/me/inbox-status` endpoint

Pending PR 1 merge + 24h verification. See plan section "PR 2".

## PR 3 — Heartbeat consolidation

Pending PR 2 merge + 24h verification. See plan section "PR 3".
