import type {
  MacroSeriesId,
  MacroSeriesObservation,
  MacroState,
} from "../types";

const SERIES: MacroSeriesId[] = ["DGS1", "DGS2", "DGS10", "DFII10", "T10YIE"];

export type FredRow = { date: string } & Partial<Record<MacroSeriesId, number>>;

function round(value: number, digits = 3) {
  return Number(value.toFixed(digits));
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

export function parseFredCsv(csv: string): FredRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("FRED response contains no observations.");
  const headers = lines[0].split(",").map((value) => value.trim());
  const dateIndex = headers.findIndex((value) => value === "DATE" || value === "observation_date");
  if (dateIndex < 0) throw new Error("FRED response has no date column.");
  const indexes = Object.fromEntries(SERIES.map((series) => [series, headers.indexOf(series)])) as Record<MacroSeriesId, number>;
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((value) => value.trim());
    const row: FredRow = { date: values[dateIndex] };
    for (const series of SERIES) {
      const raw = values[indexes[series]];
      const parsed = Number(raw);
      if (indexes[series] >= 0 && raw !== "" && raw !== "." && Number.isFinite(parsed)) row[series] = parsed;
    }
    return row;
  }).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
}

function observationFor(rows: FredRow[], series: MacroSeriesId): MacroSeriesObservation | null {
  const observations = rows
    .filter((row) => Number.isFinite(row[series]))
    .map((row) => ({ date: row.date, value: row[series]! }));
  if (!observations.length) return null;
  const latest = observations.at(-1)!;
  const previous = observations.at(-2);
  const previousFive = observations.at(-6);
  const window = observations.slice(-62);
  const changes = window.slice(1).map((item, index) => (item.value - window[index].value) * 100);
  const latestChange = previous ? (latest.value - previous.value) * 100 : null;
  const history = changes.slice(0, -1);
  const deviation = standardDeviation(history);
  const mean = history.length ? history.reduce((sum, value) => sum + value, 0) / history.length : 0;
  return {
    value_pct: round(latest.value),
    observed_at: new Date(`${latest.date}T00:00:00.000Z`).toISOString(),
    change_1d_bps: latestChange === null ? null : round(latestChange, 2),
    change_5d_bps: previousFive ? round((latest.value - previousFive.value) * 100, 2) : null,
    change_zscore_60d: latestChange === null || history.length < 10 || deviation === 0
      ? null
      : round((latestChange - mean) / deviation, 3),
  };
}

