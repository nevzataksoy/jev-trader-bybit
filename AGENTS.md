<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# JEV TRADER BYBIT — Agent Project Context

Updated: 2026-09-22 Europe/Istanbul  
Repository: `nevzataksoy/jev-trader-bybit`  
Default branch: `main`  
Validated application baseline before this context-only update: `d09e3ae3132b7bc3ceae56610f45c83f12e0f453` (`fix: complete clean V1 refactor validation`).

## Canonical reading order

Before substantial work, inspect these files in this order:

1. `AGENTS.md` — operational and architectural constraints.
2. `README.md` — current product architecture and strategy/platform split.
3. `INSTALL.md` — environment, database, Vercel and cron deployment procedure.
4. `.env.example` — canonical environment-variable surface.
5. `package.json` — validation/build commands.
6. `database/schema.sql` and `scripts/setup-db.mjs` — clean database baseline.
7. `scripts/generate-strategy-registry.mjs` — model discovery/isolation enforcement.
8. `lib/strategy/types.ts`, `lib/strategy/runner.ts`, `lib/risk.ts` — platform/model execution contract.
9. The complete target model directory under `lib/strategy/models/<family>/<version>/`.

The persistent ChatGPT Library file `/JEV TRADER BYBIT/MEMORYBANK.md` is the handoff history/context source. It is intentionally not stored in this Git repository.

## Current clean-baseline architecture

Historical strategy names V1/V2/V3/V4 and old `*-blind-v4` registry identities were removed from the clean project. Former V4 behavior is now the first clean version:

- `model1-v1`
- `model2-v1`

Default A/B:

- `STRATEGY_RUN_MODE=ab_test`
- `EXCHANGE_EXECUTION_ENGINE=none`
- `AB_ENGINE_IDS=model1-v1,model2-v1`
- `AB_EXPERIMENT_ID=model1-v1-vs-model2-v1`

A/B mode must never route real exchange orders.

## Strategy ownership rule

A model version must own all strategic behavior in its own version directory, including:

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

Shared platform code may own only model-independent infrastructure such as market data, persistence, blind identity protection, orchestration, registry/discovery, and hard execution safety ceilings.

Current version directories:

- `lib/strategy/models/model1/v1/`
- `lib/strategy/models/model2/v1/`

They must not import another model family/version. The registry generator recursively validates this boundary before dev/lint/typecheck/test/build.

Deleting one version directory should remove only that version. Deleting a model family should not break another family.

## Blind Jev invariant

Jev must not receive BTC/ETH/XAUT identity or calendar identity. Shared blind-market code maps assets to anonymous candidates and rejects forbidden identity-bearing payload fields/tokens.

Identity mapping stays application-side.

## Execution boundary

Model engines expose version-owned:

- `orderDecisions(...)`
- `planExecution(...)`

The shared `lib/risk.ts` layer only applies platform hard safety gates and caps the model's requested execution intent. Do not move strategic sizing/order ranking back into shared platform code.

## Database baseline

This is a zero-history clean DB design:

- single schema source: `database/schema.sql`
- no migration chain
- no historical local backtest/simulation subsystem
- runtime schema bootstrap uses `CREATE TABLE IF NOT EXISTS`
- `npm run db:setup` is the explicit provisioning command

Important strategy experiment tables include `strategy_experiments`, `shared_market_snapshots`, `engine_runs`, `engine_portfolios`, `engine_equity_snapshots`, `engine_orders`, and `engine_pending_signals`.

## Validation rule before source-code commit/push

For source changes, do not push an unvalidated fix to `main` if a safe validation path is available. The canonical gate is:

```bash
npm run quality
```

which runs:

```text
npm run lint
npm run typecheck
npm run test
npm run build
```

If the local execution environment cannot clone/run the repo, use an isolated validation branch or available CI/Vercel preview to run equivalent checks. Do not merge temporary CI/probe files into `main`.

The `d09e3ae` baseline was validated with all four gates passing and then received a successful Vercel deployment.

## Commit/push procedure

Use the authorized GitHub connector for repository inspection and writes when available.

Preferred flow:

1. Read current `main` HEAD and the exact files being changed.
2. Make the smallest coherent change.
3. Validate.
4. If validation fails, fix all encountered relevant failures before final push.
5. Commit only production-relevant files; exclude temporary validation helpers.
6. Move `main` with a normal fast-forward update; never force-push unless the user explicitly requests it.
7. Report the final commit SHA/message and Vercel status.
8. Never commit secrets, `.env.local`, API keys, DB credentials or cron secrets.

For a multi-file atomic update with the GitHub connector, prefer creating blobs/tree/commit and then `update_ref(force=false)` rather than producing multiple unrelated commits.

## Current operational next steps

The code/build baseline is green. The next work is runtime/deployment verification, not another architecture rewrite:

1. Verify Vercel Production env matches current `.env.example`.
2. Keep `TRADING_ENABLED=false`, `ALLOW_LIVE_TRADING=false`, `STRATEGY_RUN_MODE=ab_test`, `EXCHANGE_EXECUTION_ENGINE=none`.
3. Verify Neon/`DATABASE_URL`.
4. Check `/api/health`.
5. Invoke authenticated `/api/cron`; on a blank DB this may bootstrap schema.
6. Verify `/models` and `/api/models/state` show only `model1-v1` and `model2-v1`.
7. Verify experiment/engine/pending tables and first paper-cycle rows.
8. Test cron-job.org HTTP 200 and 15-minute cadence.
9. Observe paper A/B cycles before considering any real exchange routing.

## Known architectural follow-ups, not blockers

- Model confirmation modules currently perform persistence calls directly via shared DB helpers. A later cleanup may introduce a model-state persistence interface so strategy logic remains version-owned while persistence mechanics are platform-owned.
- The registry isolation guard prevents cross-model/version imports, but it is not a strict whitelist of every permitted platform module. Tightening that boundary can be considered later.
- Do not change these merely for aesthetics; first prioritize runtime correctness and observed A/B behavior.

## Working style

- Inspect before modifying.
- Distinguish code facts from assumptions about Vercel env/runtime DB state.
- Do not weaken risk gates just to increase trade count.
- For strategy-effectiveness work, identify where signals die: evidence → policy → pending/confirmation → platform risk → execution.
- At the end of substantial turns, summarize what changed, current status, unresolved risks, and concrete recommended next actions or information needed from the user.
