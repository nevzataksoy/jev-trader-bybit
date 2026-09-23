CREATE TABLE IF NOT EXISTS bot_runs (
  cycle_key TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  model TEXT,
  market_state JSONB,
  decision_context JSONB,
  decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  executions JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id BIGSERIAL PRIMARY KEY,
  cycle_key TEXT NOT NULL UNIQUE,
  captured_at TIMESTAMPTZ NOT NULL,
  total_portfolio_usdt NUMERIC(30, 10) NOT NULL,
  balances JSONB NOT NULL,
  prices JSONB NOT NULL,
  CONSTRAINT portfolio_snapshots_run_fk
    FOREIGN KEY (cycle_key) REFERENCES bot_runs(cycle_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS spot_orders (
  order_id TEXT PRIMARY KEY,
  order_link_id TEXT NOT NULL DEFAULT '',
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL,
  qty NUMERIC(40, 18) NOT NULL DEFAULT 0,
  price NUMERIC(40, 18) NOT NULL DEFAULT 0,
  avg_price NUMERIC(40, 18) NOT NULL DEFAULT 0,
  cum_exec_qty NUMERIC(40, 18) NOT NULL DEFAULT 0,
  cum_exec_value NUMERIC(40, 18) NOT NULL DEFAULT 0,
  fee NUMERIC(40, 18) NOT NULL DEFAULT 0,
  fee_currency TEXT NOT NULL DEFAULT '',
  order_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ,
  is_open BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS macro_snapshots (
  source_observed_at TIMESTAMPTZ PRIMARY KEY,
  collected_at TIMESTAMPTZ NOT NULL,
  state JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_portfolio_snapshots (
  time_zone TEXT NOT NULL,
  local_date DATE NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  total_portfolio_usdt NUMERIC(30, 10) NOT NULL,
  prices JSONB NOT NULL,
  PRIMARY KEY (time_zone, local_date)
);

CREATE TABLE IF NOT EXISTS strategy_experiments (
  experiment_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'cancelled')),
  initial_capital_usdt NUMERIC(30, 10) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  planned_end_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  engine_versions JSONB NOT NULL,
  configuration JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS engine_revisions (
  id BIGSERIAL PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES strategy_experiments(experiment_id) ON DELETE CASCADE,
  engine_id TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  policy_revision TEXT NOT NULL,
  config_revision TEXT NOT NULL,
  code_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (experiment_id, engine_id, policy_revision, config_revision)
);

CREATE TABLE IF NOT EXISTS shared_market_snapshots (
  id BIGSERIAL PRIMARY KEY,
  cycle_key TEXT NOT NULL UNIQUE,
  captured_at TIMESTAMPTZ NOT NULL,
  prices JSONB NOT NULL,
  indicators JSONB NOT NULL,
  fees JSONB NOT NULL,
  macro JSONB,
  data_quality JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS engine_runs (
  id BIGSERIAL PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES strategy_experiments(experiment_id) ON DELETE CASCADE,
  cycle_key TEXT NOT NULL,
  snapshot_id BIGINT NOT NULL REFERENCES shared_market_snapshots(id) ON DELETE CASCADE,
  engine_id TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  revision_id BIGINT REFERENCES engine_revisions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  jev_model TEXT,
  latency_ms INTEGER,
  usage JSONB,
  decision_context JSONB,
  decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  portfolio_judgments JSONB,
  executions JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  UNIQUE (experiment_id, cycle_key, engine_id)
);

CREATE TABLE IF NOT EXISTS engine_portfolios (
  experiment_id TEXT NOT NULL REFERENCES strategy_experiments(experiment_id) ON DELETE CASCADE,
  engine_id TEXT NOT NULL,
  asset TEXT NOT NULL CHECK (asset IN ('USDT', 'BTC', 'ETH', 'XAUT')),
  quantity NUMERIC(40, 18) NOT NULL DEFAULT 0,
  average_entry_price NUMERIC(40, 18),
  realized_pnl_usdt NUMERIC(30, 10) NOT NULL DEFAULT 0,
  last_trade_action TEXT,
  last_trade_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (experiment_id, engine_id, asset)
);

CREATE TABLE IF NOT EXISTS engine_equity_snapshots (
  id BIGSERIAL PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES strategy_experiments(experiment_id) ON DELETE CASCADE,
  cycle_key TEXT NOT NULL,
  engine_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  total_equity_usdt NUMERIC(30, 10) NOT NULL,
  cash_usdt NUMERIC(30, 10) NOT NULL,
  balances JSONB NOT NULL,
  prices JSONB NOT NULL,
  drawdown_pct NUMERIC(12, 6) NOT NULL DEFAULT 0,
  UNIQUE (experiment_id, cycle_key, engine_id)
);

CREATE TABLE IF NOT EXISTS engine_orders (
  order_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES strategy_experiments(experiment_id) ON DELETE CASCADE,
  cycle_key TEXT NOT NULL,
  snapshot_id BIGINT NOT NULL REFERENCES shared_market_snapshots(id) ON DELETE CASCADE,
  engine_id TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  asset TEXT NOT NULL CHECK (asset IN ('BTC', 'ETH', 'XAUT')),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('Buy', 'Sell')),
  quantity NUMERIC(40, 18) NOT NULL,
  reference_price NUMERIC(40, 18) NOT NULL,
  simulated_fill_price NUMERIC(40, 18) NOT NULL,
  gross_value_usdt NUMERIC(30, 10) NOT NULL,
  fee_usdt NUMERIC(30, 10) NOT NULL,
  slippage_pct NUMERIC(12, 6) NOT NULL,
  decision_status TEXT NOT NULL,
  simulation_status TEXT NOT NULL,
  routing_status TEXT NOT NULL,
  exchange_order_id TEXT,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (experiment_id, cycle_key, engine_id, asset)
);

CREATE TABLE IF NOT EXISTS engine_pending_signals (
  id BIGSERIAL PRIMARY KEY,
  scope_id TEXT NOT NULL,
  experiment_id TEXT REFERENCES strategy_experiments(experiment_id) ON DELETE CASCADE,
  engine_id TEXT NOT NULL,
  asset TEXT NOT NULL CHECK (asset IN ('BTC', 'ETH', 'XAUT')),
  setup TEXT NOT NULL,
  readiness TEXT NOT NULL CHECK (readiness IN ('wait_close', 'wait_retest')),
  status TEXT NOT NULL CHECK (status IN ('active', 'confirmed', 'invalidated', 'expired', 'replaced')),
  source_cycle_key TEXT NOT NULL,
  source_candle_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  trigger_price NUMERIC(40, 18) NOT NULL,
  anchor_price NUMERIC(40, 18) NOT NULL,
  atr_pct NUMERIC(12, 6) NOT NULL,
  source_decision JSONB NOT NULL,
  retest_seen_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_cycle_key TEXT,
  resolution_reason TEXT
);

ALTER TABLE engine_runs ADD COLUMN IF NOT EXISTS revision_id BIGINT;

CREATE INDEX IF NOT EXISTS portfolio_snapshots_captured_idx ON portfolio_snapshots(captured_at DESC);
CREATE INDEX IF NOT EXISTS spot_orders_created_idx ON spot_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS bot_runs_started_idx ON bot_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS macro_snapshots_collected_idx ON macro_snapshots(collected_at DESC);
CREATE INDEX IF NOT EXISTS daily_portfolio_snapshots_captured_idx ON daily_portfolio_snapshots(captured_at DESC);
CREATE INDEX IF NOT EXISTS shared_market_snapshots_captured_idx ON shared_market_snapshots(captured_at DESC);
CREATE INDEX IF NOT EXISTS engine_runs_experiment_idx ON engine_runs(experiment_id, started_at DESC);
CREATE INDEX IF NOT EXISTS engine_revisions_experiment_idx ON engine_revisions(experiment_id, engine_id, created_at DESC);
CREATE INDEX IF NOT EXISTS engine_equity_experiment_idx ON engine_equity_snapshots(experiment_id, engine_id, captured_at);
CREATE INDEX IF NOT EXISTS engine_orders_experiment_idx ON engine_orders(experiment_id, engine_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS engine_pending_signals_active_idx
  ON engine_pending_signals(scope_id, engine_id, asset) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS engine_pending_signals_history_idx
  ON engine_pending_signals(scope_id, engine_id, created_at DESC);
