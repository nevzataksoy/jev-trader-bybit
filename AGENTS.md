<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# JEV TRADER BYBIT — Agent Project Context

Updated: 2026-09-23 Europe/Istanbul  
Repository: `nevzataksoy/jev-trader-bybit`  
Default branch: `main`

## Canonical reading order

Before substantial work, inspect:

1. `AGENTS.md`
2. `README.md`
3. `INSTALL.md`
4. `.env.example`
5. `package.json`
6. `database/schema.sql` and `scripts/setup-db.mjs`
7. `scripts/generate-strategy-registry.mjs`
8. `lib/strategy/types.ts`, `lib/strategy/runner.ts`, `lib/risk.ts`
9. The complete target model directory under `lib/strategy/models/<family>/<version>/`

The persistent ChatGPT Library file `/JEV TRADER BYBIT/MEMORYBANK.md` is the handoff history/context source and is intentionally outside Git.

## Core invariants

- Trade universe: BTC, ETH, XAUT; USDT is cash/reserve.
- Jev must not receive real instrument identity or calendar identity.
- Jev sees anonymous candidate slots; reverse identity mapping stays application-side.
- A/B mode must never route real orders to Bybit.
- Each model version owns its complete strategy inside its own version directory.
- A model version may not import another model family/version.
- Shared code may contain model-independent platform infrastructure and hard safety gates only.
- Execution ordering and strategy sizing are model-version responsibilities.
- `lib/risk.ts` may cap/reject intent for platform safety but must not become a hidden strategy layer.
- Never commit secrets, `.env.local`, API keys, DB credentials or cron secrets.

## Current strategy versions

Available engine directories:

- `lib/strategy/models/model1/v1/` → `model1-v1`
- `lib/strategy/models/model2/v1/` → `model2-v1`
- `lib/strategy/models/model2/v2/` → `model2-v2`

The generated registry discovers versions recursively and enforces cross-model/version isolation before dev/lint/typecheck/test/build.

### Current production observation pair

The existing production experiment remains:

- `STRATEGY_RUN_MODE=ab_test`
- `EXCHANGE_EXECUTION_ENGINE=none`
- `AB_ENGINE_IDS=model1-v1,model2-v1`
- `AB_EXPERIMENT_ID=model1-v1-vs-model2-v1`

Do not silently reuse that experiment id for a different engine pair.

### Model2 V2 purpose

The first nine completed A/B cycles produced 27/27 HOLD decisions for each V1 engine. BTC and ETH repeatedly failed multiple structure/direction/setup/net-edge gates. XAUT repeatedly reached a `trend_pullback` with `wait_close` / `wait_retest`, but was usually stopped only by `NET_EDGE_LOW`; no pending signals or paper orders were produced.

Model2 V2 is an evidence-driven semantic revision, not a threshold loosening:

- preserves native rotation action through the final policy
- adds explicit `watch` distinct from deterministic `hold`
- prevents a native `hold` from being normalized back into a tradable setup
- uses the rotation-native portfolio judgment instead of rebuilding a second generic portfolio judgment
- lets a `watch` with positive gross expected edge remain pending while costs still make net edge non-executable
- never promotes a pending signal while `NET_EDGE_LOW` remains
- keeps the same numeric default thresholds as Model2 V1
- persists useful V2 diagnostics in decision JSON such as rotation action/suitability/thesis health and gross expected edge

Model1 V1 and Model2 V1 remain unchanged and are the stable baseline.

To start a new V2 comparison after deployment, explicitly use a new experiment, for example:

```env
AB_ENGINE_IDS=model1-v1,model2-v2
AB_EXPERIMENT_ID=model1-v1-vs-model2-v2
```

Keep `TRADING_ENABLED=false`, `ALLOW_LIVE_TRADING=false`, and `EXCHANGE_EXECUTION_ENGINE=none`.

## Strategy ownership

A version directory owns:

- Jev prompts/evidence interpretation
- analysis/normalization
- setup/readiness/opportunity scoring
- portfolio allocation policy
- pending/wait-close/wait-retest confirmation
- confidence policy
- decision ordering
- execution sizing
- model-specific configuration
- final buy/hold/sell decisions

The platform owns:

- Bybit data acquisition and indicators
- blind identity protection
- persistence mechanics
- A/B orchestration
- registry/discovery
- paper execution plumbing
- exchange hard safety ceilings

## Database and API contract

Single schema source: `database/schema.sql`. Runtime initialization uses `CREATE TABLE IF NOT EXISTS`.

Important experiment tables:

- `strategy_experiments`
- `shared_market_snapshots`
- `engine_runs`
- `engine_portfolios`
- `engine_equity_snapshots`
- `engine_orders`
- `engine_pending_signals`

Dashboard/API boundary:

- `/` and `/api/state`: configured Bybit account/platform surface and general `bot_runs`
- `/models` and `/api/models/state`: authoritative A/B `engine_runs`, decisions, paper portfolios/orders/equity
- `/api/health`: configuration/readiness summary only

In `ab_test`, do not treat `bot_runs.decisions` as the A/B model decision history.

## Validation and commit/push rule

Canonical local gate:

```bash
npm run quality
```

which runs lint + typecheck + test + build.

If the execution environment cannot clone/run the repository, use an isolated validation branch and the available Vercel preview/build check before merging. Do not merge a failing preview.

Preferred GitHub flow:

1. Read current `main` HEAD and exact files being changed.
2. Make the smallest coherent change on an isolated branch.
3. Validate.
4. Fix relevant failures before merge.
5. Commit only production-relevant files.
6. Merge/fast-forward without force-push.
7. Report final commit SHA/message and Vercel status.

## Runtime analysis guidance

For strategy-effectiveness work, trace where signals die:

Jev evidence → normalization → setup/readiness → policy → blockers → pending/confirmation → allocation → version-owned execution intent → platform risk → paper execution → equity.

Do not lower safety or strategy thresholds merely to increase trade count. Treat small samples as diagnostic evidence, not proof of profitability.

For Model2 V2 specifically, compare against the stable V1 baseline using a new experiment id and inspect:

- `rotationAction`
- `rotationSuitability`
- `grossExpectedEdgePct`
- `expectedNetEdgePct`
- pending/confirmed/invalidated signal lifecycle
- paper fills and equity only after the model produces executable decisions

## Known non-blocking follow-ups

- Confirmation modules still call shared DB helpers directly; a later persistence-interface cleanup may improve the model/platform boundary.
- Registry isolation prevents cross-version imports but is not a strict whitelist of all permitted platform modules.
- Do not pursue these for aesthetics ahead of runtime correctness and A/B evidence.
