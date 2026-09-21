# Jev Pulse — Autonomous Bybit Spot Trading Lab

[Türkçe](#türkçe) · [English](#english) · [Installation](./INSTALL.md) · [Deploy on Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fnevzataksoy%2Fjev-trader-bybit)

> Live dashboard: [jev-trader-bybit.vercel.app](https://jev-trader-bybit.vercel.app)

---

## Türkçe

### Proje

Jev Pulse; **USDT, BTC, ETH ve XAUT** arasında çalışan, canlı piyasa verilerini TypeSafe Jev ile değerlendiren ve doğrulanan kararları izole bir Bybit Demo Trading spot hesabında uygulayan açık kaynak bir referans uygulamadır.

Uygulama iki veri düzlemini bilinçli olarak ayırır:

- **Canlı piyasa zekâsı:** Fiyat, 15 dakikalık mum, order book, 24 saatlik değişim ve mevcut türev sinyalleri Bybit ana ağından alınır.
- **İzole yürütme:** Bakiye, açık emir, emir geçmişi, gerçekleşmeler ve yeni spot emirler ana hesaptan ayrı UID'ye sahip Demo Trading hesabına aittir; özel istekler `api-demo.bybit.com` üzerinden gider.

Bu ayrım, Jev'in güncel piyasa koşullarını değerlendirmesini sağlarken geliştirme aşamasındaki emirleri gerçek bakiyeden uzak tutar.

### Sayısal karar modeli

Bot haber, sosyal medya yorumu veya serbest metin piyasa tahmini kullanmaz. Her varlık için 15 dakika ile 30 gün arasındaki getiriler, EMA yapısı ve eğimi, RSI, MACD, ATR, Bollinger konumu/z-skoru, ADX/+DI/−DI, gerçekleşen ve aşağı-yönlü oynaklık, VWAP uzaklığı, trend verimliliği, hacim z-skoru, spread, 50 kademe emir defteri, son işlem akışı, fonlama ve açık pozisyon değişimi hesaplanır. Günlük FRED DGS1/DGS2/DGS10, 10 yıllık reel faiz ve breakeven enflasyon verileri yalnızca yavaş makro rejim bağlamı olarak kullanılır; aynı günlük gözlem her 15 dakikada yeni sinyal sayılmaz.

Teknik göstergeler yalnızca kapanmış mumlardan hesaplanır. Ticker ve emir defteri için Bybit kaynak zamanları, son kapanmış 15 dakikalık mum zamanı ve yerel toplama zamanı ayrı tutulur; bayat veri emirden önce reddedilir. Jev ayrıca pozisyonun elde olup olmadığını, doğrulanabildiğinde ortalama maliyeti/PnL'yi, son işlem zamanını, kullanıcıya özel spot komisyonunu ve 24 saatlik portföy riskini görür.

Uygulama bu ölçümlerden deterministik olarak `bull_trend`, `bear_trend`, `range`, `compression` veya `transition` rejimi üretir. Önceki 24 saat, 3 gün ve 7 günlük fiyat kanallarındaki konum; önceki tepe/dibe ATR uzaklığı, 12 saatlik swing yapısı, haftalık Bollinger genişliği yüzdeliği ve mum gövde/fitil yapısı ayrıca hesaplanır. Mamis evresi ve günlük makro veriler doğrudan hedef ağırlık çarpanı değil, ikincil bağlamdır.

Jev her varlık için rejim, en uygun setup (`trend_pullback`, `upside_breakout`, `range_reversion`, `bear_rebound`, `reduce`, `none`), giriş hazırlığı, yön, devam, false-breakout riski, dönüş teyidi, setup kalitesi ve likiditeyi atomik tipli sorularla değerlendirir. Portföy düzeyinde en iyi sermaye hedefini ve toplam risk bütçesini seçer. Kod yalnızca yapı kapısından geçen ve komisyon, spread ve kayma sonrası pozitif beklenen değere sahip setup'ları boyutlandırır; hedef ile mevcut ağırlık arasındaki fark deadband dışındaysa `buy | sell`, aksi halde `hold` oluşur.

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
   └─ TypeSafe Jev ───────> atomik yargılar → kodda hedef ağırlık → buy | sell | hold
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
- Market emirleri yapılandırılabilir Bybit yüzde kayma toleransı kullanır; emir kabulü gerçekleşme sayılmaz ve geçmiş/fill verisiyle uzlaştırılır.
- Yeni alımlar komisyon, spread ve tahmini kaymaya karşı ATR/maliyet oranı; varlık cooldown'ı, 24 saatlik drawdown ve işlem sayısı sınırlarından geçer.
- Risk azaltan satışlar önce yürütülür; bağımsız Jev alımları fırsat gücüne göre sıralanır ve bir çevrimdeki yeni pozisyon sayısı sınırlandırılır.
- Cron endpoint’i yalnızca Vercel ortamındaki `CRON_SECRET` ile eşleşen Bearer başlığıyla çalışır.
- API anahtarları hiçbir zaman istemci paketine veya dashboard cevabına eklenmez.
- Her sahip olunan 15 dakikalık turun sonunda bakım çalışır: günlük sermaye kayıtları UTC ve Europe/Istanbul bazında uzun vadeli arşivlenir; ayrıntılı tur JSON'ları, tamamlanmış eski emirler ve makro snapshot'lar yapılandırılabilir saklama sürelerine göre temizlenir. Açık emirler cleanup tarafından silinmez.

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
- Official `@typesafe-ai/sdk` (`systemOne`, typed Choice/Score/Noul questions)
- `bybit-api` V5 SDK
- Local PostgreSQL and Neon-compatible storage via `postgres`
- Vercel Hobby + cron-job.org zamanlayıcısı
- Vitest, ESLint and TypeScript quality gates

### Zamanlayıcı

Proje Vercel Hobby ile deploy edilebilmesi için yerleşik Vercel Cron tanımı içermez. cron-job.org her saatin `00, 15, 30, 45` dakikalarında `GET https://<uygulama-adresi>/api/cron` çağrısı yapar ve Vercel'deki `CRON_SECRET` ile aynı değeri `Authorization: Bearer <secret>` başlığında gönderir. Vercel fonksiyonları, Bybit'in engellediği varsayılan ABD çıkışı yerine `fra1` Frankfurt bölgesinde çalışır.

### Yerel tarihsel simülasyon

Üretim tablolarından ayrılmış `simulation` PostgreSQL şeması, son 48 saatin 192 adet 15 dakikalık karar çevrimini aynı Jev, hedef tahsis ve risk fonksiyonlarından geçirir. Göstergeler yalnız karar anında kapanmış mumlardan hesaplanır; sanal emir bir sonraki 15 dakikalık mumun açılışında ters yönlü kayma ve taker ücretiyle gerçekleşir. Geçmiş order-book REST verisi bulunmadığı için nötr proxy açıkça etiketlenir, geçmiş trade-flow ise uydurulmadan `unavailable` gönderilir.

`npm run simulation:setup` yerel şemayı hazırlar. `npm run backtest:smoke` tek Jev çağrılı uçtan uca testtir. Tam çalışma 192 model çağrısı yapacağı için önce `BACKTEST_CONFIRM_JEV_USAGE=true` ayarlanmalı, ardından `npm run backtest:2d` çalıştırılmalıdır. `npm run backtest:report` son raporu, `npm run backtest:inspect` ise eşik dağılımlarını ve maliyet sonrası ileri getiri tanısını gösterir. Simülasyon bağlantısı varsayılan olarak yalnız localhost kabul eder ve Vercel/Neon üretim veritabanına yazmaz.

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

The bot does not consume news, social commentary or free-form market forecasts. It computes 15-minute through 30-day returns, EMA structure and slope, RSI, MACD, ATR, Bollinger position/z-score, ADX/+DI/−DI, realized/downside volatility, VWAP distance, trend efficiency, volume z-score, spread, 50-level depth, recent trade flow, funding and open-interest changes. Daily FRED DGS1/DGS2/DGS10, ten-year real-yield and breakeven-inflation observations are slow macro context only; one daily observation is never treated as a new signal every fifteen minutes.

Technical indicators use closed candles only. Bybit source times for ticker/order-book data, the latest closed 15-minute candle and local collection time are tracked separately; stale inputs fail closed. Jev also receives position ownership, verified cost basis/PnL when reconstructable, last-trade timing, account-specific spot fees and trailing 24-hour portfolio risk.

Application code derives `bull_trend`, `bear_trend`, `range`, `compression` or `transition` evidence. It also measures location inside prior 24-hour, 3-day and 7-day channels, ATR distance to structural levels, twelve-hour swing structure, weekly Bollinger-width percentile and closed-candle body/wick shape. Mamis and daily macro state remain secondary context rather than direct allocation multipliers.

For each asset, Jev evaluates regime, the best setup (`trend_pullback`, `upside_breakout`, `range_reversion`, `bear_rebound`, `reduce`, `none`), entry readiness, direction, follow-through, false-breakout risk, reversal confirmation, setup quality and liquidity. At portfolio level it selects the preferred capital destination and gross risk budget. Deterministic code sizes only structure-qualified setups with positive expected value after fees, spread and slippage.

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
- Market orders carry a configurable Bybit percentage slippage limit; acknowledgement is reconciled against order/fill history before being marked confirmed.
- Buys must pass fee/spread/slippage range, per-asset cooldown, rolling drawdown and 24-hour order-count gates.
- Risk-reduction sells run first; independent Jev buys are ranked and new exposure per cycle is capped.
- The cron endpoint requires a Bearer header matching the `CRON_SECRET` stored in Vercel.
- Secrets remain server-side and are never returned to the dashboard.
- End-of-cycle maintenance archives daily equity in both UTC and Europe/Istanbul before expiring detailed run JSON, old completed orders and macro snapshots according to configurable retention periods. Open orders are never deleted by cleanup.

### Dashboard

The always-available TR/EN dashboard presents the daily USDT capital curve, asset allocation, live prices, infrastructure status, Jev decisions, confidence and probabilities, execution outcomes, filtered order history, separate order/fill timestamps, an understandable pipeline explanation, and a visible real-account risk disclosure.

### Scheduler

The repository does not include a native Vercel Cron definition, so it can deploy on Vercel Hobby. cron-job.org calls `GET https://<deployment-url>/api/cron` at minutes `00, 15, 30, 45` of every hour and sends the same secret stored in Vercel as `Authorization: Bearer <secret>`. Vercel Functions run in the `fra1` Frankfurt region instead of the default US region blocked by Bybit.

### Local historical simulation

A separate PostgreSQL `simulation` schema replays the last 48 hours as 192 fifteen-minute decisions through the same Jev, target-allocation and risk functions used by production. Indicators use only candles already closed at the decision boundary; virtual fills use the next candle open with adverse slippage and taker fees. Historical REST order-book data is unavailable, so a neutral proxy is explicitly labeled, while missing historical trade flow remains `unavailable` instead of being invented.

Run `npm run simulation:setup`, then use `npm run backtest:smoke` for a one-call end-to-end check. A full run makes 192 model calls and therefore requires `BACKTEST_CONFIRM_JEV_USAGE=true` before `npm run backtest:2d`. Use `npm run backtest:report` for the latest portfolio report and `npm run backtest:inspect` for threshold distributions and cost-adjusted forward-signal diagnostics. The simulation connection accepts localhost by default and does not write to the Vercel/Neon production database.

### Disclaimer

This is experimental reference software demonstrating a Jev integration, not investment advice. Crypto trading carries a substantial risk of loss. Demo Trading results may not represent real-market performance, liquidity or slippage. Complete independent security, strategy, legal and risk reviews before any real-account use. Project owners and contributors are not liable for trading losses.

See [INSTALL.md](./INSTALL.md) for local and Vercel setup.

After enough consecutive snapshots have accumulated, run `npm run strategy:report` to inspect 15-minute, one-hour and four-hour cost-aware outcomes, calibration, context groups, turnover and observed drawdown. Fewer than 500 one-hour asset outcomes are explicitly reported as an insufficient sample; the report is diagnostic and is not proof of profitability.
