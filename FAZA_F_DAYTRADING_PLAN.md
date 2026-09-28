# Faza F — journal sa swing-a na day trading

**Status na 28.09.2026:** trgovanje je prešlo sa FTMO CFD swing-a (XAUUSD, NAS100, bakar; MT5) na
**intraday CME fjučerse na Topstep-u** (NQ / MNQ, ES / MES; 6E / M6E u katalogu). Četiri commita od
28.09. su uvela ulaz za day trading; ovaj fajl je popis svega što je u kodu **još uvek swing** i šta
ga zamenjuje. README opisuje stanje koda kakvo jeste — i swing ostatke — dok ovde stoji šta sledi.

**Kako je fajl složen.** Posao je podeljen u **šest faza, F1–F6**; jedna faza = jedna sesija, sa
jasnim ulazom i izlazom, da nijedna ne zavisi od konteksta koji živi samo u razgovoru. **Detaljan
plan postoji samo za fazu koja je sledeća** (sada F1). Ostale imaju okvir — cilj, stavke, odluke koje
treba doneti — i dobijaju detaljan plan tek kad dođu na red, jer svaka zavisi od onoga što je
prethodna odlučila (npr. F3 i F4 čitaju dan koji F2 tek definiše). Stavke `#1–#23` su u katalogu na
dnu i brojevi se ne menjaju, jer README upućuje na njih.

Pravila koja važe za svaki korak ispod, jer su ista kao u ostatku repoa:

- **Istorija se ne prepisuje.** CFD/FTMO trejdovi, zaključani dani i stari tagovi ostaju čitljivi;
  migracije su aditivne, seed menja samo prazne knjige.
- **Pogrešan broj je gori od pada.** Sve što bi posle prelaska tiho merilo pogrešnu stvar ide prvo
  (P0), pre svega što samo lepše izgleda.
- **Jedno pravilo, jedno mesto.** Topstep pravila žive u `topstep.ts`; brief u `futures-trading`
  ih računa isto (`tools/brief/racun.py`) — menja se oboje ili ništa.

## Već isporučeno (28.09.2026.)

| Commit | Šta |
|---|---|
| `031f8bd` | Katalog dobija NQ/MNQ/ES/MES/6E/M6E; TopstepX CSV uvoz bez mapiranja; MAE/MFE iz R2 (`excursion_source = 'r2'`, `futures-trading/tools/journal_mae.py`) |
| `b3d6ff4` | Uvoz nalazi plan koji je limit popunio (treće pitanje u `import-match.ts`) |
| `3e2d1bd` | Topstep nalozi (`topstep.ts`: MLL trail po EOD, DLL, konzistentnost 55 %), veličina u celim ugovorima (`computeTopstepRisk`, `computeFuturesContracts`), Topstep baner, katalog samo fjučersi |
| `57d5580` | `/trades/log` (upis posle zatvaranja, A/B/C), `/trades/[id]/review`, „Bez pregleda" na `/daily`, „Napredak" na `/weekly`, MLL ne raste pre kraja dana |

## Protokol jedne faze

Isti za svaku fazu, da nova sesija može da krene samo iz ovog fajla:

1. **Pročitaj** ovaj fajl (sekciju faze + stavke iz kataloga) i README sekcije navedene u fazi.
2. **Detaljan plan** — ako faza još nema sekciju „Detaljno", prvo se ona napiše ovde, uz odluke koje
   traže trejdera. Kod se ne dira dok odluke nisu donete.
3. **Test koji pada** pre svake izmene, pa izmena.
4. **Gate** kao u CI-ju: `typecheck` → `scan` → `schema:check` → `test` → `lint` (0 upozorenja) →
   `build` → `dead`.
5. **Dokumentacija 1:1**: README sekcije koje faza menja, status faze ovde (✅ + commit), `ROADMAP.md`
   jedan red.
6. Commit + push. Migracija se u bazi primenjuje tek posle zelenog gate-a.

## Odluke (dnevnik)

| Datum | Faza | Odluka |
|---|---|---|
| 28.09.2026 | F1.1 | `thesis_written` ocenjuje samo trejdove napravljene pre ulaza (opcija A); ostali `na/no_plans` |
| 28.09.2026 | F1.2 | Probijen MLL / FTMO kršenje blokira samo plan (`origin: "plan"`), nikad upis posle zatvaranja — za oba moda |

