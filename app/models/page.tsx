"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import type { Language } from "@/lib/types";
import type { EngineComparisonPoint, ModelsDashboardState } from "@/lib/strategy/experiment";

const text = {
  tr: {
    nav: "ANA DASHBOARD", eyebrow: "İLERİYE DÖNÜK PAPER A/B TESTİ", title: "Aynı piyasa, iki bağımsız karar motoru.",
    intro: "Seçilen iki motor aynı piyasa snapshot'ını görür; Jev kanıtları, sanal portföyleri ve emir kayıtları birbirinden ayrıdır. Kör motorlar varlık ve takvim kimliğini görmez.",
    refresh: "Yenile", refreshing: "Yenileniyor", safety: "A/B güvenlik kilidi aktif", safetyDetail: "TRADING_ENABLED açık olsa bile bu modda hiçbir emir Bybit'e iletilmez.",
    noExperiment: "Deney henüz başlamadı. STRATEGY_RUN_MODE=ab_test ile ilk cron turu deneyi oluşturur.", experiment: "Deney", started: "Başlangıç", target: "Planlanan asgari bitiş", progress: "Zaman ilerlemesi", ordersProgress: "Asgari emir örneği",
    equity: "Sanal sermaye karşılaştırması", equitySub: "Ücret, spread ve ters yönlü kayma sonrası mark-to-market USDT değeri", return: "Net getiri", drawdown: "Maks. düşüş", cash: "USDT oranı", orders: "Sanal emir", turnover: "İşlem hacmi", fees: "Ücret", latency: "Ort. Jev gecikmesi", tokens: "Jev token", failures: "Jev hatası", portfolio: "Sanal portföyler",
    decisions: "Son karar ayrışmaları", decisionSub: "Her motorun aynı çevrimde verdiği aksiyonlar", orderHistory: "Paper emir geçmişi", orderSub: "Borsaya iletilmeyen fakat sanal bakiyeye işlenen emirler", time: "Zaman", engine: "Motor", asset: "Varlık", action: "Aksiyon", targetWeight: "Hedef ağırlık", confidence: "Güven", side: "Yön", quantity: "Miktar", fill: "Sanal fiyat", value: "Tutar", routing: "İletim", all: "Tüm motorlar", empty: "Henüz kayıt yok.", loadError: "A/B raporu alınamadı.",
  },
  en: {
    nav: "MAIN DASHBOARD", eyebrow: "FORWARD PAPER A/B TEST", title: "The same market, two independent decision engines.",
    intro: "The selected engines receive the same market snapshot while their Jev evidence, paper portfolios and order ledgers remain isolated. Blind engines cannot see asset or calendar identity.",
    refresh: "Refresh", refreshing: "Refreshing", safety: "A/B safety lock active", safetyDetail: "No order can reach Bybit in this mode, even when TRADING_ENABLED is true.",
    noExperiment: "The experiment has not started. The first cron cycle with STRATEGY_RUN_MODE=ab_test creates it.", experiment: "Experiment", started: "Started", target: "Planned minimum end", progress: "Time progress", ordersProgress: "Minimum order sample",
    equity: "Paper equity comparison", equitySub: "Mark-to-market USDT value after fees, spread and adverse slippage", return: "Net return", drawdown: "Max drawdown", cash: "USDT share", orders: "Paper orders", turnover: "Turnover", fees: "Fees", latency: "Avg. Jev latency", tokens: "Jev tokens", failures: "Jev failures", portfolio: "Paper portfolios",
    decisions: "Recent decision divergence", decisionSub: "Actions produced by each engine at the same cycle", orderHistory: "Paper order history", orderSub: "Orders applied to paper balances but never routed to the exchange", time: "Time", engine: "Engine", asset: "Asset", action: "Action", targetWeight: "Target weight", confidence: "Confidence", side: "Side", quantity: "Quantity", fill: "Paper fill", value: "Value", routing: "Routing", all: "All engines", empty: "No records yet.", loadError: "The A/B report could not be loaded.",
  },
} as const;

