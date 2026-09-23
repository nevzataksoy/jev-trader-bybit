# Kurulum ve Vercel Yayını

## Türkçe

### 1. Gereksinimler

- Node.js 20+
- Bybit Demo Trading API anahtarı
- TypeSafe Jev API anahtarı
- Neon/PostgreSQL
- cron-job.org hesabı

### 2. Yerel kurulum

```bash
git clone https://github.com/nevzataksoy/jev-trader-bybit.git
cd jev-trader-bybit
npm ci
cp .env.example .env.local
```

Gerçek secret değerlerini repoya yazmayın.

### 3. Bybit Demo Trading

`.env.local` veya Vercel Production Environment Variables:

```env
BYBIT_ACCOUNT_ENV=demo
BYBIT_API_KEY=...
BYBIT_API_SECRET=...
TRADING_ENABLED=false
ALLOW_LIVE_TRADING=false
```

Demo Trading anahtarları `https://api-demo.bybit.com` üzerinde kullanılır.

### 4. TypeSafe Jev

```env
TYPESAFE_API_KEY=...
JEV_MODEL_NAME=jev-1.13.0
```

### 5. PostgreSQL / Neon

Vercel projesine Neon entegrasyonunu bağlayın veya bağlantı adresini manuel ekleyin:

```env
DATABASE_URL=postgresql://...
```

Temiz projede ayrı migration zinciri yoktur. Nihai şema `database/schema.sql` içindedir.

Açık kurulum isterseniz:

```bash
npm run db:setup
```

Uygulama runtime sırasında da tabloları `CREATE TABLE IF NOT EXISTS` ile doğrular. Bu nedenle Vercel deploy/build adımı doğrudan migration çalıştırmaz; ilk başarılı DB kullanan runtime çağrısı şemayı otomatik bootstrap edebilir.

### 6. A/B ayarları

İlk deploy için:

```env
STRATEGY_RUN_MODE=ab_test
EXCHANGE_EXECUTION_ENGINE=none
AB_ENGINE_IDS=model1-v1,model2-v2
AB_EXPERIMENT_ID=model1-v1-vs-model2-v2
AB_INITIAL_CAPITAL_USDT=1000
AB_MIN_DAYS=42
AB_MIN_FILLED_ORDERS_PER_ENGINE=30
```

A/B modunda gerçek exchange routing her durumda kapalıdır.

### 7. Platform safety değişkenleri

Bunlar modellerin stratejik tercihleri değil, uygulamanın ortak hard limitleridir. ATR/maliyet oranı artık global hard gate değildir; model yapısal hedef alanı, invalidation riski ve gerçek round-trip maliyeti birlikte değerlendirir:

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

### 9. Model2 V1 parametreleri

```env
MODEL2_V1_INITIAL_ENTRY_PCT_OF_PORTFOLIO=0.15
MODEL2_V1_STRONG_INITIAL_ENTRY_PCT_OF_PORTFOLIO=0.20
MODEL2_V1_BUY_PCT_OF_USDT=0.20
MODEL2_V1_SELL_PCT_OF_HOLDING=0.25
MODEL2_V1_TARGET_DAILY_VOLATILITY_PCT=3
MODEL2_V1_MIN_BEAR_REBOUND_SCORE=0.62
MODEL2_V1_ALLOCATION_DEADBAND_PCT=3
MODEL2_V1_MIN_DIRECTIONAL_EDGE=0.15
MODEL2_V1_MIN_SETUP_SCORE=2.00
MODEL2_V1_MIN_EXPECTED_NET_EDGE_PCT=0.05
MODEL2_V1_MIN_LIQUIDITY_PROBABILITY=0.55
MODEL2_V1_DISORDERLY_PROBABILITY=0.70
MODEL2_V1_CUT_POSITION_PROBABILITY=0.72
MODEL2_V1_WAIT_CLOSE_TTL_MINUTES=30
MODEL2_V1_WAIT_RETEST_TTL_MINUTES=120
```

