# Jev Pulse — Autonomous Bybit Spot Trading Lab

[Türkçe](#türkçe) · [English](#english) · [Installation](./INSTALL.md) · [Deploy on Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fnevzataksoy%2Fjev-trader-bybit)

> Live deployment URL: set `NEXT_PUBLIC_APP_URL` after the first Vercel deployment and replace this line with the production URL.

---

## Türkçe

### Proje

Jev Pulse; **USDT, BTC, ETH ve XAUT** arasında çalışan, canlı piyasa verilerini TypeSafe Jev ile değerlendiren ve doğrulanan kararları izole bir Bybit Demo Trading spot hesabında uygulayan açık kaynak bir referans uygulamadır.

Uygulama iki veri düzlemini bilinçli olarak ayırır:

- **Canlı piyasa zekâsı:** Fiyat, 15 dakikalık mum, order book, 24 saatlik değişim ve mevcut türev sinyalleri Bybit ana ağından alınır.
- **İzole yürütme:** Bakiye, açık emir, emir geçmişi, gerçekleşmeler ve yeni spot emirler ana hesaptan ayrı UID'ye sahip Demo Trading hesabına aittir; özel istekler `api-demo.bybit.com` üzerinden gider.

Bu ayrım, Jev'in güncel piyasa koşullarını değerlendirmesini sağlarken geliştirme aşamasındaki emirleri gerçek bakiyeden uzak tutar.

### Sayısal karar modeli

Bot haber, sosyal medya yorumu veya serbest metin piyasa tahmini kullanmaz. Her varlık için 15 dakika ile 30 gün arasındaki getiriler, EMA yapısı ve eğimi, RSI, MACD, ATR, Bollinger konumu/z-skoru, ADX/+DI/−DI, 24 saatlik gerçekleşen oynaklık, göreli hacim, spread, 50 kademe emir defteri derinliği/dengesizliği, fonlama ve açık pozisyon değişimi hesaplanır.

Uygulama bu ölçümlerden deterministik olarak `bull_trend`, `bear_trend`, `range` veya `transition` rejimi üretir. Jev aynı yapılandırılmış durumu üç bağımsız, tipli `buy | sell | hold` sorusuyla değerlendirir. Jev hesap makinesi veya sohbet belleği olarak kullanılmaz; hesaplamalar, kalıcı geçmiş, pozisyon boyutlandırma ve emir izinleri kodun sorumluluğundadır.

Düşüş rejiminde yeni alım ancak kısa dönem momentum, aşırı satış, hacim ve emir defteri talebini birleştiren rebound skoru güvenlik eşiğini aşarsa yürütülebilir. Satışlar sermayeyi USDT'ye taşıyabilir. Yatay rejimde ise z-skoru ve bant konumu ortalamaya dönüş fırsatlarının değerlendirilmesini sağlar. Tüm alımlar USDT rezervi, tek-varlık yoğunlaşması, spread ve volatilite kapılarından geçer; boyut gerçekleşen oynaklığa göre küçültülür.

### 15 dakikalık karar döngüsü

```text
cron-job.org
   │
   ├─ Bybit Demo spot ────> bakiyeler + açık emirler + emir/gerçekleşme geçmişi
   ├─ Bybit ana ağı ──────> fiyat + mumlar + order book + piyasa göstergeleri
   │
   ├─ PostgreSQL ─────────> çevrim kilidi + snapshot + kalıcı işlem günlüğü
   │
   └─ TypeSafe Jev ───────> BTC / ETH / XAUT için buy | sell | hold
                                  │
                         güven ve risk kapıları
                                  │
                         Bybit Demo spot emri
```

Jev yalnızca tipli bir karar üretir. Emir miktarı, izin verilen varlıklar, minimum tutar, lot hassasiyeti, açık emir kontrolü, güven eşiği ve tekrar çalıştırma güvenliği uygulama kodunun sorumluluğundadır.

### Güvenlik ve operasyon özellikleri

- Varsayılan hesap ortamı `demo`; gerçek ana ağ işlemleri ayrıca kilitlidir.
- `TRADING_ENABLED=false` iken Jev kararları kaydedilir ancak emir gönderilmez.
- Aynı 15 dakikalık çevrim PostgreSQL benzersiz anahtarı sayesinde ikinci kez emir üretemez.
- Eksik kritik veri veya API hatasında sistem emir göndermeden kapanır.
- Her emir için benzersiz `orderLinkId` oluşturulur.
- Hedef varlıklar kod seviyesinde USDT, BTC, ETH ve XAUT ile sınırlandırılmıştır.
- Bybit’in sembol bazlı minimum miktar ve adım kuralları emirden önce okunur.
- Cron endpoint’i yalnızca Vercel ortamındaki `CRON_SECRET` ile eşleşen Bearer başlığıyla çalışır.
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
- Local PostgreSQL and Neon-compatible storage via `postgres`
- Vercel Hobby + cron-job.org zamanlayıcısı
- Vitest, ESLint and TypeScript quality gates

### Zamanlayıcı

Proje Vercel Hobby ile deploy edilebilmesi için yerleşik Vercel Cron tanımı içermez. cron-job.org her saatin `00, 15, 30, 45` dakikalarında `GET https://<uygulama-adresi>/api/cron` çağrısı yapar ve Vercel'deki `CRON_SECRET` ile aynı değeri `Authorization: Bearer <secret>` başlığında gönderir. Vercel fonksiyonları, Bybit'in engellediği varsayılan ABD çıkışı yerine `fra1` Frankfurt bölgesinde çalışır.

### Sorumluluk reddi

Bu yazılım Jev entegrasyonunu gösteren deneysel bir referans uygulamadır ve yatırım tavsiyesi değildir. Kripto varlık işlemleri önemli kayıp riski taşır. Demo Trading sonuçları gerçek piyasa performansını, likiditeyi veya kaymayı temsil etmeyebilir. Gerçek hesap kullanımı öncesinde bağımsız güvenlik, strateji, mevzuat ve risk değerlendirmesi yapılmalıdır. Proje sahipleri ve katkıda bulunanlar işlem kayıplarından sorumlu değildir.

---

## English

### Project

Jev Pulse is an open-source reference application that rotates capital across **USDT, BTC, ETH and XAUT**, evaluates live market state with TypeSafe Jev, and applies validated decisions inside an isolated Bybit Demo Trading spot account.

The application deliberately separates two data planes:

- **Live market intelligence:** prices, 15-minute candles, order book, 24-hour movement and available derivative signals come from Bybit mainnet.
- **Isolated execution:** balances, open orders, history, executions and new spot orders belong to a Demo Trading account with its own UID; private calls use `api-demo.bybit.com`.

This lets Jev evaluate current market conditions while keeping development orders away from real funds.

### Quantitative decision model

The bot does not consume news, social commentary or free-form market forecasts. It computes 15-minute through 30-day returns, EMA structure and slope, RSI, MACD, ATR, Bollinger position/z-score, ADX/+DI/−DI, 24-hour realized volatility, relative volume, spread, 50-level order-book depth/imbalance, funding and open-interest changes.

Application code deterministically labels each asset as `bull_trend`, `bear_trend`, `range` or `transition`. Jev judges that structured state through three independent typed `buy | sell | hold` questions. It is not used as a calculator or conversational memory: calculations, persistent context, sizing and execution permissions remain in code.

Bear-regime buys require a separate rebound score combining short-horizon momentum, oversold statistics, volume and order-book demand. Sells may rotate capital into USDT. Range decisions can use statistical mean-reversion evidence. Every buy is additionally constrained by a USDT reserve, single-asset allocation cap, spread ceiling and volatility-scaled sizing.

### 15-minute decision cycle

Jev returns one typed `buy`, `sell` or `hold` decision for BTC, ETH and XAUT. Application code owns position sizing, the asset allowlist, exchange precision, minimum notional, confidence threshold, open-order checks and idempotency.

Every successful cycle stores:

- A portfolio and price snapshot,
- The live market state supplied to Jev,
- Jev decisions and probabilities,
- Execution-gate outcomes,
- Synced Bybit orders and fill timestamps.

### Safety and operations

- `demo` is the default account environment; real-mainnet execution has an additional lock.
- `TRADING_ENABLED=false` records decisions without submitting orders.
- A PostgreSQL cycle key prevents duplicate execution within the same 15-minute window.
- Missing critical data and provider errors fail closed.
- Exchange instrument filters are loaded before sizing an order.
- The cron endpoint requires a Bearer header matching the `CRON_SECRET` stored in Vercel.
- Secrets remain server-side and are never returned to the dashboard.

### Dashboard

The always-available TR/EN dashboard presents the daily USDT capital curve, asset allocation, live prices, infrastructure status, Jev decisions, confidence and probabilities, execution outcomes, filtered order history, separate order/fill timestamps, an understandable pipeline explanation, and a visible real-account risk disclosure.

### Scheduler

The repository does not include a native Vercel Cron definition, so it can deploy on Vercel Hobby. cron-job.org calls `GET https://<deployment-url>/api/cron` at minutes `00, 15, 30, 45` of every hour and sends the same secret stored in Vercel as `Authorization: Bearer <secret>`. Vercel Functions run in the `fra1` Frankfurt region instead of the default US region blocked by Bybit.

### Disclaimer

This is experimental reference software demonstrating a Jev integration, not investment advice. Crypto trading carries a substantial risk of loss. Demo Trading results may not represent real-market performance, liquidity or slippage. Complete independent security, strategy, legal and risk reviews before any real-account use. Project owners and contributors are not liable for trading losses.

See [INSTALL.md](./INSTALL.md) for local and Vercel setup.
