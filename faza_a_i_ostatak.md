

## Urađeno (Faza A, otprilike 60%)

**Podatak i upis**
- [20260920160000_equity_at_entry.sql](supabase/migrations/20260920160000_equity_at_entry.sql) — nova kolona `tj_positions.equity_at_entry`, CHECK, SQL backfill (ostaje NULL kad je istorija neocenjena), i `tj_merge_positions` restatovan da nosi kolonu
- [risk-taken.ts](src/lib/journal/risk-taken.ts) — rizik u novcu, u % equity-ja, odstupanje od namere, disperzija. **26 testova**
- [equity-at-entry.ts](src/lib/journal/equity-at-entry.ts) — piše jednom, nikad ne prepisuje, čisti na povratak u plan. **6 testova**
- [equity.ts](src/lib/journal/equity.ts) — `getDayOpeningEquities` (batch) i `getEquityAtEntryPatch`
- Upis zakačen na sva četiri mesta: `createTrade`, `updateTrade`, import create, import merge

**Čitanje**
- `EnrichedTrade` nosi `riskMoney` / `riskPctTaken` / `riskIntentGap`
- 4 metrike (`avg_risk_pct`, `max_risk_pct`, `risk_dispersion`, `risk_intent_gap`), dimenzija `risk_bucket`, filter `risk_pct_taken`

**Dve izmene u odnosu na plan, obe namerne:**
1. `equity_at_entry` ide u `MERGE_COALESCE_COLUMNS` (keep pobeđuje), ne uz snapshot kolone — i `merge-positions.test.ts` sada čita **novu** migraciju; ranije je čuvao paritet sa funkcijom koja više ne radi.
2. Undo uvoza može ostaviti inertan `equity_at_entry` na trejdu bez fill-ova — bezopasno (brojilac je null), prvi sledeći save ga čisti.

## Ostalo

- Tracker: 2 nova auto pravila (`risk_per_trade`, `risk_matched_intent`) — migracija + `tracker-types.ts` + `auto-rules.ts`
- Kolona "Risk %" u žurnal tabeli
- Dokumentacija: README (34→38 metrika, 24→25 dimenzija), `docs/formulas-audit.md`, ROADMAP

## Pre nego što ovo radi na pravim podacima

Migracija **nije puštena** i `src/lib/supabase/types.ts` sam dopunio ručno (nemam `supabase gen types` ovde). Kad budeš puštao:

```bash
npx supabase db push
```

pa regeneriši tipove i proveri backfill na 3-4 stvarna trejda — `starting_balance + Σ net_pl + Σ cash` do početka tog dana, kako plan traži.





###

# Faza A — Rizik kao prvorazredni podatak

## Context

Žurnal meri ishod trejda besprekorno, ali ne meri **rizik koji je preuzet da bi taj ishod nastao**.

- `tj_positions.risk_pct` je TEXT kolona popunjena iz dropdowna (`form-config.ts:122`) — to je *namera*, ne činjenica. `position_size` je broj koji trejder otkuca; ništa ne proverava da li ta dva idu zajedno.
- Tracker pravilo `max_loss_per_trade` (`tracker/auto-rules.ts:269`) gleda **realizovani `netPl`**. Trejd dimenzionisan na 3% koji je dobio — nevidljiv. Trejd koji je izašao pre stopa — `pass`.
- Sickre Score daje 30 poena "procesu", a proces ne sadrži jedinu varijablu koja gasi prop nalog.
- `mentor-export.ts:327` nudi `riskNote`, slobodan tekst tipa "Rizik po trejdu: 1%", jer sistem nema pravi broj da ponudi.

Ishod faze: svaki trejd nosi proveriv podatak o tome koliko je kapitala stvarno bilo u riziku, i taj podatak ulazi u izveštaje, u dimenzije, u filtere i u tracker.

## Ključni nalaz koji oblikuje ceo plan

**Rizik u novcu je već izračunljiv iz zamrznutih podataka.** Sve komponente lanca već postoje i već su nepromenljive po trejdu:

