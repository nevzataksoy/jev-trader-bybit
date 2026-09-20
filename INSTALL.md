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
SELL_PCT_OF_HOLDING=0.25
MIN_TRADE_USDT=5
MIN_USDT_RESERVE_PCT=0.20
MAX_ASSET_ALLOCATION_PCT=0.50
TARGET_DAILY_VOLATILITY_PCT=3
MAX_DAILY_VOLATILITY_PCT=10
MAX_SPREAD_PCT=0.25
MIN_BEAR_REBOUND_SCORE=0.62
ALLOW_LIVE_TRADING=false
```

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
npm run dev
```

Kontrol adresleri:

- Dashboard: `http://localhost:3000`
- Durum API: `http://localhost:3000/api/state`
- Hazırlık kontrolü: `http://localhost:3000/api/health`

### 8. Vercel yayını

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
SELL_PCT_OF_HOLDING=0.25
MIN_TRADE_USDT=5
MIN_USDT_RESERVE_PCT=0.20
MAX_ASSET_ALLOCATION_PCT=0.50
TARGET_DAILY_VOLATILITY_PCT=3
MAX_DAILY_VOLATILITY_PCT=10
MAX_SPREAD_PCT=0.25
MIN_BEAR_REBOUND_SCORE=0.62
ALLOW_LIVE_TRADING=false
CRON_SECRET=use_at_least_32_random_characters
```

Run several successful cycles, inspect stored snapshots and decisions, and confirm the dashboard before setting `TRADING_ENABLED=true` for Demo Trading.

### 5. Quality and local run

```bash
npm run lint
npm run typecheck
npm run test
npm run build
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

### 6. Vercel deployment

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
