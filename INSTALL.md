# Kurulum ve Vercel Yayını / Installation and Vercel Deployment

## Türkçe

### 1. Gereksinimler

- Node.js 20+
- npm
- Bybit Demo Trading API anahtarı
- TypeSafe Jev API anahtarı
- Supabase veya uyumlu PostgreSQL
- Vercel projesi
- 15 dakikalık schedule için cron-job.org veya eşdeğer cron servisi

Gerçek secret değerlerini GitHub reposuna veya dokümantasyona yazmayın.

### 2. Yerel kurulum

```bash
git clone https://github.com/nevzataksoy/jev-trader-bybit.git
cd jev-trader-bybit
npm ci
cp .env.example .env.local
```

Windows PowerShell kullanıyorsanız `.env.example` dosyasını `.env.local` olarak manuel kopyalayabilirsiniz.

### 3. Bybit Demo Trading

Yerel `.env.local` veya Vercel Production Environment Variables:

```env
BYBIT_ACCOUNT_ENV=demo
BYBIT_API_KEY=...
BYBIT_API_SECRET=...
TRADING_ENABLED=false
ALLOW_LIVE_TRADING=false
```

Demo Trading private API işlemleri demo hesap üzerinde çalışır. A/B modunda gerçek exchange routing ayrıca `EXCHANGE_EXECUTION_ENGINE=none` ile kapalı tutulur.

### 4. TypeSafe Jev

```env
TYPESAFE_API_KEY=...
JEV_MODEL_NAME=jev-1.13.0
```

Jev'e gerçek asset kimliği gönderilmez. BTC / ETH / XAUT uygulama içinde anonim `candidate_1` / `candidate_2` / `candidate_3` slotlarına eşlenir.

### 5. PostgreSQL / Supabase

Supabase Dashboard → Connect ekranında iki bağlantı amacı kullanılır:

- Vercel runtime: Transaction pooler, port `6543`.
- `pg_dump`, `psql`, veri taşıma ve admin işlemleri: Session pooler, port `5432`.

Vercel Production örneği:

```env
DATABASE_URL=postgresql://postgres.PROJECT_REF:DB_PASSWORD@POOLER_HOST:6543/postgres
```

Uygulama doğrudan PostgreSQL protokolü kullanır. Aşağıdaki Supabase API secret'ları gerekmez:

- `SUPABASE_URL`
- anon key
- service-role key

Postgres.js `prepare:false` kullanır; bu ayar Transaction pooler ile uyumludur.

Temiz şema kaynağı:

```text
database/schema.sql
```

İsteğe bağlı açık kurulum:

```bash
npm run db:setup
```

Production build sırasında şema `DATABASE_URL` üzerinden idempotent olarak uygulanır. Preview ve local build bu production provisioning davranışını çalıştırmaz. Runtime endpointleri şema migration'ı başlatmaz.

### 6. Aktif A/B experiment ayarları

```env
STRATEGY_RUN_MODE=ab_test
EXCHANGE_EXECUTION_ENGINE=none
AB_ENGINE_IDS=model1-v1,model2-v2
AB_EXPERIMENT_ID=model1-v1-vs-model2-v2
AB_INITIAL_CAPITAL_USDT=1000
AB_MIN_DAYS=42
AB_MIN_FILLED_ORDERS_PER_ENGINE=30
```

42 günlük experiment aktifken `AB_EXPERIMENT_ID`, experiment başlangıç tarihi veya paper portföyler davranış revizyonu için sıfırlanmaz. R5/R6/R7 gibi revizyonlar `engine_revisions` üzerinden audit edilir.

### 7. Platform hard-safety değişkenleri

Bunlar model tercihi değil, ortak operasyonel limitlerdir:

```env
MIN_CONFIDENCE_THRESHOLD=0.72
MIN_SELL_CONFIDENCE=0.60
MIN_TRADE_USDT=5
MIN_USDT_RESERVE_PCT=0.20
MAX_ASSET_ALLOCATION_PCT=0.50
MAX_DAILY_VOLATILITY_PCT=10
MAX_SPREAD_PCT=0.25
ESTIMATED_SLIPPAGE_PCT=0.03
MAX_MARKET_SLIPPAGE_PCT=0.20
MAX_PORTFOLIO_DRAWDOWN_PCT=3
MAX_COMPLETED_ORDERS_24H=8
MAX_BUYS_PER_CYCLE=2
MACRO_CACHE_HOURS=6
```

### 8. Model1 V1 parametreleri

```env
MODEL1_V1_INITIAL_ENTRY_PCT_OF_PORTFOLIO=0.15
MODEL1_V1_BUY_PCT_OF_USDT=0.20
MODEL1_V1_SELL_PCT_OF_HOLDING=0.25
MODEL1_V1_TARGET_DAILY_VOLATILITY_PCT=3
MODEL1_V1_MIN_BEAR_REBOUND_SCORE=0.62
MODEL1_V1_ALLOCATION_DEADBAND_PCT=3
MODEL1_V1_MIN_DIRECTIONAL_EDGE=0.15
MODEL1_V1_MIN_SETUP_SCORE=2.00
MODEL1_V1_MIN_EXPECTED_NET_EDGE_PCT=0.05
MODEL1_V1_MIN_LIQUIDITY_PROBABILITY=0.55
MODEL1_V1_DISORDERLY_PROBABILITY=0.70
MODEL1_V1_CUT_POSITION_PROBABILITY=0.72
MODEL1_V1_WAIT_CLOSE_TTL_MINUTES=30
MODEL1_V1_WAIT_RETEST_TTL_MINUTES=120
```

### 9. Model2 parametreleri

Aktif engine `model2-v2`'dir. V2 parametreleri:

```env
MODEL2_V2_INITIAL_ENTRY_PCT_OF_PORTFOLIO=0.15
MODEL2_V2_STRONG_INITIAL_ENTRY_PCT_OF_PORTFOLIO=0.20
MODEL2_V2_BUY_PCT_OF_USDT=0.20
MODEL2_V2_SELL_PCT_OF_HOLDING=0.25
MODEL2_V2_TARGET_DAILY_VOLATILITY_PCT=3
MODEL2_V2_MIN_BEAR_REBOUND_SCORE=0.62
MODEL2_V2_ALLOCATION_DEADBAND_PCT=3
MODEL2_V2_MIN_DIRECTIONAL_EDGE=0.15
MODEL2_V2_MIN_SETUP_SCORE=2.00
MODEL2_V2_MIN_EXPECTED_NET_EDGE_PCT=0.05
MODEL2_V2_MIN_LIQUIDITY_PROBABILITY=0.55
MODEL2_V2_DISORDERLY_PROBABILITY=0.70
MODEL2_V2_CUT_POSITION_PROBABILITY=0.72
MODEL2_V2_WAIT_CLOSE_TTL_MINUTES=30
MODEL2_V2_WAIT_RETEST_TTL_MINUTES=120
```

Repo `model2-v1` kodunu ve `MODEL2_V1_*` örneklerini tarihsel/alternatif model sürümü olarak tutabilir; aktif A/B pair `AB_ENGINE_IDS` ile belirlenir.

### 10. R6 candidate plan ve R7 shadow probability

R6/R7 için yeni environment variable gerekmez.

Candidate plan uygulama tarafından mevcut market state ve transaction-cost verisinden oluşturulur. R7 shadow olasılıkları final model kararından sonra yalnız telemetry olarak eklenir:

```text
executionAuthoritative=false
status=uncalibrated_shadow
horizonMinutes=240
```

Bu alanlar trade execution'a bağlanmamalıdır. Yeterli olgun örnek ve calibration analizi oluşmadan shadow forecast'e execution yetkisi verilmemelidir.

R7 calibration raporu:

```bash
npm run strategy:probability-report
```

Komut `DATABASE_URL` ister. Yalnız `shadowForecast` taşıyan ve yaklaşık dört saatlik geleceği olgunlaşmış decision kayıtlarını skorlar. Rapor 15 dakikalık snapshot'lardan first-touch yaklaşımı kullandığı için intrabar sıralamayı kesin göremez.

