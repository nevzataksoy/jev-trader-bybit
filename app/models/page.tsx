"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { DetailBadge } from "@/app/components/detail-badge";
import type { Language } from "@/lib/types";
import type { EngineComparisonPoint, ModelsDashboardState } from "@/lib/strategy/experiment";

const text = {
  tr: {
    nav: "ANA DASHBOARD", eyebrow: "İLERİYE DÖNÜK PAPER A/B TESTİ", title: "Aynı piyasa, iki bağımsız karar motoru.",
    intro: "Seçilen iki motor aynı piyasa snapshot'ını görür; Jev kanıtları, sanal portföyleri ve emir kayıtları birbirinden ayrıdır. Kör motorlar varlık ve takvim kimliğini görmez.",
    refresh: "Yenile", refreshing: "Yenileniyor", safety: "A/B güvenlik kilidi aktif", safetyDetail: "TRADING_ENABLED açık olsa bile bu modda hiçbir emir Bybit'e iletilmez.",
    noExperiment: "Deney henüz başlamadı. STRATEGY_RUN_MODE=ab_test ile ilk cron turu deneyi oluşturur.", experiment: "Deney", started: "Başlangıç", target: "Planlanan asgari bitiş", progress: "Zaman ilerlemesi", ordersProgress: "Asgari emir örneği",
    equity: "Sanal sermaye karşılaştırması", equitySub: "Ücret, spread ve ters yönlü kayma sonrası mark-to-market USDT değeri", return: "Net getiri", drawdown: "Maks. düşüş", cash: "USDT oranı", orders: "Sanal emir", turnover: "İşlem hacmi", fees: "Ücret", latency: "Ort. Jev gecikmesi", tokens: "Jev token", failures: "Jev hatası", portfolio: "Sanal portföyler",
    decisions: "Son karar ayrışmaları", decisionSub: "Her motorun aynı çevrimde verdiği aksiyonlar ve kararı oluşturan temel kanıtlar", executionAttempts: "Execution denemeleri", executionAttemptsSub: "BUY/SELL kararlarının platform safety sonrası sonucu; skipped denemeler paper order oluşmadan burada görünür.", orderHistory: "Paper emir geçmişi", orderSub: "Borsaya iletilmeyen fakat sanal bakiyeye işlenen emirler", time: "Zaman", engine: "Motor", asset: "Varlık", action: "Aksiyon", targetWeight: "Hedef ağırlık", confidence: "Güven", side: "Yön", quantity: "Miktar", fill: "Sanal fiyat", value: "Tutar", routing: "İletim", all: "Tüm motorlar", empty: "Henüz kayıt yok.", loadError: "A/B raporu alınamadı.",
    signal: "Sinyal", revision: "Revizyon", status: "Durum", reason: "Neden", metrics: "Metrikler", setupReadiness: "Kurulum / hazırlık", allocation: "Tahsis", edgeRisk: "Avantaj / risk", evidence: "Kanıt özeti", blockers: "Engelleyen filtreler", diagnostics: "Tanısal sinyaller", rationale: "Politika gerekçesi", details: "Ayrıntılar", runtime: "Runtime", executionEngine: "Exchange motoru", availableEngines: "Kayıtlı motorlar", cycle: "Çevrim", completed: "Tamamlandı", model: "Jev modeli", current: "Mevcut", targetLabel: "Hedef", delta: "Fark", expectedEdge: "Net avantaj", opportunity: "Fırsat", riskBudget: "Portföy risk bütçesi", readinessScore: "Hazırlık puanı", signalState: "Sinyal durumu", regime: "Rejim", direction: "Yön", quality: "Kalite", liquidity: "Likidite", disorder: "Düzensizlik", falseBreakout: "Sahte kırılım", rowsPerPage: "Sayfa başına", previous: "Önceki", next: "Sonraki", page: "Sayfa", records: "kayıt",
  },
  en: {
    nav: "MAIN DASHBOARD", eyebrow: "FORWARD PAPER A/B TEST", title: "The same market, two independent decision engines.",
    intro: "The selected engines receive the same market snapshot while their Jev evidence, paper portfolios and order ledgers remain isolated. Blind engines cannot see asset or calendar identity.",
    refresh: "Refresh", refreshing: "Refreshing", safety: "A/B safety lock active", safetyDetail: "No order can reach Bybit in this mode, even when TRADING_ENABLED is true.",
    noExperiment: "The experiment has not started. The first cron cycle with STRATEGY_RUN_MODE=ab_test creates it.", experiment: "Experiment", started: "Started", target: "Planned minimum end", progress: "Time progress", ordersProgress: "Minimum order sample",
    equity: "Paper equity comparison", equitySub: "Mark-to-market USDT value after fees, spread and adverse slippage", return: "Net return", drawdown: "Max drawdown", cash: "USDT share", orders: "Paper orders", turnover: "Turnover", fees: "Fees", latency: "Avg. Jev latency", tokens: "Jev tokens", failures: "Jev failures", portfolio: "Paper portfolios",
    decisions: "Recent decision divergence", decisionSub: "Actions from each engine and the core evidence behind every decision", executionAttempts: "Execution attempts", executionAttemptsSub: "Platform-safety outcome for BUY/SELL decisions; skipped attempts remain visible even when no paper order is created.", orderHistory: "Paper order history", orderSub: "Orders applied to paper balances but never routed to the exchange", time: "Time", engine: "Engine", asset: "Asset", action: "Action", targetWeight: "Target weight", confidence: "Confidence", side: "Side", quantity: "Quantity", fill: "Paper fill", value: "Value", routing: "Routing", all: "All engines", empty: "No records yet.", loadError: "The A/B report could not be loaded.",
    signal: "Signal", revision: "Revision", status: "Status", reason: "Reason", metrics: "Metrics", setupReadiness: "Setup / readiness", allocation: "Allocation", edgeRisk: "Edge / risk", evidence: "Evidence summary", blockers: "Blocking filters", diagnostics: "Diagnostics", rationale: "Policy rationale", details: "Details", runtime: "Runtime", executionEngine: "Exchange engine", availableEngines: "Registered engines", cycle: "Cycle", completed: "Completed", model: "Jev model", current: "Current", targetLabel: "Target", delta: "Delta", expectedEdge: "Net edge", opportunity: "Opportunity", riskBudget: "Portfolio risk budget", readinessScore: "Readiness score", signalState: "Signal state", regime: "Regime", direction: "Direction", quality: "Quality", liquidity: "Liquidity", disorder: "Disorder", falseBreakout: "False breakout", rowsPerPage: "Rows per page", previous: "Previous", next: "Next", page: "Page", records: "records",
  },
} as const;