```
riskMoney = plannedRiskPts(entry_price, stop_price, avg_entry)   // position-stats.ts:73
          × stats.entry_qty                                       // tj_position_stats
          × stats.point_value                                     // COALESCE(point_value_at_trade, instrument)
          × stats.fx_rate                                         // COALESCE(fx_rate_at_trade, …)
```
(Identičan lanac već postoji kao lokalna promenljiva `riskMoney` u `position-stats.ts:174-186`, gde se koristi za `realized_r_net` i **ne vraća se**.)

Jedina činjenica koja se **ne može rekonstruisati unazad** je equity naloga na otvaranju dana ulaska — jer se menja svakim kasnijim trejdom, depozitom i ispravkom.

**Zato faza dodaje tačno jednu kolonu**: `tj_positions.equity_at_entry`. Ona je imenilac; brojilac je već zamrznut. Dodavanje i `risk_money` i `risk_pct` kao kolona bi značilo čuvanje izvedenih vrednosti pored njihovih ulaza — tačno ono što `tj_position_stats` postoji da spreči.

## Odluke (potvrđene)

| Pitanje | Odluka |
|---|---|
| Gde živi podatak | Zamrznuta kolona na `tj_positions` — `equity_at_entry` |
| Osnovica procenta | Equity na **otvaranju dana ulaska**, u vremenskoj zoni naloga |
| Obim | Cela faza A: kolona + backfill, 4 metrike, dimenzija, filter, 2 tracker pravila |

### Odstupanje od prvobitne skice, sa razlogom

Skica je predviđala **prepisivanje** `max_loss_per_trade` na rizik pri ulasku. Plan umesto toga **dodaje novo pravilo i ostavlja staro**:

- Prepisivanje bi tiho promenilo značenje svakog neocenjenog dana u istoriji (zaključani dani su zamrznuti, pa bi istorija postala nekonzistentna sama sa sobom).
- Dva pravila mere dve različite stvari: koliko si **rizikovao** (odluka, dan otvaranja) i koliko si **izgubio** (ishod, dan zatvaranja). Razlika između njih je sama po sebi nalaz — proklizavanje preko stopa, gep, izlazak ranije.

## Koraci

### 1. Migracija — `supabase/migrations/20260920160000_equity_at_entry.sql`

Komentari na engleskom (konvencija od `20260918…` naovamo), header sa obrazloženjem po uzoru na `20260730140000_integrity_guards.sql`.

```sql
ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS equity_at_entry numeric;

COMMENT ON COLUMN public.tj_positions.equity_at_entry IS '...';
```

Backfill u istom fajlu, u SQL-u (jednokratno, auditabilno):
- dan ulaska = `date_trunc('day', s.opened_at AT TIME ZONE a.timezone)`, vraćen u UTC — ista konvencija koju `zonedDateKey` koristi u TS-u;
- `starting_balance + Σ net_pl (closed_at < day_start) + Σ amount (occurred_at < day_start)`;
- **ostaje NULL** kada bilo koji raniji zatvoreni trejd ima `net_pl IS NULL` — nepoznat imenilac ne sme da proizvede procenat. Isto pravilo koje `equity-ladder.ts` već primenjuje (`brokenFrom`).

Bez `supabase/rollback/` fajla — aditivni `ADD COLUMN` nema presedan za to (`supabase/rollback/README.md`).

### 2. Šema i tipovi

- `supabase/schema/production_base_tables.sql` — dodati kolonu u `tj_positions` blok (bez ovoga `npm run schema:check` pada).
- Regenerisati `src/lib/supabase/types.ts` (`supabase gen types`) — fajl je generisan, ne piše se rukom.
- `src/lib/journal/reserved-keys.ts` — dodati `equity_at_entry` u `RESERVED_KEYS`, inače `reserved-keys.test.ts` pada.
- `src/lib/journal/merge-positions.ts` — dodati u `MERGE_COALESCE_COLUMNS` (rizik putuje sa fill-ovima, isto kao `point_value_at_trade`), i u SQL `tj_merge_positions` (novi `CREATE OR REPLACE` po uzoru na `20260918160000_merge_positions.sql:131`). `merge-positions.test.ts:124` tvrdi paritet te dve liste.
- `src/lib/journal/trades.ts:114-136` (`getTradeForEdit`) — obrisati `equity_at_entry` iz `fields` bag-a, kako je već urađeno za `custom` i `scale_out_levels`.

