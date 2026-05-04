# Cloudflare Cost Cleanup — Campaign Plan (2026-05)

Canonical plan of record for the May 2026 cost cleanup on `agents-love-bitcoin`. Every PR in this campaign references this file. Per-PR actuals are recorded in `cloudflare-cost-runbook.md`. Per-PR evidence (baselines, inventories, smoke captures) lives under `.planning/` (gitignored).

## Why this campaign exists

ALB is hitting daily Cloudflare free-tier limits with 5 runtime agents online. The user is planning to scale registered-and-active agents from 5 → 100 → 1,000 → 10,000 over the next quarters, and wants:

- 5 and 100 active agents to fit in the **free** Workers plan.
- 1,000 and 10,000 active agents to fit in the **$5/mo paid** Workers plan with predictable, low overage cost.
- The simplicity to be load-bearing — no premature scale infra.

## Senior reframing (read this before touching code)

The original draft of this campaign mirrored the `agent-news` cleanup pattern: keep the metering middleware, move its KV write into a Durable Object. That is the *competent* fix. It is not the *senior* fix.

The metering middleware exists to bound free-tier abuse via a 24h-rolling per-request counter. Two things are wrong with that mechanism for this product:

1. **It does not earn its complexity.** The runtime polling cadence (heartbeat 360s + inbox 600s = 144 polls/day per agent) already exceeds the static `FREE_ALLOCATION.maxRequests = 100` in `src/lib/constants.ts:18`. Today's 5-agent fleet is only working because `x402MeterOverflow` quietly bridges over the wall, or because admin-key bypass short-circuits. The mechanism is incoherent under its own product's traffic.
2. **It does not scale.** A per-request counter write — whether on KV or DO — costs O(traffic). At 10K agents that is ~1.5M writes/day on the metering key alone.

The senior plan deletes the metering middleware. It replaces the throttle with the Cloudflare `ratelimits` binding (free, no durable state). It replaces the budget concept with paid-receipt rows on AgentDO that are written only when an x402 settlement actually happens (rare event, bounded volume). It replaces the inbox-poll cost driver with a wake-up bit so idle polls don't scan the inbox table.

Build the correct mechanism. Don't reimplement the wrong one more cheaply.

## Cost envelope (target)

Steady-state volume per active agent at current cadence (heartbeat 360s + inbox 600s):

| Active agents | Workers req/day | DO rows-read/day (current) | DO rows-read/day (with wake-up bit) | KV writes/day (current) |
|---:|---:|---:|---:|---:|
| 5     | ~750     | ~75K  | ~750  | ~750 |
| 100   | ~15K     | ~1.5M | ~15K  | ~15K |
| 1,000 | ~150K    | ~150M | ~150K | ~150K |
| 10,000| ~1.5M    | ~1.5B | ~1.5M | ~1.5M |

Free-tier caps that bind first:
- **KV writes 1K/day** breaks at ~7 active agents.
- **Workers requests 100K/day** breaks at ~600 active agents.
- Free-tier SQLite-DO row caps (smaller still) likely break sooner.

Paid plan included tiers: ~10M Workers reqs/mo, ~1B DO rows-read/mo, ~50M DO rows-written/mo, ~1M KV writes/mo. Overage rates are small for reads, brutal for KV writes ($5/M). The patterns below are designed so KV writes per request go to **zero**, DO writes scale only with actual mail arrival, and DO reads scale linearly with poll count but with a tiny per-poll constant.

Targeted bill at 10K active agents on paid plan: **~$15-25/mo**, dominated by Workers request overage above the 10M/mo bucket, with DO and KV inside included tiers.

## The four patterns

### Pattern 1 — Stop counting requests; use `ratelimits` for abuse and AgentDO receipts for paid budgets

Delete `src/middleware/metering.ts` and the per-request KV write at `metering.ts:112`. Replace with three Cloudflare `ratelimits` bindings keyed by `(tier, btcAddress|ip)`:

```jsonc
"ratelimits": [
  { "name": "RL_ANON",       "namespace_id": 1, "simple": { "limit": 30,  "period": 60 } },
  { "name": "RL_REGISTERED", "namespace_id": 2, "simple": { "limit": 120, "period": 60 } },
  { "name": "RL_PAID",       "namespace_id": 3, "simple": { "limit": 300, "period": 60 } }
]
```

Tier resolution:
- Anonymous → `RL_ANON`, IP-keyed.
- `agent_index.level >= 1` → `RL_REGISTERED`, btc-address-keyed.
- Has an active x402 paid-receipt within last N minutes → `RL_PAID`, btc-address-keyed.

Cache the tier in a worker-isolate `Map<btcAddress, {tier, fetchedAt}>` for 60s after the first GlobalDO read so 99% of requests don't hit the DO for tier lookup.

The 24h-rolling free allocation concept dies entirely. If the product later needs a paid budget, write it as `(payment_id, sats_spent, settled_at)` rows on AgentDO when an x402 receipt actually settles — write rate is bounded by paid-traffic volume, not all traffic.

### Pattern 2 — Wake-up bit instead of full inbox scan on every poll

Add an `unread_count` row to AgentDO `account_stats` (table already exists at `src/objects/schema.ts:54`; one new stat key, no schema migration needed).

Maintenance:
- `receiveEmail` increments `unread_count`.
- `getInboxMessage` decrements it on the unread→read transition.
- One-time backfill on first DO touch post-deploy: `SELECT COUNT(*) FROM inbox WHERE read_at IS NULL` writes the seed value, then maintained going forward.

New endpoint:
- `GET /api/me/inbox-status` → 1-row read of `account_stats WHERE stat_key='unread_count'`. Returns `{ unread, last_received_at }`.

Existing `GET /api/me/email/inbox` stays. Update its `listInbox` to read `unread_count` from `account_stats` instead of running `SELECT COUNT(*) FROM inbox` (cuts the per-call scan in half).

Update `agent-runtime/scripts/alb-email-poll.ts` to hit `/api/me/inbox-status` first and skip the full inbox fetch when `unread === 0`.

Result: at 10K agents, idle-poll cost drops from ~100 rows-read per call to 1. The full inbox scan only runs on actual mail arrival (~5/agent/day = 50K calls/day at 10K agents, not 1.5M).

### Pattern 3 — Heartbeat consolidation

`agent_index.last_active_at` updates implicitly on any authenticated GlobalDO touch. The dedicated 360s heartbeat is mostly write-amplification.

Either:
- Drop the explicit `aibtc-checkin` schedule on the runtime side; let `last_active_at` get refreshed by inbox-status polls.
- Or stretch heartbeat to 1h and only fire if no other authenticated call happened in the last hour.

This isn't critical for free-tier survival, but at 10K agents it halves steady-state Workers request count for ~$0 effort. Defer the runtime-side change to PR 3 so PR 2's metric attribution stays clean.

### Pattern 4 — Email setup is bursty, not steady-state

When pointing 1K+ existing agents at email setup, the campaign is a one-shot fan-in (~3-5K total requests). Trivial regardless of plan. The shape: agent self-registers at its own pace, the `RL_ANON`/`RL_REGISTERED` bindings throttle abuse, no special "campaign mode" needed. Don't pre-provision in bulk — let the agents pull on themselves so the load shape matches steady-state polling.

The provisioning endpoint must be idempotent (existing `register` flow appears to be) so retries are free. Verify in PR 1 inventory.

## PR sequence

Each PR scoped to one cost surface so metric attribution is unambiguous. Verify-before-advance: no phase moves to the next until 24h Cloudflare metrics confirm the previous one.

### PR 1 — Replace metering middleware with `ratelimits` binding (+ drop unused LOGS)

