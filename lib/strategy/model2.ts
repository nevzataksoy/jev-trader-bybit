import { choice, noul, score, TypeSafeClient, type EntryType } from "@typesafe-ai/sdk";
import { getTradingConfig } from "../config";
import type { JevPortfolioJudgments, TradeAsset } from "../types";
import { TRADE_ASSETS } from "../types";
import { buildRotationDecisions, type RotationAssetJudgment } from "./model2-policy";
import type { StrategyEngine } from "./types";

function rotationRegimeQuestion(asset: TradeAsset) {
  return choice(
    {
      objective: `Classify the current rotation regime for ${asset}/USDT over the next four to sixteen fifteen-minute cycles.`,
      constraints: [
        "Use only the supplied closed-candle and execution evidence.",
        "Accumulation requires a base after weakness, improving structure and declining downside pressure; it is not merely an oversold reading.",
        "Choose uncertain when the regime evidence is materially conflicted.",
      ],
    },
    {
      bull: "An orderly positive trend supports long exposure.",
      bear: "Persistent negative structure favors USDT except for a tightly confirmed tactical rebound.",
      range: "Stable boundaries support selective mean reversion or a confirmed breakout.",
      accumulation: "A post-decline base is improving sufficiently for a small planned first tranche.",
      uncertain: "No regime has enough coherent evidence.",
    },
  );
}

function rotationActionQuestion(asset: TradeAsset) {
  return choice(
    {
      objective: `Choose the appropriate portfolio action for ${asset}/USDT in a long-only spot rotation portfolio.`,
      constraints: [
        "Enter only from a flat position and increase only when existing exposure is progressing according to plan.",
        "Do not average down a losing position.",
        "Near a range high, hold unless a participation-confirmed breakout is accepted.",
        "Reducing or exiting to USDT is a valid active trading decision.",
      ],
    },
    {
      enter: "Open the first planned tranche from USDT.",
      increase: "Add a planned tranche to winning or confirmed exposure.",
      hold: "Keep the current allocation unchanged.",
      reduce: "Move part of existing exposure to USDT.",
      exit: "Move the entire existing exposure to USDT.",
    },
  );
}

function timingQuestion(asset: TradeAsset) {
  return choice(
    {
      objective: `Judge whether the ${asset}/USDT rotation plan can act on the current closed-candle boundary.`,
      constraints: ["enter_now needs independent structure and participation confirmation.", "A moving price alone is not confirmation."],
    },
    {
      enter_now: "The plan has enough closed-candle confirmation to act now.",
      wait_close: "Another close is required.",
      wait_retest: "A boundary break or reversal must retest first.",
      no_entry: "No valid risk-increasing entry exists.",
    },
  );
}

function directionQuestion(asset: TradeAsset) {
  return choice(
    { objective: `Judge the executable direction of ${asset}/USDT over the next one to four hours.`, constraints: ["Prefer unclear when evidence conflicts."] },
    { up: "Upside is more likely after costs.", down: "Downside is more likely.", unclear: "Direction is not sufficiently separated." },
  );
}

function planQualityQuestion(asset: TradeAsset) {
  return score(
    {
      objective: `Score the quality of a complete trade plan for ${asset}/USDT now.`,
      constraints: ["Reward coherent regime, entry, invalidation and cost evidence rather than activity."],
    },
    ["No defensible plan.", "Weak or incomplete plan.", "Developing plan that needs confirmation.", "Coherent executable plan.", "Exceptional multi-factor plan."],
  );
}

function invalidationQuestion(asset: TradeAsset) {
  return noul(
    { objective: `Is the current or proposed ${asset}/USDT long thesis already invalidated?`, constraints: ["Use structure, volatility, liquidity and downside evidence together."] },
    { true: "The thesis is invalid or immediate risk reduction is necessary.", false: "The thesis is not presently invalidated." },
  );
}

