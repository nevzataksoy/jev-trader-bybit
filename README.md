# JEV TRADER BYBIT

## Türkçe

### Proje özeti

JEV TRADER BYBIT, USDT / BTC / ETH / XAUT arasında sermaye rotasyonu yapan, Bybit piyasa verilerini kullanan ve TypeSafe Jev üzerinden anonim kanıt toplayan bir işlem motorudur.

Bu repo temiz başlangıç mimarisine geçirilmiştir. Eski V1/V2/V3/V4 isim zinciri kaldırılmıştır. Mevcut eski V4 davranışı başlangıç noktası kabul edilerek iki model ailesi aşağıdaki kimliklerle yeniden başlatılmıştır:

- `model1-v1`
- `model2-v1`

Aktif 42 günlük A/B karşılaştırması `model1-v1` ve `model2-v2` arasında çalışır. Bu pencere içinde onaylı davranış değişiklikleri yeni experiment açmadan `policyRevision` / `configRevision` ile audit edilir; başlangıç/bitiş tarihi ve paper portföy korunur.

### Temel mimari kural

Her model sürümü kendi stratejisinin tamamını kendi klasöründe taşır.

```text
lib/strategy/models/
├── model1/
│   └── v1/
│       ├── index.ts
│       ├── evaluator.ts
│       ├── policy.ts
│       ├── confirmation.ts
│       ├── config.ts
│       └── confirmation.test.ts
└── model2/
    └── v1/
        ├── index.ts
        ├── evaluator.ts
        ├── analysis.ts
        ├── normalizer.ts
        ├── policy.ts
        ├── confirmation.ts
        ├── config.ts
        └── confirmation.test.ts
```

Model sürümleri birbirini import edemez. Registry generator bu kuralı build öncesinde doğrular.

Bu nedenle:

```text
models/model1/v1 silinirse  -> yalnız Model1 V1 kalkar
models/model1 silinirse     -> bütün Model1 ailesi kalkar
models/model2 etkilenmez
```

Yeni bir Model3 eklemek için örnek:

```text
lib/strategy/models/model3/v1/index.ts
```

oluşturulur. Registry build öncesinde bunu otomatik olarak `model3-v1` kimliğiyle keşfeder.

### Ortak platform ile model stratejisi arasındaki sınır

Ortak katman yalnızca modelden bağımsız altyapıyı sağlar:

- Bybit piyasa verisi ve indikatörler
- anonim varlık eşleme / blind payload güvenliği
- ortak snapshot
- paper portfolio ve execution persistence
- exchange hard safety limitleri
- A/B orchestration
- registry/discovery
- PostgreSQL erişimi

Model sürüm klasörü ise kendi stratejik kararlarının sahibidir:

- Jev soruları
- Jev cevabının analizi
- setup / readiness değerlendirmesi
- opportunity ve portfolio scoring
- allocation politikası
- execution sizing ve karar sıralaması
- model-özel parametreler
- wait_close / wait_retest mantığı
- deterministic confirmation
- evidence-weighted confirmation confidence
- nihai buy / hold / sell kararı

Runner artık modelden sonra ortak bir stratejik confirmation katmanı çalıştırmaz. Model sürümü kararını nihai hale getirerek runner'a verir.

### Kör Jev ilkesi

Jev'e gerçek varlık kimliği gönderilmez.

Uygulama BTC / ETH / XAUT değerlerini deterministik anonim slotlara dönüştürür:

```text
candidate_1
candidate_2
candidate_3
```

Payload içinde gerçek sembol, mutlak varlık kimliği ve yasaklı alanlar bulunursa blind payload kontrolü hata verir. Kimlik eşleme uygulama tarafında kalır.

### Cron ve A/B akışı

```text
cron
  ↓
piyasa verisini bir kez çek
  ↓
shared snapshot
  ├── model1-v1 → kendi Jev sorgusu → kendi analiz/policy/confirmation → final karar
  └── model2-v1 → kendi Jev sorgusu → kendi analiz/policy/confirmation → final karar
  ↓
platform safety
  ↓
paper execution / persistence
```

A/B modunda gerçek Bybit emir iletimi kod seviyesinde kapalıdır.

Varsayılan:

```env
STRATEGY_RUN_MODE=ab_test
EXCHANGE_EXECUTION_ENGINE=none
AB_ENGINE_IDS=model1-v1,model2-v2
AB_EXPERIMENT_ID=model1-v1-vs-model2-v2
```


### 42 günlük in-place revision ve yapısal trade ekonomisi

Aktif deneyde engine kimlikleri, paper portföyler ve 42 günlük başlangıç/bitiş tarihi korunur. Strateji/config revizyonları `engine_revisions` tablosunda tekil tutulur; her `engine_run` yalnız `revision_id` taşır. Aynı config JSON her 15 dakikada tekrar yazılmaz.

Entry/exit ekonomisi artık global `ATR/cost >= 2.50` hard gate'ine bağlı değildir. Modeller 15m/1h/4h destek-direnc yapısı, hedef alanı, invalidation mesafesi, reward/risk ve tahmini round-trip maliyeti; RSI/MACD/BB/ADX/VWAP, orderbook wall/flow, OI/funding ve makro bağlamla birlikte değerlendirir. `structure-economics-r3` ile non-breakout setup'larda reward doğrudan gerçek resistance mesafesidir; ATR projection yalnız önünde geçerli resistance alanı bulunmayan `upside_breakout` için fallback olarak kullanılır. R:R, gross/net edge ve target-room kontrolü aynı effective reward üzerinden hesaplanır. Platform stale data, spread, drawdown, aşırı volatilite, reserve/allocation ve order limitleri gibi operasyonel hard safety kontrollerini korur.

Market/makro kanıtı cycle başına tek `shared_market_snapshots` satırında tutulur. Skipped/rejected BUY/SELL denemeleri duplicate order üretmeden mevcut `engine_runs.executions` üzerinden `/models` ekranında görünür. Cleanup ayrı cron kullanmaz; normal 15 dakikalık cron sonunda çalışır.

### Dashboard ve runtime endpoint ayrımı

A/B modunda ana dashboard ile A/B Lab farklı veri yüzeylerini gösterir:

- `/` ve `/api/state`: yapılandırılmış Bybit hesabı, canlı fiyatlar, hesap emirleri, platform bağlantıları ve genel cron durumu.
- `/models` ve `/api/models/state`: `engine_runs`, paper portföyler, paper emirler, equity ve model karar geçmişi.
- `/api/health`: runtime konfigürasyonunun temel readiness/safety özetini verir.

A/B modunda `bot_runs` içindeki ana dashboard kaydı model kararlarının authoritative geçmişi değildir. Model kararlarını ve A/B performansını incelerken `/api/models/state` kullanılmalıdır. Models API ayrıca runtime registry'deki aktif/kayıtlı motorları ve exchange execution engine seçimini döndürür; böylece DB deney kaydı ile çalışan registry karşılaştırılabilir.

### Veritabanı

Temiz proje tek şema kaynağı olarak `database/schema.sql` kullanır. Geçmiş migration kayıtları ve upgrade SQL'leri kaldırılmıştır.

Uygulama runtime sırasında `CREATE TABLE IF NOT EXISTS` ile gerekli tabloları doğrular. Bu nedenle Vercel build aşamasının kendisi DB migration çalıştırmaz; fakat ilk DB kullanan runtime çağrısı, örneğin `/api/cron`, şemayı otomatik oluşturabilir.

İsterseniz deploy öncesinde açıkça:

```bash
npm run db:setup
```

çalıştırabilirsiniz.

Tarihsel local backtest / simulation akışı temiz projeden kaldırılmıştır.

### Kalite komutları

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
```

Kurulum ve Vercel adımları için `INSTALL.md` dosyasına bakın.

---

## English

### Project summary

JEV TRADER BYBIT rotates capital across USDT / BTC / ETH / XAUT using Bybit market data and anonymous TypeSafe Jev evidence.

The repository now uses a clean-baseline model architecture. Historical V1/V2/V3/V4 naming was removed. The former V4 behavior is treated as the initial baseline and is now exposed as:

- `model1-v1`
- `model2-v1`

The active 42-day A/B experiment compares `model1-v1` with `model2-v2`. Approved refinements inside this window are audited with `policyRevision` / `configRevision` without resetting the experiment clock or paper portfolios.

### Core architecture rule

Every model version owns its complete strategy inside its own version directory.

```text
lib/strategy/models/
├── model1/
│   └── v1/
│       ├── index.ts
│       ├── evaluator.ts
│       ├── policy.ts
│       ├── confirmation.ts
│       ├── config.ts
│       └── confirmation.test.ts
└── model2/
    └── v1/
        ├── index.ts
        ├── evaluator.ts
        ├── analysis.ts
        ├── normalizer.ts
        ├── policy.ts
        ├── confirmation.ts
        ├── config.ts
        └── confirmation.test.ts