Nova odluka se upisuje ovde pre koda, sa datumom. Ako odluka nedostaje, agent PITA trejdera i ne
pogađa.

## Kako nastaviti (nova AI sesija)

1. Grana `claude/journal-swing-to-day-trading-a49d56` (dok se ne spoji u `main`). Isti naziv grane
   postoji i u `0xsickre/futures-trading`, za delove koji diraju njega (F2: `journal_podsetnik.py`).
2. Pročitaj ovaj fajl ceo, pa `AGENTS.md` (Next.js 16 — dokumentacija u `node_modules/next/dist/docs/`),
   pa README sekcije koje faza navodi.
3. Radi **samo prvu fazu u Mapi čiji status nije ✅**, po Protokolu. Ako faza nema sekciju
   „Detaljno", prvo je napiši ovde, odluke koje traže trejdera upiši kao pitanja i stani.
4. Na kraju faze: status ✅ + hash commita u Mapi, detaljan plan SLEDEĆE faze, README 1:1, push.
5. Stani i traži jači model ako faza ispadne veća od procene (kolona Model).

## Mapa faza

| Faza | Cilj | Stavke | Zavisi od | Migracija | Model | Status |
|---|---|---|---|---|---|---|
| **F1** | Tačnost odmah: ono što danas pogrešno ocenjuje, a ne traži nijednu veliku odluku | #2, #5, #21 | — | ne | Sonnet | ⏳ **sledeća — odluke donete, spremna za rad** |
| **F2** | Topstep dan (17:00 → 17:00 CT) kao ključ dana svuda gde se dan broji | #1 | F1 | verovatno ne (izvedeno iz zone i moda naloga) | **Opus** | okvir |
| **F3** | Topstep pravila u tracker-u i Survival-u | #3, #4, #6 | F2 | da (config pravila u novcu) | **Opus** | okvir |
| **F4** | Dnevni tok: pred-sesija umesto check-in-a, forma, kategorije, nova auto pravila | #7, #8, #9, #10 | F2, F3 | da (seed, nova pravila, time stop) | Opus za #10, Sonnet ostalo | okvir |
| **F5** | Intraday analitika: sesija, trajanje u minutima, insights, swap, uzorak | #11–#15, #17, #18 | F2 | ne (sve izvedeno) | Sonnet, Opus za #13 | okvir |
| **F6** | Nasleđe i `futures-trading`: cena promašaja iz R2, legacy CFD u UI-ju, komentari, PARITY | #16, #19, #20, #22, #23 | F5 | možda (#16) | Sonnet | okvir |

## F1 — Tačnost odmah (detaljno)

**Ulaz:** grana čista, gate zelen (3.014 testova). **Pročitati:** README § Process tracking, § Topstep,
§ The plan is sealed at entry. **Bez migracije:** razlog `na` se ne čuva u bazi (`tj_tracker_checkins`
ima samo `checked`), zaključani dani su zamrznuti redovi i ne menjaju se.

### F1.1 — `thesis_written` ne sme da obori trejd upisan posle zatvaranja (#2)

**Utvrđeno u kodu.** `toTrackerTrade` (`tracker/auto-rules.ts`) čita tezu iz **zapečaćenog** plana,
namerno: pravilo pita da li je razlog postojao pre pozicije. `/trades/log` pravi trejd odjednom sa
fill-ovima, pa se plan pečati u trenutku upisa — posle zatvaranja — a rečenicu upisuje u
`trade_journal_notes`. Rezultat: svaki brzo upisan trejd **pada** pravilo; isto važi za trejd koji je
napravio samo TopstepX uvoz.

**Odbačeno:** rečenicu upisati u `thesis`. Zapečatila bi se rečenica napisana posle zatvaranja kao
„teza pre ulaza" — tačno ona racionalizacija zbog koje pravilo čita pečat.

**Izmena — opcija A, ODLUČENO 28.09.2026 (trejder):**
- `TrackerTrade` dobija `plannedBeforeEntry: boolean` = `created_at` trejda ≤ `stats.opened_at`.
  Plan-first trejd (i plan koji je uvoz popunio) je napravljen pre fill-a; trejd upisan posle
  zatvaranja ili napravljen uvozom nije.