Yeni bir model/version kendi prefix'li parametrelerini kendi `config.ts` dosyasında tanımlar.

### 10. Revision audit, counterfactual ve retention

Aynı 42 günlük experiment içinde model kimlikleri korunur; davranış değişiklikleri `policyRevision/configRevision/sourceRevision` ile ayrıştırılır. `engine_policy_revisions` config snapshot'ını her 15 dakikada tekrar etmez; aynı revision yalnız bir kez tutulur. Platformun reddettiği BUY/SELL girişimleri sparse `engine_counterfactuals` tablosuna kaydedilir.

Mevcut `/api/cron` her çevrimin sonunda `cleanupDatabase()` çalıştırır. Aynı cleanup counterfactual kayıtlarının +15m/+1h/+4h/+12h sonuçlarını mevcut shared snapshot'lardan doldurur, expired pending kayıtlarını çözer ve retention süresi aşılmış counterfactual/revision metadata'yı temizler. Ek cron veya manuel cleanup gerekmez.

### 11. Retention ve cron

```env
BOT_RUN_RETENTION_DAYS=45
DAILY_HISTORY_RETENTION_DAYS=1825
ORDER_HISTORY_RETENTION_DAYS=730
MACRO_HISTORY_RETENTION_DAYS=730
EXPERIMENT_DETAIL_RETENTION_DAYS=180
CRON_SECRET=at_least_32_random_characters
```

cron-job.org ayarı:

1. URL: `https://YOUR_PROJECT.vercel.app/api/cron`
2. Method: `GET`
3. Schedule: her saat `00, 15, 30, 45`
4. Time zone: `UTC`
5. Header: `Authorization: Bearer YOUR_CRON_SECRET`