### 11. Retention ve cron

```env
BOT_RUN_RETENTION_DAYS=45
DAILY_HISTORY_RETENTION_DAYS=1825
ORDER_HISTORY_RETENTION_DAYS=730
MACRO_HISTORY_RETENTION_DAYS=730
EXPERIMENT_DETAIL_RETENTION_DAYS=180
CRON_SECRET=at_least_32_random_characters
```

cron-job.org örneği:

1. URL: `https://YOUR_PROJECT.vercel.app/api/cron`
2. Method: `GET`
3. Schedule: UTC saatinde her saat `00, 15, 30, 45`
4. Header: `Authorization: Bearer YOUR_CRON_SECRET`

`CRON_SECRET` değerini sohbet, log veya repo içinde paylaşmayın.

### 12. Kalite doğrulaması

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Tanı raporları:

```bash
npm run strategy:report
npm run strategy:probability-report
```

`strategy:report` ve `strategy:probability-report` gözlemsel tanı araçlarıdır; tek başına kârlılık kanıtı veya causal backtest değildir.

### 13. Vercel production deploy sonrası kontrol

1. Production `DATABASE_URL` değerinin Supabase Transaction pooler port `6543` kullandığını doğrulayın.
2. Production Environment Variables değerlerini `.env.example` ile karşılaştırın.
3. `AB_ENGINE_IDS=model1-v1,model2-v2` ve `AB_EXPERIMENT_ID=model1-v1-vs-model2-v2` değerlerini koruyun.
4. `TRADING_ENABLED=false`, `ALLOW_LIVE_TRADING=false` ve `EXCHANGE_EXECUTION_ENGINE=none` bırakın.
5. Deploy tamamlandıktan sonra `/api/health` çağrısının DB bağlantısını başarılı göstermesini doğrulayın.
6. Yetkili `/api/cron` cycle çalıştırın veya normal schedule'ı bekleyin.
7. `/api/models/state` üzerinde aynı experiment'in devam ettiğini, yeni run'ın güncel `policyRevision` ve code SHA kullandığını doğrulayın.
8. `/models` ekranında candidate plan, diagnostics ve varsa `uncalibrated_shadow` forecast telemetry'sini kontrol edin.
9. Experiment başlangıç/bitiş tarihi veya paper portföyleri davranış revision'ı nedeniyle resetlemeyin.

### 14. Güncel veri kapsamı

Runtime market state price action, multi-timeframe support/resistance, orderbook, trade flow, open interest, funding ve türetilmiş squeeze-risk kanıtı taşır.

Gerçek liquidation event stream / liquidation heatmap henüz runtime state'e eklenmemiştir. Bu entegrasyon ayrı bir geliştirme olarak ele alınmalıdır; mevcut squeeze proxy'leri gerçek liquidation cluster verisi gibi yorumlanmamalıdır.

---

## English

### 1. Requirements

- Node.js 20+
- npm
- Bybit Demo Trading API credentials
- TypeSafe Jev API key
- Supabase or compatible PostgreSQL
- a Vercel project
- cron-job.org or equivalent scheduler for the 15-minute cycle

Never commit real secrets to GitHub or documentation.

### 2. Local installation

```bash
git clone https://github.com/nevzataksoy/jev-trader-bybit.git
cd jev-trader-bybit
npm ci
cp .env.example .env.local
```

On Windows PowerShell you may copy `.env.example` to `.env.local` manually.

### 3. Bybit Demo Trading

Use these values in local `.env.local` or Vercel Production Environment Variables:

```env
BYBIT_ACCOUNT_ENV=demo
BYBIT_API_KEY=...
BYBIT_API_SECRET=...
TRADING_ENABLED=false
ALLOW_LIVE_TRADING=false
```

Demo private requests use the demo account. Real exchange routing is also disabled in A/B mode through `EXCHANGE_EXECUTION_ENGINE=none`.

### 4. TypeSafe Jev

```env
TYPESAFE_API_KEY=...
JEV_MODEL_NAME=jev-1.13.0
```

