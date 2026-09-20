CREATE TABLE IF NOT EXISTS bot_runs (
  cycle_key TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  model TEXT,
  market_state JSONB,
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

CREATE INDEX IF NOT EXISTS portfolio_snapshots_captured_idx ON portfolio_snapshots(captured_at DESC);
CREATE INDEX IF NOT EXISTS spot_orders_created_idx ON spot_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS bot_runs_started_idx ON bot_runs(started_at DESC);
