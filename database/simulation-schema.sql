CREATE SCHEMA IF NOT EXISTS simulation;

CREATE TABLE IF NOT EXISTS simulation.runs (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  config JSONB NOT NULL,
  summary JSONB,
  error TEXT
);

CREATE TABLE IF NOT EXISTS simulation.candles (
  run_id TEXT NOT NULL REFERENCES simulation.runs(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  close_at TIMESTAMPTZ NOT NULL,
  open NUMERIC(40, 18) NOT NULL,
  high NUMERIC(40, 18) NOT NULL,
  low NUMERIC(40, 18) NOT NULL,
  close NUMERIC(40, 18) NOT NULL,
  volume NUMERIC(40, 18) NOT NULL,
  turnover NUMERIC(40, 18) NOT NULL,
  PRIMARY KEY (run_id, asset, interval_minutes, start_at)
);

CREATE TABLE IF NOT EXISTS simulation.derivative_points (
  run_id TEXT NOT NULL REFERENCES simulation.runs(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('open_interest', 'funding')),
  observed_at TIMESTAMPTZ NOT NULL,
  value NUMERIC(40, 18) NOT NULL,
  PRIMARY KEY (run_id, asset, kind, observed_at)
);

CREATE TABLE IF NOT EXISTS simulation.macro_points (
  run_id TEXT NOT NULL REFERENCES simulation.runs(id) ON DELETE CASCADE,
  observed_on DATE NOT NULL,
  values JSONB NOT NULL,
  PRIMARY KEY (run_id, observed_on)
);

CREATE TABLE IF NOT EXISTS simulation.cycles (
  run_id TEXT NOT NULL REFERENCES simulation.runs(id) ON DELETE CASCADE,
  cycle_at TIMESTAMPTZ NOT NULL,
  execution_at TIMESTAMPTZ NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  semantic_state JSONB NOT NULL,
  macro_state JSONB,
  portfolio_risk JSONB NOT NULL,
  equity_before_usdt NUMERIC(30, 10) NOT NULL,
  equity_after_usdt NUMERIC(30, 10) NOT NULL,
  PRIMARY KEY (run_id, cycle_at)
);

CREATE TABLE IF NOT EXISTS simulation.market_snapshots (
  run_id TEXT NOT NULL,
  cycle_at TIMESTAMPTZ NOT NULL,
  asset TEXT NOT NULL,
  state JSONB NOT NULL,
  PRIMARY KEY (run_id, cycle_at, asset),
  FOREIGN KEY (run_id, cycle_at) REFERENCES simulation.cycles(run_id, cycle_at) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS simulation.decisions (
  run_id TEXT NOT NULL,
  cycle_at TIMESTAMPTZ NOT NULL,
  asset TEXT NOT NULL,
  decision JSONB NOT NULL,
  PRIMARY KEY (run_id, cycle_at, asset),
  FOREIGN KEY (run_id, cycle_at) REFERENCES simulation.cycles(run_id, cycle_at) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS simulation.orders (
  run_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  cycle_at TIMESTAMPTZ NOT NULL,
  asset TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  decision_price NUMERIC(40, 18) NOT NULL,
  fill_price NUMERIC(40, 18),
  quantity NUMERIC(40, 18) NOT NULL,
  gross_value_usdt NUMERIC(30, 10) NOT NULL,
  fee_usdt NUMERIC(30, 10) NOT NULL,
  slippage_usdt NUMERIC(30, 10) NOT NULL,
  PRIMARY KEY (run_id, order_id),
  FOREIGN KEY (run_id, cycle_at) REFERENCES simulation.cycles(run_id, cycle_at) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS simulation.portfolio_snapshots (
  run_id TEXT NOT NULL,
  cycle_at TIMESTAMPTZ NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('before', 'after')),
  total_equity_usdt NUMERIC(30, 10) NOT NULL,
  balances JSONB NOT NULL,
  prices JSONB NOT NULL,
  PRIMARY KEY (run_id, cycle_at, phase),
  FOREIGN KEY (run_id, cycle_at) REFERENCES simulation.cycles(run_id, cycle_at) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS simulation_cycles_run_idx ON simulation.cycles(run_id, cycle_at);
CREATE INDEX IF NOT EXISTS simulation_orders_run_idx ON simulation.orders(run_id, cycle_at);
