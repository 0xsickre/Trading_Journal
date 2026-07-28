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

### 2.4 Kompozitni skor postaje jeftin odmah posle Faze 1

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
| Profit calc metoda | FIFO/LIFO/WAvg ostaje P3 — nerelevantno bez preklapajućih pozicija na istom simbolu | čeklist A14 |
| MAE/MFE | Ostaje ručni unos sa charta. Intraday feed se ne uvodi | moduli §11 |

### Nerazrešena kontradikcija između tvoja dva dokumenta

**Drawdown %.** Spec §2.5 kaže `max_drawdown_% = (peak-to-trough pad / max kumulativni P&L pre pada)
× 100`. Master čeklist kaže da % pogled ide **iz tekućeg balansa naloga uključujući uplate i isplate**.
To su dva različita imenioca i daju različite brojeve.

**Rešenje:** implementiraju se oba, imenovana i odvojena.

- `maxDrawdownPctOfEquity` — imenilac je peak equity uključujući cash flow. Finansijski tačan, ide u UI.
- `maxDrawdownPctZella` — imenilac je peak kumulativnog P&L-a. Ide **isključivo** u Zella Score, da
  skor bude uporediv sa TZ brojem.

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
- `tj_positions` +: `reviewed boolean DEFAULT false`, `rating smallint` (spec §6).

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

#### 1c — Zella Score (spec §2.6, tačni ponderi)

`PF 25 % · Avg Win/Loss 20 % · Max DD 20 % · Win % 15 % · Recovery 10 % · Consistency 10 %`

Skale iz spec-a implementirane doslovno, sa **linearnom interpolacijom unutar opsega** — spec to
označava kao nepotvrđenu pretpostavku, pa ide iza konstante koja se može kalibrisati, ne kao
magičan broj u formuli. Max DD komponenta koristi `maxDrawdownPctZella` (§3 gore).

**Prihvatanje**

- Vitest po formuli, uključujući granične slučajeve: nula gubitaka → PF `null` (ne `∞`), jedan trejd
  → stdev `0`, otvorene pozicije isključene, `avg profit < 0` → Consistency `0`.
- „Da li trejdovi duži od 7 dana imaju pozitivnu EV posle swapa?" — odgovor iz UI-ja.
- Prebacivanje `$` → `R` → `%` ne dira nijednu metričku funkciju.

**Procena:** 1a — 1 sesija · 1b — 3–4 · 1c — 1.

---

### Faza 2 — Insight engine ⭐

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

### Faza 3 — Generički report engine

Spec §5.1: *ne pisati 10 report stranica, pisati jednu.* Ovo je najveća ušteda u projektu.

**Kod**

- `reports/dimensions.ts` — registry `{ key, label, source, valueOf(trade, ctx) }`. Pokriva kolone,
  tag nizove, **deklarativne bucket-e** (hold duration, R-multiple, position size, mesec, dan u nedelji
  ulaska/izlaska) i **procesne dimenzije** (join `tj_daily_reports`: micromanage, ocena dana, mentalna
  temperatura, prekršeno pravilo, friday flat). Bucket-i su tabela definicija, ne `CASE WHEN` (spec §5.3).
- `reports/engine.ts` — `runReport({ dimension, crossDimension, metrics, filters, pnlBasis, dateRange, accountIds })`.
  `breakdownByField` postaje tanak omotač.
- `reports/pivot.ts` — dimenzija × dimenzija, **`n` u svakoj ćeliji**, sivljenje ispod praga.
- `reports/filters.ts` — **negacija (`Excluding`) po svakom polju od prvog dana** (spec §5.7:
  naknadno dodavanje je bolno), R-opseg, trajanje, position size, reviewed/unreviewed, rating,
  insight koji je okinuo.
- Ruta `/reports` sa četiri komponente po spec §5.1: Performance Summary · Charts (do 3 metrike) ·
  Summary Table · Cross Analysis.
- **Win vs Losses** i **Compare** su isti engine — prvi sa hardkodovanom dimenzijom `pnl > 0`, drugi
  sa nizom filter setova. Zato filter objekat mora biti serijalizabilan.

**Prihvatanje**

- „Nadmašuje li A-setup uz makro bias onaj protiv njega, i sa kolikim `n`?" — jedan pivot, dva klika.
- Nova dimenzija = jedan unos u registry, nula izmena engine-a.

