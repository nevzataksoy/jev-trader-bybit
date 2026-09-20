# Installation and Vercel Deployment / Kurulum ve Vercel Yayını

[Türkçe](#türkçe) · [English](#english)

---

## Türkçe

### Gereksinimler

- Node.js 20 veya üzeri
- Bybit Testnet API anahtarı
- TypeSafe Jev API anahtarı
- Neon veya Vercel Marketplace üzerinden bağlanmış PostgreSQL
- 15 dakikalık yerleşik cron için Vercel Pro/Enterprise

### 1. Yerel kurulum

```bash
git clone https://github.com/nevzataksoy/jev-trader-bybit.git
cd jev-trader-bybit
npm ci
```

`.env.example` dosyasını `.env.local` olarak kopyalayın. Gerçek anahtarları yalnızca `.env.local`, güvenli secret yöneticisi veya Vercel Environment Variables alanında tutun.

### 2. Bybit Testnet

Anahtarları [Bybit Testnet API Management](https://testnet.bybit.com/en/app/user/api-management) sayfasından oluşturun.

```env
BYBIT_ACCOUNT_ENV=testnet
BYBIT_API_KEY=...
BYBIT_API_SECRET=...
```

- Anahtara sadece ihtiyaç duyulan okuma ve spot emir izinlerini verin.
- Mümkünse sabit Vercel çıkış IP çözümü kullanarak IP kısıtlaması uygulayın.
- Secret yalnızca oluşturulurken gösterilir; repoya veya issue içeriğine eklemeyin.
- Bu adresteki anahtarlar Bybit'in ayrı Demo Trading hizmetine değil, **Testnet** ortamına aittir. Proje bu nedenle `testnet` kullanır.

### 3. TypeSafe Jev

TypeSafe konsolundan API anahtarı oluşturun:

```env
TYPESAFE_API_KEY=...
JEV_MODEL_NAME=jev-1.13.0
```

Uygulama resmî [`@typesafe-ai/sdk`](https://github.com/typesafe-ai/typesafe-sdk-js) paketini ve `systemOne({ state, questions })` çağrısını kullanır.

### 4. PostgreSQL

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
ALLOW_LIVE_TRADING=false
```

En az birkaç başarılı gözlem çevrimi ve dashboard doğrulaması sonrasında yalnızca Testnet için:

```env
TRADING_ENABLED=true
```

`BYBIT_ACCOUNT_ENV=mainnet` tek başına yeterli değildir; gerçek hesap için ayrıca `ALLOW_LIVE_TRADING=true` gerekir. Bu ikinci kilit yanlışlıkla gerçek emir gönderilmesini önler, ancak üretim güvenlik incelemesinin yerine geçmez.

### 6. Cron güvenliği

En az 32 rastgele karakter kullanın:

```env
CRON_SECRET=...
```

Vercel bu değeri `/api/cron` çağrısına otomatik olarak `Authorization: Bearer ...` başlığıyla ekler. URL query parametresi desteklenmez; secret loglara sızdırılmamalıdır.

Yerel manuel test:

```powershell
curl.exe -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron
```

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
6. Vercel Cron ekranında `*/15 * * * *` görevinin aktif olduğunu kontrol edin.
7. Testnet emirlerini doğruladıktan sonra gerekiyorsa `TRADING_ENABLED=true` yapıp yeniden deploy edin.
8. Üretim URL'sini `NEXT_PUBLIC_APP_URL` olarak ekleyin ve README'deki Live deployment satırını gerçek URL ile değiştirin.

> Vercel Hobby, günde birden sık cron ifadesini deploy etmez. Pro/Enterprise kullanın veya harici zamanlayıcıyı aynı Authorization başlığıyla `/api/cron` adresine yönlendirin.

---

## English

### Requirements

- Node.js 20+
- Bybit Testnet API key
- TypeSafe Jev API key
- Neon/PostgreSQL connected through Vercel Marketplace or directly
- Vercel Pro/Enterprise for the built-in 15-minute cron

### 1. Local setup

```bash
git clone https://github.com/nevzataksoy/jev-trader-bybit.git
cd jev-trader-bybit
npm ci
```

Copy `.env.example` to `.env.local`. Keep real credentials only in `.env.local`, a secure secret manager, or Vercel Environment Variables.

### 2. Providers

Create account credentials at [Bybit Testnet API Management](https://testnet.bybit.com/en/app/user/api-management):

```env
BYBIT_ACCOUNT_ENV=testnet
BYBIT_API_KEY=...
BYBIT_API_SECRET=...
```

Keys created on that host are Testnet keys, not keys for Bybit's separate Demo Trading service. Grant only the required read and spot-order permissions.

Configure the official TypeSafe SDK:

```env
TYPESAFE_API_KEY=...
JEV_MODEL_NAME=jev-1.13.0
```

### 3. Database

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
ALLOW_LIVE_TRADING=false
CRON_SECRET=use_at_least_32_random_characters
```

Run several successful cycles, inspect stored snapshots and decisions, and confirm the dashboard before setting `TRADING_ENABLED=true` for Testnet.

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

### 6. Vercel deployment

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fnevzataksoy%2Fjev-trader-bybit)

1. Import the GitHub repository into Vercel.
2. Attach the Neon/PostgreSQL integration.
3. Add all `.env.example` variables to the Production environment.
4. Keep `TRADING_ENABLED=false` for the first deployment.
5. Verify `/api/health`, the dashboard and a manual authenticated cron request.
6. Confirm the `*/15 * * * *` job in Vercel's Cron Jobs page.
7. Enable Testnet execution only after the observation run is healthy.
8. Set `NEXT_PUBLIC_APP_URL` and replace the README live-deployment placeholder with the real Vercel URL.

Vercel Hobby only permits daily cron execution. Use Pro/Enterprise for the native 15-minute schedule or call `/api/cron` from an external scheduler with the same Bearer authorization header.
