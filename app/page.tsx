"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DetailBadge } from "@/app/components/detail-badge";
import type {
  DashboardState,
  DailyPortfolioPoint,
  Language,
  MamisPhase,
  MarketRegime,
  OrderHistoryItem,
  TradeAction,
} from "@/lib/types";

const copy = {
  tr: {
    eyebrow: "JEV SYSTEM ONE • OTONOM SPOT LAB",
    title: "Piyasa sinyallerini karara, kararı kontrollü aksiyona dönüştürür.",
    intro:
      "Canlı ana ağ verileri Jev tarafından değerlendirilir; doğrulanan kararlar yalnızca izole Bybit Demo Trading spot hesabında uygulanır.",
    abIntro: "Canlı ana ağ verileri aynı snapshot üzerinden iki izole paper motor tarafından değerlendirilir. A/B modunda hiçbir model kararı Bybit hesabına yönlendirilmez.",
    abPaper: "İzole A/B paper",
    abRoutingOff: "A/B routing kilidi",
    accountPortfolio: "Bağlı demo hesap portföyü",
    abDecisionTitle: "A/B kararları ayrı deney kaydında",
    abDecisionSub: "Bu dashboard hesap ve platform durumunu gösterir. Model karar geçmişinin authoritative kaynağı A/B Lab ekranı ve /api/models/state endpointidir.",
    openLab: "A/B Lab kararlarını aç",
    strategyDetails: "Runtime ayrıntıları",
    runMode: "Çalışma modu",
    activeEngines: "Aktif motorlar",
    executionEngine: "Exchange motoru",
    routingState: "Exchange routing",
    accountOrders: "Bağlı hesap emir geçmişi",
    accountOrdersSub: "A/B paper emirleri değildir; yalnız yapılandırılmış Bybit hesabından senkronlanan spot emirleridir.",
    refresh: "Verileri yenile",
    refreshing: "Yenileniyor",
    liveMarket: "Canlı piyasa verisi",
    testExecution: "Demo spot yürütme",
    tradingOn: "Emir yürütme açık",
    tradingOff: "Gözlem modu",
    portfolio: "Toplam demo portföyü",
    dailyChange: "Günlük değişim",
    openOrders: "Açık emir",
    lastCycle: "Son bot çevrimi",
    noCycle: "Henüz çevrim yok",
    chartTitle: "Sermaye eğrisi",
    chartSubtitle: "Her günün son 15 dakikalık portföy snapshot’ı • USDT",
    noHistory: "Grafik, ilk başarılı cron snapshot’ından sonra oluşacak.",
    allocations: "Portföy dağılımı",
    amount: "Miktar",
    value: "USDT değeri",
    allocation: "Dağılım",
    price: "Canlı fiyat",
    intelligence: "Jev karar akışı",
    intelligenceSub: "Son çevrimde üretilen tipli kararlar ve uygulama kapısı",
    confidence: "Güven",
    regime: "Piyasa rejimi",
    sentimentCycle: "Mamis evresi",
    targetAllocation: "Mevcut / hedef",
    direction: "Yön yargısı",
    setupQuality: "Setup kalitesi",
    selectedSetup: "Seçilen setup",
    entryReadiness: "Giriş hazırlığı",
    expectedEdge: "Net beklenti",
    riskBudget: "Risk bütçesi",
    macroContext: "Makro rejim",
    momentum: "15dk / 24sa getiri",
    volatility: "24sa gerçekleşen oynaklık",
    positionState: "Pozisyon",
    averageEntry: "Ort. maliyet",
    flat: "USDT'de",
    held: "Portföyde",
    unavailable: "Yetersiz geçmiş",
    model: "Model",
    noDecision: "Henüz Jev kararı kaydedilmedi.",
    workflow: "Bot nasıl çalışıyor?",
    workflowSub: "Her 15 dakikada tekrarlanan, izlenebilir ve fail-closed karar hattı",
    steps: [
      ["01", "Hesabı oku", "USDT, BTC, ETH ve XAUT bakiyeleri ile spot açık emirler Demo Trading hesabından alınır."],
      ["02", "Piyasayı ölç", "Kapanmış mumlardan çok-zamanlı fiyat kanalları, swing yapısı, trend, oynaklık, hacim ve maliyet ölçülür."],
      ["03", "Jev ile değerlendir", "Jev rejimi, setup türünü, giriş hazırlığını, false-breakout riskini, dönüş teyidini ve sermaye hedefini değerlendirir."],
      ["04", "Hedefi uygula", "Kod yalnızca yapı ve maliyet-sonrası beklenti kapılarından geçen setup'ı hedef ağırlığa çevirir; kalan sermaye USDT'de tutulur."],
    ],
    orders: "Spot emir geçmişi",
    ordersSub: "Demo Trading spot emirleri; kalıcı kayıtlar Bybit’in yedi günlük saklama süresinden bağımsız tutulur.",
    allSymbols: "Tüm semboller",
    allSides: "Tüm yönler",
    allStatuses: "Tüm durumlar",
    buy: "AL",
    sell: "SAT",
    hold: "BEKLE",
    orderTime: "Emir zamanı",
    executionTime: "Gerçekleşme zamanı",
    symbol: "Sembol",
    side: "Yön",
    quantity: "Miktar",
    avgPrice: "Ort. fiyat",
    total: "Gerçekleşen tutar",
    fee: "Komisyon",
    status: "Durum",
    noOrders: "Seçili filtrelerde emir bulunamadı.",
    connected: "Bağlı",
    notConfigured: "Yapılandırılmadı",
    connectionError: "Bağlantı hatası",
    infrastructure: "Sistem durumu",
    bybit: "Bybit hesap API",
    database: "Kalıcı veri deposu",
    updated: "Güncellendi",
    disclosureTitle: "Deneysel yazılım ve finansal risk bildirimi",
    disclosure:
      "Bu proje Jev karar modelini gösteren bir yazılım örneğidir; yatırım tavsiyesi değildir. Kripto varlık işlemleri ciddi kayıp riski taşır. Demo Trading sonuçları gerçek piyasa performansını garanti etmez. Gerçek hesapta kullanmadan önce bağımsız güvenlik, strateji, mevzuat ve risk incelemesi yapın. Geliştiriciler işlem kayıplarından sorumlu değildir.",
    footer: "Live intelligence • Typed decisions • Controlled execution",
    loadError: "Dashboard verileri alınamadı.",
  },
  en: {
    eyebrow: "JEV SYSTEM ONE • AUTONOMOUS SPOT LAB",
    title: "Turn market signals into decisions, and decisions into controlled action.",
    intro:
      "Live mainnet data is evaluated by Jev; validated decisions execute only inside an isolated Bybit Demo Trading spot account.",
    abIntro: "The same live mainnet snapshot is evaluated by two isolated paper engines. In A/B mode no model decision is routed to the Bybit account.",
    abPaper: "Isolated A/B paper",
    abRoutingOff: "A/B routing lock",
    accountPortfolio: "Connected demo account portfolio",
    abDecisionTitle: "A/B decisions live in the experiment ledger",
    abDecisionSub: "This dashboard shows account and platform state. The authoritative model decision history is the A/B Lab and /api/models/state.",
    openLab: "Open A/B Lab decisions",
    strategyDetails: "Runtime details",
    runMode: "Run mode",
    activeEngines: "Active engines",
    executionEngine: "Exchange engine",
    routingState: "Exchange routing",
    accountOrders: "Connected account order history",
    accountOrdersSub: "These are not A/B paper orders; they are spot orders synchronized from the configured Bybit account.",
    refresh: "Refresh data",
    refreshing: "Refreshing",
    liveMarket: "Live market data",
    testExecution: "Demo spot execution",
    tradingOn: "Order execution enabled",
    tradingOff: "Observation mode",
    portfolio: "Total demo portfolio",
    dailyChange: "Daily change",
    openOrders: "Open orders",
    lastCycle: "Latest bot cycle",
    noCycle: "No cycle yet",
    chartTitle: "Capital curve",
    chartSubtitle: "Latest 15-minute portfolio snapshot of each day • USDT",
    noHistory: "The chart will appear after the first successful cron snapshot.",
    allocations: "Portfolio allocation",
    amount: "Amount",
    value: "USDT value",
    allocation: "Allocation",
    price: "Live price",
    intelligence: "Jev decision stream",
    intelligenceSub: "Typed decisions and execution gates from the latest cycle",
    confidence: "Confidence",
    regime: "Market regime",
    sentimentCycle: "Mamis phase",
    targetAllocation: "Current / target",
    direction: "Direction judgment",
    setupQuality: "Setup quality",
    selectedSetup: "Selected setup",
    entryReadiness: "Entry readiness",
    expectedEdge: "Net expectancy",
    riskBudget: "Risk budget",
    macroContext: "Macro regime",
    momentum: "15m / 24h return",
    volatility: "24h realized volatility",
    positionState: "Position",
    averageEntry: "Avg. entry",
    flat: "In USDT",
    held: "Held",
    unavailable: "Insufficient history",
    model: "Model",
    noDecision: "No Jev decision has been recorded yet.",
    workflow: "How does the bot work?",
    workflowSub: "An observable, fail-closed decision pipeline repeated every 15 minutes",
    steps: [
      ["01", "Read the account", "USDT, BTC, ETH and XAUT balances plus spot open orders come from the Demo Trading account."],
      ["02", "Measure the market", "Closed candles produce multi-timeframe channels, swing structure, trend, volatility, participation and execution-cost evidence."],
      ["03", "Evaluate with Jev", "Jev judges regime, setup type, entry readiness, false-breakout risk, reversal confirmation and the preferred capital destination."],
      ["04", "Apply the target", "Code converts only structure-qualified, cost-positive setups into target weights while residual capital remains in USDT."],
    ],
    orders: "Spot order history",
    ordersSub: "Demo Trading spot orders persisted independently of Bybit’s seven-day retention window.",
    allSymbols: "All symbols",
    allSides: "All sides",
    allStatuses: "All statuses",
    buy: "BUY",
    sell: "SELL",
    hold: "HOLD",
    orderTime: "Order time",
    executionTime: "Execution time",
    symbol: "Symbol",
    side: "Side",
    quantity: "Quantity",
    avgPrice: "Avg. price",
    total: "Executed value",
    fee: "Fee",
    status: "Status",
    noOrders: "No orders match the selected filters.",
    connected: "Connected",
    notConfigured: "Not configured",
    connectionError: "Connection error",
    infrastructure: "System status",
    bybit: "Bybit account API",
    database: "Persistent data store",
    updated: "Updated",
    disclosureTitle: "Experimental software and financial risk disclosure",
    disclosure:
      "This project is a software demonstration of the Jev decision model, not investment advice. Crypto trading involves substantial risk of loss. Demo Trading results do not guarantee real-market performance. Perform independent security, strategy, legal and risk reviews before any real-account use. The developers are not liable for trading losses.",
    footer: "Live intelligence • Typed decisions • Controlled execution",
    loadError: "Dashboard data could not be loaded.",
  },
} as const;

