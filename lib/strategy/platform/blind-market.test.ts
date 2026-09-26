import { describe, expect, it } from "vitest";
import type { JevTradingState } from "../../jev";
import type { MarketIndicatorState, PositionContext, TradeAsset } from "../../types";
import { buildBlindNumericState, createBlindAliasMap } from "./blind-market";
import { buildBlindModel1State } from "../models/model1/v1/evaluator";

const observedAt = "2026-09-21T12:30:00.000Z";

function market(symbol: string, price: number, return24h: number): MarketIndicatorState {
  return {
    symbol, source: "bybit-mainnet", collected_at: observedAt, observed_at: observedAt, ticker_at: observedAt, orderbook_at: observedAt, last_closed_15m_at: "2026-09-21T12:15:00.000Z",
    last_price: price, change_24h_pct: return24h, turnover_24h_usdt: 123_456_789, return_15m_pct: 0.2, return_1h_pct: 0.4, return_4h_pct: -0.3, return_24h_pct: return24h, return_7d_pct: 2.1, return_30d_pct: -1.2, relative_strength_vs_btc_24h_pct: 99,
    ema_9: price * 0.995, ema_21: price * 0.99, ema_50: price * 0.98, ema_200: price * 0.9, ema_50_slope_3h_pct: 0.1, rsi_14: 54, atr_14: price * 0.02, atr_14_pct: 2, bb_upper: price * 1.05, bb_lower: price * 0.95, bb_width_pct: 10, bb_position: 0.3, macd_hist: price * 0.001,
    realized_volatility_24h_pct: 2, downside_volatility_24h_pct: 1, volume_ratio_20: 1.1, volume_zscore_20: 0.2, price_zscore_20: -0.8, distance_vwap_24h_pct: -0.2, trend_efficiency_4h: 0.4, up_fraction_4h: 0.5, return_streak_15m: 1, drawdown_20d_pct: -2,
    channel_24h_high: price * 1.05, channel_24h_low: price * 0.95, channel_24h_position: 0.2, channel_3d_high: price * 1.1, channel_3d_low: price * 0.9, channel_3d_position: 0.3, channel_7d_high: price * 1.15, channel_7d_low: price * 0.85, channel_7d_position: 0.4,
    support_zone_low: price * 0.98, support_zone_high: price * 0.995, support_strength: 0.8,
    resistance_zone_low: price * 1.03, resistance_zone_high: price * 1.04, resistance_strength: 0.9,
    distance_to_support_pct: 0.5, distance_to_resistance_pct: 3,
    distance_to_24h_high_atr: 2, distance_to_24h_low_atr: 1, breakout_24h_pct: 0, bb_width_percentile_7d: 0.4, candle_body_atr: 0.2, upper_wick_atr: 0.2, lower_wick_atr: 0.7,
    structure_12h: "mixed", adx_14: 22, plus_di_14: 24, minus_di_14: 18, trend_score: 0.2, regime: "range", countertrend_rebound_score: 0.7,
    bid_ask_spread_pct: 0.03, orderbook_imbalance: 0.1, bid_depth_50_usdt: 100_000, ask_depth_50_usdt: 90_000, depth_ratio: 1.1, taker_buy_ratio: 0.55, trade_flow_imbalance: 0.08, trade_flow_window_seconds: 120,
    open_interest_usdt_estimate: 987_654_321, open_interest_change_1h_pct: 0.5, open_interest_change_4h_pct: 1.2, funding_rate_latest_pct: 0.01, data_quality: "complete", mamis_phase: "wall_of_worry", mamis_confidence: 0.7, mamis_evidence: [`${symbol} hidden evidence`],
  };
}

function position(asset: TradeAsset, quantity: number, allocation: number): PositionContext {
  return { asset, status: quantity > 0 ? "held" : "flat", quantity, value_usdt: allocation * 10, allocation_pct: allocation, average_entry_price: 777.777, unrealized_pnl_pct: quantity > 0 ? 1.25 : null, cost_basis_quality: quantity > 0 ? "complete" : "unavailable", last_trade_action: quantity > 0 ? "buy" : null, last_trade_at: quantity > 0 ? observedAt : null, minutes_since_last_trade: quantity > 0 ? 15 : null };
}

