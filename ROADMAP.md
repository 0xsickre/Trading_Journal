# Roadmap — TradeZella parity i preko toga

> Plan implementacije izveden iz master čeklista, posle audita stvarnog stanja koda
> (`src/`, `supabase/migrations/`) na dan 2026-07-27.
> Redosled nije prepisan iz čeklista — promenjen je tamo gde zavisnosti to nalažu, sa obrazloženjem.

---

## 1. Verifikovano stanje

Audit je prošao kroz celu šemu i ceo `src/`. Čeklist je uglavnom tačan; ispod su **samo odstupanja**.

### Označeno kao postojeće, a ne postoji

| Čeklist | Tvrdnja | Stvarno |
|---|---|---|
| A3 | Deposit / withdrawal / payout ✅ | **Nema tabele ni koda.** Postoji samo `tj_accounts.starting_balance` |
| A9 / J4 | Undo import ✅ | `import/actions.ts` ima samo `commitImport`. Audit redovi se pišu, rollback ne postoji |
| B12 | Default komisije po nalogu ✅ | Nema kolona ni UI polja. Fee/swap se kucaju po fill-u |
| C3 | Kumulativna drawdown kriva ✅ | Postoji samo `maxDrawdown` skalar u `analytics.ts`. Krive nema |
| D12 | Napredni kalendar 🟡 | `calendar-heatmap.tsx` je 26-nedeljna GitHub mreža. Nema meseca, nedeljnog P&L-a, journal ikonice |
| G8 | Zaključavanje dana 🟡 | Ne postoji. `executionUnlocked` je tab u formi, nema veze sa danom |
| J5 | Broker preseti 🟡 | Tabela `tj_column_mappings` postoji, **nula referenci u `src/`**. README to i priznaje |

### Označeno kao nepostojeće, a postoji

| Čeklist | Stvarno |
|---|---|
| A5 `asset_class` | Postoji na `tj_instruments` + `tj_accounts.default_asset_class` |
| A6 `tick_size`, quote ccy | Postoje `tick_size`, `tick_value`, `currency` |
| A12 `conviction` | Postojalo, **namerno obrisano** u `20260720120000_simplify_trade_fields.sql` |
| A13 `reviewed` | Postoji `needs_review`, ali znači „import ostavio nepotpun trejd" — druga semantika, ostaje ❌ |

### Podaci koji već postoje, ali ih niko ne prikazuje

Ovo diktira redosled Faze 1 — nula migracija, samo čitanje:

- **`duration_seconds`** — već računat u `tj_position_stats` view-u, tipiziran u `types.ts`, **nijedan red koda ga ne čita**. Ceo C2 blok visi o ovome.
- **`total_fees` / `total_swap`** — u view-u i u formi po trejdu, ali **nijedan agregat**. Ceo cost report je aritmetika nad postojećim.
- **`breakeven`** — već se broji u `computeStats()`, nikad se ne prikazuje.
- **`zonedWeekStartKey()`** — nedeljni bucket helper već postoji u `time.ts`.
- **`session_killzone`** — mrtva kolona na `tj_positions`, van forme.

### Arhitektonski nalazi koji menjaju procenu troška