const initialState: DashboardState = {
  generatedAt: new Date(0).toISOString(),
  accountEnvironment: "demo",
  marketSource: "bybit-mainnet",
  tradingEnabled: false,
  strategy: {
    runMode: "loading",
    activeEngines: [],
    availableEngines: [],
    executionEngine: "none",
    exchangeRoutingAllowed: false,
    exchangeRoutingReason: "trading_disabled",
  },
  balances: [],
  prices: { USDT: 1, BTC: 0, ETH: 0, XAUT: 0 },
  openOrders: [],
  orders: [],
  history: [],
  recentRuns: [],
  connection: { bybit: "not_configured", database: "not_configured", message: null },
};

function formatMoney(value: number, lang: Language, decimals = 2) {
  return new Intl.NumberFormat(lang === "tr" ? "tr-TR" : "en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDate(value: string | null, lang: Language) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-US", {
    timeZone: lang === "tr" ? "Europe/Istanbul" : "UTC",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatDay(value: string, lang: Language) {
  return new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-US", {
    timeZone: lang === "tr" ? "Europe/Istanbul" : "UTC",
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
}

function fromMillis(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function statusLabel(status: DashboardState["connection"]["bybit"], lang: Language) {
  const t = copy[lang];
  if (status === "connected") return t.connected;
  if (status === "not_configured") return t.notConfigured;
  return t.connectionError;
}

function actionLabel(action: TradeAction, lang: Language, position?: "flat" | "held") {
  if (position === "flat" && action === "hold") return lang === "tr" ? "USDT'DE BEKLE" : "STAY IN USDT";
  if (position === "held" && action === "hold") return lang === "tr" ? "KORU" : "KEEP";
  if (position === "flat" && action === "buy") return lang === "tr" ? "POZİSYON AÇ" : "ENTER";
  if (position === "held" && action === "buy") return lang === "tr" ? "ARTIR" : "ADD";
  if (position === "held" && action === "sell") return lang === "tr" ? "AZALT" : "REDUCE";
  return copy[lang][action];
}

function regimeLabel(regime: MarketRegime, lang: Language) {
  const labels = {
    tr: { bull_trend: "Yükseliş trendi", bear_trend: "Düşüş trendi", range: "Yatay piyasa", compression: "Sıkışma", transition: "Geçiş" },
    en: { bull_trend: "Bull trend", bear_trend: "Bear trend", range: "Range", compression: "Compression", transition: "Transition" },
  } as const;
  return labels[lang][regime];
}

function mamisLabel(phase: MamisPhase | undefined, lang: Language) {
  if (!phase) return "—";
  const labels: Record<Language, Record<MamisPhase, string>> = {
    tr: {
      returning_confidence: "Güven geri dönüyor", buy_the_dip: "Düşüşten alım", enthusiasm: "Coşku",
      disbelief: "İnanmama", panic: "Panik", discouragement: "Yılgınlık", wall_of_worry: "Endişe duvarı",
      anxiety: "Kaygı", aversion: "Kaçınma", denial: "İnkâr", uncertain: "Belirsiz",
    },
    en: {
      returning_confidence: "Returning confidence", buy_the_dip: "Buy the dip", enthusiasm: "Enthusiasm",
      disbelief: "Disbelief", panic: "Panic", discouragement: "Discouragement", wall_of_worry: "Wall of worry",
      anxiety: "Anxiety", aversion: "Aversion", denial: "Denial", uncertain: "Uncertain",
    },
  };
  return labels[lang][phase];
}

function CapitalChart({ history, lang }: { history: DailyPortfolioPoint[]; lang: Language }) {
  const t = copy[lang];
  if (!history.length) return <div className="empty-state">{t.noHistory}</div>;
  const values = history.map((point) => point.totalPortfolioUsdt);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, Math.max(max * 0.02, 1));
  const width = 1_000;
  const height = 260;
  const padding = 24;
  const points = history.map((point, index) => {
    const x = history.length === 1 ? width / 2 : padding + (index / (history.length - 1)) * (width - padding * 2);
    const y = height - padding - ((point.totalPortfolioUsdt - min) / range) * (height - padding * 2);
    return { x, y, point };
  });
  const path = points.map(({ x, y }, index) => `${index ? "L" : "M"}${x},${y}`).join(" ");
  const area = `${path} L${points.at(-1)!.x},${height} L${points[0].x},${height} Z`;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t.chartTitle}>
        <defs>
          <linearGradient id="chartArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b7cff" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#8b7cff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="chartLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#43e6c3" />
            <stop offset="100%" stopColor="#9a7cff" />
          </linearGradient>
        </defs>
        {[0.2, 0.5, 0.8].map((ratio) => (
          <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} className="chart-grid" />
        ))}
        <path d={area} fill="url(#chartArea)" />
        <path d={path} fill="none" stroke="url(#chartLine)" strokeWidth="4" strokeLinecap="round" />
        {points.map(({ x, y, point }) => (
          <circle key={point.capturedAt} cx={x} cy={y} r="5" className="chart-dot">
            <title>{`${formatDay(point.capturedAt, lang)} • ${formatMoney(point.totalPortfolioUsdt, lang)} USDT`}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-axis">
        <span>{formatDay(history[0].capturedAt, lang)}</span>
        {history.length > 2 && <span>{formatDay(history[Math.floor(history.length / 2)].capturedAt, lang)}</span>}
        <span>{formatDay(history.at(-1)!.capturedAt, lang)}</span>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: "connected" | "not_configured" | "error" }) {
  return <span className={`status-dot status-dot--${status}`} aria-hidden="true" />;
}

export default function Dashboard() {
  const [lang, setLang] = useState<Language>("tr");
  const [data, setData] = useState<DashboardState>(initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [symbolFilter, setSymbolFilter] = useState("ALL");
  const [sideFilter, setSideFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const t = copy[lang];
  const isAbTest = data.strategy.runMode === "ab_test";

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/state?lang=${lang}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      setData((await response.json()) as DashboardState);
    } catch (loadError) {
      console.error(loadError);
      setError(copy[lang].loadError);
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    const stored = window.localStorage.getItem("jev-dashboard-language");
    if (stored === "tr" || stored === "en") {
      const timer = window.setTimeout(() => setLang(stored), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    window.localStorage.setItem("jev-dashboard-language", lang);
  }, [lang]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadData(), 0);
    const refreshTimer = window.setInterval(() => void loadData(), 60_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(refreshTimer);
    };
  }, [loadData]);

  const totalPortfolio = data.balances.reduce((sum, balance) => sum + balance.usdtValue, 0);
  const latestRun = data.recentRuns[0];
  const historyChange = data.history.length > 1
    ? data.history.at(-1)!.totalPortfolioUsdt - data.history.at(-2)!.totalPortfolioUsdt
    : 0;
  const historyChangePct = data.history.length > 1 && data.history.at(-2)!.totalPortfolioUsdt > 0
    ? (historyChange / data.history.at(-2)!.totalPortfolioUsdt) * 100
    : 0;

  const filteredOrders = useMemo(() => data.orders.filter((order) => {
    const symbolMatches = symbolFilter === "ALL" || order.symbol === symbolFilter;
    const sideMatches = sideFilter === "ALL" || order.side.toUpperCase() === sideFilter;
    const statusMatches = statusFilter === "ALL" || order.orderStatus === statusFilter;
    return symbolMatches && sideMatches && statusMatches;
  }), [data.orders, sideFilter, statusFilter, symbolFilter]);
  const statuses = [...new Set(data.orders.map((order) => order.orderStatus))];

  return (
    <main className="app-shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />

      <header className="topbar">
        <a className="brand" href="#top" aria-label="Jev Pulse home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><strong>JEV</strong> PULSE</span>
        </a>
        <div className="topbar-actions">
          <Link className="nav-link" href="/models">A/B LAB</Link>
          <div className="language-switch" aria-label="Language">
            {(["tr", "en"] as Language[]).map((language) => (
              <button
                key={language}
                className={lang === language ? "active" : ""}
                onClick={() => setLang(language)}
              >
                {language.toUpperCase()}
              </button>
            ))}
          </div>
          <button className="refresh-button" onClick={() => void loadData()} disabled={loading}>
            <span className={loading ? "refresh-icon spinning" : "refresh-icon"}>↻</span>
            {loading ? t.refreshing : t.refresh}
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span />{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p className="hero-intro">{isAbTest ? t.abIntro : t.intro}</p>
          <div className="signal-row">
            <span className="signal signal--live"><i />{t.liveMarket}</span>
            <span className="signal"><i />{isAbTest ? `${t.abPaper} • ${data.strategy.activeEngines.join(" × ")}` : `${data.accountEnvironment.toUpperCase()} • ${t.testExecution}`}</span>
            <span className={data.strategy.exchangeRoutingAllowed ? "signal signal--enabled" : "signal signal--muted"}>
              <i />{data.strategy.exchangeRoutingAllowed ? t.tradingOn : isAbTest ? t.abRoutingOff : t.tradingOff}
            </span>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit orbit--outer"><span /></div>
          <div className="orbit orbit--inner"><span /></div>
          <div className="jev-core"><small>SYSTEM</small><strong>ONE</strong><em>JEV 1.13</em></div>
        </div>
      </section>

      {error && <div className="alert alert--error">{error}</div>}
      {data.connection.message && <div className="alert">{data.connection.message}</div>}

      <section className="metric-grid">
        <article className="metric-card metric-card--primary">
          <span>{isAbTest ? t.accountPortfolio : t.portfolio}</span>
          <strong>{formatMoney(totalPortfolio, lang)} <small>USDT</small></strong>
          <div className="metric-foot"><span className="pulse-dot" />USDT • BTC • ETH • XAUT</div>
        </article>
        <article className="metric-card">
          <span>{t.dailyChange}</span>
          <strong className={historyChange >= 0 ? "positive" : "negative"}>
            {historyChange >= 0 ? "+" : ""}{formatMoney(historyChange, lang)} <small>USDT</small>
          </strong>
          <div className={historyChangePct >= 0 ? "metric-foot positive" : "metric-foot negative"}>
            {historyChangePct >= 0 ? "↗" : "↘"} {Math.abs(historyChangePct).toFixed(2)}%
          </div>
        </article>
        <article className="metric-card">
          <span>{t.openOrders}</span>
          <strong>{data.openOrders.length}</strong>
          <div className="metric-foot">Bybit {data.accountEnvironment}</div>
        </article>
        <article className="metric-card">
          <span>{t.lastCycle}</span>
          <strong className="metric-time">{latestRun ? formatDate(latestRun.startedAt, lang) : t.noCycle}</strong>
          <div className="metric-foot">{latestRun?.status ?? "—"}</div>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel panel--chart">
          <div className="panel-heading">
            <div><span className="section-kicker">ANALYTICS</span><h2>{t.chartTitle}</h2><p>{t.chartSubtitle}</p></div>
            <div className="chart-value">{formatMoney(data.history.at(-1)?.totalPortfolioUsdt ?? totalPortfolio, lang)}<span>USDT</span></div>
          </div>
          <CapitalChart history={data.history} lang={lang} />
        </article>

        <article className="panel panel--status">
          <div className="panel-heading"><div><span className="section-kicker">INFRA</span><h2>{t.infrastructure}</h2></div></div>
          <div className="connection-list">
            <div><StatusDot status={data.connection.bybit} /><span><b>{t.bybit}</b><small>{statusLabel(data.connection.bybit, lang)}</small></span></div>
            <div><StatusDot status={data.connection.database} /><span><b>{t.database}</b><small>{statusLabel(data.connection.database, lang)}</small></span></div>
          </div>
          <div className="timestamp"><span>{t.updated}</span><b>{formatDate(data.generatedAt, lang)}</b></div>
          <DetailBadge label={t.strategyDetails} tone={isAbTest ? "success" : "info"} className="status-detail-badge">
            <div className="detail-list"><span><small>{t.runMode}</small><b>{data.strategy.runMode}</b></span><span><small>{t.activeEngines}</small><b>{data.strategy.activeEngines.join(" × ") || "—"}</b></span><span><small>{t.executionEngine}</small><b>{data.strategy.executionEngine}</b></span><span><small>{t.routingState}</small><b>{data.strategy.exchangeRoutingAllowed ? "allowed" : data.strategy.exchangeRoutingReason}</b></span></div>
          </DetailBadge>
          <div className="data-route"><span>MARKET</span><i>→</i><b>JEV</b><i>→</i><span>{isAbTest ? "PAPER" : data.accountEnvironment.toUpperCase()}</span></div>
        </article>
      </section>

      <section className="panel section-panel">
        <div className="panel-heading"><div><span className="section-kicker">PORTFOLIO</span><h2>{t.allocations}</h2></div></div>
        <div className="asset-grid">
          {data.balances.map((balance) => {
            const share = totalPortfolio > 0 ? (balance.usdtValue / totalPortfolio) * 100 : 0;
            return (
              <article className={`asset-card asset-card--${balance.coin.toLowerCase()}`} key={balance.coin}>
                <div className="asset-top"><span className="asset-icon">{balance.coin.slice(0, 1)}</span><div><strong>{balance.coin}</strong><small>{balance.coin === "USDT" ? "Tether" : balance.coin}</small></div><b>{share.toFixed(1)}%</b></div>
                <div className="asset-value">{formatMoney(balance.usdtValue, lang)} <span>USDT</span></div>
                <div className="asset-meta"><span>{t.amount}<b>{formatMoney(balance.total, lang, balance.coin === "USDT" ? 2 : 6)}</b></span><span>{t.price}<b>{formatMoney(data.prices[balance.coin], lang, 2)}</b></span></div>
                <div className="allocation-track"><i style={{ width: `${Math.max(2, share)}%` }} /></div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel section-panel">
        <div className="panel-heading panel-heading--split">
          <div><span className="section-kicker">SYSTEM ONE</span><h2>{isAbTest ? t.abDecisionTitle : t.intelligence}</h2><p>{isAbTest ? t.abDecisionSub : t.intelligenceSub}</p></div>
          <span className="model-chip">{isAbTest ? data.strategy.activeEngines.map((engine) => engine.toUpperCase()).join(" × ") : `${t.model}: ${latestRun?.model ?? "jev-1.13.0"} · ${t.macroContext}: ${latestRun?.decisionContext?.macro?.policy_regime?.replaceAll("_", " ") ?? "—"}`}</span>
        </div>
        {isAbTest ? (
          <div className="ab-source-card"><div><strong>{t.abDecisionTitle}</strong><p>{t.abDecisionSub}</p></div><Link className="inline-action" href="/models">{t.openLab} →</Link></div>
        ) : latestRun?.decisions.length ? (
          <div className="decision-grid">
            {latestRun.decisions.map((decision) => {
              const execution = latestRun.executions.find((item) => item.asset === decision.asset);
              const market = latestRun.marketState?.[decision.asset];
              const position = latestRun.decisionContext?.positions[decision.asset];
              return (
                <article className={`decision-card decision-card--${decision.action}`} key={decision.asset}>
                  <div className="decision-head"><strong>{decision.asset}/USDT</strong><span>{actionLabel(decision.action, lang, position?.status)}</span></div>
                  <div className="confidence"><div><span>{t.confidence}</span><b>{(decision.confidence * 100).toFixed(1)}%</b></div><div className="confidence-track"><i style={{ width: `${decision.confidence * 100}%` }} /></div></div>
                  <div className="probabilities">
                    {(["buy", "hold", "sell"] as TradeAction[]).map((action) => <span key={action}>{actionLabel(action, lang)} <b>{Math.round(decision.probabilities[action] * 100)}%</b></span>)}
                  </div>
                  {market && (
                    <div className="market-state-row">
                      <span><small>{t.regime}</small><b>{regimeLabel(market.regime, lang)}</b></span>
                      <span><small>{t.sentimentCycle}</small><b>{mamisLabel(market.mamis_phase, lang)}</b></span>
                      <span><small>{t.momentum}</small><b>{market.return_15m_pct.toFixed(2)}% / {market.return_24h_pct.toFixed(2)}%</b></span>
                      <span><small>{t.volatility}</small><b>{market.realized_volatility_24h_pct.toFixed(2)}%</b></span>
                    </div>
                  )}
                  {position && (
                    <div className="market-state-row">
                      <span><small>{t.positionState}</small><b>{position.status === "flat" ? t.flat : t.held}</b></span>
                      <span><small>{t.targetAllocation}</small><b>{(decision.currentAllocationPct ?? position.allocation_pct).toFixed(1)}% / {(decision.targetAllocationPct ?? position.allocation_pct).toFixed(1)}%</b></span>
                      <span><small>{t.averageEntry}</small><b>{position.average_entry_price === null ? t.unavailable : `${formatMoney(position.average_entry_price, lang)} USDT`}</b></span>
                      <span><small>24h Drawdown</small><b>{(latestRun.decisionContext?.portfolioRisk.current_drawdown_pct ?? 0).toFixed(2)}%</b></span>
                    </div>
                  )}
                  {decision.judgments && (
                    <div className="market-state-row">
                      <span><small>{t.direction}</small><b>{decision.judgments.direction.choice} · {Math.round(decision.judgments.direction.confidence * 100)}%</b></span>
                      <span><small>{t.setupQuality}</small><b>{decision.judgments.setup_quality.score.toFixed(1)} / 4</b></span>
                      <span><small>{t.selectedSetup}</small><b>{decision.selectedSetup ?? "—"}</b></span>
                      <span><small>{t.entryReadiness}</small><b>{decision.entryReadiness ?? "—"}</b></span>
                      <span><small>{t.expectedEdge}</small><b>{(decision.expectedNetEdgePct ?? 0).toFixed(3)}%</b></span>
                      <span><small>{t.riskBudget}</small><b>{(decision.grossRiskBudgetPct ?? 0).toFixed(1)}%</b></span>
                    </div>
                  )}
                  <p>{execution?.reason ?? "—"}</p>
                </article>
              );
            })}
          </div>
        ) : <div className="empty-state">{t.noDecision}</div>}
      </section>

      <section className="workflow-section">
        <div className="workflow-heading"><span className="section-kicker">PIPELINE</span><h2>{t.workflow}</h2><p>{t.workflowSub}</p></div>
        <div className="workflow-grid">
          {t.steps.map(([number, title, description]) => (
            <article key={number}><span>{number}</span><h3>{title}</h3><p>{description}</p></article>
          ))}
        </div>
      </section>

      <section className="panel section-panel orders-panel">
        <div className="panel-heading panel-heading--split">
          <div><span className="section-kicker">LEDGER</span><h2>{isAbTest ? t.accountOrders : t.orders}</h2><p>{isAbTest ? t.accountOrdersSub : t.ordersSub}</p></div>
          <div className="filters">
            <select value={symbolFilter} onChange={(event) => setSymbolFilter(event.target.value)}>
              <option value="ALL">{t.allSymbols}</option>
              <option value="BTCUSDT">BTC/USDT</option><option value="ETHUSDT">ETH/USDT</option><option value="XAUTUSDT">XAUT/USDT</option>
            </select>
            <select value={sideFilter} onChange={(event) => setSideFilter(event.target.value)}>
              <option value="ALL">{t.allSides}</option><option value="BUY">{t.buy}</option><option value="SELL">{t.sell}</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="ALL">{t.allStatuses}</option>{statuses.map((status) => <option value={status} key={status}>{status}</option>)}
            </select>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>{t.orderTime}</th><th>{t.executionTime}</th><th>{t.symbol}</th><th>{t.side}</th><th>{t.quantity}</th><th>{t.avgPrice}</th><th>{t.total}</th><th>{t.fee}</th><th>{t.status}</th></tr></thead>
            <tbody>
              {filteredOrders.length ? filteredOrders.map((order: OrderHistoryItem) => (
                <tr key={order.orderId}>
                  <td>{formatDate(fromMillis(order.createdTime), lang)}</td><td>{formatDate(fromMillis(order.executedTime), lang)}</td>
                  <td><b>{order.symbol.replace("USDT", "/USDT")}</b><small className="order-id">{order.orderId.slice(0, 10)}…</small></td>
                  <td><span className={`side-badge side-badge--${order.side.toLowerCase()}`}>{order.side === "Buy" ? t.buy : t.sell}</span></td>
                  <td>{formatMoney(Number(order.cumExecQty || order.qty), lang, 6)}</td><td>{formatMoney(Number(order.avgPrice || order.price), lang)}</td>
                  <td>{formatMoney(Number(order.cumExecValue), lang)}</td><td>{formatMoney(Number(order.fee), lang, 6)} {order.feeCurrency}</td>
                  <td><span className={`order-status ${order.isOpen ? "order-status--open" : ""}`}>{order.orderStatus}</span></td>
                </tr>
              )) : <tr><td className="empty-cell" colSpan={9}>{t.noOrders}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="disclosure"><div className="disclosure-icon">!</div><div><h2>{t.disclosureTitle}</h2><p>{t.disclosure}</p></div></section>
      <footer><a className="brand brand--small" href="#top"><span className="brand-mark"><i /><i /><i /></span><span><strong>JEV</strong> PULSE</span></a><p>{t.footer}</p><span>© {new Date().getFullYear()}</span></footer>
    </main>
  );
}