```

A model version may not import another model family or version. The registry generator enforces this at build time.

Deleting `models/model1/v1` removes only Model1 V1. Deleting `models/model1` removes the full Model1 family without breaking Model2.

To add Model3, create for example:

```text
lib/strategy/models/model3/v1/index.ts
```

The generated registry will discover it as `model3-v1`.

### Platform versus strategy

Shared platform code owns only model-agnostic infrastructure:

- Bybit data and indicators
- blind asset masking
- shared snapshots
- paper portfolio and persistence
- hard execution safety ceilings
- A/B orchestration
- model discovery
- PostgreSQL access

Each version directory owns its strategy:

- Jev questions
- evidence interpretation
- setup/readiness logic
- opportunity and portfolio scoring
- allocation policy
- execution sizing and decision ordering
- model-specific parameters
- wait_close / wait_retest state
- deterministic confirmation
- evidence-weighted confirmation confidence
- final buy / hold / sell decisions

The runner does not apply a shared strategic confirmation layer after the model finishes.

### Blind Jev invariant

Jev never receives BTC / ETH / XAUT identity. Assets are mapped to anonymous candidates and only normalized evidence is sent. The application keeps the private reverse mapping.

### A/B flow

```text
cron
  ↓
fetch market data once
  ↓
shared snapshot
  ├── model1-v1 → Jev → local analysis/policy/confirmation → final decision
  └── model2-v1 → Jev → local analysis/policy/confirmation → final decision
  ↓
platform safety
  ↓
paper execution / persistence
```

Real exchange routing is hard-disabled while `STRATEGY_RUN_MODE=ab_test`.


### 42-day in-place revisions and structural trade economics

The active experiment keeps engine identities, paper portfolios and its planned 42-day start/end window. Policy/config changes are stored once in `engine_revisions`; each `engine_run` carries only a compact `revision_id`.

Entry economics no longer depend on a shared fixed `ATR/cost >= 2.50` hard gate. Model policy evaluates multi-timeframe support/resistance, target room, invalidation distance, reward/risk and estimated round-trip costs, reinforced by RSI/MACD/BB/ADX/VWAP, orderbook flow/walls, OI/funding and macro context. Shared platform risk retains operational hard-safety gates.

Shared market/macro evidence stays deduplicated in one cycle snapshot. Skipped execution attempts reuse `engine_runs.executions` and are surfaced in `/models`; cleanup continues at the end of every normal 15-minute cron cycle with no separate cleanup cron.

### Dashboard and runtime endpoint split

In A/B mode the main dashboard and A/B Lab intentionally expose different data surfaces:

- `/` and `/api/state`: configured Bybit account, live prices, account orders, platform connections and the general cron state.
- `/models` and `/api/models/state`: `engine_runs`, paper portfolios, paper orders, equity and model decision history.
- `/api/health`: basic runtime configuration readiness and safety summary.

During A/B runs, the main `bot_runs` record is not the authoritative model-decision history. Use `/api/models/state` for model decisions and A/B performance. The models API also exposes the active/registered runtime engines and selected exchange execution engine so the live registry can be compared with the persisted experiment.

### Database

`database/schema.sql` is the clean baseline schema. Historical migration bookkeeping and upgrade SQL have been removed.

Runtime DB initialization uses `CREATE TABLE IF NOT EXISTS`. Vercel build itself does not run a migration, but the first runtime path that needs the database can bootstrap the schema automatically. `npm run db:setup` remains available for explicit provisioning.

The old local historical backtest/simulation subsystem has been removed.

See `INSTALL.md` for deployment instructions.
