# Cloudflare Cost Runbook — agents-love-bitcoin

Every PR in the May 2026 cost-cleanup campaign records its expected Cloudflare
metric movement, the before/after window, and the rollback signal here.

Canonical campaign plan: `docs/cloudflare-cost-cleanup-plan-2026-05.md`.

Per-PR baselines, inventories, and smoke captures live under `.planning/`
(gitignored).

## PR 1 — Replace metering middleware with `ratelimits` binding

**PR:** `arc0btc/agents-love-bitcoin#15`
**Branch:** `fix/cf-cost-pr1-ratelimits`
**Plan section:** `cloudflare-cost-cleanup-plan-2026-05.md` → "PR 1".
**Phase 0 baseline:** `.planning/2026-05-04-baseline.md`. Captured
`2026-05-03T16:28:51Z → 2026-05-04T16:27:51Z` against the Stacklets CF account
(`916093ba9c76cdc56aad0e16161675f1`).

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

### Post-deploy actuals (accelerated 2h verification)

Per-PR verification ran at 2h instead of 24h to keep the campaign moving;
the long tail confirmation falls out of the next PR's pre-deploy capture.

| Window | Span |
|---|---|
| Pre-deploy | `2026-05-03T16:28:51Z → 2026-05-04T16:27:51Z` (24h) |
| Post-deploy | `2026-05-04T16:37:00Z → 2026-05-04T18:43:24Z` (2h 6min) |

Cloudflare's DO metrics return one namespace per (script, class). The
deploy of PR 1 lit up `GlobalDO` as a separately-tracked namespace
(`2ce99806ef464eadb5794a4942277616`) since the new middleware reads
`agent_index` for tier resolution. AgentDO stays on the original
namespace (`79e44de26ac8464787e3fb0b3a06f92f`). Post-deploy rates are
combined unless noted.

| Metric | Pre-deploy rate/h | Post-deploy rate/h | Change |
|---|---:|---:|---:|
| `ALB_KV` writes | 47/h | **0/h** | **-100%** |
| `ALB_KV` reads | 72/h | 0/h | — (no genesis cache hits in window) |
| `ALB_KV` deletes | 0/h | 0/h | flat |
| AgentDO rows-written | 48/h | **7.6/h** | **-84%** |
| AgentDO rows-read | 309/h | 243/h | -21% |
| AgentDO invocations | 58/h | 38/h | -34% |
| GlobalDO rows-written | n/a | 0/h | new namespace |
| GlobalDO rows-read | n/a | 36/h | new namespace |
| GlobalDO invocations | n/a | 26/h | new namespace |
| Combined ALB DO rows-written | 48/h | **7.6/h** | **-84%** |
| Combined ALB DO rows-read | 309/h | 279/h | -10% |
| Worker invocations | 39/h | 43/h | +10% (within noise) |
| Worker errors | 0 | 0 | flat |

The two cost lines PR 1 targets both dropped sharply:

- **ALB_KV writes 47/h → 0/h** — `publicRateMiddleware`'s per-IP
  `pubrate:*` writes are gone. The genesis-status cache (the only
  remaining KV writer) didn't fire in this window because no new
  registrations or first-time genesis lookups happened.
- **AgentDO rows-written 48/h → 7.6/h** — the per-request `UPDATE
  rate_state` is gone. Residual writes are inbox + email-update
  operations, the lower bound this surface can reach without behaviour
  change.

The combined DO rows-read drop is more modest (-10%) because most reads
were always profile / inbox / email lookups, not rate-state. That cost
line is what PR 2 attacks via the wake-up bit.

Production smoke clean throughout the window: `/api/health`, `/api`, and
`/api/onboarding` all return 200 with the new `X-Rate-Limit: 30` header
sourced from the binding. No 5xx or 429 cluster.

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

**PR:** `arc0btc/agents-love-bitcoin#<pending>`
**Branch:** `feat/cf-cost-pr2-inbox-status`
**Plan section:** `cloudflare-cost-cleanup-plan-2026-05.md` → "PR 2".

### Scope

- `AgentDO.account_stats` now maintains two new keys:
  - `unread_count` — incremented in `receiveEmail`, decremented in
    `getInboxMessage` on the unread → read transition (clamped at 0).
  - `total_emails_received` — already existed implicitly; now seeded to 0 on
    `register` so a `SELECT stat_value` answers "total inbox count" without
    scanning the inbox table.
- One-time `ensureInboxStats()` backfill on the first DO touch post-deploy:
  reads `COUNT(*)` and `COUNT(*) WHERE read_at IS NULL` once if the stats
  rows are missing, then writes the seed values. Idempotent and
  isolate-cached.
- New `GET /api/me/inbox-status` — single 1-row read of `account_stats`,
  returns `{ unread, total }`. Designed as the wake-up bit for poll-driven
  runtimes (`alb-email-poll.ts` calls this first, skips full inbox fetch
  when `unread === 0`).
- `listInbox` swaps `SELECT COUNT(*) FROM inbox` for the
  `total_emails_received` lookup. Inbox is append-only so the lifetime
  counter equals the row count.
- Paired runtime PR (`aibtcdev/agent-runtime`) updates
  `scripts/alb-email-poll.ts` to call `/api/me/inbox-status` first; both PR
  numbers land in this entry.