const emptyState: ModelsDashboardState = { generatedAt: new Date(0).toISOString(), runMode: "loading", exchangeRoutingForcedOff: false, database: "not_configured", message: null, experiment: null, engines: [], equity: [], orders: [], runs: [] };
const engineColors = ["#8b5cf6", "#2dd4bf", "#f59e0b", "#38bdf8", "#f472b6"];

function money(value: number, lang: Language, decimals = 2) {
  return new Intl.NumberFormat(lang === "tr" ? "tr-TR" : "en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number.isFinite(value) ? value : 0);
}

function dateTime(value: string | null, lang: Language) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-US", { timeZone: lang === "tr" ? "Europe/Istanbul" : "UTC", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

function comparisonPath(points: EngineComparisonPoint[], engineId: string, width: number, height: number) {
  const enginePoints = points.filter((point) => point.engineId === engineId);
  if (!enginePoints.length) return "";
  const values = points.map((point) => point.totalEquityUsdt);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(maximum - minimum, Math.max(maximum * 0.002, 1));
  return enginePoints.map((point, index) => {
    const x = enginePoints.length === 1 ? width / 2 : index / (enginePoints.length - 1) * width;
    const y = height - ((point.totalEquityUsdt - minimum) / range) * (height - 18) - 9;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export default function ModelsPage() {
  const [lang, setLang] = useState<Language>("tr");
  const [data, setData] = useState<ModelsDashboardState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [engineFilter, setEngineFilter] = useState("all");
  const t = text[lang];
  const loadData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/models/state", { cache: "no-store" });
      const payload = await response.json() as ModelsDashboardState;
      if (!response.ok && response.status !== 503) throw new Error(payload.message ?? response.statusText);
      setData(payload);
    } catch (loadError) { console.error(loadError); setError(text[lang].loadError); } finally { setLoading(false); }
  }, [lang]);
  useEffect(() => { const stored = window.localStorage.getItem("jev-dashboard-language"); if (stored === "tr" || stored === "en") { const timer = window.setTimeout(() => setLang(stored), 0); return () => window.clearTimeout(timer); } }, []);
  useEffect(() => { document.documentElement.lang = lang; window.localStorage.setItem("jev-dashboard-language", lang); }, [lang]);
  useEffect(() => { const initial = window.setTimeout(() => void loadData(), 0); const refresh = window.setInterval(() => void loadData(), 60_000); return () => { window.clearTimeout(initial); window.clearInterval(refresh); }; }, [loadData]);

  const experiment = data.experiment;
  const timeProgress = experiment ? Math.max(0, Math.min(100, (new Date(data.generatedAt).getTime() - new Date(experiment.startedAt).getTime()) / Math.max(1, new Date(experiment.plannedEndAt).getTime() - new Date(experiment.startedAt).getTime()) * 100)) : 0;
  const engineMap = useMemo(() => new Map(data.engines.map((engine) => [engine.engineId, engine])), [data.engines]);
  const decisionRows = useMemo(() => data.runs.filter((run) => run.status === "completed" && (engineFilter === "all" || run.engineId === engineFilter)).flatMap((run) => run.decisions.map((decision) => ({ run, decision }))).slice(0, 60), [data.runs, engineFilter]);
  const filteredOrders = useMemo(() => data.orders.filter((order) => engineFilter === "all" || order.engineId === engineFilter), [data.orders, engineFilter]);

  return <main className="app-shell models-shell">
    <div className="ambient ambient--one" />
    <header className="topbar"><Link className="brand" href="/"><span className="brand-mark"><i /><i /><i /></span><span><strong>JEV</strong> PULSE</span></Link><div className="topbar-actions"><Link className="nav-link" href="/">{t.nav}</Link><div className="language-switch">{(["tr", "en"] as Language[]).map((language) => <button key={language} className={lang === language ? "active" : ""} onClick={() => setLang(language)}>{language.toUpperCase()}</button>)}</div><button className="refresh-button" onClick={() => void loadData()} disabled={loading}><span className={loading ? "refresh-icon spinning" : "refresh-icon"}>↻</span>{loading ? t.refreshing : t.refresh}</button></div></header>
    <section className="models-hero"><p className="eyebrow"><span />{t.eyebrow}</p><h1>{t.title}</h1><p>{t.intro}</p><div className={`safety-banner ${data.exchangeRoutingForcedOff ? "safety-banner--locked" : ""}`}><strong>{t.safety}</strong><span>{t.safetyDetail}</span><code>{data.runMode}</code></div></section>
    {error && <div className="alert alert--error">{error}</div>}{data.message && <div className="alert">{data.message}</div>}
    {!experiment ? <section className="panel section-panel empty-state">{t.noExperiment}</section> : <>
      <section className="panel section-panel experiment-strip"><div><small>{t.experiment}</small><strong>{experiment.experimentId}</strong></div><div><small>{t.started}</small><strong>{dateTime(experiment.startedAt, lang)}</strong></div><div><small>{t.target}</small><strong>{dateTime(experiment.plannedEndAt, lang)}</strong></div><div className="experiment-progress"><small>{t.progress}</small><strong>{timeProgress.toFixed(1)}%</strong><span><i style={{ width: `${timeProgress}%` }} /></span></div></section>
      <section className="engine-grid">{data.engines.map((engine, index) => { const cashShare = engine.totalEquityUsdt > 0 ? engine.cashUsdt / engine.totalEquityUsdt * 100 : 0; const orderProgress = Math.min(100, engine.filledOrders / experiment.minimumFilledOrdersPerEngine * 100); return <article className="panel engine-card" style={{ "--engine-color": engineColors[index % engineColors.length] } as CSSProperties} key={engine.engineId}><div className="engine-title"><div><span>{engine.engineId.toUpperCase()}</span><strong>{engine.engineVersion}</strong></div><b>{money(engine.totalEquityUsdt, lang)} USDT</b></div><div className="engine-metrics"><span><small>{t.return}</small><b className={engine.returnPct >= 0 ? "positive" : "negative"}>{engine.returnPct >= 0 ? "+" : ""}{engine.returnPct.toFixed(2)}%</b></span><span><small>{t.drawdown}</small><b>{engine.maxDrawdownPct.toFixed(2)}%</b></span><span><small>{t.cash}</small><b>{cashShare.toFixed(1)}%</b></span><span><small>{t.orders}</small><b>{engine.filledOrders}</b></span><span><small>ABSTENTION</small><b>{engine.abstentionRatePct.toFixed(1)}%</b></span><span><small>{t.turnover}</small><b>{money(engine.turnoverUsdt, lang)} USDT</b></span><span><small>{t.fees}</small><b>{money(engine.feesUsdt, lang, 4)} USDT</b></span><span><small>{t.latency}</small><b>{engine.averageLatencyMs === null ? "—" : `${Math.round(engine.averageLatencyMs)} ms`}</b></span><span><small>{t.tokens}</small><b>{engine.inputTokens + engine.outputTokens}</b></span><span><small>{t.failures}</small><b>{engine.jevFailures}</b></span></div><div className="sample-progress"><span><small>{t.ordersProgress}</small><b>{engine.filledOrders}/{experiment.minimumFilledOrdersPerEngine}</b></span><i><em style={{ width: `${orderProgress}%` }} /></i></div></article>; })}</section>
      <section className="panel section-panel"><div className="panel-heading"><div><span className="section-kicker">EQUITY</span><h2>{t.equity}</h2><p>{t.equitySub}</p></div><div className="chart-legend">{data.engines.map((engine, index) => <span key={engine.engineId}><i style={{ background: engineColors[index % engineColors.length] }} />{engine.engineId.toUpperCase()}</span>)}</div></div>{data.equity.length ? <div className="comparison-chart"><svg viewBox="0 0 1000 260" preserveAspectRatio="none"><line x1="0" x2="1000" y1="65" y2="65" className="chart-grid" /><line x1="0" x2="1000" y1="130" y2="130" className="chart-grid" /><line x1="0" x2="1000" y1="195" y2="195" className="chart-grid" />{data.engines.map((engine, index) => <path key={engine.engineId} d={comparisonPath(data.equity, engine.engineId, 1000, 260)} className="comparison-line" style={{ stroke: engineColors[index % engineColors.length] }} />)}</svg></div> : <div className="empty-state">{t.empty}</div>}</section>
      <section className="panel section-panel"><div className="panel-heading"><div><span className="section-kicker">PORTFOLIO</span><h2>{t.portfolio}</h2></div></div><div className="paper-portfolios">{data.engines.map((engine) => <div key={engine.engineId}><strong>{engine.engineId.toUpperCase()}</strong><div>{engineMap.get(engine.engineId)?.balances.map((balance) => <span key={balance.coin}><b>{balance.coin}</b><small>{money(balance.total, lang, balance.coin === "USDT" ? 2 : 6)}</small><em>{money(balance.usdtValue, lang)} USDT</em></span>)}</div></div>)}</div></section>
      <section className="panel section-panel orders-panel"><div className="panel-heading panel-heading--split"><div><span className="section-kicker">DECISIONS</span><h2>{t.decisions}</h2><p>{t.decisionSub}</p></div><div className="filters"><select value={engineFilter} onChange={(event) => setEngineFilter(event.target.value)}><option value="all">{t.all}</option>{data.engines.map((engine) => <option key={engine.engineId} value={engine.engineId}>{engine.engineId.toUpperCase()}</option>)}</select></div></div><div className="table-scroll"><table><thead><tr><th>{t.time}</th><th>{t.engine}</th><th>{t.asset}</th><th>{t.action}</th><th>{t.targetWeight}</th><th>{t.confidence}</th></tr></thead><tbody>{decisionRows.length ? decisionRows.map(({ run, decision }) => <tr key={`${run.engineId}-${run.cycleKey}-${decision.asset}`}><td>{dateTime(run.startedAt, lang)}</td><td><b>{run.engineId.toUpperCase()}</b></td><td>{decision.asset}/USDT</td><td><span className={`side-badge side-badge--${decision.action}`}>{decision.action.toUpperCase()}</span></td><td>{decision.targetAllocationPct.toFixed(2)}%</td><td>{Math.round(decision.confidence * 100)}%</td></tr>) : <tr><td className="empty-cell" colSpan={6}>{t.empty}</td></tr>}</tbody></table></div></section>
      <section className="panel section-panel orders-panel"><div className="panel-heading"><div><span className="section-kicker">PAPER ORDERS</span><h2>{t.orderHistory}</h2><p>{t.orderSub}</p></div></div><div className="table-scroll"><table><thead><tr><th>{t.time}</th><th>{t.engine}</th><th>{t.asset}</th><th>{t.side}</th><th>{t.quantity}</th><th>{t.fill}</th><th>{t.value}</th><th>{t.fees}</th><th>{t.routing}</th></tr></thead><tbody>{filteredOrders.length ? filteredOrders.map((order) => <tr key={order.orderId}><td>{dateTime(order.createdAt, lang)}</td><td><b>{order.engineId.toUpperCase()}</b><small className="order-id">{order.engineVersion}</small></td><td>{order.symbol}</td><td><span className={`side-badge side-badge--${order.side.toLowerCase()}`}>{order.side}</span></td><td>{money(order.quantity, lang, 7)}</td><td>{money(order.simulatedFillPrice, lang)}</td><td>{money(order.grossValueUsdt, lang)} USDT</td><td>{money(order.feeUsdt, lang, 4)} USDT</td><td><span className="order-status">{order.routingStatus}</span></td></tr>) : <tr><td className="empty-cell" colSpan={9}>{t.empty}</td></tr>}</tbody></table></div></section>
    </>}
    <footer><Link className="brand brand--small" href="/"><span className="brand-mark"><i /><i /><i /></span><span><strong>JEV</strong> PULSE</span></Link><p>{data.engines.map((engine) => engine.engineId.toUpperCase()).join(" × ")} • FORWARD PAPER OBSERVATION</p><span>{dateTime(data.generatedAt, lang)}</span></footer>
  </main>;
}
