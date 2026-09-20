"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DashboardState,
  DailyPortfolioPoint,
  Language,
  OrderHistoryItem,
  TradeAction,
} from "@/lib/types";

const copy = {
  tr: {
    eyebrow: "JEV SYSTEM ONE • OTONOM SPOT LAB",
    title: "Piyasa sinyallerini karara, kararı kontrollü aksiyona dönüştürür.",
    intro:
      "Canlı ana ağ verileri Jev tarafından değerlendirilir; doğrulanan kararlar yalnızca izole Bybit test hesabında uygulanır.",
    refresh: "Verileri yenile",
    refreshing: "Yenileniyor",
    liveMarket: "Canlı piyasa verisi",
    testExecution: "Test hesap yürütme",
    tradingOn: "Emir yürütme açık",
    tradingOff: "Gözlem modu",
    portfolio: "Toplam test portföyü",
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
    model: "Model",
    noDecision: "Henüz Jev kararı kaydedilmedi.",
    workflow: "Bot nasıl çalışıyor?",
    workflowSub: "Her 15 dakikada tekrarlanan, izlenebilir ve fail-closed karar hattı",
    steps: [
      ["01", "Hesabı oku", "USDT, BTC, ETH ve XAUT bakiyeleri ile açık emirler test hesabından alınır."],
      ["02", "Piyasayı ölç", "Ana ağ fiyatı, 15dk mumlar, order book ve mevcut türev sinyalleri toplanır."],
      ["03", "Jev ile değerlendir", "Jev her varlık için yalnızca al, sat veya bekle seçeneklerinden birini döndürür."],
      ["04", "Güvenle uygula", "Eşik, bakiye, açık emir, lot ve minimum tutar kontrolleri geçilirse emir iletilir."],
    ],
    orders: "Spot emir geçmişi",
    ordersSub: "Test hesap emirleri; kalıcı kayıtlar Bybit’in kısa saklama süresinden bağımsız tutulur.",
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
      "Bu proje Jev karar modelini gösteren bir yazılım örneğidir; yatırım tavsiyesi değildir. Kripto varlık işlemleri ciddi kayıp riski taşır. Test hesap sonuçları gerçek piyasa performansını garanti etmez. Gerçek hesapta kullanmadan önce bağımsız güvenlik, strateji, mevzuat ve risk incelemesi yapın. Geliştiriciler işlem kayıplarından sorumlu değildir.",
    footer: "Live intelligence • Typed decisions • Controlled execution",
    loadError: "Dashboard verileri alınamadı.",
  },
  en: {
    eyebrow: "JEV SYSTEM ONE • AUTONOMOUS SPOT LAB",
    title: "Turn market signals into decisions, and decisions into controlled action.",
    intro:
      "Live mainnet data is evaluated by Jev; validated decisions execute only inside an isolated Bybit test account.",
    refresh: "Refresh data",
    refreshing: "Refreshing",
    liveMarket: "Live market data",
    testExecution: "Test-account execution",
    tradingOn: "Order execution enabled",
    tradingOff: "Observation mode",
    portfolio: "Total test portfolio",
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
    model: "Model",
    noDecision: "No Jev decision has been recorded yet.",
    workflow: "How does the bot work?",
    workflowSub: "An observable, fail-closed decision pipeline repeated every 15 minutes",
    steps: [
      ["01", "Read the account", "USDT, BTC, ETH and XAUT balances plus open orders come from the test account."],
      ["02", "Measure the market", "Mainnet prices, 15m candles, order book and available derivative signals are collected."],
      ["03", "Evaluate with Jev", "Jev returns exactly one typed choice per asset: buy, sell or hold."],
      ["04", "Execute safely", "An order is sent only after confidence, balance, open-order, lot and notional checks pass."],
    ],
    orders: "Spot order history",
    ordersSub: "Test-account orders persisted independently of Bybit’s short retention window.",
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
      "This project is a software demonstration of the Jev decision model, not investment advice. Crypto trading involves substantial risk of loss. Test-account results do not guarantee real-market performance. Perform independent security, strategy, legal and risk reviews before any real-account use. The developers are not liable for trading losses.",
    footer: "Live intelligence • Typed decisions • Controlled execution",
    loadError: "Dashboard data could not be loaded.",
  },
} as const;

const initialState: DashboardState = {
  generatedAt: new Date(0).toISOString(),
  accountEnvironment: "testnet",
  marketSource: "bybit-mainnet",
  tradingEnabled: false,
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
    dateStyle: "medium",
    timeStyle: "short",
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

function actionLabel(action: TradeAction, lang: Language) {
  return copy[lang][action];
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
            <title>{`${point.date} • ${formatMoney(point.totalPortfolioUsdt, lang)} USDT`}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-axis">
        <span>{history[0].date}</span>
        {history.length > 2 && <span>{history[Math.floor(history.length / 2)].date}</span>}
        <span>{history.at(-1)!.date}</span>
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

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
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
          <p className="hero-intro">{t.intro}</p>
          <div className="signal-row">
            <span className="signal signal--live"><i />{t.liveMarket}</span>
            <span className="signal"><i />{data.accountEnvironment.toUpperCase()} • {t.testExecution}</span>
            <span className={data.tradingEnabled ? "signal signal--enabled" : "signal signal--muted"}>
              <i />{data.tradingEnabled ? t.tradingOn : t.tradingOff}
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
          <span>{t.portfolio}</span>
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
          <div className="data-route"><span>MARKET</span><i>→</i><b>JEV</b><i>→</i><span>{data.accountEnvironment.toUpperCase()}</span></div>
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
          <div><span className="section-kicker">SYSTEM ONE</span><h2>{t.intelligence}</h2><p>{t.intelligenceSub}</p></div>
          <span className="model-chip">{t.model}: {latestRun?.model ?? "jev-1.13.0"}</span>
        </div>
        {latestRun?.decisions.length ? (
          <div className="decision-grid">
            {latestRun.decisions.map((decision) => {
              const execution = latestRun.executions.find((item) => item.asset === decision.asset);
              return (
                <article className={`decision-card decision-card--${decision.action}`} key={decision.asset}>
                  <div className="decision-head"><strong>{decision.asset}/USDT</strong><span>{actionLabel(decision.action, lang)}</span></div>
                  <div className="confidence"><div><span>{t.confidence}</span><b>{(decision.confidence * 100).toFixed(1)}%</b></div><div className="confidence-track"><i style={{ width: `${decision.confidence * 100}%` }} /></div></div>
                  <div className="probabilities">
                    {(["buy", "hold", "sell"] as TradeAction[]).map((action) => <span key={action}>{actionLabel(action, lang)} <b>{Math.round(decision.probabilities[action] * 100)}%</b></span>)}
                  </div>
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
          <div><span className="section-kicker">LEDGER</span><h2>{t.orders}</h2><p>{t.ordersSub}</p></div>
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
