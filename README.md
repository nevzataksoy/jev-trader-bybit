# JEV TRADER BYBIT

## Türkçe

### Proje özeti

JEV TRADER BYBIT, USDT / BTC / ETH / XAUT arasında sermaye rotasyonu yapan, Bybit piyasa verilerini kullanan ve TypeSafe Jev üzerinden anonim kanıt toplayan bir işlem motorudur.

Bu repo temiz başlangıç mimarisine geçirilmiştir. Eski V1/V2/V3/V4 isim zinciri kaldırılmıştır. Mevcut eski V4 davranışı başlangıç noktası kabul edilerek iki model ailesi aşağıdaki kimliklerle yeniden başlatılmıştır:

- `model1-v1`
- `model2-v1`

Varsayılan A/B karşılaştırması `model1-v1` ve `model2-v1` arasında çalışır.

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
AB_ENGINE_IDS=model1-v1,model2-v1
AB_EXPERIMENT_ID=model1-v1-vs-model2-v1
```

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

The default A/B experiment compares those two engines.

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

### Database

`database/schema.sql` is the clean baseline schema. Historical migration bookkeeping and upgrade SQL have been removed.

Runtime DB initialization uses `CREATE TABLE IF NOT EXISTS`. Vercel build itself does not run a migration, but the first runtime path that needs the database can bootstrap the schema automatically. `npm run db:setup` remains available for explicit provisioning.

The old local historical backtest/simulation subsystem has been removed.

See `INSTALL.md` for deployment instructions.