**Branches:** off `main`, named `fix/cf-cost-pr1-ratelimits`.

**Scope:**
- Add `ratelimits` namespaces to `wrangler.jsonc` (RL_ANON, RL_REGISTERED, RL_PAID).
- New `tieredRateLimitMiddleware` at `src/middleware/rate-limit.ts` that resolves tier from `agent_index.level` (cached in isolate `Map` for 60s) and consults the matching binding. Anonymous calls use IP key; authenticated use btc-address.
- New helper on GlobalDO: `getAgentTier(btcAddress)` returning `'anon' | 'registered' | 'paid'`. Cheap point lookup against existing `agent_index` index.
- Replace `meteringMiddleware` with `tieredRateLimitMiddleware` in `src/routes/me.ts:21` and any other mount points.
- Delete `src/middleware/metering.ts`, exports `meteringMiddleware` and `getMeterState`.
- Delete `FREE_ALLOCATION`, `WINDOW_SECONDS`, and `RATE_LIMITS` constants in `src/lib/constants.ts` if they have no remaining callers.
- Update `GET /api/me/usage` to report tier + current `ratelimits` headers, or deprecate the endpoint and return `410 Gone` with a stable shape.
- Drop the `LOGS` services binding from `wrangler.jsonc` and the `LOGS?` field on `Env` in `src/lib/types.ts:17`. Confirmed unused (`grep -rn "LOGS\|logger\." src/` returns only the binding declaration).
- Add `.planning/` to `.gitignore`.
- Create `docs/cloudflare-cost-runbook.md` with the PR 1 entry filled in (PR link, baseline window, target metric, post-deploy actuals slot). Mirror the format used in `aibtcdev/agent-news/docs/cloudflare-cost-runbook.md` and `aibtcdev/landing-page/docs/cloudflare-cost-runbook.md`.

**Done criteria:**
- ALB_KV writes/h drops to baseline (everything except whatever else might be writing) over a 24h post-deploy window.
- `429` responses fire only on actual abuse (the runtime cohort at 600s polling stays well under 30 req/min, never sees 429).
- Production smoke clean: heartbeat + email-poll from one runtime agent (Spark or Forge) succeed without 402/429.
- Cost runbook PR 1 entry has actuals filled in.

**Phase 0 baseline capture (before opening PR 1):** trailing 24h `kvOperationsAdaptiveGroups` for `ALB_KV` (id `a66764f222074c4192d0d4a69a90063f`), `durableObjectsInvocationsAdaptiveGroups` and `durableObjectsPeriodicGroups` for both DO namespaces, `workersInvocationsAdaptiveGroups` for the worker. Save to `.planning/2026-05-04-baseline.md` with the exact GraphQL query, window, and headline numbers.

### PR 2 — `unread_count` + `/api/me/inbox-status` endpoint

**Branches:** off `main` (post PR 1 merge), named `feat/cf-cost-pr2-inbox-status`.

**Scope:**
- AgentDO maintains `unread_count` row in `account_stats`:
  - Increment in `receiveEmail` (`src/objects/agent-do.ts` around line 159 where `total_emails_received` already increments).
  - Decrement in `getInboxMessage` only when transitioning unread → read (lines 199-208).
  - One-time backfill on first DO touch post-deploy: if `unread_count` row missing, run `SELECT COUNT(*) FROM inbox WHERE read_at IS NULL` once, write the seed.
- New route `GET /api/me/inbox-status` in `src/routes/me.ts`. Reads from `account_stats` only; no inbox table touch.
- Update `listInbox` (`src/objects/agent-do.ts:172`) to read `unread_count` from `account_stats` instead of running `SELECT COUNT(*) FROM inbox`. Drop the count query.
- Update `agent-runtime/scripts/alb-email-poll.ts` (separate repo: `aibtcdev/agent-runtime`) to call `/api/me/inbox-status` first and skip full inbox fetch when `unread === 0`. Land in `agent-runtime` as a paired PR; reference both PR numbers in the runbook entry.
- Cost runbook PR 2 entry.

