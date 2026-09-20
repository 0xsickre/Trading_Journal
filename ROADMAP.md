# Roadmap — TradeZella parity i preko toga

> Finalni plan. Izveden iz audita koda (`src/`, `supabase/migrations/`, 2026-07-27),
> master čeklista, `tz-moduli-kompletno.md` i `tradezella-clone-spec.md`.
> Potvrđeno sa vlasnikom: **depoziti/isplate se grade**, **notebook se gradi**.

---

## 1. Verifikovano stanje koda

Audit je prošao kroz celu šemu i ceo `src/`. Ispod su **samo odstupanja** od master čeklista.

### Označeno kao postojeće, a ne postoji

| Čeklist | Stvarno |
|---|---|
| A3 Deposit / withdrawal / payout ✅ | **Nema tabele ni koda.** Samo `tj_accounts.starting_balance` |
| A9 / J4 Undo import ✅ | `import/actions.ts` ima samo `commitImport`. Audit redovi se pišu, rollback ne postoji |
| B12 Default komisije po nalogu ✅ | Nema kolona ni UI polja |
| C3 Kumulativna drawdown kriva ✅ | Samo `maxDrawdown` skalar u `analytics.ts` |
| D12 Napredni kalendar 🟡 | `calendar-heatmap.tsx` je 26-nedeljna mreža. Nema meseca, nedeljnog P&L-a, journal ikonice |
| G8 Zaključavanje dana 🟡 | Ne postoji. `executionUnlocked` je tab u formi |
| J5 Broker preseti 🟡 | `tj_column_mappings` postoji, **nula referenci u `src/`**. README to priznaje |

### Označeno kao nepostojeće, a postoji

`asset_class` ✅ · `tick_size` / `tick_value` / `currency` ✅ · `conviction` je **namerno obrisan** u
`20260720120000_simplify_trade_fields.sql` · `needs_review` postoji ali znači „import ostavio
nepotpun trejd", ne „pregledao sam" — A13 ostaje ❌.

### Latentni bug koji spec razotkriva

`computeStats()` klasifikuje breakeven kao `p === 0` nad float neto P&L-om koji uključuje fee i swap.
**To praktično nikad nije tačno**, pa je `breakeven` uvek `0`, a `winRate` nema šta da izuzme iz
imenioca. Spec §5.5 traži *konfigurabilan breakeven range* — bez njega su „breakeven trades",
„scratch hold time" i sivo bojenje kalendara mrtva slova. Zato `breakeven_range` ide u Fazu 0, ne u
Fazu 5 kako je čeklist predviđao.

### Podaci koji već postoje, ali ih niko ne prikazuje

`duration_seconds` (u view-u, **nijedan čitač**) · `total_fees` / `total_swap` (u view-u, **nijedan
agregat**) · `breakeven` (računa se, ne prikazuje) · `zonedWeekStartKey()` (nedeljni bucket helper) ·
`session_killzone` (mrtva kolona van forme).

### Arhitektonski nalazi koji smanjuju trošak Faze 5

1. **Forma je već deklarativna.** `form-config.ts` izvozi `FORM_TABS`, a `POSITION_FIELD_NAMES`,
   `NUMERIC_FIELDS`, `ARRAY_FIELD_NAMES` se iz njega izvode. „Forma iz playbook-a" je zamena izvora
   jedne konstante, ne prepisivanje forme.
2. **`TradeRow` je `{…} & Record<string, unknown>`** — dinamične kolone već prolaze kroz lanac.
3. **`breakdownByField(trades, field)` prima proizvoljno ime polja** — dimension registry je registar
   plus izvedeni bucket-i, ne nova matematika.

---

## 2. Šta su specifikacije promenile u planu

Četiri izmene u odnosu na prethodnu verziju roadmapa, sve zbog konkretnih rečenica u dokumentima.

### 2.1 Sloj jedinica i formatiranja ide u Fazu 1, ne u Fazu 5

Spec §3.2 i §5.6: sedam view modova (`$` · `%` · privacy · R · ticks · pips · points) × dve P&L
osnove (gross / net) = **14 varijanti prikaza svake metrike**, uz izričito upozorenje da se to ne sme
duplirati po widgetima.

Ako Faza 1 napiše metrike koje vraćaju formatirani novac, Faza 5 ih sve prepisuje. Zato:
**metrike vraćaju bazičnu vrednost + kontekst instrumenta, formatter je odvojen sloj, i piše se pre
prve nove metrike.** `pnlBasis: 'gross' | 'net'` je parametar engine-a od prvog dana, ne prekidač u UI-ju.

### 2.2 „Trading day" znači dan **otvaranja**, ne zatvaranja

Spec §5.5, doslovno: *Trading day = dan kada je trade otvoren/ušlo se u poziciju*.

Tvoj `dailyPnl()` grupiše po `closed_at`. Za day trading razlika ne postoji; za swing trejd držan tri
nedelje razlika je tri nedelje.

**Preporuka — i odstupam od TZ-a namerno:** realizovani P&L ostaje po **datumu zatvaranja** (tad je
novac realizovan, equity kriva mora da bude tačna), a **aktivnosne** metrike (total trading days,
poravnanje sa Logged Days) idu po **datumu otvaranja**. Dve semantike, obe imenovane, nijedna
implicitna. Kopiranje TZ semantike u equity krivu dalo bi swing journal koji laže o tome kad je novac
zarađen.

### 2.3 Insights se ne persistiraju

`tz-moduli-kompletno.md` §5: *Insights ne čuvaj u bazi — računaj ih iz pozicija pri čitanju. Pragovi
se menjaju, a persistirani insight bi zaostajao za promenjenim pragom.*

