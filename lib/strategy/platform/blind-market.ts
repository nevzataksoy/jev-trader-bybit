import { getTradingConfig } from "../config";
import type { JevTradingState } from "../../jev";
import type { MarketIndicatorState, PositionContext, TradeAsset } from "../../types";
import { TRADE_ASSETS } from "../../types";

export const BLIND_SLOTS = ["candidate_1", "candidate_2", "candidate_3"] as const;
export type BlindSlot = (typeof BLIND_SLOTS)[number];

export interface BlindAliasMap {
  slotToAsset: Record<BlindSlot, TradeAsset>;
  assetToSlot: Record<TradeAsset, BlindSlot>;
}

export interface BlindCandidateNumericState {
  inventory: {
    state: "flat" | "held";
    exposure_pct: number;
    exposure_bucket: "none" | "small" | "medium" | "large";
    unrealized_pnl_pct: number | null;
    cost_basis_quality: PositionContext["cost_basis_quality"];
    open_order: boolean;
  };
  returns_pct: {
    m15: number;
    h1: number;
    h4: number;
    d1: number;
    d7: number;
    d30: number;
    relative_to_candidate_median_d1: number;
  };
  trend: {
    deterministic_regime: MarketIndicatorState["regime"];
    price_vs_ema_9_pct: number;
    price_vs_ema_21_pct: number;
    price_vs_ema_50_pct: number;
    price_vs_ema_200_pct: number;
    ema_9_vs_21_pct: number;
    ema_21_vs_50_pct: number;
    ema_50_vs_200_pct: number;
    ema_50_slope_3h_pct: number;
    rsi_14: number;
    adx_14: number;
    directional_index_spread: number;
    structure_12h: MarketIndicatorState["structure_12h"];
    trend_efficiency_4h: number;
    up_fraction_4h: number;
    return_streak_15m: number;
  };
  range_and_breakout: {
    channel_24h_position: number;
    channel_3d_position: number;
    channel_7d_position: number;
    distance_to_24h_high_atr: number;
    distance_to_24h_low_atr: number;
    breakout_24h_pct: number;
    price_zscore_20: number;
    bb_position: number;
    bb_width_pct: number;
    bb_width_percentile_7d: number;
    candle_body_atr: number;
    upper_wick_atr: number;
    lower_wick_atr: number;
  };
  risk_and_participation: {
    atr_14_pct: number;
    realized_volatility_24h_pct: number;
    downside_volatility_24h_pct: number;
    drawdown_20d_pct: number;
    volume_ratio_20: number;
    volume_zscore_20: number;
    distance_vwap_24h_pct: number;
    countertrend_rebound_score: number;
    behavioral_phase: MarketIndicatorState["mamis_phase"];
    behavioral_phase_confidence: number;
  };
  execution: {
    round_trip_cost_pct: number;
    atr_to_cost_ratio: number;
    spread_pct: number;
    depth_ratio: number;
    orderbook_imbalance: number;
    trade_flow_imbalance: number | null;
    trade_flow_window_seconds: number | null;
    data_quality: MarketIndicatorState["data_quality"];
    microstructure_provenance: "live" | "historical_proxy" | "partial";
  };
  leveraged_positioning: {
    availability: "available" | "unavailable";
    funding_rate_pct: number | null;
    open_interest_change_1h_pct: number | null;
    open_interest_change_4h_pct: number | null;
  };
}

export interface BlindNumericState {
  schema_version: "blind-market-v2";
  evaluator_role: string;
  time_context: {
    cadence_minutes: 15;
    calendar_identity: "masked";
    market_data_age_seconds: number;
    last_closed_candle_age_minutes: number;
  };
  global_context: {
    macro_quality: string;
    policy_regime: string;
    real_yield_pressure: string;
    curve_10y_2y_bps: number | null;
    risk_sizing_owner: "deterministic_application";
  };
  candidates: Record<BlindSlot, BlindCandidateNumericState>;
}

function round(value: number, decimals = 6) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function relativeAgeSeconds(now: string, then: string) {
  const difference = Date.parse(now) - Date.parse(then);
  return Number.isFinite(difference) ? Math.max(0, Math.round(difference / 1_000)) : 0;
}

function ratioPct(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return round((numerator / denominator - 1) * 100);
}