### 3. Čitanje equity-ja na dan — `src/lib/journal/equity.ts`

Novo, uz postojeći `getAccountEquities()`:

```ts
export async function getDayOpeningEquities(
  accountId: string,
  dayKeys: readonly string[],
): Promise<Map<string, number | null>>
```

Gradi se na onome što fajl već radi: lagano čitanje `tj_position_stats` (`account_id, net_pl, closed_at`, `status=closed`) + `getCashEvents(accountId)`, pa `resolvePeriodWindow(...)` (`balance.ts:123`) po svakom cutoff-u — ono već vraća `openingEquity` za dati instant. Jedan trejd → jedan ključ; uvoz → svi ključevi odjednom, jedno čitanje.

Vraća `null` za dan pre kojeg postoji zatvoren trejd sa `net_pl == null`.

### 4. Upis — jedan uslovni patch, po uzoru na `excursionSourcePatch`

Novi `src/lib/journal/equity-at-entry.ts` (čist, testabilan):

```ts
export function equityAtEntryPatch(
  prev: { equity_at_entry: number | null } | null,
  nextStatus: PositionStatus,
  equity: number | null,
): Record<string, number | null>
```

Pravila, ista kao kod MAE/MFE ("typed always wins") i kod snapshot kolona:
- piše **samo** kada trejd prvi put ima entry fill (`computeStatus` vrati `open|partial|closed`) a kolona je `null`;
- **nikad ne prepisuje** postojeću vrednost — kasnija izmena fill-ova ne pomera istorijski imenilac;
- vraća `{ equity_at_entry: null }` kada trejd ide nazad u `planned` (`restoreTradeToPlanned`) — nema ulaska, nema equity-ja na ulasku;
- vraća `{}` inače, pa dinamički `UPDATE` u `tj_save_trade` (`20260816120000:161-168`) kolonu ni ne imenuje.

Mesta poziva (svuda gde se status računa):
- `src/app/(app)/trades/actions.ts` — `createTrade` (spread uz `...snapshot`, ~L245) i `updateTrade` (~L385, pored `excursionSourcePatch`). `updateTrade` već čita prethodni red na L335-339 — dodati `equity_at_entry` u taj `select`.
- `src/app/(app)/trades/actions.ts:477` — `restoreTradeToPlanned`, čišćenje.
- `src/app/(app)/import/actions.ts:226-248` (create) i `:351-368` (merge) — batch varijanta iz koraka 3.

`tj_save_trade` ne treba menjati: njegov `UPDATE` je dinamički nad presekom kolona tabele i ključeva u `p_position`.

### 5. Računica — novi `src/lib/journal/risk-taken.ts`

Čist modul, kandidat za `MONEY_MODULES` listu u `vitest.config.ts` (100% statements/functions):

```ts
riskMoneyAtEntry(row): number | null      // lanac iz odeljka "Ključni nalaz", preko plannedRiskPts
riskPctTaken(riskMoney, equityAtEntry): number | null
riskIntentPct(row): number | null         // parseRiskPct(row.risk_pct)
riskIntentGap(taken, intent): number | null  // |taken − intent|, u procentnim poenima
riskDispersion(values: number[]): number | null  // populaciona σ, isto kao consistencyScore
```

Nula novih parsera: `plannedRiskPts` (`position-stats.ts:73`) i `parseRiskPct` (`plan-calculations.ts:38`) postoje.

### 6. `EnrichedTrade` — tri polja

`src/lib/journal/enriched-trade.ts`: dodati u tip (L37-94) i u jedini `map` u `enrichTrades` (L127-154):
- `riskMoney: number | null`
- `riskPctTaken: number | null`
- `riskIntentGap: number | null`

Svih 12 poziva `enrichTrades` (reports, dashboard, insights, weekly, playbooks) dobijaju ih besplatno.

Takođe: `src/lib/journal/reports/test-helpers.ts` — `TradeSpec` + `mkTrade` da fixture može da ih postavi.

