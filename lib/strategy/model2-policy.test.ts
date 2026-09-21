import { describe, expect, it } from "vitest";
import { getTradingConfig } from "../config";
import type { JevPortfolioJudgments, MarketIndicatorState, PositionContext, TradeAsset } from "../types";
import { buildRotationDecisions, type RotationAssetJudgment } from "./model2-policy";

function judgment(overrides: Partial<RotationAssetJudgment> = {}): RotationAssetJudgment {
  return {
    regime: { choice: "range", confidence: 0.8, probabilities: { bull: 0.05, bear: 0.05, range: 0.8, accumulation: 0.05, uncertain: 0.05 } },
    action: { choice: "enter", confidence: 0.85, probabilities: { enter: 0.7, increase: 0.1, hold: 0.1, reduce: 0.05, exit: 0.05 } },
    timing: { choice: "enter_now", confidence: 0.8, probabilities: { enter_now: 0.8, wait_close: 0.1, wait_retest: 0.05, no_entry: 0.05 } },
    direction: { choice: "up", confidence: 0.8, probabilities: { up: 0.75, down: 0.1, unclear: 0.15 } },
    planQuality: { score: 3, confidence: 0.8, probabilities: {} },
    invalidationRisk: 0.15,
    liquidityOk: 0.9,
    ...overrides,
  };
}

function market(position: number): MarketIndicatorState {
  return {
    symbol: "BTCUSDT", source: "bybit-mainnet", collected_at: new Date().toISOString(), observed_at: new Date().toISOString(), ticker_at: new Date().toISOString(), orderbook_at: new Date().toISOString(), last_closed_15m_at: new Date().toISOString(),
    last_price: 100, change_24h_pct: 0, turnover_24h_usdt: 1_000_000, return_15m_pct: 0.2, return_1h_pct: 0.4, return_4h_pct: 0, return_24h_pct: 0, return_7d_pct: 0, return_30d_pct: 0, relative_strength_vs_btc_24h_pct: 0,
    ema_9: 100, ema_21: 99, ema_50: 98, ema_200: 90, ema_50_slope_3h_pct: 0.1, rsi_14: 45, atr_14: 2, atr_14_pct: 2, bb_upper: 105, bb_lower: 95, bb_width_pct: 10, bb_position: position, macd_hist: 0.1,
    realized_volatility_24h_pct: 2, downside_volatility_24h_pct: 1, volume_ratio_20: 1.1, volume_zscore_20: 0, price_zscore_20: position <= 0.35 ? -0.8 : 0.8, distance_vwap_24h_pct: 0, trend_efficiency_4h: 0.4, up_fraction_4h: 0.5, return_streak_15m: 1, drawdown_20d_pct: -2,
    channel_24h_high: 105, channel_24h_low: 95, channel_24h_position: position, channel_3d_high: 110, channel_3d_low: 90, channel_3d_position: position, channel_7d_high: 115, channel_7d_low: 85, channel_7d_position: position,
    distance_to_24h_high_atr: 2, distance_to_24h_low_atr: 2, breakout_24h_pct: position > 1 ? 0.5 : 0, bb_width_percentile_7d: 0.4, candle_body_atr: 0.2, upper_wick_atr: 0.2, lower_wick_atr: 0.2,
    structure_12h: "mixed", adx_14: 15, plus_di_14: 22, minus_di_14: 18, trend_score: 0, regime: "range", countertrend_rebound_score: 0.7,
    bid_ask_spread_pct: 0.03, orderbook_imbalance: 0, bid_depth_50_usdt: 100_000, ask_depth_50_usdt: 100_000, depth_ratio: 1, taker_buy_ratio: 0.5, trade_flow_imbalance: 0, trade_flow_window_seconds: 120,
    open_interest_usdt_estimate: null, open_interest_change_1h_pct: null, open_interest_change_4h_pct: null, funding_rate_latest_pct: null, data_quality: "spot_only", mamis_phase: "uncertain", mamis_confidence: 0.5, mamis_evidence: [],
  };
}

const flat = (asset: TradeAsset): PositionContext => ({ asset, status: "flat", quantity: 0, value_usdt: 0, allocation_pct: 0, average_entry_price: null, unrealized_pnl_pct: null, cost_basis_quality: "unavailable", last_trade_action: null, last_trade_at: null, minutes_since_last_trade: null });
const portfolio: JevPortfolioJudgments = {
  preferred_destination: { choice: "BTC", confidence: 0.8, probabilities: { USDT: 0.1, BTC: 0.7, ETH: 0.1, XAUT: 0.1 } },
  gross_risk_budget: { choice: "medium", confidence: 0.8, probabilities: { zero: 0.1, low: 0.1, medium: 0.7, high: 0.1 } },
  opportunity_separation: { score: 3, confidence: 0.8, probabilities: {} },
};

describe("Model2 rotation policy", () => {
  it("does not buy near a range high without a confirmed breakout", () => {
    const judgments = { BTC: judgment(), ETH: judgment({ action: { ...judgment().action, choice: "hold" } }), XAUT: judgment({ action: { ...judgment().action, choice: "hold" } }) };
    const indicators = { BTC: market(0.9), ETH: market(0.5), XAUT: market(0.5) };
    const positions = { BTC: flat("BTC"), ETH: flat("ETH"), XAUT: flat("XAUT") };
    expect(buildRotationDecisions(judgments, portfolio, indicators, positions, getTradingConfig())[0].action).toBe("hold");
  });

  it("can buy a range reversion near the lower boundary", () => {
    const judgments = { BTC: judgment(), ETH: judgment({ action: { ...judgment().action, choice: "hold" } }), XAUT: judgment({ action: { ...judgment().action, choice: "hold" } }) };
    const indicators = { BTC: market(0.2), ETH: market(0.5), XAUT: market(0.5) };
    const positions = { BTC: flat("BTC"), ETH: flat("ETH"), XAUT: flat("XAUT") };
    expect(buildRotationDecisions(judgments, portfolio, indicators, positions, getTradingConfig())[0].action).toBe("buy");
  });
});