1. **Forma je već deklarativna.** `form-config.ts` izvozi `FORM_TABS`, a `POSITION_FIELD_NAMES`,
   `NUMERIC_FIELDS`, `ARRAY_FIELD_NAMES` se **izvode** iz njega. B8 („forma se generiše iz
   playbook-a") nije prepisivanje forme — to je zamena izvora jedne konstante.
2. **`TradeRow` je `{…} & Record<string, unknown>`.** Dinamične kolone već prolaze kroz ceo lanac
   bez izmene tipova.
3. **`breakdownByField(trades, field)` već prima proizvoljno ime polja.** Dimension registry je
   registar + izvedeni bucket-i, ne nova matematika.
4. **Dupla matematika je konvencija, ne dug.** P/L i R postoje u SQL view-u i u TS-u, paritet čuva
   Vitest. Svaka nova izvedena metrika mora eksplicitno da odluči gde živi.

---

## 2. Principi kojih se plan drži

- **Migracije aditivne**, format `YYYYMMDDHHMMSS_opis.sql`, nikad izmena postojećeg fajla.
- **RLS na svakoj novoj tabeli**: owner policy sa `(SELECT auth.uid())`, `updated_at` trigger,
  indeks po `user_id`.
- **Nema REST ruta** — sve mutacije kroz Server Actions, čitanja kroz Server Components.
- **Nova metrika ide u SQL view i u TS, ili ni u jedno** — sa parity testom.
- **Dropdown vrednosti ostaju tekst**, ne foreign key.
- **Vreme je per-account** (`timestamptz` UTC + IANA tz naloga).
- Next.js 16 — pročitati `node_modules/next/dist/docs/` pre pisanja rutnog/serverskog koda.

---

## 3. Zavisnosti

```
Faza 0 (novac + integritet)
   │
   ├──► % drawdown, Recovery Factor, tačan balans ──► Faza 1
   │
Faza 1 (metrike bez migracije)
   │
   └──► ulazi za pravila ──► Faza 2 (insights)
                                  │
Faza 3 (report engine) ◄──────────┘  (insight kao dimenzija)
   │
   └──► registry ──► Faza 4 (custom fields + playbook) ──► per-rule stats
                                  │
                                  └──► Faza 5 (parity dorada) ──► Faza 6 (automatizacija)
```

Jedino tvrdo pravilo: **Faza 0 pre svakog % pogleda.** Sve ostalo je preporuka.

---

## Faza 0 — Temelj tačnosti

**Zašto prva:** čeklist traži da % drawdown ide iz tekućeg balansa naloga *uključujući uplate i
isplate*. Bez toga svaki % broj je pogrešan čim ubaciš depozit — i to tiho pogrešan, što je gore od
nepostojećeg. Recovery Factor, Consistency Score i FTMO evaluacija dele istu osnovu.

**Migracije**

- `tj_cash_events` — `id`, `user_id`, `account_id`, `event_type` (`deposit` / `withdrawal` /
  `payout` / `adjustment`), `amount`, `occurred_at timestamptz`, `note`, `created_at`.
  CHECK na `event_type`, indeks `(user_id, account_id, occurred_at)`, RLS owner policy.
- `tj_accounts`: `default_fee_per_unit`, `default_fee_fixed`, `default_swap_per_day` (B12).

**Kod**

- `src/lib/journal/balance.ts` — `buildBalanceTimeline(account, trades, cashEvents)` vraća seriju
  `{ at, realizedPnl, cashFlow, balance }`. Jedan izvor istine za svaki % pogled.
- `src/app/(app)/settings/actions.ts` — CRUD za cash events; nova kartica u `account-settings.tsx`.
- `import/actions.ts` — `undoImportBatch(batchId)`: briše pozicije nastale u batch-u, vraća
  merge-ovane fill-ove iz `tj_import_rows.parsed`, poništava batch. Dugme u istoriji importa.
- Trade forma predpopunjava fee/swap iz default-a naloga.

**Prihvatanje**

- Depozit usred perioda ne pomera $ drawdown, a pomera % drawdown — i to je vidljivo u UI-ju.
- Undo import vraća bazu u stanje pre commit-a, provereno testom nad seed fixture-om.
- FTMO evaluacija koristi isti balance timeline kao dashboard.

**Procena:** 2–3 sesije.

---

## Faza 1 — Metrike bez migracije

**Zašto ovde:** najveći odnos vrednosti prema trošku u celom planu. Podaci već postoje u view-u;
ovo je čitanje i prikaz. Takođe proizvodi ulaze koje insight engine (Faza 2) troši.

**Kod** — sve u `src/lib/journal/analytics.ts` + novi `metrics/` podmoduli, bez SQL izmena.

| Grupa | Isporuka |
|---|---|
| **Vreme držanja (C2)** | `avg hold` za sve / dobitnike / gubitnike / breakeven, longest duration, avg i max u danima. Sve iz `duration_seconds` |
| **Duration bucket-i** | `<1d · 1–3d · 3–7d · 1–2ned · >2ned` — kao izvedena dimenzija, ne kolona |
| **Cost report (C1)** | Total Commissions, Total Swap, trošak kao % bruto profita, avg swap po danu držanja |
| **Profitabilnost (C1)** | Avg Win/Loss ratio |
| **Rizik (C3)** | Recovery Factor (`net / max DD`), Consistency Score (`stdev / total profit`), Avg planned R, Avg MAE u R, Average drawdown, trenutni drawdown, datum max DD |
| **Drawdown kriva** | Nova komponenta — $ osnova iz kumulativnog P&L-a, % osnova iz balance timeline-a (Faza 0). **Dve osnove, dva pogleda, eksplicitno odvojena** |
| **Aktivnost (C4)** | breakeven count kao KPI, Longs/Shorts broj + win %, Logged days (join na `tj_daily_reports`) |
| **Nedeljni sloj (C5)** | Week Win %, avg weekly/monthly P&L, najveća profitabilna/gubitnička nedelja i mesec, max uzastopnih dobitnih/gubitničkih nedelja. Bucket-ovanje preko postojećeg `zonedWeekStartKey` |

**Prihvatanje**

- Vitest pokriva svaku novu formulu, uključujući granične slučajeve (nula gubitaka → PF `null`,
  jedan trejd → stdev `0`, otvorene pozicije isključene).
- „Da li trejdovi duži od 7 dana i dalje imaju pozitivnu EV posle swapa?" — odgovor iz UI-ja.

**Procena:** 3–4 sesije.

---

## Faza 2 — Insight engine ⭐

**Zašto odmah posle metrika:** nula migracija, nula novih podataka — samo deterministička pravila
nad onim što Faza 1 već računa. Ovo je „kvalitet povratne informacije" zbog kojeg ceo journal
postoji.

**Kod**

- `src/lib/journal/insights/` — `types.ts`, `registry.ts`, `rules/*.ts`.
  Jedan insight = `{ id, category, severity, minSample, evaluate(ctx) → Insight | null }`.
- `ctx` je jedan pre-izračunat objekat (trejdovi + statistike + dnevni izveštaji + balance
  timeline), da 31 pravilo ne prolazi 31 put kroz iste podatke.
- **Prag uzorka je obavezan** na svakom pravilu — insight koji okine na `n = 2` je šum, ne signal.
- Panel na dashboard-u, grupisan po ozbiljnosti.
- `mentor-export.ts` dobija sekciju „Insights" (H4).

**Vlastiti insight-i (H3) — ovo TZ nema**

- Micromanage na A-setup-u: trošak diranja otvorenih pozicija **izražen u R**
  (join `tj_daily_reports.micromanage` × trejdovi tog dana).
- Trgovanje protiv `macro_align` bias-a — razlika u expectancy-ju sa uzorkom.
- Swap je pojeo R: trejdovi gde `total_swap / planned_risk_$` prelazi prag.
- Ulaz pri mentalnoj temperaturi ispod 5 (`tj_daily_reports.mental_temp`).
- Chase: entry slippage sistematski nepovoljan na određenom setup-u.
- Propušteni A-setup-ovi (`status = 'missed'` × `setup_grade`) — problem izvršenja koji nijedna P&L
  statistika ne pokazuje.

**Blokada koju moram razrešiti sa tobom**

Puna lista od 31 obrasca je u `tz-moduli-kompletno.md` §5, a ponderi kompozita u
`tradezella-clone-spec.md` §2.6. **Nijedan od ta dva fajla nije u ovom repou.** Ili mi ih daj, ili
izvodim pravila sam iz čeklista i ti verifikuješ listu pre implementacije.

**Prihvatanje**

- Svako pravilo ima unit test sa fixture-om koji ga okida i fixture-om koji ga ne okida.
- Nijedan insight ne okida ispod svog `minSample`.

**Procena:** 3–4 sesije (posle razrešene blokade).

---

## Faza 3 — Generički report engine

**Zašto pre migracije šeme:** registry napisan nad postojećim kolonama je test dizajna. Kad Faza 4
doda custom polja, ona se samo *registruju* — ako engine tad mora da se menja, dizajn je bio loš.

**Kod**

- `src/lib/journal/reports/dimensions.ts` — registry: `{ key, label, source, valueOf(trade, ctx) }`.
  Pokriva kolone, tag nizove, **izvedene bucket-e** (hold duration, R-multiple, position size,
  mesec, dan u nedelji ulaska/izlaska) i **procesne dimenzije** (join na `tj_daily_reports`:
  micromanage, ocena dana, mentalna temperatura, prekršeno pravilo, friday flat).
- `reports/engine.ts` — `runReport({ dimension, metrics, filters })`. Generalizuje postojeći
  `breakdownByField`, koji postaje tanak omotač.
- `reports/pivot.ts` — dimenzija × dimenzija, **`n` u svakoj ćeliji**, sivljenje ispod praga.
  Ćelija bez uzorka mora da *izgleda* nepouzdano, ne samo da bude nepouzdana.
- `filters.ts` — negacija (`Excluding`) po svakom polju, R-opseg, trajanje, position size,
  reviewed/unreviewed.
- Nova ruta `/reports`.

**Prihvatanje**

- „Da li A-setup uz makro bias nadmašuje A-setup protiv njega — i sa kolikim uzorkom?" — jedan
  pivot, dva klika, `n` vidljiv.
- Dodavanje nove dimenzije = jedan unos u registry, nula izmena engine-a.

**Procena:** 4–5 sesija.

---

## Faza 4 — Custom fields i Playbook

Jedina faza sa strukturnom migracijom. Radi se u dva koraka koja se mogu isporučiti odvojeno.

### 4a — Custom fields

**Migracije**

- `tj_field_defs` — `key`, `label`, `field_type`, `list_key`, `group`, `sort_order`, `is_active`,
  `show_when`.
- `tj_positions.custom jsonb NOT NULL DEFAULT '{}'` + GIN indeks.
- **Backfill migracija**: metodološke kolone (`macro_align`, `cot_filter`, `htf_bias`,
  `ict_entry_model`, `entry_tf`, `session_killzone`) → `custom`, uz odgovarajuće `tj_field_defs`
  redove. Kolone se **ne brišu u istoj migraciji** — prvo dupli upis, pa čišćenje kad prođe verifikacija.

**Kod**

- `form-config.ts` prestaje da bude izvor istine i postaje fallback; `FORM_TABS` se gradi iz
  `tj_field_defs`. Forma se ne prepisuje.
- Dimension registry automatski pokupi svako custom polje (D4).
- `mentor-export.ts` čita definicije umesto hardkodovane liste polja.

### 4b — Playbook

**Migracije**

- `tj_playbooks` — naziv, opis, boja, ikona, `is_active`.
- `tj_playbook_rule_groups` — naziv, redosled (Entry / Exit / Market conditions / proizvoljno).
- `tj_playbook_rules` — tekst, `show_when` (`always` / `winner` / `loser` / `breakeven`),
  `deleted_at` (**soft-delete — istorija čekiranja mora da preživi brisanje pravila**).
- `tj_trade_rule_checks` — `position_id` × `rule_id` × `checked`.
- `tj_positions.playbook_id`, `conviction smallint CHECK (1..5)`, `reviewed boolean`.

**Kod**

- CRUD za playbook-ove u Settings-u.
- Čeklista pravila u trade formi pri review-u; `show_when` se zaključava kad je pravilo već vezano
  za trejd (E5).
- **Per-rule statistika** (E7): follow rate %, net P&L, profit factor, win rate — po pojedinačnom
  pravilu. Ovo je dimenzija u registry-ju iz Faze 3, ne poseban ekran.
- Playbook-level statistika: expectancy, win rate, PF, # izvršenih, # propuštenih.
- Playbook bira koja custom polja forma traži (E9).

**Prihvatanje**

- „Koje pojedinačno pravilo mog playbook-a nosi edge, a koje je ritual?" — odgovor sa uzorkom.
- Brisanje pravila ne menja nijednu istorijsku statistiku.
- Migracija je reverzibilna: dupli upis dokazan testom pre uklanjanja starih kolona.

**Procena:** 4a — 3 sesije. 4b — 4–5 sesija.

---

## Faza 5 — Parity dorada

Sve što TZ ima, a nije blokiralo ništa iznad.

| Blok | Isporuka |
|---|---|
| **View modovi (I3)** | Globalni gross/net prekidač + `$` / `%` / `R` / `pips` / privacy mod |
| **Kalendar (D12)** | Mesečni pogled: mesečni total, **nedeljni P&L po redu**, broj dana, ikonica journal zapisa. Izbor metrike po ćeliji (D13) |
| **Panele (D6–D8)** | Performance summary (best / worst / most active / highest WR), Win vs Loss side-by-side, Compare mod sa dva filter seta |
| **Kompozit (C6)** | Skor 0–100 po 6 TZ komponenti **+ sedma: Process Adherence** — iz `tj_daily_reports` i playbook follow rate-a. TZ ovu komponentu nema |
| **Journaling (F5–F7)** | Dnevni stat blok, expandable dan sa listom trejdova, **nedeljni pregled** kao swing ekvivalent dnevnog |
| **Disciplina (G2–G8)** | Pravila kao entitet po fazama, aktivni dani po pravilu, auto-evaluirana pravila, obavezan playbook / stop, streak doslednosti, zaključavanje dana |
| **Grid (I4, I5)** | Konfigurabilne kolone, Zella Scale kolona |
| **Trade (B11)** | Breakeven offset po nalogu — **asimetričan** `from`/`to` u `$` ili `%`, boji dan u kalendaru sivo i ulazi u `# breakeven trades` |

**Procena:** 6–8 sesija, deljivo po bloku.

---

## Faza 6 — Automatizacija i rep

- **Automatski nedeljni / mesečni recap** (H5) — cron, prag ≥ 3–4 zatvorena trejda. Insight engine
  se već pokreće, ovo je samo raspored i isporuka.
- **Insight kao filter dimenzija** (H2) — traži snapshot tabelu okinutih insight-ova po trejdu.
- **Broker preset UI** (J5) — `tj_column_mappings` konačno dobija kod.
- Merge / split trejdova (B13), transfer između naloga (B14), profit calc metoda po nalogu (A14).
- Deljenje trejda javnim linkom (J8).
- Widget layout i imenovani dashboard template-i (I1, I2).
- **Notebook (F9–F13) — odluka pre koda:** ovo je jedina grupa koju Obsidian pokriva bez linije
  koda. Preporuka: preskočiti, osim ako hoćeš beleške vezane za `position_id`.

---

## 4. Gde ovo tuče TradeZella

Parity nije cilj sam po sebi. Ovo su pitanja na koja TZ **ne može** da odgovori, a plan ih pokriva:

| Pitanje | Odakle odgovor |
|---|---|
| Koliko me košta diranje otvorenih pozicija, u R? | Faza 2 — `micromanage` × trejdovi dana |
| Nadmašuje li A-setup uz makro bias onaj protiv njega, i sa kojim `n`? | Faza 3 — pivot sa prikazom uzorka |
| Koje pravilo playbook-a nosi edge, a koje je ritual? | Faza 4b — per-rule statistika |
| Imaju li trejdovi duži od 7 dana pozitivnu EV posle swapa? | Faza 1 — duration bucket × cost report |
| Ulazim li lošije kad je mentalna temperatura ispod 5? | Faza 3 — procesne dimenzije |
| Koliko planiranog reward-a uzimam i popravlja li se? | **Već postoji** — target attainment po nedelji |
| Beže li mi sistematski A-setup-ovi? | **Već postoji** — `missed` lifecycle, čeka dimenziju |

TZ nema procesni dnevnik, nema `missed` kao prvorazredni podatak, nema R-izraženu cenu
nediscipline, i nema per-rule atribuciju edge-a. To su četiri stvari koje ovaj model ima
strukturno, ne kao dodatak.

---

## 5. Šta mi treba od tebe

1. **`tz-moduli-kompletno.md` §5** (31 insight obrazac) i **`tradezella-clone-spec.md` §2.6**
   (ponderi kompozita) — nisu u ovom repou. Bez njih Fazu 2 i kompozitni skor radim po sopstvenom
   izvođenju, koje moraš da verifikuješ.
2. **Potvrda Faze 0.** Ako nikad nećeš imati depozite/isplate na nalogu, Faza 0 se svodi na undo
   import + default komisije, a % drawdown može da ide iz `starting_balance`. To menja procenu za
   dve sesije.
3. **Odluka o Notebook-u** (F9–F13): graditi ili ostaviti Obsidian-u.

---

## 6. Sažetak redosleda

| Faza | Sadržaj | Migracija | Procena |
|---|---|---|---|
| 0 | Cash events, balance timeline, undo import, default komisije | Da | 2–3 |
| 1 | Hold time, cost report, risk metrike, drawdown kriva, nedeljni sloj | Ne | 3–4 |
| 2 | Insight engine + vlastiti insight-i + mentor pack | Ne | 3–4 |
| 3 | Report engine, pivot, dimension registry, filteri | Ne | 4–5 |
| 4a | Custom fields + migracija metodoloških kolona | Da | 3 |
| 4b | Playbook, pravila, per-rule statistika, forma iz playbook-a | Da | 4–5 |
| 5 | View modovi, kalendar, paneli, kompozit, disciplina, grid | Delom | 6–8 |
| 6 | Cron recap, insight filter, broker preseti, merge/split, deljenje | Delom | 4–6 |

Posle Faze 4 journal odgovara na svih šest pitanja iz sanity provere. Faze 5 i 6 su parity i udobnost.