**Procena:** 5–6 sesija.

---

### Faza 4 — Custom fields i Playbook

Jedina faza sa strukturnom migracijom podataka. Dva nezavisno isporučiva koraka.

#### 4a — Custom fields

- `tj_field_defs` — `key`, `label`, `field_type`, `list_key`, `group`, `sort_order`, `is_active`, `show_when`.
- `tj_positions.custom jsonb NOT NULL DEFAULT '{}'` + GIN indeks.
- **Backfill:** `macro_align`, `cot_filter`, `htf_bias`, `ict_entry_model`, `entry_tf`,
  `session_killzone` → `custom` + odgovarajući `tj_field_defs` redovi.
  **Kolone se ne brišu u istoj migraciji** — dupli upis, pa čišćenje posle verifikacije.
- `FORM_TABS` se gradi iz `tj_field_defs`; `form-config.ts` ostaje fallback. Forma se ne prepisuje.
- Dimension registry automatski pokupi svako custom polje.

#### 4b — Playbook

Nazivi tabela po moduli §1:

```
tj_playbooks        naziv, opis, boja, ikona, is_active
tj_playbook_groups  playbook_id, naziv, redosled
tj_playbook_rules   group_id, tekst, show_when, redosled, is_active, deleted_at
tj_position_rules   position_id, rule_id, followed
```

`tj_positions` +: `playbook_id`, `conviction smallint CHECK (1..5)`.

- Soft-delete pravila je obavezan — istorija čekiranja mora da preživi brisanje.
- `show_when` (`always` / `winner` / `loser` / `breakeven`) se **zaključava** čim je pravilo vezano
  za trejd, inače statistika retroaktivno puca (moduli §1).
- **Seed:** postojeće `ict_entry_model` vrednosti postaju početni playbook-ovi.
  `rules_followed` istorija se **ne razlaže retroaktivno** — čist rez, dokumentovan u UI-ju.
- **Per-rule statistika:** follow rate %, net P&L, profit factor, win rate. To je dimenzija u
  registry-ju iz F3, ne poseban ekran.
- Playbook-level: expectancy, win rate, PF, # izvršenih, # propuštenih (`status = missed`).
- Playbook bira koja custom polja forma traži.
- **Zella Score dobija sedmu komponentu — Process Adherence** iz follow rate-a i `tj_daily_reports`.
  Ponderi se renormalizuju; TZ ovu komponentu nema.

**Prihvatanje**

- „Koje pravilo nosi edge, a koje je ritual?" — odgovor sa uzorkom.
- Brisanje pravila ne menja nijednu istorijsku statistiku.
- Dupli upis dokazan testom pre uklanjanja starih kolona.

**Procena:** 4a — 3 sesije · 4b — 5 sesija.

---

### Faza 5 — Progress Tracker

Posle playbook-a, jer pravilo „svaki trejd ima playbook" nema smisla ranije (moduli §4).

```
tj_tracker_rules     tekst, stage (prepare|trade|reflect), active_days[], is_mandatory, config jsonb
tj_tracker_checkins  rule_id, report_date, checked, auto_evaluated
```

- Obavezna pravila iz moduli §4: Start My Day By · Trading Hours · Link Trades to Playbook ·
  Input Stop Loss to All Trades · Net Max Loss/Trade · Net Max Loss/Day.
- **Poslednja dva se auto-odčekiraju iz podataka** — nadovezuje se na postojeći FTMO modul.
- Korisnička pravila po fazi, sa izborom aktivnih dana.
- Streak doslednosti + heatmap poštovanja pravila, odvojen od P&L heatmapa.
- **Zaključavanje dana** — nepovratno. Tvoj „Kompletan vs Nacrt" je blizu; TZ zaključava zauvek i za
  disciplinu je to jače: ne možeš sutra „popraviti" jučerašnji zapis.

**Procena:** 4 sesije.

---

### Faza 6 — Notebook

Potvrđeno da se gradi. Ne dira `/daily` — tvoj procesni dnevnik je strukturisaniji od TZ dnevne
beleške i ostaje kakav jeste (moduli §2).

```
tj_note_folders  naziv, template_text, redosled
tj_notes         naslov, sadržaj, folder_id, position_id?, report_date?, deleted_at
tj_note_tags     odvojeni od tj_option_items — namerno, ne sinhronizuju se
```

