# Jev Pulse — Autonomous Bybit Spot Trading Lab

[Türkçe](#türkçe) · [English](#english) · [Installation](./INSTALL.md) · [Deploy on Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fnevzataksoy%2Fjev-trader-bybit)

> Live deployment URL: set `NEXT_PUBLIC_APP_URL` after the first Vercel deployment and replace this line with the production URL.

---

## Türkçe

### Proje

Jev Pulse; **USDT, BTC, ETH ve XAUT** arasında çalışan, canlı piyasa verilerini TypeSafe Jev ile değerlendiren ve doğrulanan kararları izole bir Bybit test hesabında uygulayan açık kaynak bir referans uygulamadır.

Uygulama iki veri düzlemini bilinçli olarak ayırır:

- **Canlı piyasa zekâsı:** Fiyat, 15 dakikalık mum, order book, 24 saatlik değişim ve mevcut türev sinyalleri Bybit ana ağından alınır.
- **İzole yürütme:** Bakiye, açık emir, emir geçmişi, gerçekleşmeler ve yeni emirler `testnet.bybit.com` hesabına aittir.

Bu ayrım, Jev'in güncel piyasa koşullarını değerlendirmesini sağlarken geliştirme aşamasındaki emirleri gerçek bakiyeden uzak tutar.

### 15 dakikalık karar döngüsü

```text
Vercel Cron
   │
   ├─ Bybit test hesabı ──> bakiyeler + açık emirler + emir/gerçekleşme geçmişi
   ├─ Bybit ana ağı ──────> fiyat + mumlar + order book + piyasa göstergeleri
   │
   ├─ PostgreSQL ─────────> çevrim kilidi + snapshot + kalıcı işlem günlüğü
   │
   └─ TypeSafe Jev ───────> BTC / ETH / XAUT için buy | sell | hold
                                  │
                         güven ve risk kapıları
                                  │
                         Bybit test hesap emri
```

Jev yalnızca tipli bir karar üretir. Emir miktarı, izin verilen varlıklar, minimum tutar, lot hassasiyeti, açık emir kontrolü, güven eşiği ve tekrar çalıştırma güvenliği uygulama kodunun sorumluluğundadır.

### Güvenlik ve operasyon özellikleri

- Varsayılan hesap ortamı `testnet`; ana ağ işlemleri ayrıca kilitlidir.
- `TRADING_ENABLED=false` iken Jev kararları kaydedilir ancak emir gönderilmez.
- Aynı 15 dakikalık çevrim PostgreSQL benzersiz anahtarı sayesinde ikinci kez emir üretemez.
- Eksik kritik veri veya API hatasında sistem emir göndermeden kapanır.
- Her emir için benzersiz `orderLinkId` oluşturulur.
- Hedef varlıklar kod seviyesinde USDT, BTC, ETH ve XAUT ile sınırlandırılmıştır.
- Bybit’in sembol bazlı minimum miktar ve adım kuralları emirden önce okunur.
- Cron endpoint’i yalnızca Vercel `CRON_SECRET` Bearer başlığıyla çalışır.
- API anahtarları hiçbir zaman istemci paketine veya dashboard cevabına eklenmez.

### Dashboard

TR/EN dashboard aşağıdakileri gösterir:

- Günlük USDT sermaye eğrisi,
- Dört hedef varlığın miktarı, USDT değeri, canlı fiyatı ve portföy payı,
- Bybit ve PostgreSQL bağlantı durumu,
- Son Jev kararları, olasılıklar, güven skoru ve emir kapısı sonucu,
- Sembol, yön ve durum filtreli kalıcı emir geçmişi,
- Emir zamanı ile son gerçekleşme zamanı ayrı alanlarda,
- Botun veri ve karar hattının iki dilde açıklaması,
- Gerçek hesap kullanımı için görünür risk bildirimi.

### Teknoloji

- Next.js 16 / React 19 / TypeScript
- Official `@typesafe-ai/sdk` (`systemOne`, typed choice questions)
- `bybit-api` V5 SDK
- Neon-compatible PostgreSQL via `@neondatabase/serverless`
- Vercel Cron
- Vitest, ESLint and TypeScript quality gates

### Önemli Vercel notu

Vercel Hobby planı cron görevlerini günde yalnızca bir kez çalıştırır. `*/15 * * * *` zamanlaması için **Vercel Pro/Enterprise** veya `/api/cron` adresini aynı Bearer başlığıyla çağıran harici bir zamanlayıcı gerekir.

### Sorumluluk reddi

Bu yazılım Jev entegrasyonunu gösteren deneysel bir referans uygulamadır ve yatırım tavsiyesi değildir. Kripto varlık işlemleri önemli kayıp riski taşır. Testnet sonuçları gerçek piyasa performansını, likiditeyi veya kaymayı temsil etmeyebilir. Gerçek hesap kullanımı öncesinde bağımsız güvenlik, strateji, mevzuat ve risk değerlendirmesi yapılmalıdır. Proje sahipleri ve katkıda bulunanlar işlem kayıplarından sorumlu değildir.

---

## English

### Project

Jev Pulse is an open-source reference application that rotates capital across **USDT, BTC, ETH and XAUT**, evaluates live market state with TypeSafe Jev, and applies validated decisions inside an isolated Bybit test account.

The application deliberately separates two data planes:

- **Live market intelligence:** prices, 15-minute candles, order book, 24-hour movement and available derivative signals come from Bybit mainnet.
- **Isolated execution:** balances, open orders, order history, executions and new orders belong to the `testnet.bybit.com` account.

This lets Jev evaluate current market conditions while keeping development orders away from real funds.

### 15-minute decision cycle

Jev returns one typed `buy`, `sell` or `hold` decision for BTC, ETH and XAUT. Application code owns position sizing, the asset allowlist, exchange precision, minimum notional, confidence threshold, open-order checks and idempotency.

Every successful cycle stores:

- A portfolio and price snapshot,
- The live market state supplied to Jev,
- Jev decisions and probabilities,
- Execution-gate outcomes,
- Synced Bybit orders and fill timestamps.

### Safety and operations

- `testnet` is the default account environment; mainnet execution has an additional lock.
- `TRADING_ENABLED=false` records decisions without submitting orders.
- A PostgreSQL cycle key prevents duplicate execution within the same 15-minute window.
- Missing critical data and provider errors fail closed.
- Exchange instrument filters are loaded before sizing an order.
- The cron endpoint requires Vercel's `CRON_SECRET` Bearer header.
- Secrets remain server-side and are never returned to the dashboard.

### Dashboard

The always-available TR/EN dashboard presents the daily USDT capital curve, asset allocation, live prices, infrastructure status, Jev decisions, confidence and probabilities, execution outcomes, filtered order history, separate order/fill timestamps, an understandable pipeline explanation, and a visible real-account risk disclosure.

### Vercel requirement

Vercel Hobby cron jobs can run only once per day. The `*/15 * * * *` schedule requires **Vercel Pro/Enterprise** or an external scheduler that calls `/api/cron` with the same Bearer authorization header.

### Disclaimer

This is experimental reference software demonstrating a Jev integration, not investment advice. Crypto trading carries a substantial risk of loss. Testnet results may not represent real-market performance, liquidity or slippage. Complete independent security, strategy, legal and risk reviews before any real-account use. Project owners and contributors are not liable for trading losses.

See [INSTALL.md](./INSTALL.md) for local and Vercel setup.
