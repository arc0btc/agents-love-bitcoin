# Changelog

## 1.0.0 (2026-03-27)


### Features

* **alb:** add worker-logs RPC binding and LOGS type to Env ([2daa962](https://github.com/arc0btc/agents-love-bitcoin/commit/2daa9620529d129ce6b865482dc55cd192cd31f2))
* **metering:** add admin API key bypass for platform operator ([74f1845](https://github.com/arc0btc/agents-love-bitcoin/commit/74f18451d1b49703c4070f2255eb38d067806f02))
* **phase2:** genesis-gate integration + per-address Durable Objects ([#2](https://github.com/arc0btc/agents-love-bitcoin/issues/2)) ([72ebbc2](https://github.com/arc0btc/agents-love-bitcoin/commit/72ebbc230d79ad8fb81bd25006734e89343ddace))
* **register:** use deterministic agent names from landing-page API for email addresses ([#3](https://github.com/arc0btc/agents-love-bitcoin/issues/3)) ([1a85f76](https://github.com/arc0btc/agents-love-bitcoin/commit/1a85f76da951a946684bae0be9f8e66dc60cea7f))
* scaffold agents-love-bitcoin Cloudflare Worker ([6fea422](https://github.com/arc0btc/agents-love-bitcoin/commit/6fea422b34ad195d8e7a846e0c908e828a7685ea))
* **x402:** wire x402MeterOverflow into /me/* routes ([836113b](https://github.com/arc0btc/agents-love-bitcoin/commit/836113b03fc8d1d2b07ecf6056fcdf979bd11422))


### Bug Fixes

* **alb:** add error handling to prevent raw 500s from DO failures ([7c455d2](https://github.com/arc0btc/agents-love-bitcoin/commit/7c455d21a0a87a3e1fe8e91bb6668b4435f7dbb7))
* **auth:** prioritize BIP-322 over BIP-137 for segwit address verification ([#5](https://github.com/arc0btc/agents-love-bitcoin/issues/5)) ([9863068](https://github.com/arc0btc/agents-love-bitcoin/commit/9863068f1e01f34cddb46bde2b66d0a453cb7567))
* **deps:** update bun.lock to fix frozen lockfile CI failures ([69b5fcb](https://github.com/arc0btc/agents-love-bitcoin/commit/69b5fcb1a66fb15a293a9027ea80162df7cfc86e))
* **do:** replace .one() with .toArray() to handle empty result sets ([631ccb5](https://github.com/arc0btc/agents-love-bitcoin/commit/631ccb5a09629226a82de5682e9dec2409118a40))
* **x402:** add admin key bypass to x402MeterOverflow middleware ([84fa6af](https://github.com/arc0btc/agents-love-bitcoin/commit/84fa6aff4f45c924ca6eb0e82226fe4496f12ff4))
