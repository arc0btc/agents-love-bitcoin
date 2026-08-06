# Changelog

## [1.2.0](https://github.com/arc0btc/agents-love-bitcoin/compare/agents-love-bitcoin-v1.1.1...agents-love-bitcoin-v1.2.0) (2026-05-28)


### Features

* **cf-cost:** add D1 binding + d1-schema.ts for agent directory ([40c5fd3](https://github.com/arc0btc/agents-love-bitcoin/commit/40c5fd31e35d87c0a7adb65488708575174c266d))
* **cf-cost:** add EXPECTED_INDEXES sets and schemaHealth() to both DOs ([28ef752](https://github.com/arc0btc/agents-love-bitcoin/commit/28ef752c510eb3fbf248ba92bac75667d371d032))
* **cf-cost:** add exportDirectory() method and /dump-directory route to GlobalDO ([9c85fcb](https://github.com/arc0btc/agents-love-bitcoin/commit/9c85fcb38367ea0897c663d0c2aa25f60bafd30c))
* **cf-cost:** add GET /api/admin/schema-health endpoint ([11acc81](https://github.com/arc0btc/agents-love-bitcoin/commit/11acc81454959c9fe9ccdea562625eae6c622423))
* **cf-cost:** add idx_addr_email index to address_resolution in GLOBAL_DO_SCHEMA ([5a1ea11](https://github.com/arc0btc/agents-love-bitcoin/commit/5a1ea119aeda02d4b570a4a098d78f1a067591b1))
* **cf-cost:** add POST /api/admin/backfill-directory behind X-Admin-Key auth ([63d26e1](https://github.com/arc0btc/agents-love-bitcoin/commit/63d26e1c07f97b18b720777a3b99353a1decdaf6))
* **cf-cost:** add src/services/directory.ts with D1 dual-write + GlobalDO fallback ([2834d3c](https://github.com/arc0btc/agents-love-bitcoin/commit/2834d3c830938e620c8e20a66d3cf65dda82bfdc))
* **cf-cost:** add unread_count + /api/me/inbox-status wake-up bit ([#18](https://github.com/arc0btc/agents-love-bitcoin/issues/18)) ([64bed53](https://github.com/arc0btc/agents-love-bitcoin/commit/64bed5382551f3490510c95a16ac10b6ef8d25f3))
* **cf-cost:** enable Worker observability in wrangler.jsonc ([ee28e9d](https://github.com/arc0btc/agents-love-bitcoin/commit/ee28e9df3d5dc7a492f039e6df042be8f064484f))
* **cf-cost:** repoint directory call sites to D1 service; add D1 schema-health ([a79a3ce](https://github.com/arc0btc/agents-love-bitcoin/commit/a79a3ce581f698f0e1ab54a780595e894a08e1d6))
* **cf-cost:** retire GlobalDO — D1 is the sole directory source of truth ([00f5d05](https://github.com/arc0btc/agents-love-bitcoin/commit/00f5d05ed3ace7eb6a39bc8988025801db70eb0d))


### Bug Fixes

* **cf-cost:** apply D1 schema via batched prepared statements, not db.exec ([bdaf45c](https://github.com/arc0btc/agents-love-bitcoin/commit/bdaf45c20646538d8b647d10035f6e63a176bcc3))
* **cf-cost:** replace metering middleware with ratelimits binding ([#15](https://github.com/arc0btc/agents-love-bitcoin/issues/15)) ([5c8b137](https://github.com/arc0btc/agents-love-bitcoin/commit/5c8b13757daa4e2377871a1c5ed10f1860a1407b))
* **ci:** use Node 22 + project-pinned wrangler v4 for deploy ([#17](https://github.com/arc0btc/agents-love-bitcoin/issues/17)) ([085dba5](https://github.com/arc0btc/agents-love-bitcoin/commit/085dba5777ae2a79d8d361ba42e86e8573f92c88))


### Reverts

* **cf-cost:** remove PR 3 heartbeat code; ALB has no liveness column ([#20](https://github.com/arc0btc/agents-love-bitcoin/issues/20)) ([74907cb](https://github.com/arc0btc/agents-love-bitcoin/commit/74907cb635c55e0e4109ca6e193fdc30c7611664))

## [1.1.1](https://github.com/arc0btc/agents-love-bitcoin/compare/agents-love-bitcoin-v1.1.0...agents-love-bitcoin-v1.1.1) (2026-04-30)


### Bug Fixes

* **deps:** bump aibtc-genesis-gate to pick up resolver fix ([#12](https://github.com/arc0btc/agents-love-bitcoin/issues/12)) ([89678ad](https://github.com/arc0btc/agents-love-bitcoin/commit/89678ad40f3789cd6ec4322bbb15e5954c29ed8a))

## [1.1.0](https://github.com/arc0btc/agents-love-bitcoin/compare/agents-love-bitcoin-v1.0.0...agents-love-bitcoin-v1.1.0) (2026-04-29)


### Features

* **alb:** add worker-logs RPC binding and LOGS type to Env ([2daa962](https://github.com/arc0btc/agents-love-bitcoin/commit/2daa9620529d129ce6b865482dc55cd192cd31f2))
* **alb:** v2 — L1 gate, scope cut to email-only, /llms.txt ([#8](https://github.com/arc0btc/agents-love-bitcoin/issues/8)) ([9385e0e](https://github.com/arc0btc/agents-love-bitcoin/commit/9385e0e7721467d4d70266f24823a06060f94972))
* **metering:** add admin API key bypass for platform operator ([74f1845](https://github.com/arc0btc/agents-love-bitcoin/commit/74f18451d1b49703c4070f2255eb38d067806f02))
* **phase2:** genesis-gate integration + per-address Durable Objects ([#2](https://github.com/arc0btc/agents-love-bitcoin/issues/2)) ([72ebbc2](https://github.com/arc0btc/agents-love-bitcoin/commit/72ebbc230d79ad8fb81bd25006734e89343ddace))
* **register:** admin-key bypass for genesis gate ([6e812d2](https://github.com/arc0btc/agents-love-bitcoin/commit/6e812d2cea192e977a14e6b2cda97d7732d5cdcf))
* **register:** use deterministic agent names from landing-page API for email addresses ([#3](https://github.com/arc0btc/agents-love-bitcoin/issues/3)) ([1a85f76](https://github.com/arc0btc/agents-love-bitcoin/commit/1a85f76da951a946684bae0be9f8e66dc60cea7f))
* scaffold agents-love-bitcoin Cloudflare Worker ([6fea422](https://github.com/arc0btc/agents-love-bitcoin/commit/6fea422b34ad195d8e7a846e0c908e828a7685ea))
* **x402:** wire x402MeterOverflow into /me/* routes ([836113b](https://github.com/arc0btc/agents-love-bitcoin/commit/836113b03fc8d1d2b07ecf6056fcdf979bd11422))


### Bug Fixes

* **alb:** add error handling to prevent raw 500s from DO failures ([7c455d2](https://github.com/arc0btc/agents-love-bitcoin/commit/7c455d21a0a87a3e1fe8e91bb6668b4435f7dbb7))
* **auth:** prioritize BIP-322 over BIP-137 for segwit address verification ([#5](https://github.com/arc0btc/agents-love-bitcoin/issues/5)) ([9863068](https://github.com/arc0btc/agents-love-bitcoin/commit/9863068f1e01f34cddb46bde2b66d0a453cb7567))
* **deps:** update bun.lock to fix frozen lockfile CI failures ([69b5fcb](https://github.com/arc0btc/agents-love-bitcoin/commit/69b5fcb1a66fb15a293a9027ea80162df7cfc86e))
* **do:** replace .one() with .toArray() to handle empty result sets ([631ccb5](https://github.com/arc0btc/agents-love-bitcoin/commit/631ccb5a09629226a82de5682e9dec2409118a40))
* **email:** resolve inbound mail by email_address column, not aibtc_name ([#7](https://github.com/arc0btc/agents-love-bitcoin/issues/7)) ([a6dec59](https://github.com/arc0btc/agents-love-bitcoin/commit/a6dec593549e19957321a300a4a548d11da46a88))
* **version:** wire src/version.ts through release-please extra-files ([#10](https://github.com/arc0btc/agents-love-bitcoin/issues/10)) ([7cfcfb0](https://github.com/arc0btc/agents-love-bitcoin/commit/7cfcfb09cf790ffdcf0c62268c4ee2b45b301ab8))
* **x402:** add admin key bypass to x402MeterOverflow middleware ([84fa6af](https://github.com/arc0btc/agents-love-bitcoin/commit/84fa6aff4f45c924ca6eb0e82226fe4496f12ff4))

## 1.0.0 (2026-04-29)


### Features

* **alb:** add worker-logs RPC binding and LOGS type to Env ([2daa962](https://github.com/arc0btc/agents-love-bitcoin/commit/2daa9620529d129ce6b865482dc55cd192cd31f2))
* **alb:** v2 — L1 gate, scope cut to email-only, /llms.txt ([#8](https://github.com/arc0btc/agents-love-bitcoin/issues/8)) ([9385e0e](https://github.com/arc0btc/agents-love-bitcoin/commit/9385e0e7721467d4d70266f24823a06060f94972))
* **metering:** add admin API key bypass for platform operator ([74f1845](https://github.com/arc0btc/agents-love-bitcoin/commit/74f18451d1b49703c4070f2255eb38d067806f02))
* **phase2:** genesis-gate integration + per-address Durable Objects ([#2](https://github.com/arc0btc/agents-love-bitcoin/issues/2)) ([72ebbc2](https://github.com/arc0btc/agents-love-bitcoin/commit/72ebbc230d79ad8fb81bd25006734e89343ddace))
* **register:** admin-key bypass for genesis gate ([6e812d2](https://github.com/arc0btc/agents-love-bitcoin/commit/6e812d2cea192e977a14e6b2cda97d7732d5cdcf))
* **register:** use deterministic agent names from landing-page API for email addresses ([#3](https://github.com/arc0btc/agents-love-bitcoin/issues/3)) ([1a85f76](https://github.com/arc0btc/agents-love-bitcoin/commit/1a85f76da951a946684bae0be9f8e66dc60cea7f))
* scaffold agents-love-bitcoin Cloudflare Worker ([6fea422](https://github.com/arc0btc/agents-love-bitcoin/commit/6fea422b34ad195d8e7a846e0c908e828a7685ea))
* **x402:** wire x402MeterOverflow into /me/* routes ([836113b](https://github.com/arc0btc/agents-love-bitcoin/commit/836113b03fc8d1d2b07ecf6056fcdf979bd11422))


### Bug Fixes

* **alb:** add error handling to prevent raw 500s from DO failures ([7c455d2](https://github.com/arc0btc/agents-love-bitcoin/commit/7c455d21a0a87a3e1fe8e91bb6668b4435f7dbb7))
* **auth:** prioritize BIP-322 over BIP-137 for segwit address verification ([#5](https://github.com/arc0btc/agents-love-bitcoin/issues/5)) ([9863068](https://github.com/arc0btc/agents-love-bitcoin/commit/9863068f1e01f34cddb46bde2b66d0a453cb7567))
* **deps:** update bun.lock to fix frozen lockfile CI failures ([69b5fcb](https://github.com/arc0btc/agents-love-bitcoin/commit/69b5fcb1a66fb15a293a9027ea80162df7cfc86e))
* **do:** replace .one() with .toArray() to handle empty result sets ([631ccb5](https://github.com/arc0btc/agents-love-bitcoin/commit/631ccb5a09629226a82de5682e9dec2409118a40))
* **email:** resolve inbound mail by email_address column, not aibtc_name ([#7](https://github.com/arc0btc/agents-love-bitcoin/issues/7)) ([a6dec59](https://github.com/arc0btc/agents-love-bitcoin/commit/a6dec593549e19957321a300a4a548d11da46a88))
* **x402:** add admin key bypass to x402MeterOverflow middleware ([84fa6af](https://github.com/arc0btc/agents-love-bitcoin/commit/84fa6aff4f45c924ca6eb0e82226fe4496f12ff4))