function state(): JevTradingState {
  return {
    observedAt,
    blindEpisodeKey: "experiment-model-isolation",
    executionEnvironment: "demo",
    marketSource: "bybit-mainnet",
    balances: [
      { coin: "USDT", free: 500, locked: 0, total: 500, usdtValue: 500 },
      { coin: "BTC", free: 0.017123, locked: 0, total: 0.017123, usdtValue: 300 },
      { coin: "ETH", free: 0.314159, locked: 0, total: 0.314159, usdtValue: 150 },
      { coin: "XAUT", free: 0.027182, locked: 0, total: 0.027182, usdtValue: 50 },
    ],
    prices: { USDT: 1, BTC: 68_321.123, ETH: 3_456.789, XAUT: 2_654.321 },
    openOrders: [],
    indicators: { BTC: market("BTCUSDT", 68_321.123, 1.2), ETH: market("ETHUSDT", 3_456.789, -0.4), XAUT: market("XAUTUSDT", 2_654.321, 0.3) },
    positions: { BTC: position("BTC", 0.017123, 30), ETH: position("ETH", 0.314159, 15), XAUT: position("XAUT", 0.027182, 5) },
    fees: {
      BTC: { symbol: "BTCUSDT", maker_fee_pct: 0.1, taker_fee_pct: 0.1 },
      ETH: { symbol: "ETHUSDT", maker_fee_pct: 0.1, taker_fee_pct: 0.1 },
      XAUT: { symbol: "XAUTUSDT", maker_fee_pct: 0.1, taker_fee_pct: 0.1 },
    },
    portfolioRisk: { window_hours: 24, starting_equity_usdt: 1_000, peak_equity_usdt: 1_020, current_drawdown_pct: 1.96, completed_orders_24h: 2 },
    macro: null,
  };
}

describe("blind Jev state", () => {
  it("removes asset, venue, price, raw quantity and calendar identifiers", () => {
    const input = state();
    const payload = JSON.stringify(buildBlindNumericState(input).state);
    for (const token of ["BTC", "ETH", "XAUT", "USDT", "Bybit", "68321.123", "3456.789", "2654.321", "0.017123", "0.314159", "0.027182", "2026-09-21"]) {
      expect(payload.toLowerCase()).not.toContain(token.toLowerCase());
    }
    for (const field of ["symbol", "last_price", "quantity", "average_entry_price", "observed_at_utc"]) {
      expect(payload).not.toContain(field);
    }
  });

  it("uses the same episode mapping across engines and changes mappings across episodes", () => {
    const numeric = buildBlindNumericState(state());
    const semantic = buildBlindModel1State(state());
    expect(semantic.aliases).toEqual(numeric.aliases);
    const mappings = new Set(Array.from({ length: 20 }, (_, index) => JSON.stringify(createBlindAliasMap(observedAt, `episode-${index}`).slotToAsset)));
    expect(mappings.size).toBeGreaterThan(1);
  });

  it("preserves normalized trading evidence", () => {
    const blind = buildBlindNumericState(state());
    const btcSlot = blind.aliases.assetToSlot.BTC;
    expect(blind.state.candidates[btcSlot].returns_pct.d1).toBe(1.2);
    expect(blind.state.candidates[btcSlot].trend.price_vs_ema_200_pct).toBeCloseTo(11.111111, 5);
    expect(blind.state.candidates[btcSlot].inventory.exposure_pct).toBe(30);
    expect(blind.state.candidates[btcSlot].candidate_plan.status).toBe("available");
    expect(blind.state.candidates[btcSlot].candidate_plan.target1DistancePct).toBeCloseTo(3, 5);
    expect(blind.state.candidates[btcSlot].candidate_plan.target1AfterCostRoomPct).toBeGreaterThan(0);
  });
});
