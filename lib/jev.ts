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
    choose_when: "Evidence supports upside and portfolio/open-order state makes a new buy prudent.",
  },
  sell: {
    meaning: "Reduce this asset into USDT.",
    choose_when: "Evidence supports downside or risk reduction and a sufficient holding exists.",
  },
  hold: {
    meaning: "Submit no order for this asset in this cycle.",
    choose_when: "Signals conflict, data is partial, confidence is weak, or an existing order/exposure should not change.",
  },
} as const;

function actionQuestion(asset: TradeAsset) {
  return choice(
    {
      objective: `Choose the safest portfolio action for ${asset} for the next 15-minute cycle.`,
      constraints: [
        "Use only the supplied state; do not assume missing facts.",
        "Prefer hold when signals conflict or data quality is partial.",
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
  const response = await client.systemOne({
    model,
    state: {
      ...state,
      policy: {
        allowed_assets: ["USDT", "BTC", "ETH", "XAUT"],
        cadence_minutes: 15,
        minimum_execution_confidence: risk.minConfidence,
        live_market_data_with_simulated_execution: state.executionEnvironment !== "mainnet",
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
