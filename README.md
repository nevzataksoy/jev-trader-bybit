# JEV TRADER BYBIT

## Türkçe

### Proje özeti

JEV TRADER BYBIT, USDT / BTC / ETH / XAUT arasında sermaye rotasyonu yapan, Bybit piyasa verilerini kullanan ve TypeSafe Jev üzerinden körleştirilmiş piyasa kanıtı değerlendiren long-only spot işlem araştırma motorudur.

Aktif 42 günlük A/B deneyi aynı experiment ve paper portföyler korunarak `model1-v1` ile `model2-v2` arasında çalışır. Onaylı davranış değişiklikleri yeni experiment açmak yerine `policyRevision` ile izlenir. Böylece R3/R4/R5/R6/R7 dönemleri aynı deney zaman çizelgesi içinde karşılaştırılabilir.

Temel hedef, yalnız kısa vadeli yön tahmini yapmak değil; destek, direnç, price action, orderbook, trade flow, open interest, funding ve volatilite kanıtlarını birlikte değerlendirerek sermayeyi uygun varlıklar arasında dolaştıran, maliyet sonrası kârlılığı ve risk sınırlarını gözeten bir trader motoru geliştirmektir.

### Güncel karar mimarisi

R7 itibarıyla akış aşağıdaki gibidir:

```text
15m cron
  ↓
Bybit piyasa verisini bir kez topla
  ↓
shared market snapshot
  ↓
deterministik market structure
  ├── support / resistance zones
  ├── fee + spread + slippage
  ├── orderbook / flow
  └── OI / funding / squeeze proxy
  ↓
deterministik candidate plan
  ├── support location
  ├── invalidation distance
  ├── first resistance / target1
  ├── after-cost room
  └── reward/risk
  ↓
blind Jev evidence
  ↓
model-specific policy + confirmation
  ↓
final paper decision
  ↓
R7 shadow probability forecast
  ├── P(target1 before invalidation)
  ├── P(invalidation before target1)
  ├── P(timeout)
  └── P(target1 break | target1 reached)
  ↓
platform hard safety
  ↓
paper execution / persistence
```

R7 shadow tahmini final karardan sonra eklenir. `executionAuthoritative=false` olduğu için buy / hold / sell kararını, allocation değerini veya exchange routing davranışını değiştirmez.

### Deterministik ve olasılıksal katmanların sınırı

Proje tamamen deterministik ya da tamamen stokastik değildir. Hedef mimari hibrittir:

- Piyasa geometrisi deterministiktir: support, resistance, invalidation, maliyet, target room ve operasyonel safety kuralları gözlenen veriden hesaplanır.
- Jev kanıtı olasılıksal dağılımlar içerir fakat bu dağılımlar tek başına kalibre edilmiş piyasa olasılığı kabul edilmez.
- R7 `shadowForecast`, 4 saatlik plan sonucu için üç yollu bir olasılık dağılımı kaydeder: target1-first, invalidation-first ve timeout.
- `target1BreakConditional`, ilk dirence ulaşıldığında kırılımın devam etmesine ilişkin ayrı bir koşullu shadow olasılığıdır.
- Shadow olasılıkları henüz kalibre edilmemiştir. Execution yetkisi verilmeden önce gerçek sonuçlarla Brier score, log loss ve calibration bucket analizinden geçmeleri gerekir.

Bu nedenle R7 bir stochastic execution motoru değil, gelecek kalibrasyon için veri toplayan non-authoritative probabilistic shadow katmanıdır.

### R5 → R6 → R7 gelişim çizgisi

`structure-economics-r5` market structure temelini düzeltti. Support bölgesinin tamamen fiyatın üzerinde, resistance bölgesinin tamamen fiyatın altında kalmasına izin verilmez.

`structure-economics-r6` Jev'den önce ortak bir `candidatePlan` üretir. Her iki aktif motor aynı support → invalidation → target1 geometrisini görür. İlk resistance için yeterli maliyet sonrası alan yoksa kör ATR reward genişletmesi yapılmaz.

`structure-economics-r7` mevcut R6 execution davranışını değiştirmeden her final karara mümkün olduğunda `shadowForecast` ekler. Bu kayıtlar daha sonra gerçek 4 saatlik sonuçlarla kalibre edilir.

### Candidate plan

`candidatePlan` model kararı verilmeden önce oluşturulan ortak ve deterministik plan geometrisidir. Başlıca alanlar:

- `status`: `available` / `unavailable`
- `location`: `inside_support`, `near_support`, `between_levels`, `inside_resistance`, `unstructured`
- `supportDistancePct` ve `supportStrength`
- `resistanceDistancePct` ve `resistanceStrength`
- `invalidationDistancePct`
- `target1DistancePct`
- `target1AfterCostRoomPct`
- `target1RewardRiskRatio`
- `roundTripCostPct`