function liquidityQuestion(asset: TradeAsset) {
  return noul(
    { objective: `Can ${asset}/USDT support a normal-sized spot rotation after fees, spread and slippage?`, constraints: ["Missing optional derivatives data is not itself illiquidity."] },
    { true: "Execution quality is acceptable.", false: "Execution quality blocks a position change." },
  );
}

function preferredDestinationQuestion() {
  return choice(
    {
      objective: "Select the best destination for marginal capital in the BTC, ETH, XAUT and USDT rotation universe.",
      constraints: ["Compare trend, relative strength, plan quality and costs.", "Select USDT when opportunities are not clearly executable."],
    },
    { BTC: "BTC is best.", ETH: "ETH is best.", XAUT: "XAUT is best.", USDT: "Capital preservation is best." },
  );
}

function riskBudgetQuestion() {
  return choice(
    { objective: "Choose the total long-only risk budget for the rotation portfolio.", constraints: ["Use zero when no executable plan exists or conditions are disorderly."] },
    { zero: "Remain in USDT.", low: "Use small tactical exposure.", medium: "Use normal selective exposure.", high: "Use most permitted exposure." },
  );
}

function separationQuestion() {
  return score(
    { objective: "Score how clearly the best rotation destination exceeds its alternatives after costs.", constraints: ["High separation should be rare."] },
    ["No qualified destination.", "Weak or tied alternatives.", "Meaningful leader.", "Large and coherent leader."],
  );
}

export function buildRotationSemanticState(state: Parameters<StrategyEngine["evaluate"]>[0]) {
  const config = getTradingConfig();
  return {
    meta: {
      observed_at_utc: state.observedAt,
      market_source: state.marketSource,
      mandate: "Long-only spot rotation among BTC, ETH, XAUT and residual USDT. Trading activity is not an objective.",
      missing_values_rule: "Null means unavailable and must not be inferred.",
    },
    policy: {
      minimum_usdt_reserve_pct: config.minUsdtReservePct * 100,
      maximum_asset_allocation_pct: config.maxAssetAllocationPct * 100,
      allocation_deadband_pct: config.allocationDeadbandPct,
      estimated_slippage_pct: config.estimatedSlippagePct,
      minimum_setup_score: config.minSetupScore,
      average_down_prohibited: true,
    },
    portfolio: {
      equity_usdt: state.balances.reduce((sum, balance) => sum + balance.usdtValue, 0),
      drawdown_pct: state.portfolioRisk.current_drawdown_pct,
      completed_orders_24h: state.portfolioRisk.completed_orders_24h,
      assets: Object.fromEntries(TRADE_ASSETS.map((asset) => [asset, state.positions[asset]])),
    },
    macro: state.macro ? {
      quality: state.macro.data_quality,
      policy_regime: state.macro.policy_regime,
      gold_real_yield_regime: state.macro.gold_real_yield_regime,
      curve_10y_2y_bps: state.macro.curve.slope_10y_2y_bps,
      note: "Slow regime context only; never a standalone fifteen-minute trigger.",
    } : null,
    assets: Object.fromEntries(TRADE_ASSETS.map((asset) => {
      const market = state.indicators[asset];
      return [asset, {
        position: state.positions[asset],
        price: {
          last: market.last_price,
          return_15m_pct: market.return_15m_pct,
          return_1h_pct: market.return_1h_pct,
          return_4h_pct: market.return_4h_pct,
          return_24h_pct: market.return_24h_pct,
          return_7d_pct: market.return_7d_pct,
          return_30d_pct: market.return_30d_pct,
          relative_strength_vs_btc_24h_pct: market.relative_strength_vs_btc_24h_pct,
        },
        trend: {
          deterministic_regime: market.regime,
          ema_9: market.ema_9,
          ema_21: market.ema_21,
          ema_50: market.ema_50,
          ema_200: market.ema_200,
          ema_50_slope_3h_pct: market.ema_50_slope_3h_pct,
          adx_14: market.adx_14,
          plus_di_14: market.plus_di_14,
          minus_di_14: market.minus_di_14,
          structure_12h: market.structure_12h,
        },
        range_and_breakout: {
          channel_24h_position: market.channel_24h_position,
          channel_3d_position: market.channel_3d_position,
          channel_7d_position: market.channel_7d_position,
          breakout_24h_pct: market.breakout_24h_pct,
          price_zscore_20: market.price_zscore_20,
          bb_width_percentile_7d: market.bb_width_percentile_7d,
          upper_wick_atr: market.upper_wick_atr,
          lower_wick_atr: market.lower_wick_atr,
        },
        risk_and_participation: {
          atr_14_pct: market.atr_14_pct,
          realized_volatility_24h_pct: market.realized_volatility_24h_pct,
          downside_volatility_24h_pct: market.downside_volatility_24h_pct,
          drawdown_20d_pct: market.drawdown_20d_pct,
          volume_ratio_20: market.volume_ratio_20,
          volume_zscore_20: market.volume_zscore_20,
          countertrend_rebound_score: market.countertrend_rebound_score,
        },
        execution: {
          taker_fee_pct: state.fees[asset].taker_fee_pct,
          spread_pct: market.bid_ask_spread_pct,
          depth_ratio: market.depth_ratio,
          orderbook_imbalance: market.orderbook_imbalance,
          trade_flow_imbalance: market.trade_flow_imbalance,
          data_quality: market.data_quality,
        },
        positioning: {
          funding_rate_pct: market.funding_rate_latest_pct,
          open_interest_change_1h_pct: market.open_interest_change_1h_pct,
          open_interest_change_4h_pct: market.open_interest_change_4h_pct,
        },
      }];
    })),
  };
}

