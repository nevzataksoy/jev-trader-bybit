import postgres from "postgres";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is not configured.");

const sql = postgres(connectionString, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  prepare: false,
});

function json(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function classifyOutcome(currentPrice, plan, futureSnapshots, asset) {
  const targetDistancePct = number(plan?.target1DistancePct);
  const invalidationDistancePct = number(plan?.invalidationDistancePct);
  if (!(currentPrice > 0) || !(targetDistancePct > 0) || !(invalidationDistancePct > 0)) return null;

  const targetPrice = currentPrice * (1 + targetDistancePct / 100);
  const invalidationPrice = currentPrice * (1 - invalidationDistancePct / 100);

  for (const snapshot of futureSnapshots) {
    const prices = json(snapshot?.prices, {});
    const price = number(prices?.[asset]);
    if (!(price > 0)) continue;
    if (price >= targetPrice) return "target1";
    if (price <= invalidationPrice) return "invalidation";
  }
  return "timeout";
}

function brier(forecast, outcome) {
  const outcomes = ["target1", "invalidation", "timeout"];
  const probabilities = {
    target1: number(forecast.target1BeforeInvalidation, 0),
    invalidation: number(forecast.invalidationBeforeTarget1, 0),
    timeout: number(forecast.timeout, 0),
  };
  return outcomes.reduce((sum, key) => {
    const observed = outcome === key ? 1 : 0;
    return sum + (probabilities[key] - observed) ** 2;
  }, 0);
}

function logLoss(forecast, outcome) {
  const probability = outcome === "target1"
    ? number(forecast.target1BeforeInvalidation, 0)
    : outcome === "invalidation"
      ? number(forecast.invalidationBeforeTarget1, 0)
      : number(forecast.timeout, 0);
  return -Math.log(Math.max(1e-9, Math.min(1 - 1e-9, probability)));
}

function targetBucket(probability) {
  const bounded = Math.max(0, Math.min(0.999999, probability));
  const lower = Math.floor(bounded * 5) / 5;
  return `${lower.toFixed(1)}-${(lower + 0.2).toFixed(1)}`;
}

try {
  const rows = await sql`
    SELECT
      er.engine_id,
      er.cycle_key,
      sms.captured_at,
      sms.prices AS current_prices,
      d.value AS decision,
      future.future_snapshots,
      future.max_future_at
    FROM engine_runs er
    JOIN shared_market_snapshots sms
      ON sms.id = er.snapshot_id
    CROSS JOIN LATERAL jsonb_array_elements(er.decisions) AS d(value)
    LEFT JOIN LATERAL (
      SELECT
        jsonb_agg(
          jsonb_build_object(
            'captured_at', candidate.captured_at,
            'prices', candidate.prices
          )
          ORDER BY candidate.captured_at
        ) AS future_snapshots,
        MAX(candidate.captured_at) AS max_future_at
      FROM shared_market_snapshots candidate
      WHERE candidate.captured_at > sms.captured_at
        AND candidate.captured_at <= sms.captured_at + INTERVAL '4 hours'
    ) future ON TRUE
    WHERE er.status = 'completed'
      AND d.value ? 'shadowForecast'
      AND d.value->'shadowForecast'->>'status' = 'uncalibrated_shadow'
    ORDER BY sms.captured_at ASC, er.engine_id ASC
  `;

  const samples = [];
  let immature = 0;

  for (const row of rows) {
    const decision = json(row.decision, {});
    const forecast = json(decision.shadowForecast, null);
    const plan = json(decision.candidatePlan, null);
    const currentPrices = json(row.current_prices, {});
    const futureSnapshots = json(row.future_snapshots, []);
    const currentPrice = number(currentPrices?.[decision.asset]);
    const capturedAt = Date.parse(row.captured_at);
    const maxFutureAt = Date.parse(row.max_future_at);

    if (
      !forecast
      || !plan
      || !(currentPrice > 0)
      || !Number.isFinite(capturedAt)
      || !Number.isFinite(maxFutureAt)
      || maxFutureAt - capturedAt < 225 * 60 * 1000
    ) {
      immature += 1;
      continue;
    }

    const outcome = classifyOutcome(currentPrice, plan, futureSnapshots, decision.asset);
    if (!outcome) continue;

    samples.push({
      engineId: row.engine_id,
      asset: decision.asset,
      methodRevision: forecast.methodRevision ?? "unknown",
      outcome,
      targetProbability: number(forecast.target1BeforeInvalidation, 0),
      invalidationProbability: number(forecast.invalidationBeforeTarget1, 0),
      timeoutProbability: number(forecast.timeout, 0),
      brier: brier(forecast, outcome),
      logLoss: logLoss(forecast, outcome),
      expectedNetReturnPct: number(forecast.expectedNetReturnPct, 0),
    });
  }

  const groups = new Map();
  for (const sample of samples) {
    const key = `${sample.engineId}:${sample.asset}`;
    const group = groups.get(key) ?? {
      engine: sample.engineId,
      asset: sample.asset,
      samples: 0,
      target: 0,
      invalidation: 0,
      timeout: 0,
      targetProbability: 0,
      brier: 0,
      logLoss: 0,
      expectedNetReturnPct: 0,
    };
    group.samples += 1;
    group.target += sample.outcome === "target1" ? 1 : 0;
    group.invalidation += sample.outcome === "invalidation" ? 1 : 0;
    group.timeout += sample.outcome === "timeout" ? 1 : 0;
    group.targetProbability += sample.targetProbability;
    group.brier += sample.brier;
    group.logLoss += sample.logLoss;
    group.expectedNetReturnPct += sample.expectedNetReturnPct;
    groups.set(key, group);
  }

  console.log("\\nR7 shadow probability outcomes (15-minute sampled, 4-hour horizon)");
  console.table([...groups.values()].map((group) => ({
    engine: group.engine,
    asset: group.asset,
    samples: group.samples,
    target_first_pct: Number((group.target / group.samples * 100).toFixed(2)),
    invalidation_first_pct: Number((group.invalidation / group.samples * 100).toFixed(2)),
    timeout_pct: Number((group.timeout / group.samples * 100).toFixed(2)),
    mean_target_probability: Number((group.targetProbability / group.samples).toFixed(4)),
    multiclass_brier: Number((group.brier / group.samples).toFixed(4)),
    log_loss: Number((group.logLoss / group.samples).toFixed(4)),
    mean_shadow_expected_net_pct: Number((group.expectedNetReturnPct / group.samples).toFixed(5)),
  })));

  const buckets = new Map();
  for (const sample of samples) {
    const bucket = targetBucket(sample.targetProbability);
    const key = `${sample.engineId}:${bucket}`;
    const item = buckets.get(key) ?? {
      engine: sample.engineId,
      bucket,
      samples: 0,
      forecastSum: 0,
      targetHits: 0,
    };
    item.samples += 1;
    item.forecastSum += sample.targetProbability;
    item.targetHits += sample.outcome === "target1" ? 1 : 0;
    buckets.set(key, item);
  }

  console.log("\\nTarget-first calibration buckets");
  console.table([...buckets.values()].map((item) => ({
    engine: item.engine,
    probability_bucket: item.bucket,
    samples: item.samples,
    mean_forecast: Number((item.forecastSum / item.samples).toFixed(4)),
    observed_target_rate: Number((item.targetHits / item.samples).toFixed(4)),
    calibration_gap: Number((
      item.forecastSum / item.samples - item.targetHits / item.samples
    ).toFixed(4)),
  })));

  const perEngine = new Map();
  for (const sample of samples) {
    const item = perEngine.get(sample.engineId) ?? { samples: 0, brier: 0, logLoss: 0 };
    item.samples += 1;
    item.brier += sample.brier;
    item.logLoss += sample.logLoss;
    perEngine.set(sample.engineId, item);
  }

  console.log("\\nCalibration readiness");
  console.table([...perEngine.entries()].map(([engine, item]) => ({
    engine,
    matured_forecasts: item.samples,
    multiclass_brier: Number((item.brier / item.samples).toFixed(4)),
    log_loss: Number((item.logLoss / item.samples).toFixed(4)),
    execution_ready: item.samples >= 500 ? "review_calibration" : "no",
  })));

  console.log(`Immature/unscorable shadow forecasts: ${immature}`);
  if ([...perEngine.values()].some((item) => item.samples < 500)) {
    console.warn("INSUFFICIENT CALIBRATION SAMPLE: shadow probabilities must remain non-authoritative.");
  }
  console.warn("Shadow forecasts do not authorize trades. Outcomes are sampled at 15-minute snapshots, so intrabar first-touch ordering is not observed.");
} finally {
  await sql.end({ timeout: 5 });
}