Model1 ve Model2 farklı evidence/policy davranışına sahip olabilir; candidate plan geometrisi ise aynı snapshot için ortaktır.

### R7 shadow probability

`shadowForecast` alanı yalnız candidate plan kullanılabilir olduğunda üretilir:

```text
status: uncalibrated_shadow
methodRevision: shadow-probability-r1
horizonMinutes: 240
target1BeforeInvalidation
invalidationBeforeTarget1
timeout
target1BreakConditional
expectedNetReturnPct
executionAuthoritative: false
```

İlk yöntem revision'ı kontrollü şekilde heuristik evidence bileşimi kullanır. Bu değerler calibrated probability olarak yorumlanmamalıdır. Amaç, aynı 42 günlük deney içinde forecast → gerçekleşen sonuç eşleşmesi biriktirerek daha sonra ampirik kalibrasyon yapmaktır.

Kalibrasyon raporu:

```bash
npm run strategy:probability-report
```

Rapor yalnız olgunlaşmış 4 saatlik shadow forecast'leri skorlar. 15 dakikalık snapshot örneklemesi kullandığı için intrabar first-touch sırasını kesin olarak gözlemleyemez; bu sınırlamayı rapor açıkça belirtir.

### Kullanılan piyasa kanıtı

Ortak market state içinde aşağıdaki başlıca kanıtlar bulunur:

- 15m / 1h / 4h / 1d / 7d / 30d getiriler
- EMA, RSI, MACD, Bollinger, ADX ve trend efficiency
- çok zaman dilimli support / resistance pivot kümeleri
- orderbook imbalance, depth, bid/ask wall strength ve persistence
- taker buy ratio ve trade-flow imbalance
- open interest değişimi ve funding rate
- türetilmiş long/short squeeze risk skorları
- volatility, drawdown ve behavioral phase
- gerektiğinde makro bağlam

Önemli: uygulama şu anda gerçekleşmiş liquidation event stream'i veya ileriye dönük gerçek liquidation heatmap toplamaz. `long_squeeze_risk` / `short_squeeze_risk`, OI + funding + fiyat hareketinden türetilen proxy skorlardır. Gerçek liquidation-cluster entegrasyonu ayrı bir geliştirme olarak yapılmalıdır.

### Kör Jev ilkesi

Jev'e BTC / ETH / XAUT kimliği gönderilmez. Uygulama gerçek assetleri deterministik olarak anonim slotlara eşler:

```text
candidate_1
candidate_2
candidate_3
```

Blind payload içinde gerçek sembol, mutlak fiyat, quantity, average entry price veya takvim kimliği sızarsa kontrol katmanı hata verir. R6/R7 candidate plan ve shadow çalışmaları bu gizlilik invariantını değiştirmez.

### Model izolasyonu

Aktif motorlar:

- `model1-v1`
- `model2-v2`

Repo ayrıca Model2'nin önceki `model2-v1` sürümünü de model ailesi altında tutar; aktif A/B pair `AB_ENGINE_IDS` ile belirlenir.

Her model sürümü kendi stratejik davranışının sahibidir:

- Jev soruları
- evidence yorumlama
- setup / readiness
- portfolio scoring
- allocation policy
- confirmation
- execution sizing ve ordering

Model sürümleri birbirinin strateji dosyalarını import etmez. Ortak platform kodu yalnız model-agnostic altyapıyı taşır. Candidate plan ve R7 shadow forecast ortak platform katmanındadır çünkü iki motora aynı market geometry / audit yüzeyini sağlar.

### 42 günlük deney invariantları

Aktif deney sırasında:

- experiment kimliği ve başlangıç/bitiş zamanı korunur;
- paper portföyler ve geçmiş `engine_runs` korunur;
- davranış değişiklikleri `engine_revisions` üzerinden audit edilir;
- yalnız temel engine contract değişirse yeni engine/experiment düşünülür;
- A/B modunda gerçek exchange routing kapalı kalır.

Varsayılan production orchestration:

```env
STRATEGY_RUN_MODE=ab_test
EXCHANGE_EXECUTION_ENGINE=none
AB_ENGINE_IDS=model1-v1,model2-v2
AB_EXPERIMENT_ID=model1-v1-vs-model2-v2
```

### Dashboard ve endpointler

- `/` ve `/api/state`: Bybit hesabı, canlı platform durumu ve genel runtime yüzeyi.
- `/models` ve `/api/models/state`: A/B engine run'ları, paper portföyler, kararlar, candidate plan, diagnostics ve R7 shadow probability telemetry.
- `/api/health`: runtime readiness ve DB bağlantı kontrolü.
- `/api/cron`: yetkili 15 dakikalık cycle entrypoint'i.