export const model2Engine: StrategyEngine = {
  id: "model2",
  version: "model2-rotation-v1",
  async evaluate(state) {
    const apiKey = process.env.TYPESAFE_API_KEY?.trim() || process.env.JEV_API_KEY?.trim();
    if (!apiKey) throw new Error("TYPESAFE_API_KEY is not configured.");
    const model = process.env.JEV_MODEL_NAME?.trim() || "jev-1.13.0";
    const client = new TypeSafeClient({ apiKey, defaultModel: model, timeout: 12_000, retry: { maxRetries: 1 }, logLevel: "warn" });
    const questions = {
      btc_regime: rotationRegimeQuestion("BTC"), btc_action: rotationActionQuestion("BTC"), btc_timing: timingQuestion("BTC"), btc_direction: directionQuestion("BTC"), btc_plan_quality: planQualityQuestion("BTC"), btc_invalidation: invalidationQuestion("BTC"), btc_liquidity: liquidityQuestion("BTC"),
      eth_regime: rotationRegimeQuestion("ETH"), eth_action: rotationActionQuestion("ETH"), eth_timing: timingQuestion("ETH"), eth_direction: directionQuestion("ETH"), eth_plan_quality: planQualityQuestion("ETH"), eth_invalidation: invalidationQuestion("ETH"), eth_liquidity: liquidityQuestion("ETH"),
      xaut_regime: rotationRegimeQuestion("XAUT"), xaut_action: rotationActionQuestion("XAUT"), xaut_timing: timingQuestion("XAUT"), xaut_direction: directionQuestion("XAUT"), xaut_plan_quality: planQualityQuestion("XAUT"), xaut_invalidation: invalidationQuestion("XAUT"), xaut_liquidity: liquidityQuestion("XAUT"),
      preferred_destination: preferredDestinationQuestion(), gross_risk_budget: riskBudgetQuestion(), opportunity_separation: separationQuestion(),
    } as const;
    const startedAt = Date.now();
    const response = await client.systemOne({ model, state: buildRotationSemanticState(state) as unknown as EntryType, questions });
    const assetJudgments: Record<TradeAsset, RotationAssetJudgment> = {
      BTC: {
        regime: { choice: response.answers.btc_regime.choice, confidence: response.answers.btc_regime.confidence, probabilities: { ...response.answers.btc_regime.probabilities } },
        action: { choice: response.answers.btc_action.choice, confidence: response.answers.btc_action.confidence, probabilities: { ...response.answers.btc_action.probabilities } },
        timing: { choice: response.answers.btc_timing.choice, confidence: response.answers.btc_timing.confidence, probabilities: { ...response.answers.btc_timing.probabilities } },
        direction: { choice: response.answers.btc_direction.choice, confidence: response.answers.btc_direction.confidence, probabilities: { ...response.answers.btc_direction.probabilities } },
        planQuality: { score: response.answers.btc_plan_quality.score, confidence: response.answers.btc_plan_quality.confidence, probabilities: { ...response.answers.btc_plan_quality.probabilities } },
        invalidationRisk: response.answers.btc_invalidation.noul,
        liquidityOk: response.answers.btc_liquidity.noul,
      },
      ETH: {
        regime: { choice: response.answers.eth_regime.choice, confidence: response.answers.eth_regime.confidence, probabilities: { ...response.answers.eth_regime.probabilities } },
        action: { choice: response.answers.eth_action.choice, confidence: response.answers.eth_action.confidence, probabilities: { ...response.answers.eth_action.probabilities } },
        timing: { choice: response.answers.eth_timing.choice, confidence: response.answers.eth_timing.confidence, probabilities: { ...response.answers.eth_timing.probabilities } },
        direction: { choice: response.answers.eth_direction.choice, confidence: response.answers.eth_direction.confidence, probabilities: { ...response.answers.eth_direction.probabilities } },
        planQuality: { score: response.answers.eth_plan_quality.score, confidence: response.answers.eth_plan_quality.confidence, probabilities: { ...response.answers.eth_plan_quality.probabilities } },
        invalidationRisk: response.answers.eth_invalidation.noul,
        liquidityOk: response.answers.eth_liquidity.noul,
      },
      XAUT: {
        regime: { choice: response.answers.xaut_regime.choice, confidence: response.answers.xaut_regime.confidence, probabilities: { ...response.answers.xaut_regime.probabilities } },
        action: { choice: response.answers.xaut_action.choice, confidence: response.answers.xaut_action.confidence, probabilities: { ...response.answers.xaut_action.probabilities } },
        timing: { choice: response.answers.xaut_timing.choice, confidence: response.answers.xaut_timing.confidence, probabilities: { ...response.answers.xaut_timing.probabilities } },
        direction: { choice: response.answers.xaut_direction.choice, confidence: response.answers.xaut_direction.confidence, probabilities: { ...response.answers.xaut_direction.probabilities } },
        planQuality: { score: response.answers.xaut_plan_quality.score, confidence: response.answers.xaut_plan_quality.confidence, probabilities: { ...response.answers.xaut_plan_quality.probabilities } },
        invalidationRisk: response.answers.xaut_invalidation.noul,
        liquidityOk: response.answers.xaut_liquidity.noul,
      },
    };
    const portfolioJudgments: JevPortfolioJudgments = {
      preferred_destination: { choice: response.answers.preferred_destination.choice, confidence: response.answers.preferred_destination.confidence, probabilities: { ...response.answers.preferred_destination.probabilities } },
      gross_risk_budget: { choice: response.answers.gross_risk_budget.choice, confidence: response.answers.gross_risk_budget.confidence, probabilities: { ...response.answers.gross_risk_budget.probabilities } },
      opportunity_separation: { score: response.answers.opportunity_separation.score, confidence: response.answers.opportunity_separation.confidence, probabilities: { ...response.answers.opportunity_separation.probabilities } },
    };
    return {
      engineId: "model2",
      engineVersion: "model2-rotation-v1",
      model: response.model,
      decisions: buildRotationDecisions(assetJudgments, portfolioJudgments, state.indicators, state.positions, getTradingConfig()),
      portfolioJudgments,
      usage: response.usage,
      latencyMs: Date.now() - startedAt,
    };
  },
};

export const strategyEngines = {
  model2: model2Engine,
};