### Expected Cloudflare movement

At 5 active agents on 600s polling cadence, the runtime fleet hits inbox
endpoints ~720x/day total. Today each call scans the inbox via
`SELECT COUNT(*)` plus the LIMIT/OFFSET fetch. With the wake-up bit:

- Idle polls (the common case — most polls find no new mail) drop from a
  full inbox scan to a single 1-row stat lookup. AgentDO `rows-read` per
  idle poll falls from "table size" toward 1.
- The full inbox fetch only runs on actual mail arrival. At 10K active
  agents this is the difference between ~1.5M inbox-scan calls/day and ~50K
  fetches/day on real arrivals.

PR 1 baseline AgentDO `rows-read = 7,427 / 24h ≈ 309/h`. After PR 2 plus
runtime cutover, expect `rows-read/h` to fall sharply — most of the
remainder is profile + email reads, not inbox scans.

### Done criteria

- AgentDO `rows-read/day` drops materially across the runtime fleet over
  a 24h window (or the accelerated 2h window agreed for this campaign).
- Inbox correctness preserved: send a test email, confirm
  `/api/me/inbox-status` shows `unread === 1` before read and `unread === 0`
  after a `GET /api/me/email/inbox/{id}` round-trip.
- `total` returned by `/api/me/email/inbox` still equals the historical
  count for an existing agent (backfill seeds correctly).

### Post-deploy actuals

Pre-deploy column reuses the PR 1 post-deploy snapshot once captured.

| Metric | Pre-deploy 24h total | Pre-deploy rate/h | Post-deploy total | Post-deploy rate/h | Change |
|---|---:|---:|---:|---:|---:|
| ALB DO rows-read | TBD | TBD | TBD | TBD | TBD |
| ALB DO rows-written | TBD | TBD | TBD | TBD | TBD |
| ALB DO invocations | TBD | TBD | TBD | TBD | TBD |

### Rollback signal

- `/api/me/inbox-status` returns wrong values (negative, larger than total,
  diverges from `SELECT COUNT(*) WHERE read_at IS NULL` against a smoke
  agent's DO).
- `total` from `/api/me/email/inbox` reports a number that doesn't match
  what the runtime saw before.
- Runtime poll job spikes 4xx because the new endpoint isn't authenticated
  correctly.

## PR 3 — Heartbeat consolidation

**PR:** `arc0btc/agents-love-bitcoin#<pending>`
**Branch:** `chore/cf-cost-pr3-heartbeat`
**Plan section:** `cloudflare-cost-cleanup-plan-2026-05.md` → "PR 3".

### Scope

- Add `GlobalDO.touchActive(btcAddress, thresholdSeconds = 60)` — coalesced
  UPDATE against `agent_index.last_active_at`. The `WHERE last_active_at IS
  NULL OR last_active_at < ?` clause keeps high-frequency callers from
  fanning out one DO write per request; the runtime cadence (~600s)
  triggers an actual write at most once per agent per 60s window.
- Add `POST /touch-active/:btc` HTTP handler so the worker can fire the
  refresh from the request path.
- `GET /api/me/inbox-status` now fires `globalDo.fetch('/touch-active/...')`
  as fire-and-forget through `c.executionCtx.waitUntil`. The explicit
  heartbeat task on the runtime side becomes redundant — inbox-status
  polls keep the liveness signal warm.
- Paired runtime PR (`aibtcdev/agent-runtime`) drops or stretches the
  `aibtc-checkin` schedule. ALB-side change is safe to land first; the
  runtime keeps checking in until its config catches up.

### Expected Cloudflare movement

The PR 1 heartbeat stretch logic was deferred to here so PR 2's metric
attribution stays clean. On its own, the ALB-side change adds at most 1
GlobalDO write per agent per 60s window. With 5 active agents on 600s
poll cadence, that's at most 5 writes/min ≈ 7K/day worst case, but
realistic load is closer to 1 write/agent/poll = ~720/day total — bounded
by the polling cadence. The bigger movement comes from the paired runtime
PR which drops the dedicated heartbeat task entirely; that cuts Workers
request count and AgentDO/GlobalDO invocations by the heartbeat share.

### Done criteria

- `aibtc-checkin` task volume on the runtime fleet drops to near-zero (or
  ~1/h with stretch) over the 2h verification window.
- `last_active_at` recency for each active agent stays within 1h of
  `now()` — runtime poll cadence at 600s keeps this comfortable.
- No operator alarm on agent liveness; no 5xx cluster in production.

### Post-deploy actuals

| Metric (rate/h) | Pre-deploy (post-PR2) | Post-deploy | Change |
|---|---:|---:|---:|
| `aibtc-checkin` task volume | TBD | TBD | TBD |
| GlobalDO rows-written | TBD | TBD | TBD |
| AgentDO rows-read | TBD | TBD | TBD |
| Worker invocations | TBD | TBD | TBD |

### Rollback signal

- Sustained 5xx on `/api/me/inbox-status` post-deploy. The
  fire-and-forget `touchActive` failure shouldn't surface, but a
  GlobalDO outage could still cascade if the `c.executionCtx.waitUntil`
  promise resolution somehow blocks the response — verify it doesn't.
- `last_active_at` timestamps for active agents falling more than 1h
  behind `now()` over 2h+ — would indicate the touch path isn't firing.