const emptyState: ModelsDashboardState = { generatedAt: new Date(0).toISOString(), runMode: "loading", activeEngines: [], availableEngines: [], exchangeExecutionEngine: "none", exchangeRoutingForcedOff: false, database: "not_configured", message: null, experiment: null, engines: [], equity: [], orders: [], runs: [] };
const engineColors = ["#8b5cf6", "#2dd4bf", "#f59e0b", "#38bdf8", "#f472b6"];

function money(value: number, lang: Language, decimals = 2) {
  return new Intl.NumberFormat(lang === "tr" ? "tr-TR" : "en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number.isFinite(value) ? value : 0);
}

function dateTime(value: string | null, lang: Language) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-US", { timeZone: lang === "tr" ? "Europe/Istanbul" : "UTC", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

const decisionValueLabels: Record<Language, Record<string, string>> = {
  tr: {
    buy: "Al", sell: "Sat", hold: "Bekle", uptrend: "Yükseliş", downtrend: "Düşüş", range: "Yatay", compression: "Sıkışma", transition: "Geçiş",
    up: "Yukarı", down: "Aşağı", unclear: "Belirsiz", trend_pullback: "Trend geri çekilmesi", upside_breakout: "Yukarı kırılım", range_reversion: "Bant dönüşü", bear_rebound: "Düşüş tepki yükselişi", reduce: "Azalt", none: "Kurulum yok",
    enter_now: "Şimdi gir", wait_close: "Kapanışı bekle", wait_retest: "Yeniden testi bekle", no_entry: "Giriş yok",
    pending: "Bekliyor", confirmed: "Doğrulandı", expired: "Süresi doldu", invalidated: "Geçersiz", JEV_NO_ENTRY: "Jev: giriş yok", PENDING_CLOSE: "Kapanış bekleniyor", PENDING_RETEST: "Yeniden test bekleniyor", STRUCTURE_REJECTED: "Yapı reddedildi", DIRECTIONAL_EDGE_LOW: "Yön avantajı düşük", SETUP_QUALITY_LOW: "Kurulum kalitesi düşük", NET_EDGE_LOW: "Net avantaj düşük", LIQUIDITY_LOW: "Likidite düşük", DISORDERLY_MARKET: "Düzensiz piyasa", THESIS_INVALIDATED: "Long tezi geçersiz", RISK_BUDGET_ZERO: "Risk bütçesi sıfır", ALLOCATION_DEADBAND: "Tahsis farkı eşik altında", NO_ALLOCATION_INTENT: "Tahsis niyeti yok", TARGET_ROOM_LOW: "Hedef alanı maliyet sonrası yetersiz", resistance: "Direnç", atr_projection: "ATR projeksiyonu",
  },
  en: {
    buy: "Buy", sell: "Sell", hold: "Hold", uptrend: "Uptrend", downtrend: "Downtrend", range: "Range", compression: "Compression", transition: "Transition",
    up: "Up", down: "Down", unclear: "Unclear", trend_pullback: "Trend pullback", upside_breakout: "Upside breakout", range_reversion: "Range reversion", bear_rebound: "Bear rebound", reduce: "Reduce", none: "No setup",
    enter_now: "Enter now", wait_close: "Wait for close", wait_retest: "Wait for retest", no_entry: "No entry",
    pending: "Pending", confirmed: "Confirmed", expired: "Expired", invalidated: "Invalidated", JEV_NO_ENTRY: "Jev: no entry", PENDING_CLOSE: "Waiting for close", PENDING_RETEST: "Waiting for retest", STRUCTURE_REJECTED: "Structure rejected", DIRECTIONAL_EDGE_LOW: "Directional edge low", SETUP_QUALITY_LOW: "Setup quality low", NET_EDGE_LOW: "Net edge low", LIQUIDITY_LOW: "Liquidity low", DISORDERLY_MARKET: "Disorderly market", THESIS_INVALIDATED: "Long thesis invalidated", RISK_BUDGET_ZERO: "Risk budget zero", ALLOCATION_DEADBAND: "Allocation delta below threshold", NO_ALLOCATION_INTENT: "No allocation intent", TARGET_ROOM_LOW: "Target room too small after costs", resistance: "Resistance", atr_projection: "ATR projection",
  },
};

function decisionValue(value: string, lang: Language) {
  return decisionValueLabels[lang][value] ?? value.replaceAll("_", " ");
}

function percentage(value: number, digits = 1) {
  return `${(Number.isFinite(value) ? value : 0).toFixed(digits)}%`;
}

function probability(value: number) {
  return `${Math.round((Number.isFinite(value) ? value : 0) * 100)}%`;
}

function paginationPages(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current - 1, current, current + 1].filter((page) => page >= 1 && page <= total));
  const ordered = [...pages].sort((left, right) => left - right);
  return ordered.flatMap((page, index) => index > 0 && page - ordered[index - 1] > 1 ? ["ellipsis" as const, page] : [page]);
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
  const [decisionPage, setDecisionPage] = useState(1);
  const [decisionPageSize, setDecisionPageSize] = useState(15);
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
  const decisionRows = useMemo(() => data.runs.filter((run) => run.status === "completed" && (engineFilter === "all" || run.engineId === engineFilter)).flatMap((run) => run.decisions.map((decision) => ({ run, decision }))), [data.runs, engineFilter]);
  const decisionPageCount = Math.max(1, Math.ceil(decisionRows.length / decisionPageSize));
  const safeDecisionPage = Math.min(decisionPage, decisionPageCount);
  const paginatedDecisionRows = useMemo(() => decisionRows.slice((safeDecisionPage - 1) * decisionPageSize, safeDecisionPage * decisionPageSize), [decisionRows, decisionPageSize, safeDecisionPage]);
  const decisionRangeStart = decisionRows.length ? (safeDecisionPage - 1) * decisionPageSize + 1 : 0;
  const decisionRangeEnd = Math.min(safeDecisionPage * decisionPageSize, decisionRows.length);
  const filteredOrders = useMemo(() => data.orders.filter((order) => engineFilter === "all" || order.engineId === engineFilter), [data.orders, engineFilter]);
  const executionAttempts = useMemo(() => data.runs
    .filter((run) => run.status === "completed" && (engineFilter === "all" || run.engineId === engineFilter))
    .flatMap((run) => run.executions
      .filter((execution) => execution.action === "buy" || execution.action === "sell")
      .map((execution) => ({ run, execution })))
    .slice(0, 200), [data.runs, engineFilter]);

  return <main className="app-shell models-shell">
    <div className="ambient ambient--one" />
    <header className="topbar"><Link className="brand" href="/"><span className="brand-mark"><i /><i /><i /></span><span><strong>JEV</strong> PULSE</span></Link><div className="topbar-actions"><Link className="nav-link" href="/">{t.nav}</Link><div className="language-switch">{(["tr", "en"] as Language[]).map((language) => <button key={language} className={lang === language ? "active" : ""} onClick={() => setLang(language)}>{language.toUpperCase()}</button>)}</div><button className="refresh-button" onClick={() => void loadData()} disabled={loading}><span className={loading ? "refresh-icon spinning" : "refresh-icon"}>↻</span>{loading ? t.refreshing : t.refresh}</button></div></header>
    <section className="models-hero"><p className="eyebrow"><span />{t.eyebrow}</p><h1>{t.title}</h1><p>{t.intro}</p><div className={`safety-banner ${data.exchangeRoutingForcedOff ? "safety-banner--locked" : ""}`}><strong>{t.safety}</strong><span>{t.safetyDetail}</span><code>{data.runMode}</code><DetailBadge label={t.runtime} tone="success"><div className="detail-list"><span><small>{t.engine}</small><b>{data.activeEngines.join(" × ") || "—"}</b></span><span><small>{t.executionEngine}</small><b>{data.exchangeExecutionEngine}</b></span><span><small>{t.availableEngines}</small><b>{data.availableEngines.join(", ") || "—"}</b></span></div></DetailBadge></div></section>
    {error && <div className="alert alert--error">{error}</div>}{data.message && <div className="alert">{data.message}</div>}
    {!experiment ? <section className="panel section-panel empty-state">{t.noExperiment}</section> : <>
      <section className="panel section-panel experiment-strip"><div><small>{t.experiment}</small><strong>{experiment.experimentId}</strong></div><div><small>{t.started}</small><strong>{dateTime(experiment.startedAt, lang)}</strong></div><div><small>{t.target}</small><strong>{dateTime(experiment.plannedEndAt, lang)}</strong></div><div className="experiment-progress"><small>{t.progress}</small><strong>{timeProgress.toFixed(1)}%</strong><span><i style={{ width: `${timeProgress}%` }} /></span></div></section>
      <section className="engine-grid">{data.engines.map((engine, index) => { const cashShare = engine.totalEquityUsdt > 0 ? engine.cashUsdt / engine.totalEquityUsdt * 100 : 0; const orderProgress = Math.min(100, engine.filledOrders / experiment.minimumFilledOrdersPerEngine * 100); return <article className="panel engine-card" style={{ "--engine-color": engineColors[index % engineColors.length] } as CSSProperties} key={engine.engineId}><div className="engine-title"><div><span>{engine.engineId.toUpperCase()}</span><strong>{engine.engineVersion}</strong><small>{t.revision}: {engine.currentPolicyRevision ?? "legacy"} · {engine.currentConfigRevision ?? "legacy"}</small></div><b>{money(engine.totalEquityUsdt, lang)} USDT</b></div><div className="engine-metrics"><span><small>{t.return}</small><b className={engine.returnPct >= 0 ? "positive" : "negative"}>{engine.returnPct >= 0 ? "+" : ""}{engine.returnPct.toFixed(2)}%</b></span><span><small>{t.drawdown}</small><b>{engine.maxDrawdownPct.toFixed(2)}%</b></span><span><small>{t.cash}</small><b>{cashShare.toFixed(1)}%</b></span><span><small>{t.orders}</small><b>{engine.filledOrders}</b></span><span><small>ABSTENTION</small><b>{engine.abstentionRatePct.toFixed(1)}%</b></span><span><small>{t.turnover}</small><b>{money(engine.turnoverUsdt, lang)} USDT</b></span><span><small>{t.fees}</small><b>{money(engine.feesUsdt, lang, 4)} USDT</b></span><span><small>{t.latency}</small><b>{engine.averageLatencyMs === null ? "—" : `${Math.round(engine.averageLatencyMs)} ms`}</b></span><span><small>{t.tokens}</small><b>{engine.inputTokens + engine.outputTokens}</b></span><span><small>{t.failures}</small><b>{engine.jevFailures}</b></span></div><div className="sample-progress"><span><small>{t.ordersProgress}</small><b>{engine.filledOrders}/{experiment.minimumFilledOrdersPerEngine}</b></span><i><em style={{ width: `${orderProgress}%` }} /></i></div></article>; })}</section>
      <section className="panel section-panel"><div className="panel-heading"><div><span className="section-kicker">EQUITY</span><h2>{t.equity}</h2><p>{t.equitySub}</p></div><div className="chart-legend">{data.engines.map((engine, index) => <span key={engine.engineId}><i style={{ background: engineColors[index % engineColors.length] }} />{engine.engineId.toUpperCase()}</span>)}</div></div>{data.equity.length ? <div className="comparison-chart"><svg viewBox="0 0 1000 260" preserveAspectRatio="none"><line x1="0" x2="1000" y1="65" y2="65" className="chart-grid" /><line x1="0" x2="1000" y1="130" y2="130" className="chart-grid" /><line x1="0" x2="1000" y1="195" y2="195" className="chart-grid" />{data.engines.map((engine, index) => <path key={engine.engineId} d={comparisonPath(data.equity, engine.engineId, 1000, 260)} className="comparison-line" style={{ stroke: engineColors[index % engineColors.length] }} />)}</svg></div> : <div className="empty-state">{t.empty}</div>}</section>
      <section className="panel section-panel"><div className="panel-heading"><div><span className="section-kicker">PORTFOLIO</span><h2>{t.portfolio}</h2></div></div><div className="paper-portfolios">{data.engines.map((engine) => <div key={engine.engineId}><strong>{engine.engineId.toUpperCase()}</strong><div>{engineMap.get(engine.engineId)?.balances.map((balance) => <span key={balance.coin}><b>{balance.coin}</b><small>{money(balance.total, lang, balance.coin === "USDT" ? 2 : 6)}</small><em>{money(balance.usdtValue, lang)} USDT</em></span>)}</div></div>)}</div></section>
      <section className="panel section-panel orders-panel decisions-panel">
        <div className="panel-heading panel-heading--split">
          <div><span className="section-kicker">DECISIONS</span><h2>{t.decisions}</h2><p>{t.decisionSub}</p></div>
          <div className="filters">
            <select aria-label={t.engine} value={engineFilter} onChange={(event) => { setEngineFilter(event.target.value); setDecisionPage(1); }}>
              <option value="all">{t.all}</option>
              {data.engines.map((engine) => <option key={engine.engineId} value={engine.engineId}>{engine.engineId.toUpperCase()}</option>)}
            </select>
          </div>
        </div>
        <div className="table-scroll decisions-scroll">
          <table className="decisions-table">
            <thead><tr><th>{t.time}</th><th>{t.engine}</th><th>{t.signal}</th><th>{t.setupReadiness}</th><th>{t.allocation}</th><th>{t.edgeRisk}</th><th>{t.details}</th></tr></thead>
            <tbody>{paginatedDecisionRows.length ? paginatedDecisionRows.map(({ run, decision }) => <tr key={`${run.engineId}-${run.cycleKey}-${decision.asset}`}>
              <td className="decision-time" data-label={t.time}><strong>{dateTime(run.cycleKey, lang)}</strong><small>{t.completed}: {dateTime(run.completedAt, lang)}</small></td>
              <td className="decision-engine" data-label={t.engine}><b>{run.engineId.toUpperCase()}</b><small>{run.engineVersion} · {t.revision}: {run.policyRevision ?? "legacy"}</small><small>{t.model}: {run.jevModel ?? "—"}{run.latencyMs === null ? "" : ` · ${run.latencyMs} ms`}</small></td>
              <td className="decision-signal" data-label={t.signal}><div><strong>{decision.asset}/USDT</strong><span className={`side-badge side-badge--${decision.action}`}>{decisionValue(decision.action, lang).toUpperCase()}</span></div><small>{t.confidence}: <b>{probability(decision.confidence)}</b></small><div className="decision-probabilities"><span className="positive">{decisionValue("buy", lang).toUpperCase()} {probability(decision.probabilities.buy)}</span><span>{decisionValue("hold", lang).toUpperCase()} {probability(decision.probabilities.hold)}</span><span className="negative">{decisionValue("sell", lang).toUpperCase()} {probability(decision.probabilities.sell)}</span></div></td>
              <td className="decision-setup" data-label={t.setupReadiness}><strong>{decisionValue(decision.selectedSetup, lang)}</strong><span>{decisionValue(decision.entryReadiness, lang)}</span><small>{t.quality}: {decision.judgments.setup_quality.score.toFixed(2)}/4 · {t.confidence} {probability(decision.judgments.setup_quality.confidence)}</small>{decision.readinessScore !== undefined && <small>{t.readinessScore}: {probability(decision.readinessScore)}</small>}{decision.signalState && <small>{t.signalState}: {decisionValue(decision.signalState, lang)}</small>}</td>
              <td className="decision-allocation" data-label={t.allocation}><span><small>{t.current}</small><b>{percentage(decision.currentAllocationPct, 2)}</b></span><i>→</i><span><small>{t.targetLabel}</small><b>{percentage(decision.targetAllocationPct, 2)}</b></span><em className={decision.rebalanceDeltaPct > 0 ? "positive" : decision.rebalanceDeltaPct < 0 ? "negative" : ""}>{t.delta}: {decision.rebalanceDeltaPct > 0 ? "+" : ""}{percentage(decision.rebalanceDeltaPct, 2)}</em></td>
              <td className="decision-edge" data-label={t.edgeRisk}><span><small>{t.expectedEdge}</small><b className={decision.expectedNetEdgePct > 0 ? "positive" : decision.expectedNetEdgePct < 0 ? "negative" : ""}>{decision.expectedNetEdgePct > 0 ? "+" : ""}{percentage(decision.expectedNetEdgePct, 3)}</b></span><span><small>GROSS / COST</small><b>{percentage(decision.grossExpectedEdgePct ?? 0, 3)} / {percentage(decision.roundTripCostPct ?? 0, 3)}</b></span><span><small>TARGET / REWARD / INVALID.</small><b>{percentage(decision.targetDistancePct ?? 0, 3)} / {percentage(decision.rewardDistancePct ?? decision.targetDistancePct ?? 0, 3)} / {percentage(decision.invalidationDistancePct ?? 0, 3)}</b><small>{decision.rewardSource ? decisionValue(decision.rewardSource, lang) : "legacy"}</small></span><span><small>R:R</small><b>{(decision.rewardRiskRatio ?? 0).toFixed(2)}</b></span><span><small>{t.opportunity}</small><b>{decision.opportunityScore.toFixed(2)}</b></span><span><small>{t.riskBudget}</small><b>{percentage(decision.grossRiskBudgetPct, 2)}</b></span></td>
              <td className="decision-details" data-label={t.details}>
                <DetailBadge label={t.evidence} tone="info"><div className="decision-evidence"><span><small>{t.regime}</small><b>{decisionValue(decision.judgments.regime.choice, lang)} · {probability(decision.judgments.regime.confidence)}</b></span><span><small>{t.direction}</small><b>{decisionValue(decision.judgments.direction.choice, lang)} · {probability(decision.judgments.direction.confidence)}</b></span><span><small>{t.liquidity}</small><b>{probability(decision.judgments.liquidity_ok)}</b></span><span><small>{t.disorder}</small><b>{probability(decision.judgments.disorderly)}</b></span><span><small>{t.falseBreakout}</small><b>{probability(decision.judgments.false_breakout)}</b></span></div></DetailBadge>
                <DetailBadge label={`${t.blockers} · ${decision.blockedBy?.length ?? 0}`} tone={decision.blockedBy?.length ? "warning" : "success"}><div className="decision-blockers">{decision.blockedBy?.length ? decision.blockedBy.map((blocker) => <span key={blocker}>{decisionValue(blocker, lang)}</span>) : <span className="decision-clear">CLEAR</span>}</div></DetailBadge>
                <DetailBadge label={`${t.diagnostics} · ${decision.diagnostics?.length ?? 0}`} tone="info"><div className="decision-blockers">{decision.diagnostics?.length ? decision.diagnostics.map((item) => <span key={item}>{decisionValue(item, lang)}</span>) : <span className="decision-clear">CLEAR</span>}</div></DetailBadge>
                <DetailBadge label={t.rationale}><p className="decision-rationale">{decision.policyReason}</p></DetailBadge>
              </td>
            </tr>) : <tr><td className="empty-cell" colSpan={7}>{t.empty}</td></tr>}</tbody>
          </table>
        </div>
        <div className="decision-pagination">
          <span>{decisionRangeStart}–{decisionRangeEnd} / {decisionRows.length} {t.records}</span>
          <div className="pagination-buttons">
            <button type="button" onClick={() => setDecisionPage(Math.max(1, safeDecisionPage - 1))} disabled={safeDecisionPage === 1}>{t.previous}</button>
            {paginationPages(safeDecisionPage, decisionPageCount).map((item, index) => item === "ellipsis" ? <span key={`ellipsis-${index}`}>…</span> : <button type="button" key={item} className={item === safeDecisionPage ? "active" : ""} aria-current={item === safeDecisionPage ? "page" : undefined} onClick={() => setDecisionPage(item)}>{item}</button>)}
            <button type="button" onClick={() => setDecisionPage(Math.min(decisionPageCount, safeDecisionPage + 1))} disabled={safeDecisionPage === decisionPageCount}>{t.next}</button>
          </div>
          <label><span>{t.rowsPerPage}</span><select value={decisionPageSize} onChange={(event) => { setDecisionPageSize(Number(event.target.value)); setDecisionPage(1); }}>{[15, 30, 60].map((size) => <option value={size} key={size}>{size}</option>)}</select></label>
        </div>
      </section>
      <section className="panel section-panel orders-panel"><div className="panel-heading"><div><span className="section-kicker">EXECUTION ATTEMPTS</span><h2>{t.executionAttempts}</h2><p>{t.executionAttemptsSub}</p></div></div><div className="table-scroll"><table><thead><tr><th>{t.time}</th><th>{t.engine}</th><th>{t.asset}</th><th>{t.action}</th><th>{t.status}</th><th>{t.reason}</th><th>{t.metrics}</th></tr></thead><tbody>{executionAttempts.length ? executionAttempts.map(({ run, execution }, index) => <tr key={`${run.engineId}-${run.cycleKey}-${execution.asset}-${index}`}><td>{dateTime(run.cycleKey, lang)}</td><td><b>{run.engineId.toUpperCase()}</b><small className="order-id">{run.policyRevision ?? "legacy"}</small></td><td>{execution.asset}/USDT</td><td><span className={`side-badge side-badge--${execution.action}`}>{decisionValue(execution.action, lang).toUpperCase()}</span></td><td><span className="order-status">{execution.status}</span></td><td>{execution.reason}</td><td><small>ATR {percentage(execution.riskMetrics?.atrPct ?? 0, 3)} · COST {percentage(execution.riskMetrics?.roundTripCostPct ?? 0, 3)} · RATIO {(execution.riskMetrics?.atrToCostRatio ?? 0).toFixed(2)} · TARGET {percentage(execution.riskMetrics?.targetDistancePct ?? 0, 3)} · EDGE {percentage(execution.riskMetrics?.expectedNetEdgePct ?? 0, 3)}</small></td></tr>) : <tr><td className="empty-cell" colSpan={7}>{t.empty}</td></tr>}</tbody></table></div></section>
      <section className="panel section-panel orders-panel"><div className="panel-heading"><div><span className="section-kicker">PAPER ORDERS</span><h2>{t.orderHistory}</h2><p>{t.orderSub}</p></div></div><div className="table-scroll"><table><thead><tr><th>{t.time}</th><th>{t.engine}</th><th>{t.asset}</th><th>{t.side}</th><th>{t.quantity}</th><th>{t.fill}</th><th>{t.value}</th><th>{t.fees}</th><th>{t.routing}</th></tr></thead><tbody>{filteredOrders.length ? filteredOrders.map((order) => <tr key={order.orderId}><td>{dateTime(order.createdAt, lang)}</td><td><b>{order.engineId.toUpperCase()}</b><small className="order-id">{order.engineVersion}</small></td><td>{order.symbol}</td><td><span className={`side-badge side-badge--${order.side.toLowerCase()}`}>{order.side}</span></td><td>{money(order.quantity, lang, 7)}</td><td>{money(order.simulatedFillPrice, lang)}</td><td>{money(order.grossValueUsdt, lang)} USDT</td><td>{money(order.feeUsdt, lang, 4)} USDT</td><td><span className="order-status">{order.routingStatus}</span></td></tr>) : <tr><td className="empty-cell" colSpan={9}>{t.empty}</td></tr>}</tbody></table></div></section>
    </>}
    <footer><Link className="brand brand--small" href="/"><span className="brand-mark"><i /><i /><i /></span><span><strong>JEV</strong> PULSE</span></Link><p>{data.engines.map((engine) => engine.engineId.toUpperCase()).join(" × ")} • FORWARD PAPER OBSERVATION</p><span>{dateTime(data.generatedAt, lang)}</span></footer>
  </main>;
}
