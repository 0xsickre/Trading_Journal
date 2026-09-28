# Faza F — journal sa swing-a na day trading

**Status na 28.09.2026:** trgovanje je prešlo sa FTMO CFD swing-a (XAUUSD, NAS100, bakar; MT5) na
**intraday CME fjučerse na Topstep-u** (NQ / MNQ, ES / MES; 6E / M6E u katalogu). Četiri commita od
28.09. su uvela ulaz za day trading; ovaj fajl je popis svega što je u kodu **još uvek swing** i šta
ga zamenjuje. README opisuje stanje koda kakvo jeste — i swing ostatke — dok ovde stoji šta sledi.

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

## P0 — brojevi koji su posle prelaska pogrešni

| # | Swing danas | Day trading | Fajlovi |
|---|---|---|---|
| 1 | **Dan = kalendarski dan u zoni naloga.** Kalendar, `/daily`, tracker presude, dnevni insights, `max_loss_per_day` | Za Topstep nalog dan je **Topstep dan 17:00 → 17:00 CT** (`topstepDayKey` već postoji). Na New York nalogu (seed) fill između 18:00 i ponoći ET ide u taj kalendarski dan, a Topstep ga broji u sledeći — kalendar i „DLL danas" na baneru se ne slažu za isto veče | `time.ts`, `activity.ts`, `calendar-view.ts`, `tracker/*`, `daily-report*.ts`, `insights/day-rules.ts`, `review-gaps.ts` (i `journal_podsetnik.py`) |
| 2 | **Auto pravilo `thesis_written`** se ocenjuje na svakom trejdu | `/trades/log` piše rečenicu u `trade_journal_notes`, ne u `thesis` → svaki brzo upisan trejd pada pravilo i Process osa pada bez razloga. Ili rečenica ide u `thesis`, ili se pravilo gasi za quick-log/Topstep naloge (odluka trejdera) | `quick-log.ts`, `tracker/auto-rules.ts` |
| 3 | **Tracker limiti u % equity-ja** (`max_loss_per_trade/day/week`, `risk_per_trade`) | Topstep limiti su **novac**: dnevni gubitak = DLL plana, rizik po trejdu = `computeTopstepRisk` (12,5 % prostora iznad MLL, min/max plana). Na Topstep nalogu pravila čitaju plan, a ne unet procenat | `tracker/auto-rules.ts`, `tracker-types.ts`, `topstep.ts` |
| 4 | **`risk_matched_intent`** poredi veličinu sa izabranim `risk_pct` (0,25–1 %) | `/trades/log` ne pita `risk_pct`, pa pravilo daje `na` i ništa ne ocenjuje. Namera je iznos iz pravila rizika (`computeTopstepRisk`), ne % naloga; lista „Risk %" nema smisla na Topstep-u | `tracker/auto-rules.ts`, seed kategorija |
| 5 | **MLL probijen ne zaključava nalog.** FTMO kršenje blokira nove trejdove, Topstep ne | Isto ponašanje kao FTMO: `MLL hit` → nema novih trejdova dok se nalog ne resetuje (`topstep_reset_at`) | `trades/actions.ts`, `topstep-status.ts` |
| 6 | **Survival osa i simulacija znaju samo FTMO** (`headroomPct` iz `evaluateFtmo`, pragovi u `survival.ts`) | Topstep: pod = trailing MLL u novcu, dnevni limit = DLL, cilj = target (uz 55 % pravilo). Bez toga Survival na Topstep nalogu meri tuđa pravila ili sopstveni najgori DD | `survival.ts`, `scorecard.ts`, `survival-card.tsx` |

## P1 — dnevni tok (šta trejder stvarno radi)

| # | Swing danas | Day trading | Fajlovi |
|---|---|---|---|
| 7 | **`/daily` = pre-market kapija + check-in po otvorenoj poziciji** (dani držanja, `touched`, teza) | Otvorene pozicije preko noći ne postoje (Topstep ravna do 15:10 CT). Check-in kartica postaje prazna → zameniti **pred-sesijom**: brief pročitan, očekivani raspon, crveni prozori, plan dana (max trejdova, DLL danas). „Bez pregleda" ostaje post-sesija | `daily-report-form.tsx`, `open-positions-card.tsx`, `position-checkin.ts` |
| 8 | **Forma trejda „Why this trade"**: teza, invalidacija, time stop u **danima** (1–5), scale-out plan | Plan-first forma ostaje za limit koji se čeka; time stop u **minutima** ili „do kraja sesije"; teza opciona. `/trades/log` je primarni ulaz (već) | `form-config.ts`, `plan-snapshot.ts`, `number-choice.tsx`, migracija `time_stop_days` → nova kolona (stara ostaje za istoriju) |
| 9 | **Seed kategorija**: Entry TF 15m/1h/4h/1D, HTF Bias, Exit „Time exit", greške „Overmanaged", „Against HTF bias", Risk % | Entry TF 1m/2m/5m/15m; „Bias dana (brief)"; Exit „Flat by close"; greške day tradera: „Overtrading", „Trade after DLL plan", „Revenge re-entry", „Traded red window". Samo za prazne knjige (seed), postojeće liste menja trejder u Settings | nova migracija `tj_seed_categories` |
| 10 | **Nova auto pravila nedostaju** | `max_trades_per_day`, `stop_after_losses` (N uzastopnih), `flat_by_close` (nijedna pozicija posle Topstep kraja dana, uz praznike iz brief-a), kasnije `no_entry_in_red_window` | `tracker-types.ts`, `tracker/auto-rules.ts`, `tracker-rule-manager.tsx`, CHECK u bazi |

## P2 — analitika skalirana na intraday

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

## P3 — čišćenje i nasleđe

| # | Šta | Odluka |
|---|---|---|
| 19 | FTMO mod, MT5 statement uvoz, `scripts/mt5_excursion.py`, TradingView CFD backtest | Ostaju za istoriju CFD naloga; u UI-ju ispod „Legacy (CFD)". Ne brisati dok postoji ijedan FTMO trejd |
| 20 | „Where this sits": vault (F0–F5, makro bias, COT) je swing ciklus | Za day trading kontekst daje **`futures-trading` brief** (raspon, kalendar, režim, ugovori danas). `htf_bias` → bias dana iz brief-a |
| 21 | Dupliranje naloga: poruka kaže „…costs and FTMO rules" a kopira i Topstep | Tekst u `account-settings.tsx` |
| 22 | Komentari u kodu koji tvrde „this is a swing book" (`co-exposure.ts`, `survival.ts`, `portfolio-heat.ts`, `period-stats.ts`, `trade-rules.ts`, …) | Prepisati uz izmenu modula, ne pre (komentar prati kod) |
| 23 | `PARITY.md`, `docs/formulas-audit.md` | Dopuna posle P2 — intraday metrike TradeZella-e ponovo postaju relevantne |

## Redosled

1. P0 #1–#6 (jedna po jedna, svaka sa testom koji pada pre izmene).
2. P1 #7–#10 zajedno sa seed migracijom.
3. P2 po potrebi nedeljnog pregleda — prvo #11 i #12 (sesija, trajanje u minutima), jer ih „Napredak" već delimično računa.
4. P3 uz odgovarajući modul.
