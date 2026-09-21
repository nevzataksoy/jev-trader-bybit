# Installation and Vercel Deployment / Kurulum ve Vercel Yayını

[Türkçe](#türkçe) · [English](#english)

---

## Türkçe

### Gereksinimler

- Node.js 20 veya üzeri
- Bybit Demo Trading API anahtarı
- TypeSafe Jev API anahtarı
- Neon veya Vercel Marketplace üzerinden bağlanmış PostgreSQL
- 15 dakikalık çağrı için ücretsiz cron-job.org hesabı

### 1. Yerel kurulum

```bash
git clone https://github.com/nevzataksoy/jev-trader-bybit.git
cd jev-trader-bybit
npm ci
```

`.env.example` dosyasını `.env.local` olarak kopyalayın. Gerçek anahtarları yalnızca `.env.local`, güvenli secret yöneticisi veya Vercel Environment Variables alanında tutun.

### 2. Bybit Demo Trading

Doğrulanmış ana Bybit hesabında [Demo Trading](https://www.bybit.com/en/derivative-activity/demo-trading) moduna geçin; ardından kullanıcı menüsündeki API sayfasından Demo hesabına ait anahtarı oluşturun. Demo hesabı ana hesaptan ayrı bir UID kullanır ve anahtar ana hesabın normal API listesinde görünmeyebilir.

```env
BYBIT_ACCOUNT_ENV=demo
BYBIT_API_KEY=...
BYBIT_API_SECRET=...
```

- Anahtara sadece ihtiyaç duyulan okuma ve spot emir izinlerini verin.
- Mümkünse sabit Vercel çıkış IP çözümü kullanarak IP kısıtlaması uygulayın.
- Secret yalnızca oluşturulurken gösterilir; repoya veya issue içeriğine eklemeyin.
- Demo anahtarları yalnızca `https://api-demo.bybit.com` alanında geçerlidir. `BYBIT_ACCOUNT_ENV=testnet` kullanmak `10003` hatasına neden olur.
- Uygulama sadece `category=spot`, `accountType=UNIFIED` ve USDT/BTC/ETH/XAUT kapsamını kullanır; USDC ile futures/option pozisyonları karar portföyüne alınmaz.

### 3. TypeSafe Jev

TypeSafe konsolundan API anahtarı oluşturun:

```env
TYPESAFE_API_KEY=...
JEV_MODEL_NAME=jev-1.13.0
```

Uygulama resmî [`@typesafe-ai/sdk`](https://github.com/typesafe-ai/typesafe-sdk-js) paketini ve `systemOne({ state, questions })` çağrısını kullanır.

Günlük ABD tahvil ve reel faiz bağlamı resmî FRED CSV akışından alınır. Ayrı bir FRED API anahtarı gerekmez; başarılı gözlem PostgreSQL'de önbelleğe alınır ve sağlayıcı geçici olarak erişilemezse son veri `stale` işaretlenerek yalnızca bağlam olarak kullanılır.

### 4. PostgreSQL

Yerel PostgreSQL 17 için parola URL-encode edilerek aşağıdaki bağlantı kullanılabilir:

```env
DATABASE_URL=postgresql://postgres:URL_ENCODED_PASSWORD@127.0.0.1:5432/jev-trader-bybit?sslmode=disable
```

PowerShell'de bağlantıyı uygulamadan önce doğrulayın:

```powershell
& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -h 127.0.0.1 -U postgres -d jev-trader-bybit -c "select current_database(), current_user;"
```

Parolada `@`, `:`, `/`, `#` veya `%` varsa bağlantı dizesine doğrudan yazmayın; URL-encode edin. Yerel bağlantıda `sslmode=disable`, Neon/Vercel tarafından verilen bağlantıda sağlayıcının `sslmode=require` ayarı kullanılmalıdır.

Vercel Dashboard → Storage/Marketplace üzerinden Neon PostgreSQL bağlantısı oluşturun veya mevcut Neon bağlantı adresinizi kullanın:

```env
DATABASE_URL=postgresql://...
```

Şemayı oluşturun:

```bash
npm run db:setup
```

Uygulama çalışma anında da `CREATE TABLE IF NOT EXISTS` ile şemayı doğrular. `database/schema.sql` manuel kurulum ve denetim için repoda tutulur.

### 5. Güvenli çalışma ayarları

İlk kurulumda emir yürütmeyi kapalı bırakın:

```env
TRADING_ENABLED=false
MIN_CONFIDENCE_THRESHOLD=0.72
BUY_PCT_OF_USDT=0.20
INITIAL_ENTRY_PCT_OF_PORTFOLIO=0.15
STRONG_INITIAL_ENTRY_PCT_OF_PORTFOLIO=0.20
SELL_PCT_OF_HOLDING=0.25
MIN_TRADE_USDT=5
MIN_USDT_RESERVE_PCT=0.20
MAX_ASSET_ALLOCATION_PCT=0.50
TARGET_DAILY_VOLATILITY_PCT=3
MAX_DAILY_VOLATILITY_PCT=10
MAX_SPREAD_PCT=0.25
MIN_BEAR_REBOUND_SCORE=0.62
ESTIMATED_SLIPPAGE_PCT=0.03
MAX_MARKET_SLIPPAGE_PCT=0.20
MIN_TRADABLE_RANGE_TO_COST_RATIO=2.50
MAX_PORTFOLIO_DRAWDOWN_PCT=3
MAX_COMPLETED_ORDERS_24H=8
MAX_BUYS_PER_CYCLE=2
ALLOCATION_DEADBAND_PCT=3
MIN_POLICY_CONFIDENCE=0.58
MIN_SELL_CONFIDENCE=0.60
MIN_DIRECTIONAL_EDGE=0.15
MIN_SETUP_SCORE=2.00
MIN_EXPECTED_NET_EDGE_PCT=0.05
MIN_LIQUIDITY_PROBABILITY=0.55
DISORDERLY_PROBABILITY=0.70
CUT_POSITION_PROBABILITY=0.72
WAIT_CLOSE_TTL_MINUTES=30
WAIT_RETEST_TTL_MINUTES=120
MACRO_CACHE_HOURS=6
BOT_RUN_RETENTION_DAYS=45
DAILY_HISTORY_RETENTION_DAYS=1825
ORDER_HISTORY_RETENTION_DAYS=730
MACRO_HISTORY_RETENTION_DAYS=730
ALLOW_LIVE_TRADING=false
```

`BOT_RUN_RETENTION_DAYS` ayrıntılı Jev/market JSON kayıtlarının ve bunlara bağlı 15 dakikalık ham snapshot'ların saklama süresidir. Cleanup bu kayıtları silmeden önce son günlük sermaye noktasını `daily_portfolio_snapshots` tablosuna hem UTC hem Europe/Istanbul günü için aktarır. `DAILY_HISTORY_RETENTION_DAYS` uzun vadeli grafiği, `ORDER_HISTORY_RETENTION_DAYS` yalnızca açık olmayan eski emirleri, `MACRO_HISTORY_RETENTION_DAYS` ise makro geçmişini sınırlar. Bakım her sahip olunan cron turunun sonunda çalışır ve başarısız olması trading turunun sonucunu geriye dönük olarak değiştirmez.

En az birkaç başarılı gözlem çevrimi ve dashboard doğrulaması sonrasında yalnızca Demo Trading için:

```env
TRADING_ENABLED=true
```

`BYBIT_ACCOUNT_ENV=mainnet` tek başına yeterli değildir; gerçek hesap için ayrıca `ALLOW_LIVE_TRADING=true` gerekir. Bu ikinci kilit yanlışlıkla gerçek emir gönderilmesini önler, ancak üretim güvenlik incelemesinin yerine geçmez.

### 6. Cron güvenliği

En az 32 rastgele karakter kullanın:

```env
CRON_SECRET=...
```

Bu değeri Vercel Production Environment Variables alanına ekleyin. cron-job.org görevinde de aynı değeri `Authorization: Bearer ...` istek başlığı olarak kullanın. URL query parametresi desteklenmez; secret URL'ye veya loglara yazılmamalıdır.

Yerel manuel test:

```powershell
curl.exe -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron
```

cron-job.org üzerinde görev oluşturun:

1. URL: `https://YOUR_PROJECT.vercel.app/api/cron`
2. İstek yöntemi: `GET`
3. Zamanlama: her saat `00`, `15`, `30`, `45` dakikaları
4. Zaman dilimi: `UTC`
5. İstek başlığı: `Authorization` = `Bearer YOUR_CRON_SECRET`
6. Mümkünse istek zaman aşımını `60` saniye yapın ve yanıt gövdesi saklamayı kapatın.

Görevi önce **Test run** ile çalıştırın. Başarılı cevap `200` ve `{"success":true,...}` döndürür. Aynı 15 dakikalık pencere daha önce çalıştıysa güvenli biçimde `skipped:true` dönebilir.

### 7. Yerel doğrulama

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run strategy:report
npm run dev
```

Kontrol adresleri:

- Dashboard: `http://localhost:3000`
- Durum API: `http://localhost:3000/api/state`
- Hazırlık kontrolü: `http://localhost:3000/api/health`

### 8. Yerel tarihsel simülasyon

Simülasyon için `.env.local` içinde yerel PostgreSQL bağlantısını ayrıca tanımlayın. Aynı yerel veritabanı kullanılabilir; veriler ayrı `simulation` şemasında tutulur:

```env
BACKTEST_DATABASE_URL=postgresql://postgres:URL_ENCODED_PASSWORD@127.0.0.1:5432/jev-trader-bybit?sslmode=disable
ALLOW_REMOTE_BACKTEST_DB=false
BACKTEST_INITIAL_CAPITAL_USDT=1000
BACKTEST_TAKER_FEE_PCT=0.10
BACKTEST_SLIPPAGE_PCT=0.03
```

```powershell
npm run simulation:setup
npm run backtest:smoke
$env:BACKTEST_CONFIRM_JEV_USAGE="true"
npm run backtest:2d
Remove-Item Env:BACKTEST_CONFIRM_JEV_USAGE
npm run backtest:report
npm run backtest:inspect
```

`backtest:smoke` bir Jev çağrısı, tam iki günlük koşu 192 Jev çağrısı yapar. Tam koşu bu nedenle açık onay değişkeni olmadan başlamaz. Simülasyon kodu uzak veritabanını varsayılan olarak reddeder; üretim Neon/Vercel veritabanına yazmak için güvenlik kilidini kaldırmayın. Rapor sonucu yalnız iki günlük boru hattı tanısıdır ve kârlılık kanıtı değildir.

### 9. Vercel yayını

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fnevzataksoy%2Fjev-trader-bybit)

1. GitHub reposunu Vercel'e import edin.
2. Neon/PostgreSQL entegrasyonunu aynı projeye bağlayın.
3. `.env.example` içindeki değişkenleri Production environment'a ekleyin.
4. İlk deploy sırasında `TRADING_ENABLED=false` kullanın.
5. `/api/health`, dashboard ve manuel cron çağrısını doğrulayın.
6. cron-job.org görevini yukarıdaki URL, zamanlama ve Bearer başlığıyla oluşturup test edin.
7. cron-job.org geçmişinde çağrının `200` döndüğünü, dashboard'da yeni çevrimin ve snapshot'ın oluştuğunu kontrol edin.
8. Demo Trading spot emirlerini doğruladıktan sonra gerekiyorsa `TRADING_ENABLED=true` yapıp yeniden deploy edin.
9. Üretim URL'sini `NEXT_PUBLIC_APP_URL` olarak ekleyin ve README'deki Live deployment satırını gerçek URL ile değiştirin.

> Depoyu Vercel Hobby ile uyumlu tutmak için `vercel.json` yalnızca `fra1` Frankfurt fonksiyon bölgesini seçer; yerleşik cron tanımı içermez. Bybit ABD çıkışlı istekleri engellediğinden Vercel'in varsayılan `iad1` bölgesi kullanılmaz. Zamanlama cron-job.org tarafından gerçekleştirilir.

---

## English

### Requirements

- Node.js 20+
- Bybit Demo Trading API key
- TypeSafe Jev API key
- Neon/PostgreSQL connected through Vercel Marketplace or directly
- A free cron-job.org account for the 15-minute trigger

### 1. Local setup

```bash
git clone https://github.com/nevzataksoy/jev-trader-bybit.git
cd jev-trader-bybit
npm ci
```

Copy `.env.example` to `.env.local`. Keep real credentials only in `.env.local`, a secure secret manager, or Vercel Environment Variables.

### 2. Providers

Switch the verified mainnet account to [Demo Trading](https://www.bybit.com/en/derivative-activity/demo-trading), then create the key from the API page reached inside Demo Trading. The demo account has a separate UID, so its key may not appear in the normal main-account key list.

```env
BYBIT_ACCOUNT_ENV=demo
BYBIT_API_KEY=...
BYBIT_API_SECRET=...
```

Demo keys must use `https://api-demo.bybit.com`; selecting `testnet` produces Bybit error `10003`. Grant only the required read and spot-order permissions. The application only uses Unified spot data for USDT/BTC/ETH/XAUT and excludes USDC plus futures/options positions from its decision portfolio.

Configure the official TypeSafe SDK:

```env
TYPESAFE_API_KEY=...
JEV_MODEL_NAME=jev-1.13.0
```

Daily Treasury, real-yield and breakeven context comes from the official FRED CSV feed and needs no separate API key. Successful observations are cached in PostgreSQL; a provider failure marks the last observation stale instead of inventing a new macro signal.

### 3. Database

For local PostgreSQL 17, URL-encode the password and use:

```env
DATABASE_URL=postgresql://postgres:URL_ENCODED_PASSWORD@127.0.0.1:5432/jev-trader-bybit?sslmode=disable
```

Use the pooled connection URL supplied by Neon for Vercel, normally with `sslmode=require`. The `postgres` driver supports both the local server and Neon/Vercel.

Provision a Neon/PostgreSQL integration from Vercel Marketplace and set:

```env
DATABASE_URL=postgresql://...
```

Initialize it locally or from an approved deployment shell:

```bash
npm run db:setup
```

### 4. Safe rollout

Start in observation mode:

```env
TRADING_ENABLED=false
MIN_CONFIDENCE_THRESHOLD=0.72
BUY_PCT_OF_USDT=0.20
INITIAL_ENTRY_PCT_OF_PORTFOLIO=0.15
STRONG_INITIAL_ENTRY_PCT_OF_PORTFOLIO=0.20
SELL_PCT_OF_HOLDING=0.25
MIN_TRADE_USDT=5
MIN_USDT_RESERVE_PCT=0.20
MAX_ASSET_ALLOCATION_PCT=0.50
TARGET_DAILY_VOLATILITY_PCT=3
MAX_DAILY_VOLATILITY_PCT=10
MAX_SPREAD_PCT=0.25
MIN_BEAR_REBOUND_SCORE=0.62
ESTIMATED_SLIPPAGE_PCT=0.03
MAX_MARKET_SLIPPAGE_PCT=0.20
MIN_TRADABLE_RANGE_TO_COST_RATIO=2.50
MAX_PORTFOLIO_DRAWDOWN_PCT=3
MAX_COMPLETED_ORDERS_24H=8
MAX_BUYS_PER_CYCLE=2
ALLOCATION_DEADBAND_PCT=3
MIN_POLICY_CONFIDENCE=0.58
MIN_SELL_CONFIDENCE=0.60
MIN_DIRECTIONAL_EDGE=0.15
MIN_SETUP_SCORE=2.00
MIN_EXPECTED_NET_EDGE_PCT=0.05
MIN_LIQUIDITY_PROBABILITY=0.55
DISORDERLY_PROBABILITY=0.70
CUT_POSITION_PROBABILITY=0.72
WAIT_CLOSE_TTL_MINUTES=30
WAIT_RETEST_TTL_MINUTES=120
MACRO_CACHE_HOURS=6
BOT_RUN_RETENTION_DAYS=45
DAILY_HISTORY_RETENTION_DAYS=1825
ORDER_HISTORY_RETENTION_DAYS=730
MACRO_HISTORY_RETENTION_DAYS=730
ALLOW_LIVE_TRADING=false
CRON_SECRET=use_at_least_32_random_characters
```

`BOT_RUN_RETENTION_DAYS` controls detailed Jev/market JSON and linked raw 15-minute snapshots. Before those rows expire, cleanup archives the latest daily equity point for both UTC and Europe/Istanbul in `daily_portfolio_snapshots`. The other retention values govern the long-term chart, closed order history and macro history. Maintenance runs after every owned cron cycle, never deletes open orders, and a cleanup error does not rewrite an otherwise completed trading cycle as failed.

Run several successful cycles, inspect stored snapshots and decisions, and confirm the dashboard before setting `TRADING_ENABLED=true` for Demo Trading.

### 5. Quality and local run

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run strategy:report
npm run dev
```

Use `/api/health` to check configuration readiness without exposing secret values. Manually invoke the cron with:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron
```

Create a job at cron-job.org:

1. URL: `https://YOUR_PROJECT.vercel.app/api/cron`
2. Request method: `GET`
3. Schedule: minutes `00`, `15`, `30`, `45` of every hour
4. Time zone: `UTC`
5. Request header: `Authorization` = `Bearer YOUR_CRON_SECRET`
6. If available, set the timeout to `60` seconds and disable response-body storage.

Run **Test run** first. A successful request returns HTTP `200` with `{"success":true,...}`. If that 15-minute window was already processed, `skipped:true` is also a safe successful result.

### 6. Local historical simulation

Add a dedicated local connection to `.env.local`. It may point to the same local database because all backtest records live in the separate `simulation` schema:

```env
BACKTEST_DATABASE_URL=postgresql://postgres:URL_ENCODED_PASSWORD@127.0.0.1:5432/jev-trader-bybit?sslmode=disable
ALLOW_REMOTE_BACKTEST_DB=false
BACKTEST_INITIAL_CAPITAL_USDT=1000
BACKTEST_TAKER_FEE_PCT=0.10
BACKTEST_SLIPPAGE_PCT=0.03
```

```powershell
npm run simulation:setup
npm run backtest:smoke
$env:BACKTEST_CONFIRM_JEV_USAGE="true"
npm run backtest:2d
Remove-Item Env:BACKTEST_CONFIRM_JEV_USAGE
npm run backtest:report
npm run backtest:inspect
```

The smoke command makes one Jev call; the full two-day replay makes 192. The full run is blocked without explicit usage confirmation. Remote databases are rejected by default so simulation rows cannot accidentally pollute Neon/Vercel production. A two-day report is a pipeline diagnostic, not evidence of profitability.

### 7. Vercel deployment

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fnevzataksoy%2Fjev-trader-bybit)

1. Import the GitHub repository into Vercel.
2. Attach the Neon/PostgreSQL integration.
3. Add all `.env.example` variables to the Production environment.
4. Keep `TRADING_ENABLED=false` for the first deployment.
5. Verify `/api/health`, the dashboard and a manual authenticated cron request.
6. Create and test the cron-job.org job with the URL, schedule and Bearer header above.
7. Confirm an HTTP `200` in cron-job.org history and a new cycle/snapshot on the dashboard.
8. Enable Demo Trading spot execution only after the observation run is healthy.
9. Set `NEXT_PUBLIC_APP_URL` and replace the README live-deployment placeholder with the real Vercel URL.

The repository's `vercel.json` selects only the `fra1` Frankfurt Function region and intentionally defines no native Vercel Cron, so it remains compatible with Hobby. Bybit blocks US-origin requests, so the default Vercel `iad1` region is not used. Scheduling is handled by cron-job.org.

---

## A/B motor kurulumu / A/B engine setup

İlk ileriye dönük karşılaştırma için aynı değerleri yerelde ve Vercel Production Environment Variables alanında kullanın:

```env
STRATEGY_RUN_MODE=ab_test
EXCHANGE_EXECUTION_ENGINE=none
AB_ENGINE_IDS=model1-blind-v4,model2-blind-v4
AB_EXPERIMENT_ID=model1-blind-v4-vs-model2-blind-v4
AB_INITIAL_CAPITAL_USDT=1000
AB_MIN_DAYS=42
AB_MIN_FILLED_ORDERS_PER_ENGINE=30
EXPERIMENT_DETAIL_RETENTION_DAYS=180
```

Şemayı deploy öncesinde hedef veritabanına bir kez uygulayın:

```bash
npm run db:setup
```

İlk başarılı cron çağrısı `strategy_experiments`, `shared_market_snapshots`, `engine_runs`, `engine_portfolios`, `engine_equity_snapshots`, `engine_orders` ve stateful doğrulama için `engine_pending_signals` kayıtlarını başlatır. `/api/health` cevabında `strategyRunMode=ab_test`, `exchangeRoutingAllowed=false` ve `exchangeRoutingReason=ab_test_lock` görülmelidir. Karşılaştırma ekranı `/models`, salt veri endpoint'i `/api/models/state` adresindedir.

To run the forward comparison, configure the same variables locally and in Vercel Production, apply the schema once with `npm run db:setup`, and invoke the authenticated cron. The first successful cycle creates the experiment and both 1,000-USDT paper ledgers. Verify the hard lock through `/api/health` before observing results at `/models`.

A/B tamamlandıktan sonra tek motor çalıştırmak için örnek:

```env
STRATEGY_RUN_MODE=model2-blind-v4
EXCHANGE_EXECUTION_ENGINE=model2-blind-v4
TRADING_ENABLED=true
```

Bu örnek yalnızca Demo Trading için kullanılmalıdır. `STRATEGY_RUN_MODE=ab_test` olduğu sürece diğer iki değer ne olursa olsun borsa iletimi kapalı kalır.

Model dosyaları `lib/strategy/models` klasöründedir. `npm run dev`, `npm run build` ve kalite komutları öncesinde registry otomatik oluşturulur. Bir modeli kaldırmak için yalnızca ilgili `.ts` dosyasını silin. Aktif bir A/B deneyindeki motor setini değiştirirseniz eski kayıtlarla karışmaması için yeni bir `AB_EXPERIMENT_ID` kullanın; uygulama aynı deney kimliğini farklı motor setiyle kullanmayı reddeder.

Strategy models live under `lib/strategy/models`. The registry is regenerated automatically before development, build and quality commands. Delete a model file to remove that engine. When changing the engines in an A/B test, use a new `AB_EXPERIMENT_ID`; the application rejects reusing an existing experiment id with a different engine set.

Backtest motorunu aynı registry üzerinden seçmek için `BACKTEST_STRATEGY_ENGINE=model1-blind` kullanın.