Jev does not receive real asset identity. BTC / ETH / XAUT are mapped internally to anonymous `candidate_1` / `candidate_2` / `candidate_3` slots.

### 5. PostgreSQL / Supabase

Use two Supabase connection modes for different purposes:

- Vercel runtime: Transaction pooler, port `6543`.
- `pg_dump`, `psql`, migration/transfer and administrative work: Session pooler, port `5432`.

Vercel Production example:

```env
DATABASE_URL=postgresql://postgres.PROJECT_REF:DB_PASSWORD@POOLER_HOST:6543/postgres
```

The application connects directly through PostgreSQL and does not require:

- `SUPABASE_URL`
- anon key
- service-role key

Postgres.js uses `prepare:false`, which is compatible with transaction pooling.

The clean schema source is:

```text
database/schema.sql
```

Optional explicit provisioning:

```bash
npm run db:setup
```

Production builds apply the schema through `DATABASE_URL` idempotently. Preview and local builds do not run production provisioning. Runtime endpoints do not initiate schema migrations.

### 6. Active A/B experiment settings

```env
STRATEGY_RUN_MODE=ab_test
EXCHANGE_EXECUTION_ENGINE=none
AB_ENGINE_IDS=model1-v1,model2-v2
AB_EXPERIMENT_ID=model1-v1-vs-model2-v2
AB_INITIAL_CAPITAL_USDT=1000
AB_MIN_DAYS=42
AB_MIN_FILLED_ORDERS_PER_ENGINE=30
```

Do not reset `AB_EXPERIMENT_ID`, the experiment start time, or paper portfolios for an in-place behavior revision. R5/R6/R7 revisions are audited through `engine_revisions`.

### 7. Platform hard-safety variables

These are shared operational ceilings, not model preferences:

```env
MIN_CONFIDENCE_THRESHOLD=0.72
MIN_SELL_CONFIDENCE=0.60
MIN_TRADE_USDT=5
MIN_USDT_RESERVE_PCT=0.20
MAX_ASSET_ALLOCATION_PCT=0.50
MAX_DAILY_VOLATILITY_PCT=10
MAX_SPREAD_PCT=0.25
ESTIMATED_SLIPPAGE_PCT=0.03
MAX_MARKET_SLIPPAGE_PCT=0.20
MAX_PORTFOLIO_DRAWDOWN_PCT=3
MAX_COMPLETED_ORDERS_24H=8
MAX_BUYS_PER_CYCLE=2
MACRO_CACHE_HOURS=6
```

### 8. Model1 V1 parameters

```env
MODEL1_V1_INITIAL_ENTRY_PCT_OF_PORTFOLIO=0.15
MODEL1_V1_BUY_PCT_OF_USDT=0.20
MODEL1_V1_SELL_PCT_OF_HOLDING=0.25
MODEL1_V1_TARGET_DAILY_VOLATILITY_PCT=3
MODEL1_V1_MIN_BEAR_REBOUND_SCORE=0.62
MODEL1_V1_ALLOCATION_DEADBAND_PCT=3
MODEL1_V1_MIN_DIRECTIONAL_EDGE=0.15
MODEL1_V1_MIN_SETUP_SCORE=2.00
MODEL1_V1_MIN_EXPECTED_NET_EDGE_PCT=0.05
MODEL1_V1_MIN_LIQUIDITY_PROBABILITY=0.55
MODEL1_V1_DISORDERLY_PROBABILITY=0.70
MODEL1_V1_CUT_POSITION_PROBABILITY=0.72
MODEL1_V1_WAIT_CLOSE_TTL_MINUTES=30
MODEL1_V1_WAIT_RETEST_TTL_MINUTES=120
```

### 9. Model2 parameters

The active engine is `model2-v2`. V2 parameters:

```env
MODEL2_V2_INITIAL_ENTRY_PCT_OF_PORTFOLIO=0.15
MODEL2_V2_STRONG_INITIAL_ENTRY_PCT_OF_PORTFOLIO=0.20
MODEL2_V2_BUY_PCT_OF_USDT=0.20
MODEL2_V2_SELL_PCT_OF_HOLDING=0.25
MODEL2_V2_TARGET_DAILY_VOLATILITY_PCT=3
MODEL2_V2_MIN_BEAR_REBOUND_SCORE=0.62
MODEL2_V2_ALLOCATION_DEADBAND_PCT=3
MODEL2_V2_MIN_DIRECTIONAL_EDGE=0.15
MODEL2_V2_MIN_SETUP_SCORE=2.00
MODEL2_V2_MIN_EXPECTED_NET_EDGE_PCT=0.05
MODEL2_V2_MIN_LIQUIDITY_PROBABILITY=0.55
MODEL2_V2_DISORDERLY_PROBABILITY=0.70
MODEL2_V2_CUT_POSITION_PROBABILITY=0.72
MODEL2_V2_WAIT_CLOSE_TTL_MINUTES=30
MODEL2_V2_WAIT_RETEST_TTL_MINUTES=120
```

The repository may retain `model2-v1` code and `MODEL2_V1_*` examples as a historical/alternative model version. The active pair is controlled by `AB_ENGINE_IDS`.

### 10. R6 candidate plan and R7 shadow probability

R6/R7 require no new environment variable.

The application builds candidate-plan geometry from the current market state and transaction costs. R7 shadow probabilities are attached after the final model decision as telemetry only:

```text
executionAuthoritative=false
status=uncalibrated_shadow
horizonMinutes=240
```

Do not wire these fields into trade execution until enough matured samples have been collected and calibration has been reviewed.

R7 calibration report:

```bash
npm run strategy:probability-report
```

The command requires `DATABASE_URL`. It scores only decisions with `shadowForecast` and sufficiently matured future observations. Because it uses 15-minute snapshots, exact intrabar first-touch ordering is not observable.

### 11. Retention and cron

```env
BOT_RUN_RETENTION_DAYS=45
DAILY_HISTORY_RETENTION_DAYS=1825
ORDER_HISTORY_RETENTION_DAYS=730
MACRO_HISTORY_RETENTION_DAYS=730
EXPERIMENT_DETAIL_RETENTION_DAYS=180
CRON_SECRET=at_least_32_random_characters
```

cron-job.org example:

1. URL: `https://YOUR_PROJECT.vercel.app/api/cron`
2. Method: `GET`
3. Schedule: UTC every hour at `00, 15, 30, 45`
4. Header: `Authorization: Bearer YOUR_CRON_SECRET`

Do not expose `CRON_SECRET` in chat, logs, or the repository.

### 12. Quality validation

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Diagnostic reports:

```bash
npm run strategy:report
npm run strategy:probability-report
```

`strategy:report` and `strategy:probability-report` are observational diagnostics, not standalone proof of profitability or causal backtests.

### 13. Post-deploy production checks

1. Verify that Production `DATABASE_URL` uses the Supabase Transaction pooler on port `6543`.
2. Compare Production Environment Variables with `.env.example`.
3. Preserve `AB_ENGINE_IDS=model1-v1,model2-v2` and `AB_EXPERIMENT_ID=model1-v1-vs-model2-v2`.
4. Keep `TRADING_ENABLED=false`, `ALLOW_LIVE_TRADING=false`, and `EXCHANGE_EXECUTION_ENGINE=none`.
5. After deployment, verify `/api/health` reports successful database connectivity.
6. Trigger an authenticated `/api/cron` cycle or wait for the normal schedule.
7. Verify `/api/models/state` shows the same experiment continuing with the current `policyRevision` and code SHA.
8. Check `/models` for candidate-plan, diagnostics, and `uncalibrated_shadow` forecast telemetry when available.
9. Do not reset the experiment window or paper portfolios for a behavior revision.

### 14. Current data coverage

The runtime market state includes price action, multi-timeframe support/resistance, orderbook, trade flow, open interest, funding, and derived squeeze-risk evidence.

A realized liquidation-event stream / liquidation heatmap is not yet part of runtime state. Existing squeeze proxies must not be interpreted as real liquidation-cluster data.