function businessDayAge(observedAt: string, now: Date) {
  const cursor = new Date(observedAt);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let days = 0;
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function describeChange(label: string, observation: MacroSeriesObservation | null) {
  if (!observation || observation.change_5d_bps === null) return `${label} unavailable`;
  if (observation.change_5d_bps >= 15) return `${label} rising sharply over the last five observations`;
  if (observation.change_5d_bps >= 5) return `${label} rising moderately over the last five observations`;
  if (observation.change_5d_bps <= -15) return `${label} falling sharply over the last five observations`;
  if (observation.change_5d_bps <= -5) return `${label} falling moderately over the last five observations`;
  return `${label} broadly stable over the last five observations`;
}

export function buildMacroState(rows: FredRow[], collectedAt = new Date()): MacroState {
  const series = Object.fromEntries(SERIES.map((id) => [id, observationFor(rows, id)])) as MacroState["series"];
  const available = SERIES.filter((id) => series[id] !== null);
  const observedTimes = available.map((id) => new Date(series[id]!.observed_at).getTime());
  const sourceObservedAt = observedTimes.length ? new Date(Math.max(...observedTimes)).toISOString() : null;
  const dgs1 = series.DGS1;
  const dgs2 = series.DGS2;
  const dgs10 = series.DGS10;
  const real10 = series.DFII10;
  const breakeven = series.T10YIE;
  const slope10y2y = dgs10 && dgs2 ? round((dgs10.value_pct - dgs2.value_pct) * 100, 2) : null;
  const slope2y1y = dgs2 && dgs1 ? round((dgs2.value_pct - dgs1.value_pct) * 100, 2) : null;
  const twoYearShock = dgs2?.change_zscore_60d ?? 0;
  const twoYearFiveDay = dgs2?.change_5d_bps ?? 0;
  const policyRegime: MacroState["policy_regime"] = !dgs2
    ? "unknown"
    : twoYearShock >= 2 || (dgs2.change_1d_bps ?? 0) >= 12
      ? "tightening_shock"
      : twoYearShock <= -2 || (dgs2.change_1d_bps ?? 0) <= -12
        ? "easing_shock"
        : twoYearFiveDay >= 8
          ? "tightening"
          : twoYearFiveDay <= -8
            ? "easing"
            : "stable";
  const realYieldRegime: MacroState["gold_real_yield_regime"] = !real10
    ? "unknown"
    : (real10.change_5d_bps ?? 0) <= -8
      ? "supportive"
      : (real10.change_5d_bps ?? 0) >= 8
        ? "restrictive"
        : "neutral";
  const baseQuality: MacroState["data_quality"] = available.length === SERIES.length ? "complete" : available.length ? "partial" : "unavailable";
  const dataQuality = sourceObservedAt && businessDayAge(sourceObservedAt, collectedAt) > 2 ? "stale" : baseQuality;
  const curveDescription = slope10y2y === null
    ? "yield curve unavailable"
    : slope10y2y > 25
      ? "the ten-year yield is materially above the two-year yield"
      : slope10y2y < -25
        ? "the ten-year yield is materially below the two-year yield"
        : "the two-year and ten-year curve is relatively flat";

  return {
    source: "fred",
    collected_at: collectedAt.toISOString(),
    source_observed_at: sourceObservedAt,
    data_quality: dataQuality,
    series,
    curve: { slope_10y_2y_bps: slope10y2y, slope_2y_1y_bps: slope2y1y },
    policy_regime: policyRegime,
    gold_real_yield_regime: realYieldRegime,
    semantic: {
      front_end: describeChange("the two-year Treasury yield", dgs2),
      long_end: describeChange("the ten-year Treasury yield", dgs10),
      curve: curveDescription,
      real_yield: describeChange("the ten-year real Treasury yield", real10),
      inflation_expectations: describeChange("ten-year breakeven inflation", breakeven),
    },
    error: null,
  };
}

export function createUnavailableMacroState(error: string, collectedAt = new Date()): MacroState {
  return {
    source: "fred",
    collected_at: collectedAt.toISOString(),
    source_observed_at: null,
    data_quality: "unavailable",
    series: { DGS1: null, DGS2: null, DGS10: null, DFII10: null, T10YIE: null },
    curve: { slope_10y_2y_bps: null, slope_2y_1y_bps: null },
    policy_regime: "unknown",
    gold_real_yield_regime: "unknown",
    semantic: {
      front_end: "front-end Treasury data unavailable",
      long_end: "long-term Treasury data unavailable",
      curve: "yield curve unavailable",
      real_yield: "real-yield data unavailable",
      inflation_expectations: "breakeven-inflation data unavailable",
    },
    error,
  };
}

export function markMacroStateStale(state: MacroState, error: string): MacroState {
  return { ...state, data_quality: "stale", error };
}

export function isMacroCacheFresh(state: MacroState, now = Date.now(), cacheHours = 6) {
  const collected = new Date(state.collected_at).getTime();
  const nominalValues = [state.series.DGS1, state.series.DGS2, state.series.DGS10]
    .map((item) => item?.value_pct)
    .filter((value): value is number => Number.isFinite(value));
  const suspiciousEmptyRow = nominalValues.length === 3 && nominalValues.every((value) => value === 0);
  return !suspiciousEmptyRow
    && Number.isFinite(collected)
    && now - collected >= 0
    && now - collected < cacheHours * 60 * 60 * 1_000;
}

export async function fetchMacroState(fetchImpl: typeof fetch = fetch): Promise<MacroState> {
  const end = new Date();
  const start = new Date(end.getTime() - 150 * 24 * 60 * 60 * 1_000);
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.searchParams.set("id", SERIES.join(","));
  url.searchParams.set("cosd", start.toISOString().slice(0, 10));
  url.searchParams.set("coed", end.toISOString().slice(0, 10));
  const response = await fetchImpl(url, {
    headers: { accept: "text/csv" },
    cache: "no-store",
    signal: AbortSignal.timeout(7_000),
  });
  if (!response.ok) throw new Error(`FRED macro request failed with HTTP ${response.status}.`);
  return buildMacroState(parseFredCsv(await response.text()), end);
}
