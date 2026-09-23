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

The active production experiment is now:

- `STRATEGY_RUN_MODE=ab_test`
- `EXCHANGE_EXECUTION_ENGINE=none`
- `AB_ENGINE_IDS=model1-v1,model2-v2`
- `AB_EXPERIMENT_ID=model1-v1-vs-model2-v2`
- experiment started at `2026-09-22 22:45:35Z`

Do not silently reuse that experiment id for a different engine pair or after a strategy/platform behavior change. Start a new experiment id whenever semantics or shared execution-risk behavior changes.

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

## 48-cycle runtime review — 2026-09-23

The first ~12 hours of the `model1-v1` vs `model2-v2` experiment produced 48 completed cycles per engine with no failed/running leftovers and no evidence of cron gaps beyond the expected cadence.

Observed decision behavior:

- Model1 V1: 144/144 decisions were HOLD; 122/144 had `no_entry`; no pending signal lifecycle was created.
- Model2 V2: 143 HOLD + 1 confirmed BUY decision across 144 asset decisions.
- Model2 V2 produced 14 persisted pending decision states, 8 invalidated states, 1 expired state and 1 confirmed state across the 48 cycles.
- Model2 V2 portfolio judgment preferred a non-USDT destination in 30/48 cycles; Model1 V1 did so in only 7/48.
- The one confirmed BUY was ETH after a `wait_retest` trend-pullback signal. It reached the platform with confidence ~0.727, target allocation 15% and positive post-cost expected edge, but execution was skipped by the platform hard gate: `ATR-to-cost ratio 1.31 is below 2.50`.
- No `engine_orders` rows were created and both paper portfolios therefore remained 100% USDT / 1000 USDT equity.

Important interpretation:

- “No order” did not mean “no signal”: Model2 V2 did generate a real confirmed BUY, but shared platform risk rejected it.
- Model2 V2 pending/confirmation is functioning and generally filtered bad candidates: several positive/near-positive pending setups subsequently had negative 1h/4h price movement, so do not loosen confirmation thresholds merely to increase trade count.
- The dominant shared execution concern is the fixed `MIN_TRADABLE_RANGE_TO_COST_RATIO=2.50`. Model2 V2 already subtracts taker fees, spread and estimated slippage from expected net edge, while `lib/risk.ts` applies the same cost components again through ATR/cost. In the reviewed window round-trip costs were ~0.260–0.262%, while observed max ATR percentages were ~0.269% BTC, ~0.368% ETH and ~0.110% XAUT. This implies maximum ATR/cost ratios of only ~1.03, ~1.41 and ~0.42 respectively, so a 2.50 gate would reject every BUY in that market window regardless of model confidence.
- Do not simply lower this safety threshold from the 12-hour sample. Treat it as a platform-risk design/calibration issue and gather counterfactual execution outcomes over a longer sample before changing it.

Known diagnostics issues discovered in the same review:

1. Both Model1 V1 and Model2 V2 can label a flat/no-entry decision as `ALLOCATION_DEADBAND` when the opportunity takes the early risk-reduction path (`cut_position`, disorderly, reduce semantics). This masks the real blocker and makes blocker statistics misleading, especially for XAUT.
2. Model2 V2 can preserve both `PENDING_CLOSE` and `PENDING_RETEST` in `blockedBy` when an active signal's original readiness differs from the current cycle's readiness. This is mainly an observability inconsistency.
3. `engine_orders` only contains simulated orders that pass platform safety. Rejected BUY attempts remain in `engine_runs.executions`, so order-history UI alone can make a valid model signal look as if it never existed.

Recommended next engineering sequence:

1. Preserve the current experiment as evidence; do not mutate Model2 V2 behavior in-place under the same experiment id.
2. Add/repair diagnostics first so blockers and skipped execution attempts are visible and trustworthy.
3. Measure longer counterfactual outcomes for model BUYs/pending signals and the ATR/cost gate.
4. If platform range-to-cost logic is redesigned, start a new experiment id even if engine ids stay the same.
5. If Model2 strategy semantics change again, create `model2-v3` rather than rewriting the historical V2 baseline.
6. Keep Model1 V1 unchanged unless a larger sample demonstrates a repeatable false-negative calibration problem.

## Known non-blocking follow-ups

- Confirmation modules still call shared DB helpers directly; a later persistence-interface cleanup may improve the model/platform boundary.
- Registry isolation prevents cross-version imports but is not a strict whitelist of all permitted platform modules.
- Do not pursue these for aesthetics ahead of runtime correctness and A/B evidence.