- Podrazumevani folderi: Weekly Review · Trade Notes · Market Observations · Recently Deleted.
- **Šablon po folderu**, auto-popuna pri kreiranju beleške.
- Auto-sync: beleška sa trejda ide u Trade Notes preko `position_id`.
- Soft-delete („Recently Deleted"), izvoz u PDF, javni link po belešci.
- **Nedeljni pregled** (čeklist F7) živi ovde kao folder sa šablonom — swing ekvivalent dnevnog.

**Procena:** 4 sesije.

---

### Faza 7 — Parity i automatizacija

| Blok | Isporuka |
|---|---|
| **Kalendar (D12/D13)** | Mesečni pogled: mesečni total, **P&L po nedelji**, broj dana, ikonica journal zapisa, izbor metrike po ćeliji. Sivo = breakeven po opsegu iz F0 |
| **Journaling (F5/F6)** | Dnevni stat blok (Net P&L · trades · WR · winners · losers · volume · PF · komisije · Gross), expandable dan sa listom trejdova, mini kalendar |
| **Auto recap (H5)** | Vercel cron → mentor pack za protekli period → `tj_recaps` → notifikacija. Prag ≥ 3 zatvorena trejda nedeljno, ≥ 4 mesečno |
| **Grid (I4/I5)** | Konfigurabilne kolone sa per-user persistencijom, Zella Scale kolona (target attainment + MFE capture — logika **već postoji**, fali prikaz) |
| **Dashboard (I1/I2)** | Widget layout JSON, imenovani template-i |
| **Trade Log akcije** | Merge / split trejdova, transfer između naloga |
| **Import (J5)** | Broker preset UI — `tj_column_mappings` konačno dobija kod |
| **Ostalo** | Profit calc metoda po nalogu (FIFO/LIFO/WAvg) sa punom rekalkulacijom, deljenje trejda javnim linkom |

**Procena:** 8–10 sesija, deljivo po bloku.

---

## 6. Svesno izostavljeno

| Modul | Razlog |
|---|---|
| Backtesting + Trade Replay | Traži pun istorijski feed. TradingView to radi bolje |
| Broker sync | Manuelni unos je izbor i prednost |
| Spaces / mentor / leaderboard | Jednokorisnički sistem |
| Zella AI chat + agenti | Mentor pack + insights daju isto bez API troška |
| Opcije (DTE, strike, expiry) | Ne trguješ opcijama |
| Intraday dimenzije (entry time 5–30 min) | Day-trading artefakt |
| Ekonomski kalendar | Živi u vault-u |
| **Running P&L kriva po trejdu** | Traži cenovni feed. Posledica: `most time in drawdown` otpada |
| Intraday MAE/MFE preciznost | Ručni unos sa charta; kod swinga je dnevni high/low dovoljan |

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
| 0 | Cash events, breakeven range, default komisije, undo import, reviewed/rating | Da | ✅ |
| 1 | Sloj jedinica → metrike (vreme, trošak, rizik, nedeljni sloj) → Zella Score | Ne | ✅ |
| 2 | Insight engine: 30 TZ obrazaca + 7 vlastitih + mentor pack | Ne | 4–5 |
| 3 | Report engine, pivot sa `n`, dimension registry, negacija filtera | Ne | 5–6 |
| 4a | Custom fields + backfill metodoloških kolona | Da | 3 |
| 4b | Playbook, pravila, per-rule stats, forma iz playbook-a, 7. komponenta skora | Da | 5 |
| 5 | Progress Tracker, auto-evaluirana pravila, streak, zaključavanje dana | Da | 4 |
| 6 | Notebook: folderi, šabloni, note tagovi, nedeljni pregled | Da | 4 |
| 7 | Kalendar, dnevni blok, cron recap, grid kolone, widget layout, merge/split | Delom | 8–10 |

**Ukupno: 41–46 sesija.** Posle F4 journal odgovara na svih šest pitanja iz sanity provere.
F5–F7 su disciplina, udobnost i parity.

**Prva tri koraka, konkretno:** `tj_cash_events` + `classifyOutcome()` → `units.ts` → hold time i
cost report. Prva dva su temelji koje je skupo naknadno ubaciti; treći je prva stvar koju ćeš videti
u UI-ju.