### 7. Filter

`src/lib/journal/reports/filters.ts` — jedan red u `NUMERIC_FIELDS` i jedan u `NUMERIC_FIELD_LABELS`:
`risk_pct_taken: (t) => t.riskPctTaken` / `"Risk % taken"`. `filter-bar.tsx` čita mapu, ne treba dirati.

### 8. Metrike — `src/lib/journal/reports/metrics.ts`

Četiri unosa, svaki delegira na `risk-taken.ts` (obrazac: `avg_entry_slip`, L420-443):

| key | label | unit | higherIsBetter |
|---|---|---|---|
| `avg_risk_pct` | Avg risk taken | `pct` | `false` |
| `max_risk_pct` | Max risk taken | `pct` | `false` |
| `risk_dispersion` | Risk dispersion | `pct` | `false` |
| `risk_intent_gap` | Risk vs intent | `pct` | `false` |

`risk_intent_gap` je **prosek apsolutnog odstupanja**, ne prosek razlike: sa predznakom se preveliki i premali trejd potiru i knjiga koja nikad ne pogađa svoju nameru čita kao savršena. Zato i `higherIsBetter: false` umesto trika sa obrtanjem znaka koji `avg_entry_slip` koristi.

Nijedna nije u `DEFAULT_METRIC_KEYS` ni u `DEFAULT_COLUMNS` (`reports-workbench.tsx:93`) — pojavljuju se u biraču kolona automatski.

**Tvrdi pad koji treba ispraviti:** `spec-conformance.test.ts:285` — `expect(METRICS).toHaveLength(34)` → 38, na oba mesta.

### 9. Dimenzija — `src/lib/journal/reports/dimensions.ts`

`RISK_PCT_EDGES` pored `SIZE_EDGES` (L257) i jedan unos u `derivedDimensions`:

```ts
{ key: "risk_bucket", label: "Risk taken", group: "derived",
  order: RISK_PCT_EDGES.map((e) => e.label),
  valueOf: (t) => bucketByEdges(t.riskPctTaken, RISK_PCT_EDGES) }
```

Ivice: `< 0.5%`, `0.5 – 1%`, `1 – 1.5%`, `1.5 – 2%`, `2 – 3%`, `≥ 3%`. Ništa drugo — `engine.ts`, birači i `filter-bar` čitaju registar.

### 10. Tracker — dva nova auto pravila

**`risk_per_trade`** (dan **otvaranja**, `% of equity`, ide u `AUTO_RULES_NEEDING_PCT`) — nijedan trejd otvoren tog dana nije rizikovao više od limita.
**`risk_matched_intent`** (dan otvaranja, bez configa) — svaki trejd je u toleranciji od svoje izabrane `risk_pct` vrednosti. Tolerancija je izvezena konstanta `RISK_INTENT_TOLERANCE` sa obrazloženjem u komentaru (presedan: `CONSISTENCY_SCALE` u `risk-metrics.ts`), **ne** novi oblik configa — time se izbegava dirati `tracker-actions.ts` zod granu, `queries.ts` `parseConfig` i UI.

Redosled izmena (iz recepta koji `20260813160000_thesis_written_rule.sql` dokumentuje):

1. Migracija: `DROP`/`ADD CONSTRAINT tj_tracker_rules_auto_key_check` sa 8 ključeva; `CREATE OR REPLACE FUNCTION tj_seed_tracker_rules` sa dva nova reda; backfill `INSERT … WHERE NOT EXISTS` za postojećeg korisnika (idempotentno preko `tj_tracker_rules_one_per_auto_key`).
2. `src/lib/journal/tracker-types.ts` — `AUTO_RULE_KEYS` + `AUTO_RULES_NEEDING_PCT`.
3. `src/lib/journal/tracker/auto-rules.ts` — `TrackerTrade` dobija `riskPctTaken` i `riskIntentPct`, `toTrackerTrade` ih puni preko `risk-taken.ts`; dva `eval*` po uzoru na `evalOpenDayFlag` (L306) i `evalMaxLossPerTrade` (L269); dva unosa u `evaluateAutoRulesForDay` (TS to ionako forsira preko `Record<AutoRuleKey, …>`).
4. Trejd bez poznatog rizika (nema stopa, neocenjen instrument, `equity_at_entry` null) → postojeći razlog `"unpriced"`. Nema novog `AutoReason`, pa `tracker-checklist.tsx:39-71` ostaje netaknut.
5. `compliance.ts` i sva četiri poziva evaluatora — bez izmena, generički su.
6. `auto-rules.test.ts:329-357` — konformnost registra, tvrdi pad.