`/models` üzerinde shadow olasılıkları açıkça `uncalibrated_shadow` olarak gösterilir ve execution sinyali değildir.

### Veritabanı

Uygulama provider-agnostic PostgreSQL kullanır. Temiz şema kaynağı `database/schema.sql` dosyasıdır.

Vercel + Supabase runtime için `DATABASE_URL` değerinde Supabase Transaction pooler port `6543` kullanılır. Veri taşıma / `pg_dump` / `psql` gibi yönetim işlemleri için Session pooler port `5432` kullanılabilir.

Uygulama Supabase Data API/Auth/Storage kullanmaz; `SUPABASE_URL`, anon key veya service-role key gerekmez.

R7 için yeni DB tablosu veya migration yoktur. Shadow forecast, mevcut `engine_runs.decisions` JSON içindeki karar telemetry'si olarak saklanır. Böylece aktif experiment sıfırlanmaz.

### Kalite ve tanı komutları

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
npm run strategy:report
npm run strategy:probability-report
```

`strategy:probability-report` için olgunlaşmış R7 kayıtları ve çalışan `DATABASE_URL` gerekir.

Kurulum ve production adımları için `INSTALL.md` dosyasına bakın.

---

## English

### Project summary

JEV TRADER BYBIT is a long-only spot trading research engine that rotates capital across USDT / BTC / ETH / XAUT, consumes Bybit market data, and evaluates blinded market evidence through TypeSafe Jev.

The active 42-day A/B experiment keeps the same experiment identity and paper portfolios while comparing `model1-v1` with `model2-v2`. Approved behavioral changes are tracked with `policyRevision` instead of restarting the experiment, so R3/R4/R5/R6/R7 remain comparable on the same timeline.

The strategic goal is broader than short-horizon direction prediction: combine support, resistance, price action, orderbook, trade flow, open interest, funding, and volatility evidence to rotate capital across eligible assets while respecting after-cost economics and risk limits.

### Current decision architecture

As of R7 the flow is:

```text
15m cron
  ↓
fetch Bybit market data once
  ↓
shared market snapshot
  ↓
deterministic market structure
  ├── support / resistance zones
  ├── fee + spread + slippage
  ├── orderbook / flow
  └── OI / funding / squeeze proxy
  ↓
deterministic candidate plan
  ├── support location
  ├── invalidation distance
  ├── first resistance / target1
  ├── after-cost room
  └── reward/risk
  ↓
blind Jev evidence
  ↓
model-specific policy + confirmation
  ↓
final paper decision
  ↓
R7 shadow probability forecast
  ├── P(target1 before invalidation)
  ├── P(invalidation before target1)
  ├── P(timeout)
  └── P(target1 break | target1 reached)
  ↓
platform hard safety
  ↓