function hashSeed(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function defaultEpisodeKey(observedAt: string) {
  const date = new Date(observedAt);
  const week = Math.floor(date.getTime() / (7 * 24 * 60 * 60 * 1_000));
  return `live-week-${week}`;
}

export function createBlindAliasMap(observedAt: string, episodeKey?: string): BlindAliasMap {
  const assets = [...TRADE_ASSETS];
  let seed = hashSeed(episodeKey?.trim() || defaultEpisodeKey(observedAt));
  for (let index = assets.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    const target = seed % (index + 1);
    [assets[index], assets[target]] = [assets[target], assets[index]];
  }
  const slotToAsset = Object.fromEntries(BLIND_SLOTS.map((slot, index) => [slot, assets[index]])) as Record<BlindSlot, TradeAsset>;
  const assetToSlot = Object.fromEntries(BLIND_SLOTS.map((slot) => [slotToAsset[slot], slot])) as Record<TradeAsset, BlindSlot>;
  return { slotToAsset, assetToSlot };
}

function exposureBucket(position: PositionContext): BlindCandidateNumericState["inventory"]["exposure_bucket"] {
  if (position.status === "flat" || position.allocation_pct < 0.01) return "none";
  if (position.allocation_pct < 15) return "small";
  if (position.allocation_pct < 35) return "medium";
  return "large";
}

function microstructureProvenance(market: MarketIndicatorState): BlindCandidateNumericState["execution"]["microstructure_provenance"] {
  if (!market.data_provenance) return "live";
  if (market.data_provenance.orderbook === "historical_proxy") return "historical_proxy";
  if (market.data_provenance.trade_flow === "unavailable") return "partial";
  return "live";
}

export function buildBlindNumericState(state: JevTradingState) {
  const aliases = createBlindAliasMap(state.observedAt, state.blindEpisodeKey);
  const config = getTradingConfig();
  const medianReturn = [...TRADE_ASSETS]
    .map((asset) => state.indicators[asset].return_24h_pct)
    .sort((left, right) => left - right)[1];
  const candidates = Object.fromEntries(BLIND_SLOTS.map((slot) => {
    const asset = aliases.slotToAsset[slot];
    const market = state.indicators[asset];
    const position = state.positions[asset];
    const fee = state.fees[asset];
    const roundTripCost = fee.taker_fee_pct * 2 + market.bid_ask_spread_pct + config.estimatedSlippagePct * 2;
    const derivativesAvailable = market.funding_rate_latest_pct !== null
      || market.open_interest_change_1h_pct !== null
      || market.open_interest_change_4h_pct !== null;
    return [slot, {
      inventory: {
        state: position.status,
        exposure_pct: round(position.allocation_pct),
        exposure_bucket: exposureBucket(position),
        unrealized_pnl_pct: position.unrealized_pnl_pct === null ? null : round(position.unrealized_pnl_pct),
        cost_basis_quality: position.cost_basis_quality,
        open_order: state.openOrders.some((order) => order.symbol === market.symbol),
      },
      returns_pct: {
        m15: round(market.return_15m_pct), h1: round(market.return_1h_pct), h4: round(market.return_4h_pct),
        d1: round(market.return_24h_pct), d7: round(market.return_7d_pct), d30: round(market.return_30d_pct),
        relative_to_candidate_median_d1: round(market.return_24h_pct - medianReturn),
      },
      trend: {
        deterministic_regime: market.regime,
        price_vs_ema_9_pct: ratioPct(market.last_price, market.ema_9),
        price_vs_ema_21_pct: ratioPct(market.last_price, market.ema_21),
        price_vs_ema_50_pct: ratioPct(market.last_price, market.ema_50),
        price_vs_ema_200_pct: ratioPct(market.last_price, market.ema_200),
        ema_9_vs_21_pct: ratioPct(market.ema_9, market.ema_21),
        ema_21_vs_50_pct: ratioPct(market.ema_21, market.ema_50),
        ema_50_vs_200_pct: ratioPct(market.ema_50, market.ema_200),
        ema_50_slope_3h_pct: round(market.ema_50_slope_3h_pct), rsi_14: round(market.rsi_14),
        adx_14: round(market.adx_14), directional_index_spread: round(market.plus_di_14 - market.minus_di_14),
        structure_12h: market.structure_12h, trend_efficiency_4h: round(market.trend_efficiency_4h),
        up_fraction_4h: round(market.up_fraction_4h), return_streak_15m: market.return_streak_15m,
      },
      range_and_breakout: {
        channel_24h_position: round(market.channel_24h_position), channel_3d_position: round(market.channel_3d_position),
        channel_7d_position: round(market.channel_7d_position), distance_to_24h_high_atr: round(market.distance_to_24h_high_atr),
        distance_to_24h_low_atr: round(market.distance_to_24h_low_atr), breakout_24h_pct: round(market.breakout_24h_pct),
        price_zscore_20: round(market.price_zscore_20), bb_position: round(market.bb_position),
        bb_width_pct: round(market.bb_width_pct), bb_width_percentile_7d: round(market.bb_width_percentile_7d),
        candle_body_atr: round(market.candle_body_atr), upper_wick_atr: round(market.upper_wick_atr), lower_wick_atr: round(market.lower_wick_atr),
      },
      risk_and_participation: {
        atr_14_pct: round(market.atr_14_pct), realized_volatility_24h_pct: round(market.realized_volatility_24h_pct),
        downside_volatility_24h_pct: round(market.downside_volatility_24h_pct), drawdown_20d_pct: round(market.drawdown_20d_pct),
        volume_ratio_20: round(market.volume_ratio_20), volume_zscore_20: round(market.volume_zscore_20),
        distance_vwap_24h_pct: round(market.distance_vwap_24h_pct), countertrend_rebound_score: round(market.countertrend_rebound_score),
        behavioral_phase: market.mamis_phase, behavioral_phase_confidence: round(market.mamis_confidence),
      },
      execution: {
        round_trip_cost_pct: round(roundTripCost), atr_to_cost_ratio: round(market.atr_14_pct / Math.max(roundTripCost, 0.0001)),
        spread_pct: round(market.bid_ask_spread_pct), depth_ratio: round(market.depth_ratio),
        orderbook_imbalance: round(market.orderbook_imbalance), trade_flow_imbalance: market.trade_flow_imbalance === null ? null : round(market.trade_flow_imbalance),
        trade_flow_window_seconds: market.trade_flow_window_seconds, data_quality: market.data_quality,
        microstructure_provenance: microstructureProvenance(market),
      },
      leveraged_positioning: {
        availability: derivativesAvailable ? "available" : "unavailable",
        funding_rate_pct: market.funding_rate_latest_pct === null ? null : round(market.funding_rate_latest_pct),
        open_interest_change_1h_pct: market.open_interest_change_1h_pct === null ? null : round(market.open_interest_change_1h_pct),
        open_interest_change_4h_pct: market.open_interest_change_4h_pct === null ? null : round(market.open_interest_change_4h_pct),
      },
    } satisfies BlindCandidateNumericState];
  })) as Record<BlindSlot, BlindCandidateNumericState>;
  const firstMarket = state.indicators[aliases.slotToAsset.candidate_1];
  const blindState: BlindNumericState = {
    schema_version: "blind-market-v2",
    evaluator_role: "Evaluate anonymous market evidence only. Instrument identity and calendar identity are intentionally unavailable. Do not infer them. Do not size, route or authorize trades. Report uncertainty honestly; deterministic application policy owns final allocation, risk and execution.",
    time_context: {
      cadence_minutes: 15,
      calendar_identity: "masked",
      market_data_age_seconds: relativeAgeSeconds(state.observedAt, firstMarket.observed_at),
      last_closed_candle_age_minutes: round(relativeAgeSeconds(state.observedAt, firstMarket.last_closed_15m_at) / 60, 2),
    },
    global_context: {
      macro_quality: state.macro?.data_quality ?? "unavailable",
      policy_regime: state.macro?.policy_regime ?? "unknown",
      real_yield_pressure: state.macro?.gold_real_yield_regime ?? "unknown",
      curve_10y_2y_bps: state.macro?.curve.slope_10y_2y_bps ?? null,
      risk_sizing_owner: "deterministic_application",
    },
    candidates,
  };
  return { aliases, state: blindState };
}

export function assertBlindPayload(payload: unknown) {
  const serialized = JSON.stringify(payload);
  const forbiddenValues = ["BTC", "ETH", "XAUT", "USDT", "Bybit", "bitcoin", "ethereum", "gold"];
  const forbiddenFields = ["symbol", "last_price", "quantity", "value_usdt", "average_entry_price", "observed_at_utc", "collected_at"];
  const violation = [...forbiddenValues, ...forbiddenFields].find((token) => serialized.toLowerCase().includes(token.toLowerCase()));
  if (violation) throw new Error(`Blind payload leaked forbidden token: ${violation}`);
}