Time H2 („insight kao filter dimenzija") **ne traži tabelu** — filtrira se nad izračunatim
vrednostima. Ispada jedna migracija iz plana.

### 2.4 Sickre Score postaje jeftin odmah posle Faze 1

Spec §2.6 daje tačne pondere i skale. Svih šest ulaza (Profit Factor, Avg Win/Loss, Max Drawdown,
Win %, Recovery Factor, Consistency) su metrike **Faze 1**. Skor se isporučuje na kraju Faze 1, a
sedma komponenta — Process Adherence, koju TZ nema — dodaje se kad playbook počne da daje follow rate.

---

## 3. Odluke koje su specifikacije razrešile

| Pitanje | Odluka | Izvor |
|---|---|---|
| Depoziti/isplate | **Grade se.** `tj_cash_events` u Fazi 0 | Potvrda vlasnika + spec §1.2 `BalanceEvent` |
| Notebook | **Gradi se.** `tj_notes` + folderi + šabloni + note tagovi | Potvrda vlasnika + moduli §2 |
| Insight persistencija | Ne persistira se, računa se pri čitanju | moduli §5 |
| Breakeven | Konfigurabilan asimetričan opseg po nalogu, u `$` ili `%` | spec §5.5, čeklist B11 |
| Playbook migracija | `ict_entry_model` vrednosti sede početne playbook-ove; `rules_followed` istorija se **ne** razlaže retroaktivno — čist rez | moduli §1 |
| Redosled playbook / tracker | Playbook prvi. Pravilo „svaki trejd ima playbook" nema smisla pre toga | moduli §4 |
| Profit calc metoda | ~~ostaje P3~~ → **odbijeno u F7 i kolona obrisana.** Nerelevantno bez preklapajućih pozicija na istom simbolu, a model ima jedan red po trejdu | čeklist A14 |
| MAE/MFE | Ostaje ručni unos sa charta. Intraday feed se ne uvodi | moduli §11 |

### Nerazrešena kontradikcija između tvoja dva dokumenta

**Drawdown %.** Spec §2.5 kaže `max_drawdown_% = (peak-to-trough pad / max kumulativni P&L pre pada)
× 100`. Master čeklist kaže da % pogled ide **iz tekućeg balansa naloga uključujući uplate i isplate**.
To su dva različita imenioca i daju različite brojeve.

**Rešenje:** implementiraju se oba, imenovana i odvojena.

- `maxDrawdownPctOfEquity` — imenilac je peak equity uključujući cash flow. Finansijski tačan, ide u UI.
- `maxDrawdownPctOfPeakPnl` — imenilac je peak kumulativnog P&L-a. Ide **isključivo** u Sickre
  Score, da skor ostane uporediv sa istom metrikom kod TZ-a.

Bez ovog razdvajanja skor ne bi bio uporediv, ili bi UI lagao — biraju se oba, ne kompromis.

---

## 4. Principi

- Migracije aditivne, `YYYYMMDDHHMMSS_opis.sql`, nikad izmena postojećeg fajla.
- RLS na svakoj novoj tabeli: owner policy sa `(SELECT auth.uid())`, `updated_at` trigger, indeks po `user_id`.
- Nema REST ruta — mutacije kroz Server Actions, čitanja u Server Components.
- Nova metrika ide u SQL view **i** u TS, ili ni u jedno, sa parity testom.
- Dropdown vrednosti ostaju plain text.
- Vreme je per-account (`timestamptz` UTC + IANA tz).
- **Metrika vraća broj + kontekst; formatiranje je poseban sloj.**
- **Prag uzorka je obavezan** na svakom insight-u i vidljiv u svakoj pivot ćeliji.
- Next.js 16 — pročitati `node_modules/next/dist/docs/` pre rutnog/serverskog koda.

---

## 5. Faze

```
F0 novac + integritet ──► F1 jedinice + metrike + skor ──► F2 insights
                                    │                          │
                                    └──► F3 report engine ◄─────┘
                                                │
                                    F4 custom fields + playbook
                                                │
                          ┌─────────────────────┼─────────────────────┐
                    F5 tracker            F6 notebook           F7 parity + automatizacija
```

---

### Faza 0 — Novac i integritet ✅ ZAVRŠENO

> Isporučeno. Odstupanje od prvobitnog plana: **FTMO evaluacija namerno NE koristi balance
> timeline.** Prop-firm drawdown se meri od balansa sa kojim je izazov počeo — da depozit podiže
> pod, dobio bi prostor koji ti pravila nikad nisu dala. Uplate su performans naloga, ne evaluacija
> izazova. Dokumentovano u `ftmo.ts` i README-u.
>
> Dodato van prvobitnog opsega, jer bez toga undo nije bio pošten: `tj_import_rows.prev_executions`.
> Merge briše postojeće fill-ove, a snimak prethodnog stanja živeo je samo u promenljivoj tokom
> request-a — na disku nije bilo čemu da se vrati.


**Zašto prva:** svaki % pogled deli isti imenilac. Depozit ubačen posle toga tiho pokvari svaki
procenat unazad. Breakeven range je ovde jer bez njega tri metrike Faze 1 nemaju značenje.

**Migracije**

- `tj_cash_events` — `user_id`, `account_id`, `event_type` (`deposit` / `withdrawal` / `payout` /
  `adjustment`), `amount`, `occurred_at timestamptz`, `note`. CHECK na tip, indeks
  `(user_id, account_id, occurred_at)`, RLS.
- `tj_accounts` +: `default_commission`, `default_fees`, `default_swap_per_day`,
  `breakeven_from`, `breakeven_to`, `breakeven_unit` (`$` / `%`), `default_stop_pct`,
  `default_target_pct`, `profit_calc_method` (default `fifo`, koristi se tek u F7).
- ~~`tj_positions` +: `reviewed boolean DEFAULT false`, `rating smallint` (spec §6).~~
  **Obe obrisane** (`20260801180000`, `20260801200000`), zajedno sa `profit_calc_method`
  (`20260801160000`) iz reda iznad. Dodate su po spec-u, nikad im nije napravljena druga polovina —
  nijedan UI ih nije postavljao i nijedna metrika čitala. Detaljno u §6.

> `breakeven_from` / `breakeven_to` su **asimetrični** — npr. `−37.50` do `0`. Nije `±X`.

**Kod**

- `lib/journal/balance.ts` — `buildBalanceTimeline(account, trades, cashEvents)` → serija
  `{ at, realizedPnl, cashFlow, equity }`. Jedini izvor istine za svaki % pogled i za FTMO.
- `lib/journal/breakeven.ts` — `classifyOutcome(netPnl, account)` → `win` / `loss` / `breakeven`.
  **Zamenjuje `p === 0` granu u `computeStats()`** i postaje jedina klasifikacija u sistemu.
- Cash events CRUD u Settings-u; kartica po nalogu.
- `undoImportBatch(batchId)` — briše pozicije nastale u batch-u, vraća merge-ovane fill-ove iz
  `tj_import_rows.parsed`, poništava batch. Dugme u istoriji importa.
- Trade forma predpopunjava fee/swap iz naloga.

**Prihvatanje**

- Depozit usred perioda **ne** pomera `$` drawdown i **pomera** `%` drawdown — vidljivo u UI-ju.
- Breakeven count postaje različit od nule na realnim podacima.
- Undo import vraća bazu u stanje pre commit-a — test nad fixture-om.
- FTMO evaluacija čita isti balance timeline kao dashboard.

**Procena:** 3 sesije.

---

### Faza 1 — Jedinice, metrike, kompozitni skor ✅ ZAVRŠENO

> Isporučeno. Dva odstupanja od plana, oba svesna:
>
> **1.** Plan je rekao da `fmtMoney` / `fmtR` postanu tanki omotači nad `units.ts`. Urađeno je
> obrnuto: `format.ts` drži primitivne formatere, `units.ts` semantički sloj iznad njih. Suprotan
> smer bi napravio kružnu zavisnost bez ikakve dobiti.
>
> **2.** Globalni prekidač 7 view modova **nije zakačen na dashboard**. Sloj postoji, testiran je, i
> sve nove metrike vraćaju bazne vrednosti — što je bila arhitektonska poenta i ono što sprečava
> prepisivanje kasnije. Sam prekidač ide uz filtere i `pnlBasis` u Fazi 3, jer tamo i pripada;
> zakačiti ga sad značilo bi dirati svaki widget dvaput.
>
> Dodato van plana: `drawdownSeries()` (kriva je tražila seriju, ne skalar) i izdvajanje MAE/MFE
> geometrije iz trade forme u `excursion.ts` — postojala je kao druga kopija koju nijedan agregat
> nije mogao da koristi.

**Prvi korak je infrastrukturni i mora prethoditi svemu ostalom u fazi.**

#### 1a — Sloj jedinica (blokira ostatak faze)

- `lib/journal/units.ts` — `MetricValue = { base: number, unit: 'money'|'r'|'pct'|'points'|'count', ctx }`.
- `formatMetric(value, viewMode, instrument, privacy)` — sedam modova, jedno mesto.
- `pnlBasis: 'gross' | 'net'` postaje parametar svake agregatne funkcije, ne UI prekidač.
- Postojeći `fmtMoney` / `fmtR` / `fmtPct` postaju tanki omotači nad ovim.

#### 1b — Metrike (nula migracija, sve iz postojećeg view-a)

| Grupa | Isporuka |
|---|---|
| **Vreme (C2)** | Avg hold time × 4 (svi / dobitnici / gubitnici / scratch), longest duration, avg i max u danima — sve iz `duration_seconds` |
| **Trošak (C1)** | Total Commissions, Total Fees, **Total Swap**, trošak kao % bruto profita, avg swap po danu držanja. „Nema podatka" ≠ 0 (spec §5.5) |
| **Profitabilnost** | Avg Win/Loss ratio, Avg trade P&L, Largest profit/loss, **NET ROI** i `adjusted_cost` (spec §2.2) |
| **Rizik (C3)** | Recovery Factor, Consistency Score, Avg planned R (numerički, iz `planned_rr`), Avg MAE u R, Average drawdown, trenutni drawdown, datum max DD |
| **Drawdown kriva** | Nova komponenta. **Dve osnove eksplicitno odvojene** — `$` iz kumulativnog P&L-a, `%` iz balance timeline-a (F0) |
| **Aktivnost (C4)** | Breakeven trades (sad stvarno radi), Longs/Shorts broj + win %, **Logged days** (join `tj_daily_reports`), Total trading days po **datumu otvaranja** (§2.2 gore) |
| **Nedeljni sloj (C5)** | Week Win %, avg weekly/monthly P&L, najveća profitabilna/gubitnička nedelja i mesec, max uzastopnih nedelja — preko postojećeg `zonedWeekStartKey` |

#### 1c — Sickre Score (ponderi po spec §2.6, ime naše)

`PF 25 % · Avg Win/Loss 20 % · Max DD 20 % · Win % 15 % · Recovery 10 % · Consistency 10 %`

Skale iz spec-a implementirane doslovno, sa **linearnom interpolacijom unutar opsega** — spec to
označava kao nepotvrđenu pretpostavku, pa ide iza konstante koja se može kalibrisati, ne kao
magičan broj u formuli. Max DD komponenta koristi `maxDrawdownPctOfPeakPnl` (§3 gore).

**Prihvatanje**

- Vitest po formuli, uključujući granične slučajeve: nula gubitaka → PF `null` (ne `∞`), jedan trejd
  → stdev `0`, otvorene pozicije isključene, `avg profit < 0` → Consistency `0`.
- „Da li trejdovi duži od 7 dana imaju pozitivnu EV posle swapa?" — odgovor iz UI-ja.
- Prebacivanje `$` → `R` → `%` ne dira nijednu metričku funkciju.

**Procena:** 1a — 1 sesija · 1b — 3–4 · 1c — 1.

---

### Faza 2 — Insight engine ⭐ ✅ ZAVRŠENO

> Isporučeno: **24 pravila** — 17 iz TradeZella kataloga i 7 vlastitih.
>
> **Korekcija moje ranije procene.** Rekao sam „30 od 31 izvodljivo, jedan otpada". Kad sam prošao
> kroz svaki obrazac pri implementaciji, ispalo je **četiri** koja otpadaju, ne jedan — tri od njih
> traže running P&L krivu ili intraday tajming koje nemamo, a četvrti je duplikat trade-level
> pravila. Popisani su u `OMITTED_RULES` sa razlogom, vide se u UI-ju i idu u mentor pack.
>
> Ostatak razlike do 31: nekoliko TZ obrazaca se prirodno spojilo u jedno pravilo
> (`flip_flop_day` pokriva i pozitivnu i negativnu varijantu, `overtrading` i
> `unusual_number_of_trades` mere istu stvar), pa je 17 pravila pokrilo ~20 njihovih stavki.

Nula migracija. Deterministička pravila nad onim što F1 već računa.

**Struktura** (po moduli §5)

```
lib/journal/insights/
├── types.ts        InsightRule { id, level: 'trade'|'day'|'week', minSample, evaluate(ctx) }
├── registry.ts
├── trade-insights.ts
├── day-insights.ts
├── week-insights.ts   ← swing dodatak, TZ nema
└── *.test.ts          jedan test po pravilu — pragovi su poslovna logika
```

`ctx` je jedan pre-izračunat objekat (trejdovi + statistike F1 + dnevni izveštaji + balance timeline),
da 31 pravilo ne prolazi 31 put kroz iste podatke. Bez persistencije (§2.3 gore); ako performanse
zaškripe — keš po `position.updated_at`.

#### Izvodljivost 31 TZ obrasca nad tvojim podacima

Prošao sam svaki. Presuda:

| Status | Broj | Koji |
|---|:--:|---|
| **Direktno izvodljiv** | 24 | sve što se računa iz MAE/MFE, fill-ova, trajanja, veličine i dnevnih agregata |
| **Aproksimacija iz MAE/MFE** | 6 | `no drawdown`, `green to red`, `green to break even`, `red to green`, `drawdown exceed profit`, `maximize your profit` — bez running P&L krive gledaju se krajnje tačke i ekskurzije umesto putanje |
| **Neizvodljiv** | 1 | **`most time in drawdown`** — traži udeo *vremena* u minusu, dakle punu running P&L seriju, dakle cenovni feed. Moduli §11 to i priznaju. **Izostavlja se, ne aproksimira** — lažan procenat je gori od nedostajućeg |

#### Prevod pragova na swing (moduli §5)

`loss streak short gap` 30 s → **isti ili sledeći dan** · `overtrading day` → **overtrading week** ·
`exceed average hold time` 1 h → **75. percentil hold dana** · `tilt session` → **tilt nedelja** ·
60-dnevni prozor → **6-mesečni** (mali uzorak).

#### Sedam vlastitih insight-a — ovo TZ ne može

| Insight | Uslov |
|---|---|
| `protiv makro bias-a` | `macro_align = Protiv bias` + istorijski rezultat te kategorije |
| `COT chase` | `cot_filter = Ne chase`, a ušao svejedno |
| `micromanage na A-setup-u` | `micromanage = violated` × `setup_grade = A`, **cena izražena u R** |
| `ulaz na lošu mentalnu ocenu` | `mental_temp < 5` na dan ulaska |
| `A-setup propušten` | `status = missed` × `setup_grade = A` |
| `swap pojeo R` | `swap > 15 %` bruto P&L-a |
| `plan bez izvršenja` | `planned` stariji od N dana bez fill-a |

**Mentor pack** dobija sekciju „Insights" — LLM dobija imenovane obrasce umesto sirovih brojeva.

**Prihvatanje:** svako pravilo ima fixture koji ga okida i fixture koji ga ne okida. Nijedno ne okida
ispod svog `minSample`.

**Procena:** 4–5 sesija.

---

### Faza 3 — Generički report engine ✅ ZAVRŠENO

> Isporučeno u tri koraka: 3a čist engine sa testovima, 3b ruta `/reports`, 3c compare + view modovi
> + konsolidacija. Tri hardkodovane liste dimenzija su spojene na registry — dimenzija dodata na
> jednom mestu sad se pojavljuje u gridu, na dashboard-u i u reportovima.
>
> `units.ts` je vraćen iz istorije. Review serijal ga je obrisao kao nedostižan kod i tada je to bilo
> tačno; `/reports` je prekidač koji ga je nedostajao, pa je sloj sad živ i pozvan.
>
> **Nije verifikovano u pregledaču.** Kontejner nema Supabase kredencijale, pa svaka ruta vraća 500 —
> uključujući postojeće. Produkcijski build kompajlira `/reports`, što je najjači dostupan signal.

Spec §5.1: *ne pisati 10 report stranica, pisati jednu.* Ovo je najveća ušteda u projektu.

**Kod**

- `reports/dimensions.ts` — registry `{ key, label, source, valueOf(trade, ctx) }`. Pokriva kolone,
  tag nizove, **deklarativne bucket-e** (hold duration, R-multiple, position size, mesec, dan u nedelji
  ulaska/izlaska) i **procesne dimenzije** (join `tj_daily_reports`: micromanage, ocena dana, mentalna
  temperatura, prekršeno pravilo, friday flat). Bucket-i su tabela definicija, ne `CASE WHEN` (spec §5.3).
- `reports/engine.ts` — `runReport({ trades, dimension, metricKeys, filters, dimensionContext, metricContext, minSample, sortBy })`.
  `breakdownByField` postaje tanak omotač.
- `reports/pivot.ts` — dimenzija × dimenzija, **`n` u svakoj ćeliji**, sivljenje ispod praga.
- `reports/filters.ts` — **negacija (`Excluding`) po svakom polju od prvog dana** (spec §5.7:
  naknadno dodavanje je bolno), R-opseg, trajanje, position size, ~~reviewed/unreviewed, rating~~
  (kolone obrisane, v. Fazu 0), insight koji je okinuo.
- Ruta `/reports` sa četiri komponente po spec §5.1: Performance Summary · Charts (do 3 metrike) ·
  Summary Table · Cross Analysis.
- **Win vs Losses** i **Compare** su isti engine — prvi sa hardkodovanom dimenzijom `pnl > 0`, drugi
  sa nizom filter setova. Zato filter objekat mora biti serijalizabilan.

**Prihvatanje**

- „Nadmašuje li A-setup uz makro bias onaj protiv njega, i sa kolikim `n`?" — jedan pivot, dva klika.
- Nova dimenzija = jedan unos u registry, nula izmena engine-a.

**Procena:** 5–6 sesija.

---

### Faza 4 — Custom fields i Playbook ✅ ZAVRŠENO

Jedina faza sa strukturnom migracijom podataka. Dva koraka, oba isporučena.

#### 4a — Custom fields ✅

- `tj_field_defs` — `key`, `label`, `field_type`, `list_key`, `group_id`, `sort_order`, `is_active`,
  `show_when`. RLS owner policy, `updated_at` triger, `UNIQUE (user_id, key)`.
- `tj_positions.custom jsonb NOT NULL DEFAULT '{}'` + GIN (`jsonb_path_ops`).
- `lib/journal/field-values.ts` — jedan accessor, kolona pa `custom`. Svih pet generičkih čitalaca
  (`reports/dimensions`, `mentor-export`, `journal-grid` filteri i CSV izvoz, `insights/process-rules`)
  prešlo na njega **pre** migracije, jer bi inače tiho vraćali `undefined`.
- `buildFormTabs(defs)` — struktura u kodu, lista polja unutar metodoloških grupa iz baze.
- `customFieldDimensions(defs)` — novo polje je odmah dimenzija na `/reports`, nula izmena engine-a.
- Settings → **Moja polja**: CRUD, arhiviranje (nikad brisanje), pregled ključa.

**Odstupanja od originalnog plana** (svesna, jer je baza bila prazna):

- **Nema dupolog upisa i nema perioda dvostruke istine.** Kolone `macro_align`, `cot_filter`,
  `htf_bias`, `entry_tf` obrisane su u istoj migraciji koja uvodi `custom`. Plan je predviđao
  backfill pa čišćenje posle verifikacije; sa nula trejdova to je bila cena bez koristi. **Ovaj
  oblik se ne sme kopirati u kasniju migraciju** — čim postoje pravi trejdovi, dva skladišta moraju
  da se preklapaju dok se podaci prepisuju.
- `session_killzone` nije backfill-ovan — kolona je već obrisana u `20260728124000`.
- `ict_entry_model` nije postao custom polje nego **playbook** (4b); `rules_followed` je obrisan.
- Slabo mesto koje plan nije predvideo: `getTradeForEdit` filtrira vrednosti na string / broj /
  niz stringova, pa **objekat tiho ispada** — `custom` bi nestajao pri svakom otvaranju forme i
  bio upisan prazan pri sledećem čuvanju. Rešeno `flattenCustom`-om, uz regresioni test.
- `updateTrade` **spaja** `custom` umesto da ga zameni: jsonb upis briše ceo dokument, pa bi polje
  koje je u međuvremenu arhivirano izgubilo istoriju pri nevezanoj izmeni trejda.

#### 4b — Playbook ✅

```
tj_playbooks        name, description, color, icon, is_active, sort_order
tj_playbook_groups  playbook_id, name, sort_order
tj_playbook_rules   group_id, text, show_when, sort_order, deleted_at
tj_position_rules   position_id, rule_id, followed   UNIQUE (position_id, rule_id)
```

`tj_positions` +: `playbook_id`, `conviction smallint CHECK (1..5)`.

- Soft-delete pravila: brisanje odgovorenog pravila ga arhivira, statistika ostaje netaknuta.
  Neodgovoreno pravilo se briše stvarno.
- `show_when` se zaključava čim pravilo ima ijedan `tj_position_rules` red — **i u UI-ju i DB
  trigerom** (`tj_playbook_rule_freeze_show_when`), jer forma nije jedini put do upisa.
- `followed` je **tri stanja**, ne dva. `NULL` = neodgovoreno, što nije isto što i prekršeno;
  spajanje to dvoje bi od nedovršene forme napravilo problem discipline u statistici.
- Seed: šest playbook-ova iz starih `ict_entry_model` vrednosti, sa praznim grupama.
  Pravila se **ne** seed-uju — pravilo koje nisi napisao je pravilo koje ćeš čekirati bez čitanja.
- Per-rule statistika: dimenzija `playbook_rule` + metrika `follow_rate`, plus `playbook` i
  `conviction`. Sve kroz engine iz F3 — nijedan poseban ekran.
- `ruleAppliesTo` je **jedna** funkcija koju koriste i forma i statistika, pa ne mogu da se raziđu
  oko toga koja je populacija merena.

**Odstupanja**

- `ReportMetric.compute` dobio treći argument (`scope`: bucket-i koji definišu grupu). Bez toga je
  red „Čekaj sweep" računao i odgovore na *ostala* pravila istih trejdova — broj je tvrdio nešto o
  jednom pravilu opisujući nekoliko. Test je to uhvatio; skoro svaka metrika `scope` ignoriše.
- `is_active` na `tj_playbook_rules` nije uveden — `deleted_at` sam nosi to značenje, a dva polja za
  isto stanje su dva izvora istine.
- ~~**Sickre Score još nema Process Adherence komponentu**~~ — isporučeno u F5. Ponderi su
  nepromenjeni; komponenta se dodaje samo kad postoji podatak, i maksimum raste sa 100 na 115.
- „Playbook bira koja custom polja forma traži" **nije** implementirano: veza playbook → field defs
  bi značila da forma menja strukturu po izboru u padajućem meniju, što je prepisivanje forme, a ne
  konfiguracija. Ostaje kao otvoreno pitanje za kasnije.

**Prihvatanje**

- „Koje pravilo nosi edge, a koje je ritual?" — `/reports` → grupiši po *Pravilo iz playbook-a*,
  kolona *Follow rate* uz `n`. ✅
- Brisanje pravila ne menja nijednu istorijsku statistiku. ✅ (soft delete + test)
- Dupli upis dokazan testom pre uklanjanja starih kolona — **neprimenjivo**, vidi odstupanja u 4a.

---

### Faza 5 — Progress Tracker ✅

Posle playbook-a, jer pravilo „svaki trejd ima playbook" nema smisla ranije (moduli §4).

```
tj_tracker_rules     text, stage (prepare|trade|reflect), active_days smallint[] (ISO 1-7),
                     auto_key, config jsonb, is_mandatory, sort_order, deleted_at
                     UNIQUE (user_id, auto_key) WHERE auto_key IS NOT NULL AND deleted_at IS NULL
tj_tracker_checkins  rule_id, report_date, checked boolean NULL, auto_evaluated
                     CHECK (checked IS NOT NULL OR auto_evaluated)   UNIQUE (rule_id, report_date)
```

`tj_daily_reports` +: `locked_at timestamptz`.

- Deset seed-ovanih pravila: ritual · mantre (3) · prihvatanje rizika · satnica · playbook · stop ·
  max gubitak po trejdu · max gubitak po danu. Korisnička pravila po fazi, sa izborom dana.
- **Četiri se auto-ocenjuju iz podataka**, ne dva. Atribucija dana se razlikuje po pravilu i to je
  jedina stvar u fazi koja se lako pogreši: novac se pripisuje danu **zatvaranja**, odluka danu
  **otvaranja**. Otvoren trejd bez playbook-a mora da padne na dan ulaska — na atribuciji po
  zatvaranju bio bi nevidljiv, pa bi deset nevezanih otvorenih trejdova dalo savršen dan.
- **Dan bez trejdova je `na`, ne `pass`.** „Nisam probio limit" je tačno na dan kad nisi trgovao, ali
  kao prolaz bi značilo da se niz farmi **ne trgujući** — tačna inverzija metrike. `na` ispada iz
  brojioca **i imenioca**, pa discipliniran dan bez trejdova i dalje ima 100 % i ne prekida niz.
- **Zaključavanje dana** — nepovratno, i to DB trigerom: svaka izmena zaključanog reda puca, a
  otključavanje je izmena. Obuhvata samo procesni dnevnik; **na `tj_positions` nema trigera i ne sme
  ga biti** — P&L je činjenica koja mora da se može ispraviti.
- Streak + heatmap doslednosti na dashboardu, **fiksna skala 0–100** i jedna nijansa, namerno ne
  profit/loss par.
- Sickre Score dobija sedmu komponentu (15 %), spoj doslednosti trackera (60) i follow rate-a (40).

**Odstupanja od originalnog plana**

- **Tracker nije dobio svoju stranicu.** Prvo je napravljen kao `/tracker`, pa spojen u `/daily`:
  `tj_lock_day` pečati oba jednim pozivom, a nešto što se pečati zajedno nije dve stranice. `/tracker`
  ostaje redirect. Spojena je površina, ne skladište — i dalje dve tabele i dva nezavisna upisa.
- **„Nadovezuje se na postojeći FTMO modul" nije izvodljivo.** `evaluateFtmo` vraća `OFF_RESULT` bez
  `ftmo_mode`, pragovi su mu procenti početnog balansa a ne apsolutan novac koji pravilo navodi, i
  izlaže `worstDay` ali ne mapu po danima. Auto-evaluacija je zasebna, čista.
- **`auto_key` kao kolona** — roadmap-ova šema nema način da kaže *koji* red je „Net Max Loss/Day".
  Diskriminanta koja bira granu koda ne sme da živi u slobodnom blobu.
- **`checked` mora biti nullable.** `NULL` znači „ocenjeno, nije primenjivo" — potrebno i za dan bez
  trejdova i da zamrznut dan ne bi „vaskrsnuo" auto pravila kad kasniji import doda trejd unazad.
- **`auto_evaluated` je hibrid**, što roadmap ne definiše: auto verdikti se izvode pri čitanju za
  otključan dan, a **zamrzavaju u redove pri zaključavanju**. Bez druge polovine brava je dekor —
  zaključan dan bi promenio ocenu čim ispraviš stop na trejdu sa tog dana.
- **Process Adherence ne dolazi iz `tj_daily_reports`** nego iz čekiranja. Dnevni izveštaj nema meru
  doslednosti, samo `rule_broken`, koji insight engine već troši; uzimanje 15 % skora odatle bi
  dvostruko brojalo jedan signal. `rule_broken` zato i **ostaje** u dnevnom izveštaju.
- **Config se seed-uje prazan.** Neподешeno novčano pravilo je `na` dok ne postaviš limit. Isti
  razlog zbog kog playbook ne seed-uje pravila: seed-ovan limit od 200 je limit koji ćeš prolaziti a
  da ga nikad nisi izabrao.
- **`is_active` nije uveden** — neoznačen boolean bi tiho prepisao imenilac svakog prošlog dana.
  `deleted_at` je jedini prekidač, i primenjivost se računa poređenjem dana sa `created_at` /
  `deleted_at`.
- **Mantre i `risk_accepted` prebačeni iz `tj_daily_reports` u tracker pravila.** Bile su iste vrste
  stvari, ali ih niko nikad nije čitao: nisu ulazile ni u doslednost, ni u niz, ni u skor. Migracija
  odbija da se izvrši ako ijedan izveštaj ima čekiranu mantru.
- **Peto auto pravilo („napisati dnevni izveštaj") nije uvedeno** — set je namerno fiksiran na četiri.

**Popravljeno usput**

- `CalendarHeatmap` je gradio ključeve dana u zoni **browsera** dok su svi podaci u zoni **naloga** —
  poslednja kolona je za Beograd/NY bila dan unapred, a sve vrednosti pomerene za kolonu. Mreža je
  izdvojena u `heatmap-grid.tsx` sa `endDay` propom, pa je popravljeno za **oba** heatmapa.
- `sickre-score-card` je pokrivenost poredio sa tvrdo upisanih 100; sa sedmom komponentom maksimum je
  115, pa bi delimičan skor od 100/115 prikazao kao potpuno pokriven. `computeSickreScore` sad vraća
  i `maxCoverage`.
- `tj_tracker_rules_active_days_check` je propuštao **prazan** `active_days`: `array_length` prazne
  liste vraća `NULL`, a `NULL BETWEEN` je `NULL`, što `CHECK` prihvata. Pravilo bez dana je primenjivo
  ni na jedan dan — stoji na čeklisti kao praćeno a nigde se ne ocenjuje.
- `tj_tracker_rules` je imao samo **parcijalne** indekse po `user_id` (`WHERE deleted_at IS NULL`),
  pa su kaskada iz `auth.users` i najčešće čitanje (`includeRetired: true`) bili neindeksirani.
- `tj_execution_guard()` i `tj_position_missed_guard()` iz `20260729091418` su ostali dostupni preko
  `/rest/v1/rpc` sa korisnikovim JWT-om. Rizik je bio mali (triger funkcija pozvana direktno puca pre
  nego što išta dodirne), ali „slučajno ne radi" je slabija garancija od „nije pozivljivo". Revoke je
  bezbedan jer PostgreSQL proverava `EXECUTE` na triger funkciji pri **kreiranju** trigera, ne pri
  svakom okidanju — potvrđeno nad živom bazom: RPC odbijen, oba trigera i dalje okidaju.

**Otvoreno, nije kod**

- Sweep i dalje prijavljuje `tj_seed_my_defaults()` — **namerno**. Ne prima argumente i sve izvodi iz
  `auth.uid()`, pa prijavljen korisnik njime može da seed-uje samo sebe; to mu je i svrha. Opasan
  oblik je onaj koji je `20260729140000` zatvorio: SECURITY DEFINER **plus user id kao argument**.
- **Leaked password protection je isključen** u Supabase Auth podešavanjima. To je dugme u dashboardu,
  ne migracija.

**Prihvatanje**

- „Koliko dana zaredom sam odradio proces?" — dashboard → *Doslednost procesa*. ✅
- Zaključan dan se ne može otključati ni izmeniti; trejdovi sa tog dana se i dalje mogu ispraviti.
  ✅ (provereno nad živom bazom, kao prijavljen korisnik)
- Ručno testiranje u pregledaču **nije obavljeno** — kontejner nema Supabase env promenljive.

**Procena:** 4 sesije. **Stvarno:** 5.

---

### Faza 6 — Notebook ✅

Ne dira `/daily` — procesni dnevnik je forma sa fiksnim pitanjima i ostaje kakav jeste (moduli §2).
Notebook je za ono što u formu ne staje: nedeljni pregled, zapažanje o tržištu, pasus o jednom trejdu.

```
tj_note_folders  name, template_text, sort_order            UNIQUE (user_id, name)
tj_notes         title, content, folder_id?, position_id?, report_date?,
                 tags text[], pinned, deleted_at
tj_note_tags     name — zaseban rečnik                       UNIQUE (user_id, name)
```

- Seed folderi sa šablonima: **Weekly Review · Trade Notes · Market Observations**. Šablon se upisuje
  u telo nove beleške — poenta nedeljnog pregleda je da pitanja već stoje tu kad sedneš.
- **Sadržaj je markdown, čuvan kao čist tekst.** Renderuje se u TypeScript-u u React elemente, nikad u
  HTML string, pa `dangerouslySetInnerHTML` ne postoji nigde i beleška ne može da ubaci markup šta god
  da se u nju otkuca. Tekst usput ostaje pretraživ i izvozljiv, što HTML blob iz WYSIWYG-a ne bi bio.
- Autosnimanje, bez dugmeta Sačuvaj. Tekst se piše u naletima kroz duže sedenje, a jedina stvar koja
  ne sme da se desi pisanju je da nestane pri navigaciji — što ručno čuvanje upravo poziva.
- Tagovi se kucaju slobodno i skupljaju u rečnik u hodu. Rečnik koji moraš da urediš pre nego što
  počneš da pišeš je rečnik koji prestaneš da koristiš.
- Beleška se kači na trejd preko `position_id`, i sa nje se otvara trejd.

**Odstupanja od originalnog plana**

- **„Recently Deleted" je filter, ne folder.** Da je pravi folder, brisanje bi premeštalo belešku u
  njega i time zaboravilo iz kog je foldera došla, pa vraćanje ne bi imalo gde da je vrati.
  `deleted_at` nosi isto značenje i pamti poreklo.
- **Folderi se brišu tvrdo, beleške preživljavaju.** `folder_id` je `ON DELETE SET NULL`, pa beleške
  padnu u „Bez foldera". Meko brisanje foldera bi ih sakrilo iza nevidljivog roditelja, a odbijanje
  brisanja punog foldera bi teralo korisnika da ga prazni ručno.
- **PDF izvoz je print stylesheet**, ne biblioteka. „Sačuvaj kao PDF" u dijalogu za štampu JESTE izvoz;
  projekat ne dobija zavisnost radi jednog dugmeta. Cena je `@media print` blok koji skida hrom
  aplikacije — bez njega bi svaki list nosio navigaciju sa strane.
- **Javni link po belešci nije izgrađen** (odluka vlasnika). To je jedina stavka faze koja otvara
  podatke van prijave, tražila bi `SECURITY DEFINER` sa argumentom — tačno oblik koji je dvaput
  zatvaran — a mentor pack izvoz već pokriva deljenje.
- **`trade_journal_notes` ostaje kolona na trejdu** (odluka vlasnika). Kratka beleška uz unos i duži
  zapis u Notebook-u su dva različita posla; veza ide preko `position_id`.
- **Nema „auto-sync" u smislu kopiranja.** Beleška vezana za trejd se vidi u Trade Notes zato što je
  tamo, ne zato što se negde duplira. Dva mesta sa istim tekstom su dva mesta koja se raziđu.
- `tj_note_tags` je **rečnik**, a tagovi stoje kao `text[]` na belešci sa GIN indeksom — isti oblik
  koji `psychology_tags` već koristi na poziciji, umesto join tabele za jednog korisnika.

**Prihvatanje**

- „Šta sam naučio ove nedelje?" — `/notebook` → Weekly Review → nova beleška dolazi sa pitanjima. ✅
- Obrisana beleška se vraća; folder obrisan sa beleškama ne gubi nijednu. ✅ (provereno nad živom
  bazom, kao prijavljen korisnik)
- Ručno testiranje u pregledaču **nije obavljeno** — kontejner nema Supabase env promenljive.

**Procena:** 4 sesije. **Stvarno:** 1.

---

### Faza 7 — Parity i automatizacija · **prvi rez isporučen**

Faza 7 nije jedna faza nego **osam nezavisnih blokova**, i razlikuju se po vrednosti za red
veličine. Isporučena su tri, dva su odbijena sa obrazloženjem, četiri stoje neurađena.

| Blok | Status |
|---|---|
| **Kalendar (D12/D13)** | ✅ |
| **Journaling (F5/F6)** | ✅ |
| **Grid (I4/I5)** | ✅ |
| **Dashboard (I1/I2)** | ⬜ Widget layout JSON, imenovani template-i |
| **Auto recap (H5)** | ⬜ Cron → mentor pack → `tj_recaps` → notifikacija. Prag ≥ 3 zatvorena trejda nedeljno, ≥ 4 mesečno |
| **Import (J5)** | ⬜ Broker preset UI — `tj_column_mappings` konačno dobija kod |
| **Trade Log akcije** | ⬜ Merge / split trejdova. *Transfer između naloga zapravo već radi* — `updateTrade` piše `account_id` bez ijednog ograničenja; fali samo akcija nad redom |
| **Profit calc metoda** | ❌ odbijeno |
| **Javni link za trejd** | ❌ odbijeno |

#### Isporučeno

```
tj_user_prefs  user_id (PK), journal_hidden_columns text[]
```

- **`/calendar`** — mesečna mreža sa Net P&L po danu, kolona nedeljnog zbira, izbor metrike po ćeliji
  (Net P&L · R · broj trejdova · win rate), ikonica na danima sa dnevnikom, sivi breakeven dani po
  opsegu iz F0, klik na dan vodi na `/daily?date=…`.
- **Dnevni stat blok** na `/daily` — devet figura plus proširiva lista trejdova zatvorenih tog dana.
- **Kolone u gridu** — MFE capture kolona (logika je postojala, samo se nije videla), izbor kolona sa
  pamćenjem po korisniku.

**Odstupanja i nalazi**

- **Roadmap je potcenio grid: target attainment je već bio kolona.** Fali je bio samo MFE capture.
- **`bucketByPeriod` je dobio `"day"`**, pa dan, nedelja i mesec idu kroz jednu funkciju. Tri mesta
  koja sama izvode ključ dana su tri prilike da se ne slože oko toga kom danu pripada zatvaranje u
  petak uveče. Test pribija da dnevna ćelija kalendara i dnevni blok daju isti broj.
- **`HeatmapGrid` nije proširen** — nedelje-kao-kolone sa ćelijama od 3px su pravi oblik za godinu na
  jedan pogled i pogrešan za mesec sa kog se čitaju cifre. Ni `ui/calendar.tsx` (react-day-picker,
  stoji neiskorišćen u repou) — radi nad `Date` u zoni **browsera**, a ovde je svaki ključ dan
  **naloga**; to je bug popravljen u Fazi 5.
- **Mesečna mreža ima promenljiv broj redova** (28/35/42), ne fiksnih šest: red sastavljen isključivo
  od dana sledećeg meseca je šum u svakom mesecu kome ne treba.
- **`tj_user_prefs` čuva SAKRIVENE kolone, ne vidljive.** Čuvanje vidljivih bi zamrzlo svakom
  korisniku listu na dan kad ju je poslednji put dirao, pa bi svaka buduća kolona stigla nevidljiva
  baš onima koji su se potrudili da grid podese. Niz je uz to inertan: id iza preimenovane kolone ne
  odgovara ničemu i tiho prestaje da važi. Uska tipizovana tabela, ne `prefs jsonb` vreća.
- **Mini kalendar na `/daily` nije napravljen** — `/calendar` je taj pogled, a druga mreža u dnevnoj
  stranici je drugo mesto koje se raziđe.
- **Izvoz iz grida ostaje pun**, ne prati sakrivene kolone: on ionako nosi i polja kojih u gridu nema.

#### Odbijeno

- **Profit calc metoda (FIFO/LIFO/WAvg).** `profit_calc_method` je bio **mrtva kolona** od uvođenja —
  fetch-ovan i tipizovan, ali nikad pročitan da bi nešto granao, i nikad postavljiv iz UI-ja. Da
  proradi, i `tj_position_stats` view i njegov TS blizanac `position-stats.ts` morali bi da dobiju
  praćenje lotova; oba rade jedan objedinjen prosek ulaza. A metode se razlikuju samo kad pozicija ima
  više ulaznih fillova po različitim cenama sa izlazima između njih — a model ima **jedan
  `tj_positions` red po trejdu**, pa se to ne može ni predstaviti (isti argument kao linija 109).
  Kolona ne bi mogla da promeni nijedan broj šta god da nosi, a podešavanje koje ne može ništa da
  uradi je gore od nepostojećeg: poziva da ga neko postavi i poveruje rezultatu. **Obrisana**
  migracijom `20260801160000`; vraća se jednim `ALTER`-om onog dana kad postoji model sa lotovima.
- **Javni link za deljenje trejda.** Isti oblik odbijen u Fazi 6. Tražio bi probijanje tri kapije
  (`isPublic` lista u `lib/supabase/middleware.ts`, redirect u `(app)/layout.tsx`, i
  `authenticated`-only RLS na svakoj tabeli), `SECURITY DEFINER` sa tokenom, i **stranicu trejda koja
  ne postoji** — pod `/trades/[id]` postoji samo `edit`. Mentor pack izvoz već pokriva deljenje.

#### Beleške za preostala četiri bloka

- **Widget layout (I1/I2)** je najskuplji i najmanje vredan: `dashboard.tsx` je 1450 linija sa ~35
  ulančanih `useMemo`-a i ~450 linija još neizdvojenog inline Recharts JSX-a. Devet od dvadesetak
  kartica **jesu** već zasebne komponente, pa je pola posla urađeno; ostatak je izdvajanje i model
  podataka za 26 stat pločica, ne sam renderer rasporeda. Filteri su globalno stanje dashboarda i ne
  mogu biti „samo još jedan widget" bez konteksta.
- **Auto recap (H5)** bi bio **prvi izuzetak od pravila „nema REST ruta"** (§4). `buildMentorPack` i
  `resolveCalendarRange` su čisti i spremni; fali sve ostalo — `tj_recaps`, route handler, izuzetak u
  `proxy.ts` matcher-u, service-role klijent i kanal za notifikaciju.
- **Broker preseti (J5)** su najčistiji od četiri: `tj_column_mappings` i RLS policy postoje, a stanje
  čarobnjaka (`Record<Canonical, string>`) je već tačno oblik koji `mapping jsonb` treba. Šav je
  `import-wizard.tsx` na mestu gde `autoMap(headers)` popunjava mapu.
- **Merge / split** mora da poštuje `tj_executions_guard` (okida se i na `UPDATE OF position_id`, pa
  je re-parentovanje fillova dozvoljeno i provereno), `tj_positions_missed_guard`, status CHECK i
  `tj_trade_images (position_id, kind)` UNIQUE. Grid nema selekciju redova, pa merge traži i to.

**Procena:** 8–10 sesija za svih osam. **Stvarno za prva tri bloka:** 1, u osam koraka.

---

### Posle Faze 7 — parity čišćenje ✅

Nastalo iz poređenja sa punim TradeZella izveštajem o funkcijama (v. `PARITY.md`). Sitne stavke,
sve isporučene, bez otvorenih repova.

| Šta | Zašto | Migracija |
|---|---|:--:|
| **Sharpe, Sortino, Calmar, Avg daily DD** (`238f94b`) | Četiri standardne metrike koje su stvarno nedostajale — `PARITY.md` je tvrdio pun parity na metrikama i **to nije bilo tačno** | Ne |
| **`rating` obrisan** (`51fb378`) | Mrtva kolona iz F0 | Da |
| **`psychology_tags` razdvojen** (`51fb378`) | Jedna kolona hranjena iz dve liste | Ne |
| **`result` obrisan** (`b36c06e`) | Duplirao izvedeni `outcome` | Da |
| **`reviewed` obrisan** (`ba72e88`) | Mrtva kolona iz F0 | Da |

Tri stvari vredne pamćenja:

- **Risk ratio-i se godišnje skaliraju MERENIM brojem dana, ne konstantom 252.** Konvencija
  pretpostavlja prisustvo u svakoj sesiji; sving trejder koji zatvara 40 dana godišnje nije, i √252
  bi naduvalo broj preko dva puta. Broj perioda izlazi iz podataka. Period je dan **sa zatvorenim
  trejdom**, ne kalendarski — jer iste metrike rade i unutar grupa u izveštajima („ulazi
  ponedeljkom"), gde je kalendar šest sedmina nula po konstrukciji. Ispod 5 dana → `null`.
- **`psychology_tags` je razdvojen bez migracije** jer je podela povratna iz podataka: opcione liste
  govore odakle je koja vrednost došla (`tagSplitDimensions`). Vrednost u obe liste pripada **prvoj**
  — „Revenge" je seedovan i u `emotion` i u `discipline`, a chip picker deduplicira redom iz
  `listKeys`, pa je kliknuti chip došao iz `emotion`. Nije proizvoljan prioritet nego reprodukcija
  izbora koji je korisnik stvarno napravio. Kombinovana dimenzija ostaje kao „Psychology Tags (sve)"
  jer je jedina koja još pokazuje slobodno ukucanu oznaku.
- **Brisanje `result` je moralo prvo da sruši `tj_position_stats`** — view je nosio `p.result` kroz
  sva četiri CTE-a, a `CREATE OR REPLACE` ne sme da ukloni kolonu. Nijedan potrošač je nije čitao
  (nema je ni u `PositionStat` ni u TS blizancu). Posle `CREATE VIEW` obavezno ponovo
  `security_invoker = on` — `CREATE VIEW` resetuje opcije, a bez toga view zaobilazi RLS.
  Filter u gridu nije izgubljen nego zamenjen izvedenim „Ishod", sa breakeven pojasom **po nalogu**.

### Faza 8 — Automatski MAE/MFE · **polovina A isporučena, B blokirana**

Nastalo iz poređenja sa TradeZella izveštajem: vlasnik je odbio Backtesting i Trade Replay („to
radim direktno u TradingView aplikaciji") i tražio umesto toga da se **MAE i MFE prestanu prepisivati
rukom sa grafikona**.

To je bio bolji izbor za red veličine. Ne zbog cene nego zato što **analiza već postoji i gladuje**:
`excursion.ts` (`maeR`, `mfeR`, `capturePct`), metrika `avg_mae_r`, kolona **Capture %** u gridu —
sve napisano i testirano u ranijim fazama, a zavisi od toga hoće li čovek ručno uneti dva broja po
trejdu. Neće. Automatizacija ne dodaje funkciju, ona **pali funkciju koja već stoji**.

Posao se čisto deli na determinističku polovinu i mrežnu, i to je jedini razlog zašto je pola moglo
da se isporuči odmah.

#### Isporučeno — polovina A (`69c93dc`, nula migracija, nula mreže)

`src/lib/journal/excursion-scan.ts` + 22 testa. Provajder-agnostičan: `Candle` je četiri broja i
vreme, pa se OANDA, Dukascopy ili CSV svode na isti ulaz i nijedan ne može da procuri u računicu.

Dva pravila nose svaki broj, oba pinovana testom:

1. **Sveća se broji samo ako cela stane u prozor držanja.** Sveća sa oznakom 14:00 na satnom feedu
   pokriva 14:00–15:00; ulazak u 14:30 znači da njen `low` može biti iz 14:05 — cena kojoj trejd
   nikad nije bio izložen. MAE se čita kao „koliko sam bio blizu stopa", pa precenjivanje tu nije
   greška zaokruživanja nego lažno sećanje. Cena pravila je zapisana: trejd kraći od jedne sveće ne
   vidi nijednu, zato interval bira pozivalac (`suggestInterval`, namerno zaustavljen na 1h).
2. **Fillovi su takođe osmotrene cene.** `capturePct = realizedR / mfeR`, a realizovani R se gradi
   iz prosečnog izlaza; ako pravilo 1 odbaci izlaznu sveću a izlaz je bio najbolja cena trejda, MFE
   padne ispod realizovanog i capture pređe 100%. Isti prosečan izlaz na obe strane čini odnos
   dokazivo ≤ 100%. **Postoji i test koji namerno pokazuje kvar bez ovog pravila** (capture 1000%),
   da se razlog ne izgubi pri nekom budućem čišćenju.

Vraća se sirovi ekstrem, nikad odsečen na ulaznu cenu — `excursionFromTrade` već svodi ne-adverzni
MAE na 0 i broji ga kao „nikad nije bio u minusu".

#### Polovina B — **trading: MT5 (isporučeno 19.09.2026.); backtest: ručni unos**

**Trading nalozi** dobijaju MAE/MFE iz FTMO MT5 terminala na ovom računaru:
`scripts/mt5_excursion.py`. Prijavljuje se kao korisnik dnevnika (`JOURNAL_EMAIL`/`JOURNAL_PASSWORD` iz
`.env.local`, pod RLS-om). Uzima samo cene po simbolu i vremenu, pa broj FTMO naloga nije bitan. Long
se meri na bid-u, short na ask-u, na tikovima između tika ulaza i tika poslednjeg izlaza. Fill se
traži među tikovima svog minuta; ako nijedan nije u krugu od 0,05%, trejd se odbija sa razlogom.
Sat servera je NY+7 i proverava se pre upisa. Jedinice bakra (centi prema dolarima po funti) usklađuju
se same. Za trejdove starije od istorije tikova koriste se M1 barovi. `excursion_source` je sada
`manual | mt5`, i ručni unos uvek pobeđuje.

**Backtest nalozi: MAE/MFE iz TradingView izvoza, pri uvozu** (`tradingViewExcursion`,
`20260919160000`). Izvoz daje favorable/adverse excursion u novcu, umanjen za proviziju ulaza.
Provizija se vraća, iznos se deli veličinom, i dobija se cena. Na tri trejda na zlatu čiji je MFE
ranije kucan ručno iz istih fajlova, rezultat je jednak u cent. TradingView meri cele barove, pa kod
gubitnog stopa MAE ide preko stopa; zato se tada drži na stopu, a MFE na TP-u. Stop na BE ili bolje
nije granica. Upisuje se kao `excursion_source = 'tradingview'`, samo tamo gde nema vrednosti ili ih
je upisao raniji uvoz. Undo ih briše (`excursion_written`). Ručni unos i dalje pobeđuje.

Pre toga, istog dana: Dukascopy popunjavanje je **uklonjeno** (`20260919140000`). Feed nije broker na kom je backtest rađen, pa se razlika morala
pogađati iz fill-ova, a na bakru sa 1h barovima to nije išlo. Jedini trejd koji je popunio (#6)
zadržava cene, sada kao ručne.

Ostaje iz tog dana: greška u uvozu je ispravljena. TradingView vremena su čitana u zoni NALOGA, a
chart je bio na NY vremenu, pa su svi fill-ovi bili šest sati ranije. Uvoz sada pita za zonu charta
(podrazumevano NY), a sedam već uvezenih fill-ova je ispravljeno.

#### Stari tekst — izvor MAE/MFE kao otvoreno pitanje (pre 19.09.2026.)

**Stanje na 18.09.2026:** MAE/MFE se unosi isključivo rukom, na trejdu koji ga ima. Logika koja ih
računa iz sveća je napisana i testirana (`excursion-scan.ts`: bira 1m–1h prema dužini držanja, sveća
se broji samo ako cela staje u prozor trejda) i ne zavisi od izvora. **Nedostaje feed.**

**Dosadašnji izvori su otpali, oba:**
- OANDA v20 REST — OANDA je 2017. ukinula v20 pristup za EU klijente, a vlasnikov nalog je
  EU-regulisan (provereno u samom nalogu).
- cTrader Open API — bio je odgovor dok je postojao cTrader bot most. Prelaskom na MT4/MT5 taj
  odgovor otpada, a bot most je uklonjen (v. Fazu 11).

**Kandidati koje tek treba ispitati, nijedan nije izabran:**
1. MT5 terminal export minuta oko svakog trejda (bez mreže, ali ručni korak po trejdu).
2. Expert Advisor koji dok je pozicija otvorena beleži ekstreme i šalje ih dnevniku — isti oblik kao
   stari most, samo za MT4/5. Ako se ovo izabere, nauk iz Faze 11 važi: heartbeat, idempotentnost po
   ključu događaja, i karantin umesto pogađanja naloga.
3. Treći candle API za nekoliko instrumenata koji se stvarno trguju.

Dok se izvor ne izabere, `max_drawdown_price` i `max_profit_price` su polja koja se popunjavaju rukom
— to je zapisano i u README § „Half built, half waiting", da ne izgledaju kao polja koja je neko
zaboravio.

Ono što ostaje tačno iz originalnog plana, kad god se izvor izabere: **ručno mora da pobedi
automatski** (automatika piše samo tamo gde čovek nije uneo ništa — `excursion_source` koji je to
ranije razlikovao je otišao sa bot mostom, pa će ta oznaka morati da se uvede ponovo uz izvor), i
**keš je obavezan, ne optimizacija** (jednom povučene sveće rade zauvek, isti razlog zbog kog se
`point_value_at_trade` već snima na poziciju).

**Procena:** ne procenjuje se dok se izvor ne izabere.

---

## 6. Svesno izostavljeno

| Modul | Razlog |
|---|---|
| Backtesting + Trade Replay | **Potvrđeno odbijeno.** Vlasnik: „to radim direktno u TradingView aplikaciji". Embed ne pomaže — Bar Replay živi u njihovoj aplikaciji, widget je crna kutija koju kod ne može da korakne. Ostalo bi da se gradi sve troje: grafikon, feed sveća i simulator naloga |
| Broker sync | Manuelni unos je izbor i prednost |
| Spaces / mentor / leaderboard | Jednokorisnički sistem |
| Zella AI chat + agenti | Mentor pack + insights daju isto bez API troška |
| Opcije (DTE, strike, expiry) | Ne trguješ opcijama |
| Intraday dimenzije (entry time 5–30 min) | Day-trading artefakt |
| Ekonomski kalendar | Živi u vault-u |
| **Running P&L kriva po trejdu** | Traži cenovni feed. Posledica: `most time in drawdown` otpada |
| ~~Intraday MAE/MFE preciznost~~ | **Više ne važi — v. Fazu 8.** Ručni unos je bio pretpostavka, a ispao je razlog zašto `capturePct` i `avg_mae_r` stoje prazni. `suggestInterval` bira 1m–1h prema dužini držanja; dnevni high/low je odbačen jer bi dve odbačene ivične sveće pojele dva cela dana trejda |

---

## 7. Gde ovo tuče TradeZella

| Pitanje | Faza |
|---|---|
| Koliko me košta diranje otvorenih pozicija, u R? | F2 — `micromanage` × trejdovi dana |
| Nadmašuje li A-setup uz makro bias onaj protiv njega, i sa kojim `n`? | F3 — pivot sa uzorkom |
| Koje pravilo playbook-a nosi edge, a koje je ritual? | F4b — per-rule statistika |
| Imaju li trejdovi duži od 7 dana pozitivnu EV posle swapa? | F1 — duration bucket × cost report |
| Ulazim li lošije kad je mentalna temperatura ispod 5? | F3 — procesne dimenzije |
| Koliko planiranog reward-a uzimam i popravlja li se? | **već postoji** |
| Beže li mi sistematski A-setup-ovi? | **već postoji** (`missed`), čeka dimenziju u F3 |

TZ nema procesni dnevnik, nema `missed` kao prvorazredni podatak, nema R-izraženu cenu nediscipline,
nema per-rule atribuciju edge-a, i nema Process Adherence u kompozitnom skoru. To je pet stvari koje
ovaj model ima strukturno.

---

## 8. Sažetak

| Faza | Sadržaj | Migracija | Sesije |
|:--:|---|:--:|:--:|
| 0 | Cash events, breakeven range, default komisije, undo import | Da | ✅ |
| 1 | Sloj jedinica → metrike (vreme, trošak, rizik, nedeljni sloj) → Sickre Score | Ne | ✅ |
| 2 | Insight engine: 17 TZ pravila + 7 vlastitih + mentor pack | Ne | ✅ |
| 3 | Report engine, pivot sa `n`, dimension registry, negacija filtera | Ne | ✅ |
| 4a | Custom fields + backfill metodoloških kolona | Da | ✅ |
| 4b | Playbook, pravila, per-rule stats, forma iz playbook-a | Da | ✅ |
| 5 | Progress Tracker, auto-evaluirana pravila, streak, zaključavanje dana, 7. komponenta skora | Da | ✅ |
| 6 | Notebook: folderi, šabloni, note tagovi, nedeljni pregled | Da | ✅ |
| 7 | Kalendar, dnevni blok, grid kolone | Da | ✅ |
| 7 | *ostatak:* widget layout, cron recap, broker preseti, merge/split | Delom | 5–7 |
| 8 | Automatski MAE/MFE — polovina A (čist skener sveća) | Ne | ✅ |
| 8 | *ostatak:* polovina B — OANDA adapter, `tj_candles`, backfill | Da | 1–2 ⛔ |
| 9 | Revizija runde 3 — devet koraka, 31 nalaz, README od nule | Ne | ✅ |
| 10 | Izvršavanje render sloja — jsdom + testing-library | Ne | ✅ |

⛔ = blokirano. Faza 8B čeka OANDA praktični token; ništa drugo ne fali.

## Faza 10 — izvršavanje render sloja

**Povod.** Runda 3 se zatvorila imenovanjem sopstvene rupe: 16 250 linija komponenti i 25 ruta
pregledanih čitanjem, nikad izvršavanjem. Sva četiri nalaza koja su promenila brojeve na ekranu —
`S1`, `S2`, `S3`, `P1` — živela su u tom sloju, a `S1` je vlasnik našao sam, otvaranjem aplikacije.
Nijedan od tada 958 testova ga nije uhvatio, jer je formula bila tačna; pogrešno je bilo ono što
joj `dashboard.tsx` prosleđuje.

**Kičma.** `book.fixture.test.ts` već drži knjigu od deset trejdova sa svakom brojkom izvedenom na
papiru. `mkTrade(spec).row` vraća `TradeRow` — tačno tip koji `Dashboard` traži. Ista knjiga
postaje propovi renderovanog Dashboard-a, pa test tvrdi da se isti brojevi pojave u DOM-u: papir →
`lib/` → ekran, jedan skup brojeva kroz sva tri sloja. I šest oblika knjige (prazna, jedan trejd,
sve dobitnici, sve gubitnici, sve breakeven, samo otvorene) prelaze iz `lib/` testa u render test.

| Korak | Šta | Stanje |
|---|---|---|
| 0 | Harness: jsdom, testing-library, shim-ovi, `server-only` alias, podela na dva vitest projekta | ✅ |
| 1 | Dashboard: knjiga na ekranu + šest oblika | ✅ |
| 2 | Dashboard kontrole: period / nalog / osnova mere isti prozor (`P1`) | ✅ |
| 3 | Čiste prezentacione komponente, uključujući `markdown-view` | ✅ |
| 4 | `journal-grid` | ✅ |
| 5 | Forme: `trade-form`, `daily-report-form`, `tracker-checklist` | ✅ |
| 6 | `import-wizard` — odbijene ćelije na ekranu | ✅ |
| 7 | Dokumentacija i izmereni podovi za render sloj | ✅ |

**Rangiranje po riziku** (izmereno, 43 fajla). Tier 1 — računa sam i ima stanje koje to menja:
`dashboard.tsx` (42 memo, 10 kontrola), `reports/reports-workbench.tsx` (stanje u URL-u),
`journal-grid.tsx` (račun i u `accessorFn` i u ćeliji), `month-calendar.tsx`, `trade-form.tsx`,
`reports/compare-view.tsx`, `drawdown-chart.tsx`, `cash-events-manager.tsx`. Tier 2 računa bez
korisničkog stanja (14 fajlova), Tier 3 je čista prezentacija (21).

**Nova klasa koju runda 3 nije tražila: aritmetika pisana direktno u JSX-u.** Ona zaobilazi
testiranu biblioteku u potpunosti, pa je nijedan `lib/` test ne može uhvatiti. Jedan nalaz je već
potvrđen čitanjem izvora — `drawdown-chart.tsx:122` prikazivao je `Max` nenegirano a `:138`
`Trenutni` negirano, iako `balance.ts` obe računa kao `Math.abs(...)`; u novčanoj osnovi su pak obe
negativne. Dve brojke jedna do druge, suprotne konvencije znaka. **Popravljeno u Koraku 7**, sa
svojim testom (`drawdown-chart.render.test.tsx`) — nijedan raniji korak nije konkretno pokrio taj
fajl, pa je zatvoreno pri zaključivanju faze umesto da ostane otvoreno. Sedam daljih kandidata iz
plana faze ostaje van obima ove faze, popisano tamo za buduću proveru.

**Svesno izvan obima:** rasklapanje `dashboard.tsx` (šav postoji na liniji 807, ali izdvojena
funkcija dokazuje račun a ne ekran), Playwright (traži pokrenutu aplikaciju i kredencijale kojih
kontejner nema), i testovi ruta (server komponente traže Next runtime, a logika im je tanka —
dohvat pa prosleđivanje propova koji se sad tvrde na drugoj strani).

**Zaključak.** Faza zatvorena, svih osam koraka. 1090 testova u 78 fajlova (958 → 1090); render
sloj ima svoj izmereni pod pokrivenosti (64/64/61/65), odvojen od bibliotečkog (95/89/96/96), a ne
stopljen u njega. Pet nalaza: `W1`–`W4` (Koraci 1, 1, 3, 5) i `drawdown-chart.tsx`-ov znak (Korak 7,
flagovan u izviđanju a nijedan raniji korak ga nije konkretno pokrio). Sva četiri nalaza runde 3 —
`S1`, `S2`, `S3`, `P1` — sada imaju render test koji bi ih uhvatio da su se ponovila. Detaljno u
`CODE_REVIEW.md`, sekcija „Phase 10 — conclusion".

**Ukupno: 41–46 sesija za F1–F8**, plus 9 potrošenih na reviziju runde 3 (F9) i 5–7 procenjenih za
render sloj (F10). Posle F4 journal odgovara na svih šest pitanja iz sanity provere. F5–F7 su
disciplina, udobnost i parity; F9–F10 su dokaz da brojevi koje pokazuju stvarno stoje.

**Prva tri koraka, konkretno:** `tj_cash_events` + `classifyOutcome()` → `units.ts` → hold time i
cost report. Prva dva su temelji koje je skupo naknadno ubaciti; treći je prva stvar koju ćeš videti
u UI-ju.

---

## Runda 4 — SQL sloj, put upisa i ekran (avgust 2026.)

Jedanaest koraka, vođenih pitanjem koje su prethodne runde ostavile otvorenim: **da li su brojevi
tačni**, a ne samo da li je kod sam sa sobom saglasan.

Rupa koju je runda zatvorila je bila u temelju: **novac se rađa u SQL-u, a nijedan test nikad nije
izvršio SQL**. `tj_position_stats` računa `gross_pl`, `net_pl` i `realized_r`; svaki TS test je
`net_pl` primao kao datost. Dokazana je bila agregacija nad brojem, ne rađanje broja.

| Korak | Šta je bilo | Ishod |
|---|---|---|
| 0 | nema `node_modules`, `typecheck` skripte ni CI-ja; brojke u dokumentaciji ne stoje | baseline izmeren, trigger za seed popravljen (0/0/0/0 → radi) |
| 1 | 10 tabela nigde u repou; baza se ne može rekonstruisati iz koda | bazna šema izvučena, view dokazan bajt za bajt |
| 2 | SQL nikad izvršen testom | knjiga sa papira, svaka kolona view-a tvrđena |
| 3 | 10 instrumenata, nema FX konverzije, `tick_value` svuda null | 91 instrument, kurs snimljen pri upisu, `gross_pnl_override` |
| 4 | tvrdi se da kod radi ono što README kaže, ali ništa to ne proverava | 30 metrika + 7 komponenti skora protiv specifikacije |
| 5 | pet dupliranih izraza po inventaru | **dvadeset** kopija u šest klasa, dve sa stvarnim razilaženjem |
| 6 | cena bez ijednog ograničenja; upis u četiri odvojena poziva | CHECK + zod, `tj_save_trade` u jednoj transakciji |
| 7 | spajanje bira prvog kandidata i briše fill-ove; `110'16` = 11016 | dvosmislenost vidljiva, 32-inski zapis odbijen, undo atomičan |
| 8 | poreklo novca se ne vidi; 10 komponenti bez testa | `money-provenance.ts`, sedam jedinica pokriveno |
| 9 | 22 commit-a koje nijedna revizija nije pročitala | neprocenjiv trejd tiho ispada iz svakog broja — sad se priznaje |
| 10 | aplikacija nikad viđena sa podacima | knjiga kroz živu bazu; **ekran ostaje blokiran mrežom** |
| 11 | gate se drži konvencijom | `.github/workflows/gate.yml` |

**Šta i dalje nije dokazano** — zapisano u `CODE_REVIEW.md`, „Round 4 — conclusion": jedanaest od
četrnaest ruta nikad nije viđeno kako iscrtava knjigu (mrežna politika sredine ne pušta Supabase iz
kontejnera); pet komponenti izveštaja (~1720 linija) nema test; prozor spajanja pri uvozu je i dalje
procena a ne merenje; migracije reprodukuju žive objekte ali nisu zapis istorije koji se može
odvrteti.

**Testovi: 1712 u 108 fajlova** (1090 → 1712 kroz rundu 4).

---

## Faza 11 — bot most: order → planirani trejd → aktivni trejd (avgust 2026.) — **UKLONJENO 18.09.2026.**

> **Ova faza više ne postoji u kodu.** Bot most je govorio samo cTrader, a trgovanje prelazi na
> MT4/MT5, pa je ostao kao površina koju niko ne koristi: `tj_bot_ingest` izložen `anon` roli, tabela
> tokena i tri tabele stanja koje moraju da budu tačne zbog brokera sa kojim dnevnik više ne priča.
> Migracija `20260918120000_remove_bot_bridge.sql` briše tabele, funkcije i `broker*` kolone, a
> trejdove koje je most upisao prebacuje na `source = 'manual'` — **nijedan trejd ni fill nije
> izgubljen**, izgubljen je samo log događaja, koji se ne može rekonstruisati i nije potreban da bi
> se ijedan trejd objasnio. Ono što je most davao besplatno, a sada nemamo, jesu MAE/MFE cene — v.
> Fazu 8B ispod.
>
> Tekst faze ostaje kao zapis šta je bilo urađeno i zašto.

**Povod.** Dnevnik je do sada dobijao svaki trejd rukom, uključujući i delove koje je broker već
ustanovio: simbol, smer, limit cenu, stop i cenu po kojoj se fill stvarno desio. Prepisivanje nije
prosuđivanje, a plaćalo se punom pažnjom. Uz to, dva podatka najkorisnija za ocenu izvršenja —
planirana naspram stvarne ulazne cene — bila su i dva najpodložnija da budu zaokružena ili pogrešno
zapamćena, jer su čitana sa grafikona satima kasnije.

**Granica koja čuva pravilo.** README je „Broker sync" vodio kao svesno izostavljen, uz obrazloženje
da ručni unos tera da se trejd pročita još jednom. To obrazloženje i dalje stoji — i zato bot piše
**samo činjenice koje je broker već proizveo**. Plan, teza, psihologija, ocena setupa, playbook,
`risk_pct` i `planned_rr` ostaju prazni i dalje se kucaju. Automatizovano je prepisivanje, ne
prosuđivanje.

**Tri odluke koje nose ostatak.**

1. **Ne kroz `tj_save_trade`.** Ta funkcija je `SECURITY INVOKER` i upisuje `auth.uid()`, koji je pod
   anon ključem `NULL`. Jedini način da se natera bio bi `set_config('request.jwt.claims', …)` —
   falsifikovana sesija u funkciji dostupnoj `anon` ulozi, dakle jača verzija baš one rupe zbog koje
   je šest funkcija ostalo bez `EXECUTE`. Odbijeno. Treći razlog je tiši i gori: njeno rukovanje
   fill-ovima je puna zamena, pa bi u koraku sa izlazima obrisala ulazni fill.
2. **Idempotencija je jedan constraint, ne logika u botu.** `UNIQUE (user_id, event_key)` nad
   append-only `tj_bot_events`. Ponovljeno slanje, druga instanca bota i pražnjenje outbox-a posle
   pada postaju bezopasni odjednom, u bazi. Bot i dalje vodi lokalnu dedup, ali kao brzinu, ne kao
   garanciju — obrisan LocalStorage košta suvišna slanja, nikad dupli trejd.
3. **Karantin umesto pogađanja.** Nemapiran nalog, nemapiran simbol, neupotrebljiv volumen → događaj
   se zabeleži, trejd se **ne** upiše, razlog je vidljiv u Settings. Nema fallback-a na `accounts[0]`
   i nema propuštanja nepoznatog simbola kao očišćenog ključa — to je ponašanje koje
   `20260728120000` već imenuje kao failure mode za CSV put.

**Najveći otvoreni rizik tačnosti: `units_per_qty`.** Dnevnik broji `qty` u lotovima/ugovorima,
cTrader javlja bazne jedinice. Za FX i metale delilac je `Symbol.LotSize`; za FTMO index CFD-ove nije
proverljiv bez žive konekcije, jer FTMO vrti sopstvenu cTrader instancu. Rešeno tako što bot šalje i
`LotSize` i cTrader-ov sopstveni broj lotova, panel prikaže da li se delilac i brokerov broj
poklapaju, a čovek potvrdi jednom po simbolu. Do potvrde — karantin. Konačna provera ostaje vezana za
`ProtoOASymbolsListReq`, isti blocker kao Faza 8B § Deo 4.

**Šta nije rešeno, i zna se da nije.**

- **Rupa od restarta.** Ako je order i postavljen i ispunjen dok je bot bio ugašen, ništa u cAlgo
  API-ju ih više ne povezuje — `Position.Id` nije `PendingOrder.Id`, a pozicija ne nosi id order-a.
  Bot to ispiše u log i ne pošalje ništa. Heuristika po Label-u ili ceni bi pre ili kasnije zakačila
  fill na pogrešan trejd, a tiho pogrešan trejd je gori od glasno nedostajućeg.
- **Provizija i swap se upisuju kao 0.** Predznak i round-turn konvencija `Position.Commissions` nisu
  provereni; sirove vrednosti putuju u `tj_bot_events.payload`. Mora se rešiti pre nego što izlazi
  počnu da hrane neto P&L.
- **Preklapanje sa uvozom.** FTMO izvod za period koji je bot već zabeležio može kroz
  `tj_save_trade` da prepiše bot fill-ove. Ublažavanje: iz kandidata za spajanje izbaciti pozicije sa
  `broker_position_id IS NOT NULL`, da duplikat bude vidljiv umesto da prepis bude tih.
- **`partial` / `closed` još ne postoje na ovom putu.** To JESTE brojanje fill-ova, i kad izlazi
  stignu, pravilo mora da živi na jednom mestu: `tj_status_from_executions(uuid)` u SQL-u koji zovu
  oba pisca, a TS `computeStatus` svede na živi pregled u formi — isti oblik kao postojeći par
  `tj_position_stats` / `position-stats.ts`.

**Cloud je mrtav kraj, i to tiho.** cTrader Cloud ne šalje HTTP i ne prijavljuje grešku kad ne
pošalje. Bot tamo izgleda zdravo a ne isporučuje ništa — pa otud heartbeat i linija „poslednje
javljanje" u panelu: ćutanje mora da bude vidljivo sa strane dnevnika, ne samo iz terminala.

**Testovi: 2123 u 132 fajla** (2074 → 2123). Guard koji je zaradio svoj postojanje u ovoj fazi:
`reserved-keys.test.ts` je pao na četiri nove `broker*` kolone pre nego što je iko stigao da napravi
korisničko polje koje bi ih trajno zaklonilo.

---

## Faza 12 — uvoz prepoznaje ručni trejd, spajanje, i odlazak sa cTrader-a (18.09.2026.)

**Povod.** Dva trejda u knjizi koja su isti trejd. Jedan je unet rukom dok se gledao backtest, drugi
je stigao uvozom TradingView exporta — i sve je stajalo u dnevniku dvaput, u svakom zbiru.

**Zašto se nisu spojili.** `sameTrade` traži da se vreme ulaza poklopi u okviru deset minuta. To je
tačno za izvod koji stigne istog dana, a beskorisno za način na koji se dnevnik koristi: ručno unet
trejd nosi trenutak kad je **ukucan**, fajl nosi trenutak kad je **odtrgovan**. Meseci razlike, isti
trejd.

**Rešeno u četiri koraka, svaki sa svojim gate-om i svojim commit-om:**

1. **Bot most je uklonjen.** Govorio je samo cTrader, a trgovanje ide na MT4/MT5 — ostala bi površina
   koju niko ne koristi: `tj_bot_ingest` izložen `anon` roli, tabela tokena i tri tabele stanja.
   Nijedan trejd ni fill nije izgubljen; izgubljen je log događaja, koji se ne može rekonstruisati i
   nije potreban da bi se ijedan trejd objasnio. **Cena koja ostaje otvorena: MAE/MFE.** Most ih je
   davao besplatno, sada su ručni unos, a izvor za MT4/5 tek treba naći (v. Fazu 8B).
   Uz to: `npm run lang:count` — brojanje srpskih stringova koje je README tri puta tvrdio, a niko
   nije mogao da ponovi, sada je skripta.
2. **Instrument se kuca, ne skroluje.** Katalog od 91 simbola je bio grupisani `Select`, a Radix-ov
   type-to-jump hvata samo početak labele — „gold" nije nalazilo ništa. `instrument-select.tsx`
   filtrira po simbolu, imenu i klasi.
3. **Uvoz prepoznaje ručno unet trejd, bez vremena.** Kad strogo pitanje ne nađe ništa, postavlja se
   slabije: isti nalog, instrument, smer, ulazna i izlazna cena, pa **ili ista veličina ili isti
   novac**. Veličina ILI novac, jer TradingView sam računa veličinu po svom modelu rizika, a trejder
   ukuca lotove koje je stvarno mislio — 1.00 i 1.73 lota mogu biti isti trejd, i P&L se tada slaže
   u cent. Red se označi kao `suggested`, imenuje trejd za koji veruje da jeste, i dolazi sa već
   izabranim merge-om. Dvosmislen red se sada može ručno uperiti u konkretan trejd.
   Uz to: **T/P se uvozi samo na trejd koji nema target** (undo ga briše), a **SL se ne uvozi uopšte**
   — izvod javlja nivoe kakvi su bili **na kraju**, pa bi stop pomeren na BE pregazio stop sa kojim je
   rizik stvarno uzet.
4. **Ručno spajanje dva postojeća trejda.** Jedan zadržava identitet, ocenu, plan i beleške; drugi
   daje fill-ove, novac i snapshot instrumenta, pa se briše. Fill-ovi se uzimaju celi, nikad se ne
   sabiraju: dva reda opisuju isti trejd, a sabiranje bi udvostručilo veličinu i izmislilo P&L.
   Bez undo-a, i dijalog to kaže tim rečima.
5. **Datumi i sat.** `dd/MM/yyyy` i 24h svuda na ekranu, tri oblika iz `lib/journal/time.ts`.
   `MM/dd` nije stil nego drugi datum, pa `date-format-conformance.test.ts` obara build na njemu.
   Mašinski čitani datumi (ključevi dana, vrednosti `datetime-local` polja, CSV/XLSX izvoz) ostaju
   ISO namerno.

**Migracije:** `20260918120000_remove_bot_bridge`, `20260918140000_import_suggested_and_target`,
`20260918160000_merge_positions`. Sve tri primenjene na produkciju; treća je proverena na živoj bazi
u transakciji koja je vraćena, i rezultat stoji u zaglavlju migracije.

**Testovi: 2372 u 142 fajla** (2326 → 2372).

### Faza 12b — posle prvog pravog korišćenja (19.09.2026.)

Tri stvari koje su se videle tek kad je spajanje zaista upotrebljeno na backtest trejdovima:

- **Spojeni trejdovi „nestali" sa dashboarda.** Nisu bili pokvareni: fill-ovi iz TradingView fajla
  nose datume iz 2018, a dashboard se otvarao na 90 dana. Sada se otvara na **All** kad ništa nije
  zatvoreno u poslednjih 90 dana, a kad period izostavlja trejdove, iznad brojki piše koliko i do
  kada, sa dugmetom **Show all**. Kolona datuma u journal-u sada nosi i godinu.
- **Dijalog za spajanje je pitao ono što je pravilo.** Uvoz ispravlja ručno unet trejd — nije
  pitanje. Dijalog sada kaže koji red ostaje i koji se troši, i ima jedno dugme.
- **Forma za novi trejd ide redom odluka**: nalog, instrument, playbook sa checklistom, pa tek onda
  cene i rizik. **Ručna faza je uklonjena** (i select u formi i „Move to active" u gridu): planned
  ili active je ono što kažu fill-ovi. Ostaje samo „Mark as missed", jer to fill-ovi ne mogu da znaju.

### Brzina — svaki klik skoro trenutan (19.09.2026.)

**Uzrok, izmeren pre bilo kakve izmene:** server na Vercelu je radio u Virdžiniji (IAD), a baza je u
Frankfurtu. Svaki upit je išao preko Atlantika, prosečno ~200 ms, a stranica ih pravi 6–19. Osim toga
aplikacija nije pamtila nijednu stranicu između klikova (Next podrazumevano: 0 s).

**Urađeno:**
- `vercel.json` → `fra1`.
- `staleTimes` 30 s.
- Stranica počinje da se učitava na hover u meniju (`NavLink`).
- Po jedna grupa paralelnih upita po stranici (journal, reports, playbooks, dashboard, daily, weekly,
  settings, notebook).
- React `cache()` na zajedničkim čitanjima; `tj_position_rules` se čita jednom po stranici.
- Bez drugog iscrtavanja posle čuvanja trejda i čekiranja pravila.
- Filteri u Reports bez odlaska na server.

**Ostaje za kasnije**, kad trejdova bude stotine:
- eksplicitne kolone i vremenski prozor u `getTradesWithStats`;
- virtualizacija tabele trejdova;
- `tj_position_stats` koji agregira sva izvršenja.

### Reports — pojednostavljeno i bez poznatih grešaka (19.09.2026.)

**Pregled** (tri nezavisne revizije: izgled, računanje, podaci) našao je:
- oko 30 kontrola odjednom, 4 od 7 dugmadi za jedinice koja ovde nikad ne rade;
- „Add filter" koji ne radi;
- brojni filter koji ne prima `-` ni decimale;
- Best/Worst kartice sa „—";
- grafik koji crta 0 umesto „—" i otkriva iznose na osi u Privacy režimu;
- mesece sortirane po P&L-u i dane od nedelje;
- Compare koji gubi trejdove;
- metrike koje daju 0 umesto „—" (pa „pobeđuju" u rangiranju);
- recovery factor koji deli neto sa bruto;
- backtest i live pomešane.

**Urađeno:**
- **Knjiga:** prekidač `Live | Backtest | All` (`scope.ts`) koji sam bira i pamti izbor. Valuta, %
  osnova i breakeven se računaju samo nad nalozima u opsegu.
- **Izbačeno:** R/Points/Ticks/Pips, Compare, linijski grafik i pivot (`pivot.ts`, `pivot-color.ts`,
  `cross-analysis.tsx`, `compare-view.tsx`).
- **Ekran:**
  - Filteri se prave lokalno i upisuju tek kad nešto ograničavaju.
  - `Columns` bira kolone.
  - Sortiranje ide u oba smera (`key:asc|desc`) i resetuje se pri promeni grupisanja.
  - Tabela ima Total red.
  - Grafik prikazuje jednu metriku, formatiranu kao tabela.
  - Postoji jedna poruka kada nema podataka.
  - Dodat je skelet učitavanja.
- **Računanje:**
  - „—" umesto 0 za metrike bez uzorka.
  - Recovery factor na izabranoj osnovi.
  - Drawdown zadržava trejd bez vremena zatvaranja.
  - Trejd se broji jednom po grupi.
  - Trejd bez smera ide u „—".
  - Oznaka „≥ 3R".
  - Meseci idu hronološki, a nedelja počinje ponedeljkom.
  - Istoimeni nalozi se razlikuju.
- **Testovi:** svaka greška ima svoj test (`report-fixes.test.ts`, `scope.test.ts`, render testovi za
  workbench i filtere).

### Import — tačno uparivanje i spajanje koje se uvek može poništiti (19.09.2026.)

Nastavak primopredaje `plan_ostatak.md` (obrisana kad je sve urađeno).

**Uparivanje:**
- Strogo uparivanje ne prelazi na drugi nalog.
- Novac se poredi na istoj osnovi (`pnlBasis`: TradingView neto, broker bruto).
- Goli broj nije vreme.
- Veličina i vreme se porede na svakom poklapanju, uz relativnu toleranciju.
- Cene se prikazuju onako kako ih je fajl zapisao.

**Spajanje:**
- Pre bilo kakve izmene čita se stanje trejda i upisuje audit red sa starim fill-ovima i statusom
  (`parsed.prev`).
- Ako zamena padne, stari fill-ovi i polja se vraćaju.
- Odbija se spajanje:
  - bez fill-ova (brisalo bi sve fill-ove trejda),
  - bez cilja,
  - drugog reda u isti trejd.
- Red sa nečitljivom veličinom, cenom ili vremenom ulaza se preskače i ne može se spojiti.

**Upis i poništavanje:**
- Upis ide u delovima od 50 redova u isti batch, sa napretkom na dugmetu.
- Undo čita redove po redosledu upisa i vraća najraniji snimak.
- Preskočen red više ne imenuje trejd, pa ne kvari vraćanje.
- Undo odbija da poništi uvoz dok noviji uvoz nad istim trejdom nije poništen.
- Istorija uvoza prikazuje datum kao dd/MM/yyyy.

### Settings — nalozi i depoziti (19.09.2026.)

**Nalozi:**
- Kompaktna lista (tip, valuta, početni balans, pravila, broj trejdova); sve izmene idu kroz dijalog.
- **Novi nalog** i **Duplicate** (kopira sva podešavanja osim datuma resetovanja izazova).
- **Archive / Restore** (`archived_at`, migracija `20260919220000_account_archived_at.sql`). Arhiviran
  nalog čuva trejdove, ne nudi se za nove trejdove, uvoz ni depozite, a u filterima ostaje, označen
  „(archived)". Poslednji aktivan nalog ne može da se arhivira.
- Uređivanje: jedno Save, broj koji se ne može pročitati blokira čuvanje, valuta zaključana kad nalog
  ima trejdove, upozorenje pri promeni balansa ili zone, restart izazova uz potvrdu.
- „25.000" i „1,500" se odbijaju kao dvosmisleni umesto da se pogađa.
- Brisanje: „Delete permanently", uz kucanje imena kad nalog ima podatke.

**Depoziti:**
- Početni balans je prvi, samo za čitanje, red liste (izveden, ne upisuje se — equity ga već sadrži).
- Datumi dd/MM/yyyy u zoni naloga; „danas" je dan naloga, a unos se beleži u podne te zone.
- Filter po nalogu, neto tok po valuti, brisanje uz potvrdu.

### Kategorije i tagovi — samo ono što trejderu treba (19.09.2026.)

Novi podrazumevani skup (seed za novog korisnika i posle „Delete all data"), migracija
`20260919230000_must_have_categories.sql` (`tj_seed_categories`). Korisnik bez ijednog trejda dobija
ga odmah; korisnik sa trejdovima zadržava svoje liste.

- **Izbačeno:** Macro Align, COT Filter; BOS/CHoCH → MSS, Imbalance → FVG, Equal Highs/Lows (to je
  likvidnost koju sweep uzima); izlazi „u profitu/minusu" (to kaže P&L); „Other".
- **Swing:** Entry TF 15m / 1h / 4h / 1D; greška „Overmanaged" (HTF ideja vođena na LTF-u).
- **Bez preklapanja:** Emotion = stanje, Discipline = šta je išlo dobro, Mistake = šta nije. „Revenge",
  „Moved stop", „Oversized" više nisu u dve liste odjednom.
- **Risk %:** 0.25 / 0.5 / 0.75 / 1.
- **Vreme ulaza se prati samo:** nova dimenzija izveštaja „Entry hour" (sat ulaza u zoni naloga), uz
  postojeći „Entry weekday" — koji dani i sati donose novac, bez ikakvog taga.

### Settings — jedan jezik, tab u adresi, brži ulazak (20.09.2026.)

**Jezik.** Settings je poslednji ekran koji je merio, a govorio pola srpski. `STAGE_LABELS`
(Priprema / Trgovanje / Osvrt → Prepare / Trade / Review, što menja i dnevnu čeklistu), pasus iznad
kataloga instrumenata i dve poruke iz server akcija su na engleskom. `npm run lang:count`: 132 srpskih
od 3.512 stringova, i `/settings` je sada 0.

**Tab u adresi.** `?tab=accounts`, `&sub=tags` pod Categories, upisano sa `history.replaceState` —
reload, link i dugme „nazad" pamte gde se stalo. Podrazumevani tab se ne piše u URL.

**Brzina.** Broj „Used" pored svakog taga čita tag kolone svih trejdova. Radio se pri svakom otvaranju
Settings-a, pa je otvaranje Accounts-a čekalo prebrojavanje cele knjige; sada je server akcija
(`getTagUsage`) koju Tags tabela zove kad se prvi put otvori. Tagovi se čitaju kroz `selectAllPages`
(PostgREST vraća najviše 1000 redova i status 200).

**Sitnice koje su smetale:**
- Boja nove kategorije se čuva (ranije se gubila).
- Tačkica pored taga prvo uzima boju taga, pa tek onda kategorije — kao u formi za trejd.
- Kategorije se pomeraju i sa tastature (Move up / Move down u meniju).
- Tabela tagova prati redosled kategorija koji je trejder postavio, ne abecedu.
- Tracker: ▲/▼ ugašeni na krajevima, poslednji dan ne može da se isključi, prazan tekst se vraća na
  stari, povlačenje i vraćanje pravila pitaju za potvrdu.
- Instrumenti: pretraga, oznaka „$ / point" nosi valutu instrumenta, Save radi samo kad ima izmene,
  brisanje pita i kaže koliko trejdova koristi simbol.
- „Delete all data" više ne nabraja brojke koje zastare; fraza za potvrdu se briše na Cancel.
- Nema više `router.refresh()` posle akcija koje same revalidiraju.

**Obrisan instrument ostaje obrisan.** `tj_seed_instruments_defaults` je unosio 91 red pri svakom
pozivu (`on conflict do nothing`), a `ensureDefaults()` ga zove sa početne strane — obrisan simbol se
vraćao pri sledećoj poseti, i to sa specifikacijom iz kataloga umesto sa ispravljenom. Migracija
`20260920001500_seed_instruments_only_when_empty.sql`: seed radi samo nad praznim katalogom. Reset i
dalje vraća svih 91, jer ih prvo obriše.

**Tick 0.001 se čuva.** Pravilo protiv dvosmislenog „25.000" hvatalo je i „0.001" (i odbijalo „0,001"
kao nečitljiv), pa tick zlata nije mogao da se unese. Nula ispred zareza ili tačke ne može biti
hiljadarka, i sada se tako i čita.

### Uvoz — TradingView u tuđoj valuti i MT5 izveštaj (20.09.2026.)

**TradingView konvertuje novac, a cene ne.** Na EUR grafikonu izvoz ima `Price USD` pored
`Net PnL EUR`. Pošto se veličina ugovora čita deljenjem novca sa pomerajem cene, takav izvoz izgleda
kao pogrešna veličina i tako je i bio odbijan („P&L je 0.932 po 1.00 po jedinici, što nije ni 1 ni 1"
— rečenica koja o valuti ne kaže ništa). Sada se čita i valuta cena, pa poruka kaže šta je u čemu i
koje podešavanje to rešava. Ne konvertuje se: kurs je dnevni, a nema ga ni u fajlu ni u journal-u.

**MT5 izveštaj ima svoj čitač** (`mt5-statement.ts`). MT5 ne izvozi tabelu nego izveštaj: naslov,
četiri reda o nalogu, pa tri tabele jedna ispod druge (Positions, Orders, Deals). Kroz pravilo
„zaglavlje je prvi red" to je stizalo kao `Trade History Report | __EMPTY | …` i nije se imalo šta
mapirati.

- Čita se samo **Positions** — jedan red po poziciji, sa otvaranjem i zatvaranjem.
- Kolone se uzimaju po **poziciji u zaglavlju**, jer se „Time" i „Price" javljaju dvaput; po imenu bi
  izlaz pregazio ulaz.
- **Provizija i swap menjaju znak**: MT5 piše šta je skinuo (−3.50), a `net_pl` je
  `bruto − fees − swap`. Kredit ostaje kredit.
- Valuta naloga se čita iz reda `Account:` i mora da se poklopi sa journal nalogom.
- Vreme je sat **servera**, a zona nije u fajlu: bira se u uvozu, podrazumevano EET (`Europe/Athens`),
  kako rade FTMO serveri.
- Red koji se ne može pročitati se prikazuje sa razlogom; otvorena pozicija zadržava ulaz i nema izlaz.

Provereno na stvarnom izveštaju vlasnika (`ReportHistory-1514682848.xlsx`, FTMO demo, EUR): prepoznat,
valuta i broj naloga pročitani, nula zatvorenih pozicija — nalog ih zaista nema. **Redove sa trejdovima
treba još potvrditi na izveštaju koji ih ima.**

### Nedeljni osvrt — ništa se ne gubi i prošla nedelja se pamti (20.09.2026.)

**Greške:**
- Nesačuvan tekst je nestajao pri promeni nedelje. Sada se nacrt čuva u pregledaču po nedelji
  (`weekly-draft.ts`), nudi se nazad uz datum, i pita se pre napuštanja strane.
- Strelica „sledeća nedelja" je bila link sa `disabled` atributom, što na `<a>` ne radi ništa — sada je
  pravo onemogućeno dugme. Unazad se staje na najstariju nedelju koja uopšte ima podatke.
- Vremena (zaključavanje, poslednje čuvanje) formatirala su se u zoni servera; sada idu u zoni naloga.
- Čuvanje je primalo nedelju koja još nije počela, a zaključavanje nije — sada oba koriste ista
  pravila (`weekSaveRefusal`, `weekLockRefusal`), koja su prvi put i testirana.
- `Avg R` je bio čuvan pogrešnim uzorkom, pa je nedelja sa nultim R-om pisala „—" umesto 0.00R.
- „Zabeleženo dana" se računalo iz 7, a boduje se samo pon–pet.
- Ocena nedelje nije osvežavala izveštaje (`revalidateWeekly`), a značka „Završeno" je opisivala ono
  što je otkucano, ne ono što je sačuvano.
- Pet tekstualnih polja nije imalo ograničenje dužine (sada 4000 znakova).

**Novo:**
- Kartica **„Prošle nedelje si rekao"** na vrhu: obaveza iz prošle nedelje i njeni katalizatori, uz
  pitanje Da / Delimično / Ne. Odgovor se čuva na redu tekuće nedelje
  (migracija `20260920120000_weekly_previous_change_kept.sql`; dok nije primenjena, pitanja nema).
- Recap je podeljen na **Novac** i **Proces**, a prazna nedelja piše jednu rečenicu umesto mreže nula.
- Filter po nalogu; nalozi u različitim valutama se više ne sabiraju.
- Dani u traci vode na taj dnevni unos.
- Strana više ne čita ceo dnevnik: check-in-ovi i zabeleženi dani čitaju se samo za tu nedelju.