### 11. Ekran

- `src/components/journal/journal-grid.tsx` — kolona `risk_pct` ("Risk %") između `size` i `avg_entry`, uz label u `COLUMN_LABELS`. Model skrivenih kolona (`column-prefs.ts`) je takav da se nova kolona pojavljuje i kod već podešene tabele.
- Ništa drugo nije obavezno: `/reports` birači, filter bar i tracker ekran čitaju registre.

### 12. Dokumentacija

- `README.md` — § Metrics (tabela Risk + brojevi `34 metrics` → 38, `24 built-in dimensions` → 25, `10 derived` → 11), § Process tracking (`**Six** are scored automatically` → Eight, L738), § Data model (nova kolona).
- `docs/formulas-audit.md` — nova sekcija sa formulom i verdiktom (⚪ bespoke za `risk_intent_gap`, ✅ za rizik kao % equity-ja).
- `ROADMAP.md` — datirana sekcija na kraju, po uzoru na postojeće.
- `PARITY.md` — lista metrika i dimenzija (već je zastarela na 30, popraviti usput ili ostaviti — napomenuti).

## Verifikacija

**Automatski, redosledom iz `.github/workflows/gate.yml`:**

```bash
npm run typecheck && npm run schema:check && npm run test && npm run lint && npm run dead
```

Testovi koji moraju da padnu pre izmene i prođu posle: `spec-conformance.test.ts` (broj metrika), `reserved-keys.test.ts` (nova kolona), `auto-rules.test.ts:329` (registar pravila), `merge-positions.test.ts:124` (paritet liste sa SQL-om).

**Novi testovi:**
- `src/lib/journal/risk-taken.test.ts` — lanac u novcu (uključujući FX ≠ 1 i `point_value` null → `null`, nikad 1), σ na jednom uzorku, gap kad `risk_pct` nije parsabilan.
- `src/lib/journal/equity-at-entry.test.ts` — piše jednom, ne prepisuje, čisti na povratak u `planned`, `{}` kad nema promene.
- Dopuna `filters.test.ts:254-293` (nabraja numerička polja ručno) i `dimensions.test.ts` za bucket ivice.
- `auto-rules.test.ts` — po jedan `pass`/`fail`/`unpriced` slučaj za oba nova pravila, na `EQUITY = 10_000` obrascu koji fajl već koristi.

**Ručno, jer SQL polovina nije pokrivena CI-jem** (`position-stats.parity.test.ts:6-15` to i kaže):
1. Pustiti migraciju na Supabase branch, pa uporediti `equity_at_entry` za 3-4 stvarna trejda sa ručno izračunatim `starting_balance + Σ net_pl + Σ cash` do početka tog dana. Rezultat zapisati u `CODE_REVIEW.md`, kako je rađeno za view.
2. Proveriti da trejd sa neocenjenim instrumentom u istoriji ima `NULL`, a ne broj.

**Kroz aplikaciju** (`preview_start`, dev server iz `.claude/launch.json`):
1. Novi trejd sa stopom i entry fill-om → "Risk %" kolona u žurnalu pokazuje broj; equity u Settings × taj procenat ≈ `riskMoney`.
2. Izmeniti fill na dvostruku količinu → `risk %` se udvostručuje, `equity_at_entry` se **ne menja**.
3. Vratiti trejd u `planned` → kolona prazna.
4. `/reports` → dimenzija "Risk taken" sa četiri nove metrike; provera da `risk_intent_gap` nije nula na trejdu gde je izabrano 1% a stvarno je 1.6%.
5. `/daily` → dva nova pravila u tracker listi; dan bez trejdova ih prikazuje kao `na`, ne `pass`.