**Done criteria:**
- AgentDO rows-read/day drops by ~95% across the runtime fleet over a 24h window.
- Inbox correctness preserved: read all messages with one full fetch, confirm `unread_count` returns to 0.
- Inbound email correctness preserved: send a test email, confirm `unread_count` increments before and decrements after read.

### PR 3 — Heartbeat consolidation

**Branches:** off `main` (post PR 2 merge), named `chore/cf-cost-pr3-heartbeat`.

**Scope:**
- Drop or stretch `aibtc-checkin` schedule in `agent-runtime` deploy configs (this is an `agent-runtime` repo change, not ALB).
- ALB-side: ensure `agent_index.last_active_at` is refreshed inside the inbox-status path so liveness signals don't go dark when explicit heartbeat stops.
- Cost runbook PR 3 entry.

**Done criteria:**
- `aibtc-checkin` task volume drops to near-zero (drop) or 1h cadence (stretch).
- No operator alarm on agent liveness over a 24h window.
- `last_active_at` recency for each active agent stays within 1h of `now()`.

## Review and merge cadence

- **Open each PR in `arc0btc/agents-love-bitcoin`** with the campaign plan linked in the description and the specific PR section anchored.
- **Tag `@arc0btc` for review on PR open.** Continue back-and-forth review iterations until the operator approves.
- **Trigger Copilot review once at PR open**, not on subsequent pushes. (`gh pr create` triggers it by default in this repo's setup; if a force-push occurs, do not re-request Copilot.)
- **Merge gating:** both arc0btc approval and any unresolved Copilot comments addressed. Don't wait for additional rounds beyond what's needed to resolve raised issues.
- **Post-merge:** capture 24h Cloudflare metrics, fill in the runbook entry, then open the next PR. Do not pipeline PRs.

## Anti-patterns to avoid

1. Bundling multiple patterns into one PR. Metric attribution gets murky. Separate PRs, separate 24h verification windows.
2. Pre-deploy "we'll just verify in production" without Phase 0 baseline. The honest before/after requires the same query against the same window before and after.
3. Migrating the metering counter into AgentDO storage as a 1:1 replacement. That preserves a mechanism whose product justification doesn't survive runtime-driven agents. Build the budget concept on receipts, not requests.
4. Adding hibernatable WebSockets for inbox notifications. Real win at 50K+, not now. Wake-up-bit polling is 95% of the value at 5% of the complexity.
5. Keeping `LOGS` bound after PR 1. If unused, delete it.

## Tooling pointers

- **Cloudflare GraphQL token:** `~/dev/aibtcdev/x402-sponsor-relay/.env` `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (AIBTC account). If ALB is on a different account, check `arc0btc` org Cloudflare access.
- **Reference inventories with copy-paste GraphQL:**
  - `~/dev/aibtcdev/worker-logs/.planning/2026-05-02T2050Z-news-kv-write-inventory.md`
  - `~/dev/aibtcdev/worker-logs/.planning/2026-05-03T0445Z-newsdo-rows-read-inventory.md`
- **Reference cost-runbook entries:**
  - `~/dev/aibtcdev/agent-news/docs/cloudflare-cost-runbook.md`
  - `~/dev/aibtcdev/landing-page/docs/cloudflare-cost-runbook.md`
- **Reference PRs (read diffs end-to-end before starting):**
  - `aibtcdev/agent-news#704`, `#705` — KV rate-limit removal
  - `aibtcdev/agent-news#725` — agent-resolver bulk-write fix
  - `aibtcdev/agent-news#731` — materialised correspondent_stats
  - `aibtcdev/x402-sponsor-relay#367` — INFO log sampling
  - `aibtcdev/landing-page#644` — sampling helper + timeout sentinel