- `thesis_written` ocenjuje samo trejdove sa `plannedBeforeEntry`; dan bez njih je `na` sa novim
  razlogom `no_plans` („nijedan trejd nije planiran pre ulaza") — ne `pass`, jer ništa nije provereno.
- `tracker-checklist.tsx` dobija tekst za `no_plans` (srpski, kao ostali razlozi).
- Ostala pravila se ne diraju: `stop_loss_set` i `playbook_linked` quick-log ispunjava sam.

~~Opcija B (bez koda): isključiti `thesis_written` u Settings → Tracker.~~ Odbačena: gubi se merenje
za plan-first limite, gde teza ima smisla.

**Testovi** (`tracker/auto-rules.test.ts`): trejd napravljen posle ulaza bez teze → `na/no_plans`;
plan-first sa tezom → `pass`; plan-first bez teze → `fail`; dan sa oba → ocenjuje se samo plan-first;
plan popunjen uvozom (`created_at` pre fill-a) → ocenjuje se.

**Posledica koju treba reći:** nezaključani prošli dani se preračunaju po novom značenju (CFD trejdovi
kucani posle ulaza postaju `na`). Zaključani dani ostaju kakvi su.

### F1.2 — probijen MLL: blokira se plan, ne evidencija (#5)

**Utvrđeno u kodu.** FTMO zamrzavanje je u `createTrade` (`isFtmoAccountFrozen`) i blokira svako
kreiranje; `updateTrade` blokira samo izmenu koja dodaje izloženost (`addsExposure`). `/trades/log` takođe
zove `createTrade`, pa FTMO blokada danas odbija i upis trejda posle zatvaranja. Uvoz piše direktno
(`import/actions.ts`, `tj_positions` + `tj_replace_executions`) i ne prolazi kroz blokadu. Za Topstep ne postoji ništa; veličina se ionako ne računa kad nema
prostora (`computeTopstepRisk` → `null`).

**Izmena:**
- `topstep-status.ts`: `isTopstepAccountFailed(accountId)` — isto kao `isFtmoAccountFrozen`, jedan
  nalog, status `failed` iz `evaluateTopstep`.
- `createTrade` dobija poreklo upisa (`origin: "plan" | "log"`; `quick-log.ts` šalje `"log"`). Plan
  (`/trades/new`) na nalogu sa probijenim MLL-om → odbijen: „Topstep nalog je pao (MLL) — resetuj ga u
  Settings". Upis posle zatvaranja → prolazi.
- **Isto za FTMO** (odlučeno, vidi dole): `isFtmoAccountFrozen` u `createTrade` važi samo za
  `origin: "plan"`; poruka ostaje ista.
- `updateTrade`: isti uslov kao FTMO (`addsExposure`) i za Topstep.
- `trade-form.tsx`: nalog sa probijenim MLL-om se nudi kao kod FTMO-a (`topstepFailedAccountIds`).
  `quick-log-form.tsx`: samo upozorenje iznad forme, ne blokada.
- Uvoz se ne dira: već ne prolazi kroz blokadu, i tako ostaje (evidencija).

**Testovi:** `topstep.test.ts` za status već postoji; novi render testovi za formu (blokada plana,
upozorenje u quick-logu) i test akcije za `origin` — za Topstep i za FTMO (quick-log na zamrznutom
FTMO nalogu sada prolazi; plan i dalje ne).

**Odluka (28.09.2026, trejder): da** — i FTMO propušta upis posle zatvaranja. Isti `origin`, jedno
pravilo za oba moda: blokira se nova izloženost, nikad evidencija.

README § Process tracking (pasus o FTMO modu: „a new trade can neither be created nor activated") se
u izlazu iz F1 prepisuje u skladu s tim.

### F1.3 — tekst dupliranja naloga (#21)

`account-settings.tsx`: „Copies the type, currency, timezone, breakeven range, costs and FTMO rules"
→ „…costs and prop-firm rules (FTMO or Topstep)". `account-rules.ts` već kopira Topstep plan i
pravilo rizika; test u `account-settings.render.test.tsx` čita tekst.

### Izlaz iz F1

- Gate zelen; broj testova raste.
- README: § Process tracking (pasus „Two of the eight…" prepisan: `thesis_written` više ne pada na
  quick-log trejdu), § Topstep (red o MLL-u: plan blokiran, evidencija ne), broj testova.
- Ovde: F1 ✅ sa commitom; **detaljan plan za F2** upisan pre nego što F2 počne.

## F2–F6 — okvir (detaljno kad dođu na red)

### F2 — Topstep dan (#1)
- **Cilj:** jedan ključ dana po nalogu: Topstep nalog → `topstepTradingDay`, ostali → dan u zoni
  naloga. Kalendar, `/daily`, tracker, dnevni insights, „Bez pregleda", `journal_podsetnik.py` čitaju
  isti ključ.
- **Odluke:** šta sa „All accounts" pogledom kad su u njemu i Topstep i CFD nalog (dva različita dana);
  da li se ključ izvodi iz `topstep_mode` ili je posebno podešavanje naloga.
- **Pročitati pre plana:** README § Attributing to days; `time.ts`, `activity.ts`, `calendar-view.ts`,
  `tracker/auto-rules.ts` (`TradeDayIndex`), `tracker/queries.ts`, `daily-report-queries.ts`.

### F3 — Topstep pravila u tracker-u i Survival-u (#3, #4, #6)
- **Cilj:** `max_loss_per_day` = DLL plana, rizik po trejdu = `computeTopstepRisk`, namera =
  iznos pravila; Survival osa dobija Topstep prostor iznad MLL-a, simulacija pod u novcu i DLL.
- **Odluke:** da li Topstep nalog ima procentualna pravila uopšte ili samo novčana; kako se računa
  „headroom" kad MLL trail-uje.
- **Pročitati:** README § Process tracking, § Survival, § Process · Survival · Edge; `survival.ts`,
  `scorecard.ts`, `tracker-types.ts`.

### F4 — Dnevni tok (#7–#10)
- **Cilj:** `/daily` = pred-sesija (brief, raspon, crveni prozori, plan dana) + „Bez pregleda";
  forma sa time stop-om u minutima; seed kategorija za day tradera; auto pravila
  `max_trades_per_day`, `stop_after_losses`, `flat_by_close`.
- **Odluke:** tačna lista kategorija i grešaka; odakle `/daily` čita brief (link ili podaci).
- **Pročitati:** README § Routes `/daily`, § Ratings; `daily-report-form.tsx`, `form-config.ts`,
  seed migracija `20260919230000`.

### F5 — Intraday analitika (#11–#15, #17, #18)
- **Cilj:** dimenzije sesija / minuti od otvaranja / redni broj u danu / posle gubitka; trajanje u
  minutima; insights u intraday obliku i vraćanje izostavljenih; swap sakriven na fjučersima;
  tekstovi o uzorku; co-exposure u minutima; mentor export za day tradera.
- **Odluke:** granice sesijskih prozora (ET); koji swing insights se gase, a koji ostaju za CFD.
- **Pročitati:** README § Metrics, § Process tracking (Insights); `reports/dimensions.ts`,
  `progress.ts`, `insights/*`.

### F6 — Nasleđe i `futures-trading` (#16, #19, #20, #22, #23)
- **Cilj:** cena promašenog setupa iz R2 do kraja Topstep dana; FTMO/MT5/TradingView CFD ispod
  „Legacy"; komentari „swing book" prepisani; PARITY i formulas-audit dopunjeni.
- **Pročitati:** README § Learning, § MAE/MFE; `futures-trading` README § MAE/MFE.

## Katalog stavki

### P0 — brojevi koji su posle prelaska pogrešni

| # | Swing danas | Day trading | Fajlovi |
|---|---|---|---|
| 1 | **Dan = kalendarski dan u zoni naloga.** Kalendar, `/daily`, tracker presude, dnevni insights, `max_loss_per_day` | Za Topstep nalog dan je **Topstep dan 17:00 → 17:00 CT** (`topstepTradingDay` već postoji). Na New York nalogu (seed) fill između 18:00 i ponoći ET ide u taj kalendarski dan, a Topstep ga broji u sledeći — kalendar i „DLL danas" na baneru se ne slažu za isto veče | `time.ts`, `activity.ts`, `calendar-view.ts`, `tracker/*`, `daily-report*.ts`, `insights/day-rules.ts`, `review-gaps.ts` (i `journal_podsetnik.py`) |
| 2 | **Auto pravilo `thesis_written`** se ocenjuje na svakom trejdu | `/trades/log` piše rečenicu u `trade_journal_notes`, ne u `thesis` → svaki brzo upisan trejd pada pravilo i Process osa pada bez razloga. Ili rečenica ide u `thesis`, ili se pravilo gasi za quick-log/Topstep naloge (odluka trejdera) | `quick-log.ts`, `tracker/auto-rules.ts` |
| 3 | **Tracker limiti u % equity-ja** (`max_loss_per_trade/day/week`, `risk_per_trade`) | Topstep limiti su **novac**: dnevni gubitak = DLL plana, rizik po trejdu = `computeTopstepRisk` (12,5 % prostora iznad MLL, min/max plana). Na Topstep nalogu pravila čitaju plan, a ne unet procenat | `tracker/auto-rules.ts`, `tracker-types.ts`, `topstep.ts` |
| 4 | **`risk_matched_intent`** poredi veličinu sa izabranim `risk_pct` (0,25–1 %) | `/trades/log` ne pita `risk_pct`, pa pravilo daje `na` i ništa ne ocenjuje. Namera je iznos iz pravila rizika (`computeTopstepRisk`), ne % naloga; lista „Risk %" nema smisla na Topstep-u | `tracker/auto-rules.ts`, seed kategorija |
| 5 | **MLL probijen ne zaključava nalog.** FTMO kršenje blokira `createTrade`, Topstep ne | **Ne prepisati FTMO zamrzavanje doslovno**: `/trades/log` takođe zove `createTrade`, a upis POSLE zatvaranja je evidencija, ne nova izloženost — doslovna kopija bi zabranila upis baš trejda koji je probio MLL. Blokira se samo plan-first ulaz (`/trades/new`), upis posle zatvaranja ostaje otvoren uz upozorenje (detalj u F1) | `trades/actions.ts`, `topstep-status.ts`, `trade-form.tsx`, `quick-log-form.tsx` |
| 6 | **Survival osa i simulacija znaju samo FTMO** (`headroomPct` iz `evaluateFtmo`, pragovi u `survival.ts`) | Topstep: pod = trailing MLL u novcu, dnevni limit = DLL, cilj = target (uz 55 % pravilo). Bez toga Survival na Topstep nalogu meri tuđa pravila ili sopstveni najgori DD | `survival.ts`, `scorecard.ts`, `survival-card.tsx` |

### P1 — dnevni tok (šta trejder stvarno radi)

| # | Swing danas | Day trading | Fajlovi |
|---|---|---|---|
| 7 | **`/daily` = pre-market kapija + check-in po otvorenoj poziciji** (dani držanja, `touched`, teza) | Otvorene pozicije preko noći ne postoje (Topstep ravna do 15:10 CT). Check-in kartica postaje prazna → zameniti **pred-sesijom**: brief pročitan, očekivani raspon, crveni prozori, plan dana (max trejdova, DLL danas). „Bez pregleda" ostaje post-sesija | `daily-report-form.tsx`, `open-positions-card.tsx`, `position-checkin.ts` |
| 8 | **Forma trejda „Why this trade"**: teza, invalidacija, time stop u **danima** (1–5), scale-out plan | Plan-first forma ostaje za limit koji se čeka; time stop u **minutima** ili „do kraja sesije"; teza opciona. `/trades/log` je primarni ulaz (već) | `form-config.ts`, `plan-snapshot.ts`, `number-choice.tsx`, migracija `time_stop_days` → nova kolona (stara ostaje za istoriju) |
| 9 | **Seed kategorija**: Entry TF 15m/1h/4h/1D, HTF Bias, Exit „Time exit", greške „Overmanaged", „Against HTF bias", Risk % | Entry TF 1m/2m/5m/15m; „Bias dana (brief)"; Exit „Flat by close"; greške day tradera: „Overtrading", „Trade after DLL plan", „Revenge re-entry", „Traded red window". Samo za prazne knjige (seed), postojeće liste menja trejder u Settings | nova migracija `tj_seed_categories` |
| 10 | **Nova auto pravila nedostaju** | `max_trades_per_day`, `stop_after_losses` (N uzastopnih), `flat_by_close` (nijedna pozicija posle Topstep kraja dana, uz praznike iz brief-a), kasnije `no_entry_in_red_window` | `tracker-types.ts`, `tracker/auto-rules.ts`, `tracker-rule-manager.tsx`, CHECK u bazi |

### P2 — analitika skalirana na intraday

| # | Swing danas | Day trading | Fajlovi |
|---|---|---|---|
| 11 | **Dimenzije**: `weekend_hold`, `time_stop_breached`, `touched`, `thesis_state`; intraday dimenzije „svesno izostavljene" | Dodati: **sesijski prozor** (Globex noć / pre-open / 09:30–10:00 ET otvaranje / jutro / ručak / popodne / poslednji sat), **minuti od otvaranja**, **redni broj trejda u danu**, **trejd posle gubitka** (već u `progress.ts` — preseliti u dimenzije), trajanje u minutima. Swing dimenzije ostaju samo dok postoji istorija koja ih puni | `reports/dimensions.ts`, `progress.ts` |
| 12 | **`hold-time.ts`** korpe za dane/nedelje, `units.ts` trajanje u danima, `exceed_avg_hold_time` | Korpe u minutima (<1, 1–5, 5–15, 15–60, >60 min); prikaz trajanja u min:s | `hold-time.ts`, `units.ts`, `insights/trade-rules.ts` |
| 13 | **Insights „swing prevodi"**: `SWING_RULES` (time stop, vikend, teza), `week-rules` (overtrading/tilt na nivou nedelje), `revenge_trade` sa swing prozorom, `swap_ate_the_trade`, `stale_plan`, `against_macro_bias`, `cot_chase` | Vratiti TZ intraday verzije: revenge u **minutima**, overtrading **po danu**, tilt posle N gubitaka u sesiji; uključiti izostavljene `patience_paid_off` (vreme prvog ulaza u sesiji) i `most_time_in_drawdown` / `deep_in_drawdown_day` — R2 minutne sveće iz `futures-trading` sada postoje, pa „nema feed-a" više nije razlog | `insights/*`, `OMITTED_RULES` u `registry.ts` |
| 14 | **Swap** kao metrika i pločica, `swap_triple_day`, `weekend-hold.ts` | Fjučersi nemaju swap. Pločica se sakriva kad je swap 0 u opsegu; kolone ostaju za CFD istoriju | `costs.ts`, `reports/metrics.ts`, `book-overview.tsx` |
| 15 | **Statistika ciljana na 40–70 trejdova godišnje** (tekstovi, `periodsPerYear`, pragovi uzorka, eksperiment 4 nedelje pre) | Day trading daje taj broj za mesec. Eksperiment: pre/posle u **sesijama** ili trejdovima, ne nedeljama; tekstovi koji tvrde „na 40–70 trejdova godišnje" prepisati | `experiments.ts`, `uncertainty.ts` tekstovi, `risk-ratios.ts` |
| 16 | **Cena promašenog setupa**: `mt5_excursion.py --missed`, `time_stop_days` ili 5 trgovačkih dana | Za fjučerse: iz R2 sveća, prozor do kraja Topstep dana. Posao ide u `futures-trading/tools/journal_mae.py` (isti izvor kao MAE/MFE) | `missed-cost.ts`, `futures-trading` |
| 17 | **Co-exposure**: preklapanje u **danima**, korelacija po danima zatvaranja | NQ + ES u isto vreme je jedan rizik: preklapanje u **minutima**, zbirni rizik otvorenih ugovora u odnosu na DLL | `co-exposure.ts`, `portfolio-heat.ts` |
| 18 | **Mentor export** (33 srpska stringa) pita swing pitanja (HTF, teza, vikend) | Prompt za day tradera: sesija, redni broj trejda, posle gubitka, A/B/C, DLL | `mentor-export.ts` |

### P3 — čišćenje i nasleđe

| # | Šta | Odluka |
|---|---|---|
| 19 | FTMO mod, MT5 statement uvoz, `scripts/mt5_excursion.py`, TradingView CFD backtest | Ostaju za istoriju CFD naloga; u UI-ju ispod „Legacy (CFD)". Ne brisati dok postoji ijedan FTMO trejd |
| 20 | „Where this sits": vault (F0–F5, makro bias, COT) je swing ciklus | Za day trading kontekst daje **`futures-trading` brief** (raspon, kalendar, režim, ugovori danas). `htf_bias` → bias dana iz brief-a |
| 21 | Dupliranje naloga: poruka kaže „…costs and FTMO rules" a kopira i Topstep | Tekst u `account-settings.tsx` |
| 22 | Komentari u kodu koji tvrde „this is a swing book" (`co-exposure.ts`, `survival.ts`, `portfolio-heat.ts`, `period-stats.ts`, `trade-rules.ts`, …) | Prepisati uz izmenu modula, ne pre (komentar prati kod) |
| 23 | `PARITY.md`, `docs/formulas-audit.md` | Dopuna posle P2 — intraday metrike TradeZella-e ponovo postaju relevantne |
