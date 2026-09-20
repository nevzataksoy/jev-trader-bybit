import { choice, TypeSafeClient, type EntryType } from "@typesafe-ai/sdk";
import type {
  JevDecision,
  JevResponse,
  MarketIndicatorState,
  OrderHistoryItem,
  SpotBalance,
  TickerPrices,
  TradeAction,
  TradeAsset,
} from "./types";
import { getTradingConfig } from "./config";

export interface JevTradingState {
  observedAt: string;
  executionEnvironment: "testnet" | "demo" | "mainnet";
  marketSource: "bybit-mainnet";
  balances: SpotBalance[];
  prices: TickerPrices;
  openOrders: OrderHistoryItem[];
  indicators: Record<TradeAsset, MarketIndicatorState>;
}

const actionCriteria = {
  buy: {
    meaning: "Increase this asset using available USDT.",
    choose_when: [
      "Bull trend: multi-timeframe returns, EMA structure, directional movement, volume and order-book demand jointly support continuation.",
      "Range: price is statistically discounted inside the range and mean-reversion evidence is supported by RSI, z-score and order-book demand.",
      "Bear trend: choose only for a measured countertrend rebound with positive 15m/1h momentum, sufficient rebound score, liquidity and controlled volatility.",
      "Portfolio allocation, USDT reserve and open-order state make additional exposure prudent.",
    ],
  },
  sell: {
    meaning: "Reduce this asset into USDT.",
    choose_when: [
      "Bear trend, negative multi-timeframe momentum or weakening directional/volume structure supports capital preservation in USDT.",
      "A range rebound is exhausted near a statistical upper extreme with weakening demand.",
      "Volatility, concentration or derivatives positioning makes reducing an existing holding prudent.",
    ],
  },
  hold: {
    meaning: "Submit no order for this asset in this cycle.",
    choose_when: "Signals conflict, data is partial, confidence is weak, or an existing order/exposure should not change.",
  },
};

function actionQuestion(asset: TradeAsset) {
  return choice(
    {
      objective: `Choose the safest portfolio action for ${asset} for the next 15-minute cycle.`,
      constraints: [
        "Use only the supplied state; do not assume missing facts.",
        "Treat the deterministic regime and normalized statistics as evidence, not as a guarantee.",
        "Derivative data is optional for XAUT; spot_only is not by itself a reason to hold.",
        "Prefer hold when material signals conflict, liquidity is weak, or no regime-specific setup is present.",
        "Account for current balances and open orders before increasing exposure.",
        "The application, not the model, controls sizing and execution risk.",
      ],
    },
    actionCriteria,
  );
}

export async function evaluateTradingState(state: JevTradingState): Promise<JevResponse> {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim() || process.env.JEV_API_KEY?.trim();
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not configured.");

  const model = process.env.JEV_MODEL_NAME?.trim() || "jev-1.13.0";
  const client = new TypeSafeClient({
    apiKey,
    defaultModel: model,
    timeout: 10_000,
    retry: { maxRetries: 1 },
    logLevel: "warn",
  });
  const questions = {
    btc_action: actionQuestion("BTC"),
    eth_action: actionQuestion("ETH"),
    xaut_action: actionQuestion("XAUT"),
  };
  const risk = getTradingConfig();
  const totalPortfolioUsdt = state.balances.reduce((sum, balance) => sum + balance.usdtValue, 0);
  const response = await client.systemOne({
    model,
    state: {
      ...state,
      policy: {
        allowed_assets: ["USDT", "BTC", "ETH", "XAUT"],
        cadence_minutes: 15,
        minimum_execution_confidence: risk.minConfidence,
        minimum_usdt_reserve_pct: risk.minUsdtReservePct * 100,
        maximum_single_asset_allocation_pct: risk.maxAssetAllocationPct * 100,
        maximum_spread_pct: risk.maxSpreadPct,
        maximum_daily_realized_volatility_pct: risk.maxDailyVolatilityPct,
        minimum_bear_rebound_score: risk.minBearReboundScore,
        live_market_data_with_simulated_execution: state.executionEnvironment !== "mainnet",
      },
      portfolio: {
        total_value_usdt: totalPortfolioUsdt,
        allocations_pct: Object.fromEntries(state.balances.map((balance) => [
          balance.coin,
          totalPortfolioUsdt > 0 ? (balance.usdtValue / totalPortfolioUsdt) * 100 : 0,
        ])),
      },
      time_context: {
        canonical_timezone: "UTC",
        state_observed_at_utc: state.observedAt,
        exchange_timestamp_rule: "Bybit Unix epoch milliseconds are normalized to ISO-8601 UTC before persistence.",
        decision_rule: "Judge only the supplied current cycle; do not infer elapsed time from an unstated local timezone.",
      },
    } as unknown as EntryType,
    questions,
  });

  const answerMap = {
    BTC: response.answers.btc_action,
    ETH: response.answers.eth_action,
    XAUT: response.answers.xaut_action,
  } as const;
  const decisions = (Object.keys(answerMap) as TradeAsset[]).map((asset): JevDecision => {
    const answer = answerMap[asset];
    return {
      asset,
      action: answer.choice as TradeAction,
      confidence: answer.confidence,
      probabilities: {
        buy: answer.probabilities.buy,
        sell: answer.probabilities.sell,
        hold: answer.probabilities.hold,
      },
    };
  });

  return {
    model: response.model,
    decisions,
    usage: response.usage,
  };
}