paper execution / persistence
```

The R7 shadow forecast is attached after the final model decision. Because `executionAuthoritative=false`, it cannot change buy / hold / sell, allocation, or exchange routing.

### Deterministic versus probabilistic boundary

The project is neither purely deterministic nor fully stochastic. The intended architecture is hybrid:

- Market geometry stays deterministic: support, resistance, invalidation, transaction cost, target room, and operational safety are computed from observed data.
- Jev evidence contains probability distributions, but those distributions are not automatically treated as calibrated market probabilities.
- R7 `shadowForecast` records a three-way four-hour outcome distribution: target1-first, invalidation-first, and timeout.
- `target1BreakConditional` is a separate conditional shadow probability for continuation through the first resistance after it is reached.
- Shadow probabilities are explicitly uncalibrated. They must be evaluated against realized outcomes with Brier score, log loss, and calibration buckets before they can be considered for execution authority.

R7 is therefore not a stochastic execution engine. It is a non-authoritative probabilistic shadow layer used to collect calibration evidence.

### R5 → R6 → R7 evolution

`structure-economics-r5` corrected the market-structure foundation. A support zone may not sit entirely above current price, and a resistance zone may not sit entirely below it.

`structure-economics-r6` introduced a shared deterministic `candidatePlan` before Jev evaluation. Both active engines now see the same support → invalidation → target1 geometry. When the first resistance does not provide enough after-cost room, the policy does not invent a blind ATR reward extension.

`structure-economics-r7` preserves R6 execution behavior and adds `shadowForecast` telemetry to final decisions whenever a usable candidate plan exists.

### Candidate plan

`candidatePlan` is shared deterministic trade geometry built before model judgment. Main fields include:

- `status`: `available` / `unavailable`
- `location`: `inside_support`, `near_support`, `between_levels`, `inside_resistance`, `unstructured`
- `supportDistancePct` and `supportStrength`
- `resistanceDistancePct` and `resistanceStrength`
- `invalidationDistancePct`
- `target1DistancePct`
- `target1AfterCostRoomPct`
- `target1RewardRiskRatio`
- `roundTripCostPct`

Model1 and Model2 may interpret evidence differently, but the candidate-plan geometry for the same snapshot is shared.

### R7 shadow probability

`shadowForecast` is emitted only when a candidate plan is available:

```text
status: uncalibrated_shadow
methodRevision: shadow-probability-r1
horizonMinutes: 240
target1BeforeInvalidation
invalidationBeforeTarget1
timeout
target1BreakConditional
expectedNetReturnPct
executionAuthoritative: false
```

The first method revision intentionally uses a controlled heuristic evidence composition. These numbers must not be described as calibrated probabilities. The purpose is to accumulate forecast → realized-outcome pairs inside the same 42-day experiment and then calibrate empirically.

Calibration report:

```bash
npm run strategy:probability-report
```

The report scores only matured four-hour forecasts. It uses 15-minute snapshot observations, so it cannot observe exact intrabar first-touch ordering; the report prints this limitation.

### Market evidence

The shared market state includes:

- 15m / 1h / 4h / 1d / 7d / 30d returns
- EMA, RSI, MACD, Bollinger, ADX, and trend efficiency
- multi-timeframe support / resistance pivot clusters
- orderbook imbalance, depth, bid/ask wall strength, and persistence
- taker buy ratio and trade-flow imbalance
- open-interest changes and funding rate
- derived long/short squeeze-risk proxies
- volatility, drawdown, and behavioral phase
- macro context when available

Important: the application does not currently collect a realized liquidation-event stream or a forward liquidation heatmap. `long_squeeze_risk` / `short_squeeze_risk` are proxies derived from OI, funding, and price behavior. Real liquidation-cluster integration is a separate future development.

### Blind Jev invariant

Jev never receives BTC / ETH / XAUT identity. The application maps real assets to anonymous candidate slots:

```text
candidate_1
candidate_2
candidate_3
```

The blind payload guard rejects leaked symbols, absolute prices, raw quantities, average-entry prices, or calendar identity. R6/R7 candidate-plan and shadow work does not weaken this invariant.

### Model isolation

Active engines:

- `model1-v1`
- `model2-v2`

The repository also retains the earlier `model2-v1` version inside the Model2 family; the active A/B pair is selected through `AB_ENGINE_IDS`.

Each model version owns its strategic behavior:

- Jev questions
- evidence interpretation
- setup / readiness
- portfolio scoring
- allocation policy
- confirmation
- execution sizing and ordering

Model versions do not import another model's strategy files. Shared platform code contains only model-agnostic infrastructure. Candidate-plan geometry and the R7 shadow forecast live in the shared platform because both engines require the same market geometry and audit surface.

### 42-day experiment invariants

During the active experiment:

- the experiment identity and start/end window stay unchanged;
- paper portfolios and historical `engine_runs` are preserved;
- behavior changes are audited through `engine_revisions`;
- a new engine/experiment is considered only for a fundamental engine-contract change;
- real exchange routing remains disabled in A/B mode.

Default production orchestration:

```env
STRATEGY_RUN_MODE=ab_test
EXCHANGE_EXECUTION_ENGINE=none
AB_ENGINE_IDS=model1-v1,model2-v2
AB_EXPERIMENT_ID=model1-v1-vs-model2-v2
```

### Dashboard and endpoints

- `/` and `/api/state`: Bybit account, live platform state, and general runtime surface.
- `/models` and `/api/models/state`: A/B engine runs, paper portfolios, decisions, candidate plans, diagnostics, and R7 shadow-probability telemetry.
- `/api/health`: runtime readiness and database connectivity.
- `/api/cron`: authenticated 15-minute cycle entrypoint.

The `/models` page labels shadow probabilities as `uncalibrated_shadow`; they are not execution signals.

### Database

The application uses provider-agnostic PostgreSQL. `database/schema.sql` is the clean schema source.

For Vercel + Supabase runtime, `DATABASE_URL` should use the Supabase Transaction pooler on port `6543`. Session pooler port `5432` may be used for administrative transfer / `pg_dump` / `psql` work.

The application does not use Supabase Data API/Auth/Storage, so no `SUPABASE_URL`, anon key, or service-role key is required.

R7 adds no database table or migration. Shadow forecasts are stored as decision telemetry inside the existing `engine_runs.decisions` JSON, so the active experiment does not reset.

### Quality and diagnostics

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
npm run strategy:report
npm run strategy:probability-report
```

`strategy:probability-report` requires matured R7 records and a working `DATABASE_URL`.

See `INSTALL.md` for installation and production deployment steps.