### 12. Yerel doğrulama

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run strategy:report
```

Tarihsel local backtest/simulation komutları bu temiz projede bulunmaz.

### 13. Vercel deploy sonrası kontrol sırası

1. Neon entegrasyonunun bağlı olduğunu ve `DATABASE_URL` oluştuğunu doğrulayın.
2. Vercel Production Environment Variables alanını güncel `.env.example` ile eşitleyin.
3. Eski `model1-blind-*`, `model2-blind-*`, eski strategy parametreleri ve bütün `BACKTEST_*` değişkenlerini Vercel'den kaldırın.
4. `AB_ENGINE_IDS=model1-v1,model2-v2` ve `AB_EXPERIMENT_ID=model1-v1-vs-model2-v2` kullanın.
5. İlk aşamada `TRADING_ENABLED=false`, `EXCHANGE_EXECUTION_ENGINE=none` bırakın.
6. Deploy tamamlandıktan sonra `/api/health` çağırın.
7. Yetkili bir `/api/cron` çağrısı yapın. DB tamamen boşsa bu çağrı runtime schema bootstrap'ını tetikleyebilir.
8. `/api/state` yanıtının bağlı Bybit hesabı/platform durumunu, `/models` ve `/api/models/state` yanıtının ise A/B `engine_runs` / paper karar geçmişini temsil ettiğini doğrulayın. `/api/models/state` içindeki `activeEngines`, `availableEngines` ve deney motorları yalnız `model1-v1` ile `model2-v1` olmalıdır.
9. DB'de `strategy_experiments`, `shared_market_snapshots`, `engine_runs`, `engine_portfolios`, `engine_equity_snapshots`, `engine_orders`, `engine_policy_revisions`, `engine_counterfactuals` tablolarının oluştuğunu kontrol edin.
10. cron-job.org Test Run yapın ve HTTP 200 doğrulayın.
11. Birkaç çevrim boyunca Jev kararlarını, pending/confirmed akışını ve paper equity sonuçlarını gözlemleyin.
12. A/B testi sırasında gerçek exchange routing'i açmayın.

---

# Installation and Vercel Deployment

## English

### 1. Requirements

- Node.js 20+
- Bybit Demo Trading API key
- TypeSafe Jev API key
- Neon/PostgreSQL
- cron-job.org account

### 2. Local setup

```bash
git clone https://github.com/nevzataksoy/jev-trader-bybit.git
cd jev-trader-bybit
npm ci
cp .env.example .env.local
```

Never commit real secrets.

### 3. Bybit Demo Trading

```env
BYBIT_ACCOUNT_ENV=demo
BYBIT_API_KEY=...
BYBIT_API_SECRET=...
TRADING_ENABLED=false
ALLOW_LIVE_TRADING=false
```

### 4. TypeSafe Jev

```env
TYPESAFE_API_KEY=...
JEV_MODEL_NAME=jev-1.13.0
```

### 5. PostgreSQL / Neon

Attach Neon to the Vercel project or provide:

```env
DATABASE_URL=postgresql://...
```

The clean project has no migration history chain. `database/schema.sql` contains the final baseline schema.

Optional explicit provisioning:

```bash
npm run db:setup
```

Runtime initialization also uses `CREATE TABLE IF NOT EXISTS`. Vercel build itself does not perform a DB migration; the first runtime request that requires the database can bootstrap the schema.

### 6. A/B configuration

```env
STRATEGY_RUN_MODE=ab_test
EXCHANGE_EXECUTION_ENGINE=none
AB_ENGINE_IDS=model1-v1,model2-v2
AB_EXPERIMENT_ID=model1-v1-vs-model2-v2
AB_INITIAL_CAPITAL_USDT=1000
AB_MIN_DAYS=42
AB_MIN_FILLED_ORDERS_PER_ENGINE=30
```

Real exchange routing is hard-disabled in A/B mode.

### 7. Platform safety versus model configuration

Shared safety ceilings remain global. Strategy choices live under `MODEL1_V1_*` or `MODEL2_V1_*`. Future model versions should define their own prefixed configuration in their own version directory.

Use `.env.example` as the canonical variable list.

### 8. Revision audit, retention and cron

Keep the same 42-day experiment and engine ids while in-place policy changes are separated by `policyRevision/configRevision/sourceRevision`. Revision config is deduplicated in `engine_policy_revisions`. Only platform-rejected BUY/SELL attempts create sparse `engine_counterfactuals` rows.

The existing `/api/cron` already calls `cleanupDatabase()` at the end of every 15-minute cycle. That same cleanup fills +15m/+1h/+4h/+12h counterfactual outcomes from shared snapshots and applies retention; no additional cron or manual cleanup is required.

Configure cron-job.org:

1. URL: `https://YOUR_PROJECT.vercel.app/api/cron`
2. Method: `GET`
3. Schedule: minutes `00, 15, 30, 45`
4. Time zone: `UTC`
5. Header: `Authorization: Bearer YOUR_CRON_SECRET`

### 9. Validation

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run strategy:report
```

Historical local backtest/simulation commands are intentionally not part of this clean baseline.

### 10. Post-deploy Vercel checklist

1. Verify the Neon integration and `DATABASE_URL`.
2. Synchronize Production Environment Variables with the current `.env.example`.
3. Remove old `model1-blind-*`, `model2-blind-*`, old strategy variables and every `BACKTEST_*` variable.
4. Set `AB_ENGINE_IDS=model1-v1,model2-v2`.
5. Set `AB_EXPERIMENT_ID=model1-v1-vs-model2-v2`.
6. Keep `TRADING_ENABLED=false` and `EXCHANGE_EXECUTION_ENGINE=none` initially.
7. Verify `/api/health`.
8. Send one authenticated `/api/cron` request; on an empty database this can trigger runtime schema bootstrap.
9. Verify `/api/state` represents the configured Bybit account/platform surface while `/models` and `/api/models/state` represent A/B `engine_runs` and paper decision history. `activeEngines`, `availableEngines`, and the persisted experiment engines should contain only `model1-v1` and `model2-v1`.
10. Confirm the experiment/engine tables plus `engine_policy_revisions` and `engine_counterfactuals` exist in PostgreSQL.
11. Run cron-job.org Test Run and confirm HTTP 200.
12. Observe multiple paper cycles before making any execution-mode change.
