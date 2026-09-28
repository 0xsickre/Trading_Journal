# Faza F — journal sa swing-a na day trading

**Status na 28.09.2026:** trgovanje je prešlo sa FTMO CFD swing-a (XAUUSD, NAS100, bakar; MT5) na
**intraday CME fjučerse na Topstep-u** (NQ / MNQ, ES / MES; 6E / M6E u katalogu). Četiri commita od
28.09. su uvela ulaz za day trading; ovaj fajl je popis svega što je u kodu **još uvek swing** i šta
ga zamenjuje. README opisuje stanje koda kakvo jeste — i swing ostatke — dok ovde stoji šta sledi.

**Kako je fajl složen.** Posao je podeljen u **šest faza, F1–F6**; jedna faza = jedna sesija, sa
jasnim ulazom i izlazom, da nijedna ne zavisi od konteksta koji živi samo u razgovoru. **Detaljan
plan postoji samo za fazu koja je sledeća** (sada H1, pa F4). Ostale imaju okvir — cilj, stavke, odluke koje
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
| `a8e63f9` | **F3**: Topstep trejdovi po planu u tracker-u (DLL, budžet na ulazu +10 %, broj ugovora), % osnovica bez Topstep kapitala, `risk_budget_at_entry`, Survival u novcu (trailing MLL), prop-firm headroom i za Topstep, bez „Risk %" na Topstep fjučersu |
| `3644c05` | **F2**: Topstep nalog broji Topstep dan (17:00 → 17:00 CT) svuda — kalendar, `/daily`, „Bez pregleda", tracker, `/weekly`, dashboard, izveštaji; „danas" po primarnom nalogu (`DayZone`, `todayFor`) |
| `c0077e1` | **F1**: `thesis_written` ocenjuje samo trejdove planirane pre ulaza (`no_plans`); probijen MLL / FTMO blokira plan, ne evidenciju (`origin`); Topstep „Reset account…" u Settings; tekst dupliranja naloga |

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
| 28.09.2026 | F1.2 | Settings dobija „Reset account…" za Topstep (upisuje `topstep_reset_at`, kao FTMO restart) — bez njega poruka „resetuj ga u Settings" nema kuda da vodi. Kolona već postoji, bez migracije |
| 28.09.2026 | F2 | D1-A: svaki trejd ide u dan po pravilu SVOG naloga, i u „All accounts" pogledu |
| 28.09.2026 | F2 | D2-A: pravilo dana se izvodi iz `topstep_mode` (Topstep nalog = 17:00 → 17:00 CT), bez nove kolone i bez migracije |
| 28.09.2026 | F2 | D3-A: „danas" je Topstep dan kad je primarni nalog u Topstep režimu (posle 17:00 CT je već sutra) |
| 28.09.2026 | F2 | D4-A: nedelja se broji po Topstep danu — nedeljno veče od 17:00 CT pripada novoj nedelji |
| 28.09.2026 | F3 | E1-A: isto pravilo, Topstep trejdovi po planu (DLL po nalogu i Topstep danu), ostali po % sa osnovicom BEZ Topstep naloga; dan pada ako padne bilo koji nalog |
| 28.09.2026 | F3 | E2-A: `max_loss_per_week` ne ocenjuje Topstep trejdove (Topstep nema nedeljni limit) |
| 28.09.2026 | F3 | E3-B: gubitak po trejdu na Topstep-u = budžet rizika na ulazu + 10 % tolerancije za proklizavanje |
| 28.09.2026 | F3 | E4-B: budžet se pečati na ulazu u `risk_budget_at_entry` (migracija); trejd bez pečata čita izvedeni iz timeline-a |
| 28.09.2026 | F3 | E5: „veličina po nameri" na Topstep-u = broj ugovora jednak onom što forma izračuna iz budžeta na ulazu |
| 28.09.2026 | F3 | E6-A: headroom = najbliži prilaz MLL podu u istoriji (min prostor ÷ MLL); Survival u „All accounts" simulira primarni nalog |
| 28.09.2026 | F3 | E7: lista „Risk %" se ne nudi na Topstep fjučersu u formi plana |
| 28.09.2026 | — | Trejder: FTMO, swing i CFD „verovatno se više neće koristiti", sme da se izbaci. Baza na taj dan: nijedan FTMO/CFD trejd. Obim uklanjanja se dogovara kao posebna faza, ne usput u F3 |
| 28.09.2026 | F3 | Trejder odobrio migraciju `20260928160000`; primenjena istog dana |
| 28.09.2026 | H1 | Uklanjanje FTMO/swing/CFD koda ide PRE F4, kao posebna faza, u predloženom obimu; kolone u bazi ostaju |
| 28.09.2026 | F4 | G1-B (brief upisuje red u journal), G2-A (check-in kartica se uklanja), G3-A (`time_stop_minutes` + „do kraja sesije"), G6 → F5 |
| 28.09.2026 | F4 | G4-A: migracija dodaje predložene day-trading stavke i gasi (ne briše) swing stavke u postojećim listama |
| 28.09.2026 | F4 | G5: `max_trades_per_day` (N = 2), `stop_after_losses` (N = 2 uzastopna u Topstep danu), `flat_by_close`, `no_entry_in_red_window`; `walk_away_target` NE. Ručna pravila koja pokrivaju isto se penzionišu (`deleted_at`) |

Nova odluka se upisuje ovde pre koda, sa datumom. Ako odluka nedostaje, agent PITA trejdera i ne
pogađa.

## Kako nastaviti (nova AI sesija)

1. Grana: `main` — od F1 (28.09.2026) trejder je tražio da se radi direktno na `main`, bez posebnih
   grana; `claude/journal-swing-to-day-trading-a49d56` je ostala na stanju pre F1. Isti naziv grane
   postoji i u `0xsickre/futures-trading`; F2 tamo ne menja kod (vidi F2 → „Utvrđeno u kodu").
2. Pročitaj ovaj fajl ceo, pa `AGENTS.md` (Next.js 16 — dokumentacija u `node_modules/next/dist/docs/`),
   pa README sekcije koje faza navodi.
3. Radi **samo prvu fazu u Mapi čiji status nije ✅**, po Protokolu. Ako faza nema sekciju
   „Detaljno", prvo je napiši ovde, odluke koje traže trejdera upiši kao pitanja i stani.
4. Na kraju faze: status ✅ + hash commita u Mapi, detaljan plan SLEDEĆE faze, README 1:1, push.
5. Stani i traži jači model ako faza ispadne veća od procene (kolona Model).

## Mapa faza

| Faza | Cilj | Stavke | Zavisi od | Migracija | Model | Status |
|---|---|---|---|---|---|---|
| **F1** | Tačnost odmah: ono što danas pogrešno ocenjuje, a ne traži nijednu veliku odluku | #2, #5, #21 | — | ne | Sonnet | ✅ `c0077e1` (28.09.2026) |
| **F2** | Topstep dan (17:00 → 17:00 CT) kao ključ dana svuda gde se dan broji | #1 | F1 | ne (D2-A: izvedeno iz `topstep_mode`) | **Opus** | ✅ `3644c05` (28.09.2026) |
| **F3** | Topstep pravila u tracker-u i Survival-u | #3, #4, #6 | F2 | da: `20260928160000` (`risk_budget_at_entry`) | **Opus** | ✅ `a8e63f9` (28.09.2026) — migracija primenjena 28.09.2026 uz odobrenje trejdera |
| **H1** | Uklanjanje FTMO / MT5 / swing koda (trejder, 28.09.2026) | #19 i delovi #13, #14 | F3 | ne (kolone ostaju) | **Opus** | ⏳ **sledeća — odluke donete** |
| **F4** | Dnevni tok: pred-sesija umesto check-in-a, forma, kategorije, nova auto pravila | #7, #8, #9, #10 | F2, F3 | da (brief tabela, nova pravila, time stop, kategorije) | **Opus** | posle H1 — odluke donete (G1–G6) |
| **F5** | Intraday analitika: sesija, trajanje u minutima, insights, swap, uzorak | #11–#15, #17, #18 | F2 | ne (sve izvedeno) | Sonnet, Opus za #13 | okvir |
| **F6** | Nasleđe i `futures-trading`: cena promašaja iz R2, legacy CFD u UI-ju, komentari, PARITY | #16, #19, #20, #22, #23 | F5 | možda (#16) | Sonnet | okvir |

## F1 — Tačnost odmah (detaljno) — ✅ `c0077e1`

**Isporučeno kako je planirano**, uz dve stvari koje plan nije predvideo: (1) Settings nije imao
reset za Topstep nalog, pa bi blokada plana bila bez izlaza — dodat „Reset account…" (odluka u
dnevniku); (2) `origin: "log"` propušta samo trejd koji je stvarno zatvoren, jer je server akcija
javni endpoint. Gate zelen, 3.046 testova (+32). Tekstovi grešaka u formi su na engleskom, kao ostatak
te forme; razlog `no_plans` u checklisti je na srpskom, kao ostali razlozi.

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

## F2 — Topstep dan kao ključ dana (detaljno) — ✅ `3644c05`

**Isporučeno po planu i odlukama D1–D4 (sve A).** `time.ts` ima `DayZone` (ime zone ili Topstep
pravilo), `dayKeyIn` / `weekKeyIn` / `dayStartUtcIn` / `todayFor` i `accountDayZoneResolver`;
`topstepTradingDay` je preseljen tamo. Unija sa imenom zone je zadržala potpise svih modula (stari
testovi rade nepromenjeno), a kompajler je pokazao svako mesto gde zona ulazi u funkciju koja traži
samo ime. `todayInTz` je uklonjen. Van plana: početak perioda na dashboardu (`dayStartUtcIn`) — za
Topstep 17:00 CT prethodne večeri, uz test za nedelju prelaska na letnje vreme, gde „ponoć + 17 h"
greši za sat. Proveren produkcioni podatak (samo čitanje): jedan Topstep trejd, nijedan ne menja
dan, nijedan zaključan dan nije pogođen. `futures-trading` se ne menja. Gate zelen, 3.075 testova
(+29). Namerno ostaje kalendarski dan: FTMO dan, noći swap-a, vikend držanja, dani drawdown-a,
time stop u danima (F4) i `equity_at_entry` (F3).


**Ulaz:** `main` posle F1 (`c0077e1`), gate zelen (3.046 testova). **Pročitati:** README § Attributing
to days, § A trading day, § Process tracking, § Topstep; `time.ts`, `topstep.ts`
(`topstepTradingDay`), `tracker/auto-rules.ts`, `daily/page.tsx`. **Bez migracije:** ključ se izvodi
iz naloga, ništa se ne upisuje; `tj_daily_reports` i `tj_tracker_checkins` ostaju ključani datumom.

### Utvrđeno u kodu (28.09.2026, posle F1)

- **Jedan obrazac svuda.** Dan se svuda računa kao `zonedDateKey(trenutak, tzOf(red))`, gde je `tzOf`
  iz `accountTimezoneResolver` (`time.ts:515`: zona naloga → zona primarnog → `America/New_York`).
  Mesta: `daily/page.tsx:122–125, 169, 286` (tracker indeks, brojke dana, „Bez pregleda"),
  `calendar/page.tsx:77–81, 120–122, 150` (dan/nedelja/mesec + tracker), `weekly/page.tsx:119–120, 142,
  173`, `dashboard.tsx:807–814, 1144, 1189, 1447, 1553`, `enriched-trade.ts:142–164` (`openDay`,
  `closeDay`, `closeWeek` → dnevni i nedeljni insights), `period-stats.ts:123–127`,
  `analytics.ts:346, 458, 521`, `activity.ts` (`tradingDayKeysFromRows`),
  `tracker/equity-ladder.ts:49` (keš po danu), `trades-view.ts:51, 86–87` (filter perioda),
  `daily/tracker-actions.ts:147–150` (zaključavanje). Zamena `tzOf` → `dayOf` na jednom mestu u
  resolveru pokriva skoro sve.
- **Topstep dan postoji samo u `topstep.ts`** (`topstepTradingDay`, `:112`; DLL, EOD MLL, najbolji dan).
  Nijedan drugi modul ga ne zove — potvrđeno pretragom.
- **„Danas" je zona primarnog naloga**, na devet mesta: `todayInTz` u `daily/page.tsx:69`,
  `daily/actions.ts:23`, `daily/tracker-actions.ts:56, 143` (budući dan se ne zaključava),
  `page.tsx:30` (dashboard), `calendar/page.tsx:62`, `weekly/page.tsx:45`, `weekly/actions.ts:72`,
  `playbooks/[id]/page.tsx:68`, `notebook/page.tsx:46`, `settings/tracker-actions.ts:237`.
- **Dnevni izveštaj i tracker su jedan red po datumu za celu knjigu** (`tj_daily_reports`
  `UNIQUE (user_id, report_date)`), ne po nalogu. Zato „All accounts" pitanje nije o dva izveštaja,
  nego o tome koji trejd ulazi u koji datum.
- **`journal_podsetnik.py` (futures-trading) VEĆ broji Topstep dan** (`racun.trgovacki_dan`, 17:00 CT),
  samo za naloge u Topstep režimu. Plan (#1) ga je navodio kao potrošača koji treba da pređe — ne
  treba; prelazi journal. Danas se podsetnik i „Bez pregleda" na `/daily` NE slažu za trejd zatvoren
  posle 17:00 CT (18:00 ET): podsetnik ga broji u sutra, `/daily` u danas. F2 to ispravlja sa strane
  journala; `futures-trading` se ne menja.
- **Beograd ≈ Topstep dan.** 17:00 CT = 00:00 u Beogradu dok su oba u letnjem/zimskom vremenu; ne
  poklapa se ~3 nedelje u martu i ~1 u novembru (sat razlike). Zato promena zone naloga u
  `Europe/Belgrade` NIJE rešenje — tačno je samo većinu godine.
- **`equity_at_entry`** (`equity.ts:157`, `import/actions.ts:203`) uzima stanje na početku dana u zoni
  naloga; za Topstep to ide u F3 (rizik u novcu, ne u %), F2 ga ne dira.
- **Sat ulaza** (`zonedHour` u `enriched-trade.ts`, „sat ulaza" na `/weekly`) ostaje sat na satu zone
  naloga — to je pitanje sesije (F5), ne dana.

### Izmena

- `time.ts`: `accountDayResolver(accounts, primaryTz)` → `(trenutak, accountId) => dayKey`: Topstep nalog
  → `topstepTradingDay`, ostali → `zonedDateKey` u zoni naloga (pravilo naloga po D2). Uz njega
  `weekKeyOf` = ponedeljak Topstep dana (`weekStartOfDayKey`), da nedeljni ključ i dnevni ne razdvoje
  nedeljno veče. `topstepTradingDay` se seli u `time.ts` (ili ostaje u `topstep.ts` i uvozi se) —
  jedno mesto, isti testovi.
- Svi `tzOf`/`tzFor` potrošači sa liste gore prelaze na `dayOf(trenutak, red)` umesto
  `zonedDateKey(trenutak, tzOf(red))`. `buildTradeDayIndex`, `bucketByPeriod`, `enrichTrades`,
  `cashByDay`, `tradingDayKeysFromRows`, `reviewGaps` dobijaju `dayOf` umesto `tzOf`.
- „Danas" po D3: jedna funkcija `todayFor(primary)` umesto `todayInTz(primary.timezone)` na devet mesta.
- FTMO (`ftmo.ts:168`) ostaje na svojoj zoni — FTMO dan je dan FTMO-a, ne Topstep-a.
- Zaključani dani se ne diraju (zamrznuti redovi). Nezaključani prošli dani na Topstep nalogu se
  preračunaju: trejd zatvoren posle 17:00 CT prelazi u sledeći datum — **reći trejderu pre merge-a**
  koliko takvih trejdova ima (upit nad `tj_position_stats` pre primene).

### Odluke koje traži trejder (pre koda)

- **D1 — „All accounts" sa Topstep i CFD nalogom zajedno.** (A) svaki trejd ide u dan po pravilu
  SVOG naloga — isti datum može da znači 17→17 CT za jedan i ponoć–ponoć za drugi; (B) u „All
  accounts" jedno pravilo za sve (primarnog naloga). Preporuka: **A** — dan trejda ne sme da zavisi od
  filtera na ekranu, inače isti trejd ima dva datuma.
- **D2 — Odakle pravilo dana.** (A) iz `topstep_mode` (nalog u Topstep režimu = Topstep dan, bez nove
  kolone); (B) posebno podešavanje naloga „kraj dana" (npr. `day_boundary: calendar | cme_17ct`,
  migracija). Preporuka: **A** — nijedan nalog danas ne traži treće pravilo; B je migracija za
  hipotetički slučaj. Posledica A: isključen Topstep mod vraća nalogu kalendarske dane.
- **D3 — Šta je „danas".** (A) Topstep dan kad je primarni nalog u Topstep režimu (posle 17:00 CT
  `/daily` otvara sutrašnji dan — tačno kad počinje Globex sesija); (B) uvek kalendarski dan zone
  primarnog naloga. Preporuka: **A**, isto pravilo kao D2.
- **D4 — Vikend.** Topstep dan petka se završava u 16:00 CT (zatvaranje), a nedelja od 17:00 CT je
  već ponedeljak. Nedeljni ključ po Topstep danu (nedeljno veče → nova nedelja) — potvrditi da tako i
  `/weekly` treba da broji.

### Testovi (prvo padaju)

- `time.test.ts`: `accountDayResolver` — Topstep nalog 18:30 CT pon → uto; 16:59 CT → isti dan; CFD
  nalog u NY istog trenutka → pon; nalog bez zone → primarni; nedelja 17:30 CT → pon; DST prelaz
  (mart/novembar) — dan se računa u Chicagu, ne u zoni naloga.
- `tracker/auto-rules.test.ts`: `max_loss_per_day` na Topstep nalogu sabira trejd od 18:30 CT pon u
  utorak; CFD trejd istog trenutka ostaje u ponedeljku (D1-A).
- `review-gaps` + `daily/page`: „Bez pregleda" za dan D = isti skup kao `journal_podsetnik.py` za D
  (fiksni primer sa trejdom posle 17:00 CT).
- `period-stats` / kalendar: dan, nedelja (D4) i mesec Topstep trejda posle 17:00 CT.
- Zaključan dan: zamrznute presude se ne menjaju kad trejd „pređe" u sledeći dan.

### Izlaz iz F2

- Gate zelen; README § Attributing to days (izuzetak „Except Topstep's own day" postaje pravilo),
  § A trading day (21:25 podsetnik i `/daily` isti dan), § Topstep (banner i kalendar isti dan).
- Ovde: F2 ✅ sa commitom, detaljan plan za F3.

## F3 — Topstep pravila u tracker-u i Survival-u (detaljno) — ✅ `a8e63f9`

**Isporučeno po odlukama E1–E7.** Van plana ili drugačije od predloga:
- **Uvoz ne pečati budžet**: izvod stiže posle sesije, pa bi njegov „pečat" bio samo ista izvedena
  vrednost; trejd koji je napravio samo uvoz čita budžet izveden u trenutku ulaza. Pečat piše ručni
  upis (forma plana, `/trades/log`) na čuvanju koje trejdu prvi put daje fill.
- **Spajanje trejdova ne prenosi pečat**: lista kolona spajanja živi u SQL funkciji; dodavanje bi
  značilo prepisivanje funkcije. Preživeli trejd zadržava svoj pečat ili čita izvedeni.
- **Survival počinje od SADAŠNJEG stanja naloga** (balans i pod), DLL dan se seče na −DLL (Topstep
  likvidira), pod završava run. Test za trailing je scenario unutar DLL-a — prvi, sa danom od
  −2.000, bio je pogrešan jer ga DLL s pravom seče.
- `ftmoHeadroomPct` je postao `propHeadroomPct` („Prop-firm room" na kartici).
- Gate zelen, 3.125 testova (+50), coverage pragovi (100 % za `survival.ts`) prolaze.
- **Migracija `20260928160000` primenjena 28.09.2026** (odobrio trejder; u bazi zabeležena kao
  `risk_budget_at_entry`, kolona i CHECK provereni; jedini postojeći trejd nema pečat i čita izvedeni
  budžet). Kod je bezbedan na obe
  strane migracije: `updateTrade` čita prethodni red sa `select("*")` (imenovana nepostojeća kolona bi
  oborila čitanje), `tj_save_trade` preskače kolonu koje nema, a tracker tada izvodi budžet. Posle
  primene pečat počinje da se piše sam.


**Ulaz:** `main` posle F2 (`3644c05`), gate zelen (3.075 testova). **Pročitati:** README § Process
tracking, § Topstep, § Survival, § Process · Survival · Edge; `tracker/auto-rules.ts`,
`tracker/equity-ladder.ts`, `risk-taken.ts`, `topstep.ts`, `plan-calculations.ts`
(`computeTopstepRisk`, `computeFuturesContracts`), `survival.ts`, `scorecard.ts`, `dashboard.tsx`
(survival, scorecard).

### Utvrđeno u kodu (28.09.2026, posle F2)

- **Tracker pravila su jedan skup za celu knjigu**, ne po nalogu: `tj_tracker_rules` nema
  `account_id`, `config` je samo `{ pct }` (`tracker-types.ts`). Četiri pravila su procenat
  equity-ja kojim je dan otvoren (`AUTO_RULES_NEEDING_PCT`); `max_loss_per_day` sabira SVE trejdove
  zatvorene tog dana, preko svih naloga (`evalMaxLossPerDay`).
- **Osnovica procenata je cela knjiga**: `bookEquityLadder` sabira `starting_balance` svih naloga
  (`equity-ladder.ts`). Topstep 50K ulazi sa 50.000 u imenilac iako nalog može da izgubi samo prostor
  iznad MLL-a — pa je u mešovitoj knjizi i CFD procenat pogrešan (razblažen Topstep kapitalom).
- **`computeTopstepRisk` zna samo SADA** (`room`, `dllLeftToday` iz `getTopstepSizing`). Istorije
  prostora iznad MLL-a po danu nema: `evaluateTopstep` računa trailing pod u petlji, ali vraća samo
  završno stanje. Za ocenu prošlog trejda treba prostor i DLL **u trenutku ulaza**.
- **`equity_at_entry`** je zapečaćen na ulazu (dan otvaranja u zoni naloga, `equity.ts:157`,
  `import/actions.ts:203`) — na Topstep nalogu to je balans, ne prostor iznad MLL-a, pa je
  `risk_per_trade` u % i tu merilo pogrešne stvari.
- **`risk_matched_intent`** poredi rizik sa `risk_pct` iz padajuće liste; `/trades/log` ga ne pita,
  pa je na Topstep-u uvek `na` (`matchedRiskIntent`). Zaokruživanje naniže (`computeFuturesContracts`)
  znači da je stvarni rizik skoro uvek ispod budžeta (1 MNQ od $202 na budžetu od $250).
- **Survival je simulacija u procentima** koja se ukamaćuje (`simulateSurvival`, `dayReturnsFrom`);
  pragovi su FTMO procenti ili sopstveni najgori DD (`dashboard.tsx`, `thresholdsFor`). Trailing MLL
  u novcu ne može da se izrazi fiksnim procentualnim podom. U „All accounts" kartica uzima prvi FTMO
  nalog ili prvi nalog.
- **Scorecard** dobija samo `ftmoHeadroomPct` (`scorecard.ts:99`, iz `evaluateFtmo`); Topstep nema
  ekvivalent, pa Survival osa na Topstep nalogu ima samo drawdown od sopstvenog vrha.

### Predlog izmene (posle odluka)

- `topstep.ts`: `topstepTimeline(config, trades)` — za svaki Topstep dan: pod i balans na otvaranju,
  neto dana, DLL preostao; `evaluateTopstep` postaje poslednji red timeline-a (isti testovi). Iz
  njega `topstepStateAt(instant)` = prostor iznad MLL-a i DLL preostao u trenutku ulaza.
- Auto pravila po nalogu (E1): trejdovi Topstep naloga se ocenjuju novcem iz plana, ostali
  procentom, a osnovica procenta je kapital samo ne-Topstep naloga. Dan pada ako padne bilo koji nalog.
- `risk_per_trade` / `risk_matched_intent` na Topstep-u čitaju budžet na ulazu (E3, E4, E5).
- Survival: Topstep režim simulacije u novcu (trailing EOD pod, DLL kao zaustavljen dan, cilj uz
  55 %), `headroom` za scorecard po E6.
- Forma plana na Topstep fjučersu: bez liste „Risk %" (E7).

### Odluke koje traži trejder (pre koda)

- **E1 — Novčana pravila na Topstep nalogu.** (A) ista pravila, ali Topstep trejdovi se ocenjuju po
  planu: dnevni gubitak = DLL plana po nalogu i Topstep danu, a procenti ostaju za CFD, sa osnovicom
  bez Topstep naloga; (B) nova auto pravila (`topstep_dll`, `topstep_risk`) uz stara — nova CHECK
  vrednost, migracija. Preporuka: **A** — jedno pravilo „dnevni gubitak" koje svaki nalog čita po
  svom pravilu, kao dan u F2; nezaključani prošli dani se preračunaju (1 Topstep trejd danas).
- **E2 — Nedeljni limit na Topstep-u.** Topstep nema nedeljno pravilo. (A) `na` za Topstep trejdove;
  (B) procenat kao do sada, ali od prostora iznad MLL-a. Preporuka: **A**.
- **E3 — Gubitak po trejdu na Topstep-u.** Granica = budžet rizika na ulazu (A) tačno, ili (B) uz
  toleranciju za proklizavanje (npr. +10 %). Preporuka: **B** sa tolerancijom koju ti odrediš —
  stop pogođen uz tik-dva proklizavanja nije prekršaj pravila.
- **E4 — Odakle budžet na ulazu.** (A) izvodi se iz zatvorenih trejdova (timeline, bez migracije,
  ali se menja kad kasni uvoz ispravi raniji trejd); (B) pečati se na ulazu u novu kolonu
  `risk_budget_at_entry` (migracija, kao `equity_at_entry`), a stari trejdovi čitaju izvedeni.
  Preporuka: **B** — odluka se meri onim što se znalo u trenutku ulaza.
- **E5 — „Veličina po nameri" na Topstep-u.** Pogođeno ako je broj ugovora = ono što bi forma
  izračunala iz budžeta na ulazu (`computeFuturesContracts`, zaokruženo naniže), ne ±0,1 pp.
  Preporuka: **da**.
- **E6 — Headroom kad MLL trail-uje.** (A) najbliži prilaz podu u istoriji: min(prostor ÷ MLL plana)
  — kao FTMO `headroomPct`; (B) samo trenutni prostor ÷ MLL. Preporuka: **A**. Uz to: Survival
  kartica u „All accounts" simulira primarni nalog, ne zbir naloga.
- **E7 — Lista „Risk %" na Topstep fjučersu** u formi plana: sakriti (veličina je već iz pravila
  rizika). Preporuka: **da**.

### Testovi (prvo padaju)

- `topstep.test.ts`: timeline — pod na otvaranju svakog dana, trail samo po EOD, reset, isplata;
  `topstepStateAt` usred dana (DLL već potrošen jutrom).
- `tracker/auto-rules.test.ts`: Topstep dan sa gubitkom = DLL → `fail`; CFD trejd istog dana ocenjen
  procentom sa osnovicom bez Topstep naloga; `max_loss_per_week` `na` na Topstep-u (E2).
- `risk-taken.test.ts`: budžet na ulazu, `matchedIntent` po broju ugovora (E5).
- `survival.test.ts`: novčana simulacija — trailing pod, DLL ne završava run, cilj uz 55 %.
- `scorecard.test.ts`: Topstep headroom po E6.

### Izlaz iz F3

- Gate zelen; migracija (ako E4-B) primenjena tek posle zelenog gate-a i uz odobrenje trejdera.
- README: § Process tracking (četiri limita), § Topstep (pasus „The tracker's loss and risk rules
  do not read any of this yet" prepisan), § Survival, § Process · Survival · Edge.
- Ovde: F3 ✅ sa commitom, detaljan plan za F4.

## H1 — Uklanjanje FTMO / MT5 / swing koda (detaljno)

**Ulaz:** `main` posle F3 (`c6fe8f1`), gate zelen (3.125 testova). **Odluka:** trejder 28.09.2026 —
„verovatno se više neće koristiti"; baza tog dana nema nijedan FTMO ni CFD trejd (samo arhiviran
prazan „Backtesting XAUUSD" i Topstep-practice). **Pravilo:** briše se KOD; kolone i tabele u bazi
ostaju (migracije su aditivne), pa se ništa ne gubi i sve se može vratiti iz istorije gita.

**Ostaje:** Topstep, TopstepX uvoz, TradingView backtest uvoz (backtest nalozi), procentualni
tracker pragovi za naloge van Topstep-a (backtest nalog ih koristi), `swap_funding` na fill-u i u
računu P&L-a (novčani moduli i view u bazi; na fjučersu je 0).

**Koraci** (svaki: test koji pada → brisanje → gate → commit):

- **H1.1 FTMO mod** — `ftmo.ts`, `ftmo-status.ts`, `ftmo-banner.tsx` i njihovi testovi; FTMO sekcija i
  „Restart challenge" u Settings (`account-settings.tsx`, `resetFtmoChallenge`, FTMO polja u
  `updateAccount` i `settings-rules.ts`); zamrzavanje u `createTrade`/`updateTrade` (ostaje Topstep
  grana), `ftmoFailedAccountIds` u formi plana i quick-logu; FTMO baner i `ftmoStatuses` na dashboardu
  (`dashboard-widgets.ts` widget `ftmo`), FTMO grana `thresholdsFor` u Survival-u i u prop headroom-u;
  kopiranje FTMO pravila pri dupliranju (`account-rules.ts`); `ftmo_*` iz `Account` tipa i
  `getAccounts` select-a; komentari koji upućuju na FTMO.
- **H1.2 MT5 statement uvoz** — `mt5-statement.ts`, MT5 grana u `import-wizard.tsx` (EET zona),
  `scripts/mt5_excursion.py`, MT5 izvor u `excursion-source.ts` i `missed-cost.ts` (samo ako nema
  drugog čitaoca), `instrument-aliases.ts` FTMO/CFD aliasi; testovi.
- **H1.3 Check-in po poziciji i swing insights** — `open-positions-card.tsx` (G2), `position-checkin*`,
  akcija čuvanja check-in-a, `swing-rules.ts` (`SWING_RULES`: teza/prekid, `pastTimeStop`,
  `weekendHoldRecord`, delimični izlaz), dimenzije `touched`, `thesis_state`, `weekend_hold` i
  `time_stop_breached` u izveštajima, check-in u `insights/context.ts` i `enriched-trade.ts`.
  `time_stop_days` ostaje dok ga F4 ne zameni minutima.
- **H1.4 Swap kao metrika** — pločica i metrika swap-a, insight(i) o swap-u i trostrukom danu,
  `weekend-hold.ts` ako posle H1.3 nema čitaoca. Troškovi po fill-u ostaju.

**Testovi:** negativni render testovi (Settings ne nudi FTMO pravila, uvoz ne nudi MT5, `/daily` nema
check-in, registar insights-a nema swing pravila), a postojeći testovi obrisanog koda idu sa njim.
Gate zelen posle svakog koraka; coverage pragovi i dalje važe.

**Izlaz:** README 1:1 (sve sekcije koje opisuju FTMO, MT5, check-in, swing insights, swap metriku;
broj testova, insights i ruta), `PARITY.md` ako pominje obrisano, ovde H1 ✅, pa F4.

### H1 urađeno (28.09.2026)

- **H1.1** `09752cd` — FTMO mod obrisan; Settings nudi samo Topstep pravila, widget `ftmo` → `topstep`.
- **H1.2** `69e5124` — MT5 statement uvoz i `mt5_excursion.py` obrisani.
- **H1.3** `67feff6` — check-in kartica, `position-checkin*`, `open-positions.ts`, `swing-rules.ts`
  (5 pravila), dimenzije `touched`/`thesis_state`/`weekend_hold`/`time_stop_breached`, polja
  `weekendHold`/`heldDays`/`timeStopDays`/`pastTimeStop` u `enriched-trade.ts`, nedeljni rekap bez
  vikend/check-in brojeva. `weekend-hold.ts` je ostao bez čitaoca pa je obrisan već ovde.
- **H1.4** — metrika `total_swap` (38 → 37), red „Swap per holding day" i insight
  `swap_ate_the_trade` (24 → 23 pravila). Red „Swap" u kartici Costs ostaje, ali se prikazuje samo
  kad opseg ima swap (mapa #14): na CFD istoriji bi inače provizije bez njega davale pogrešan zbir
  ispod sebe. Swap po fill-u, `swap_long/short/triple_day` u katalogu instrumenata i swap u neto P&L-u
  ostaju. `PARITY.md`: FTMO → Topstep u §6 i §8, `total_swap` izbačen iz §1.
- Procentualni tracker pragovi ostaju: backtest nalog nije Topstep i čita ih.

## F4 — Dnevni tok za day tradera (detaljno)

**Ulaz:** `main` posle H1 (F3: `a8e63f9`, `409858d`; migracija `20260928160000` primenjena). **Pročitati:** README
§ Routes `/daily`, § Ratings, § Process tracking; `daily-report-form.tsx`, `form-config.ts`,
`plan-snapshot.ts`, `tracker-types.ts`, `tracker-rule-manager.tsx`,
`tracker/auto-rules.ts`, seed migracija `20260919230000`; u `futures-trading`: `tools/brief/brief.py`,
`tools/journal_api.py`, README § Dnevni brief.

### Utvrđeno u kodu i bazi (28.09.2026, posle F3; baza samo čitana)

- **`/daily`** ima „Bez pregleda", tri tracker faze i karticu „Pre nego što uđeš" (mentalno stanje u
  zvezdicama + „ne otvaram ništa novo"). Check-in po otvorenoj poziciji (G2-A) je uklonjen već u
  H1.3; tabela `tj_position_checkins` ostaje kao istorija. Dan je „kompletan" kad postoji aktivan
  fokus-cilj (`isDayComplete`).
- **Brief** (`futures-trading`) pravi HTML u repou (`izlaz/brief/{datum}.html`) i Telegram poruku u
  06:40 BG: vesti sa crvenim prozorima (−5/+15 i −2/+5 min), očekivani raspon NQ/ES za Topstep dan i
  RTH, Topstep kraj dana (praznici, rani kraj), ugovori danas. **Journal ne dobija ništa
  strukturisano** — nema tabele ni polja; `journal_api.py` brief danas samo ČITA iz journala.
- **Forma plana**: `thesis`, `invalidation`, `time_stop_days` (1–5 dana) u grupi „Why this trade"
  (`form-config.ts`); posle H1.3 `time_stop_days` čitaju samo plan pečat (`plan-snapshot.ts`), spajanje
  pozicija, uvoz i šema unosa — nijedan insight ni dimenzija više.
- **Kategorije trejdera u bazi su swing seed**: Entry TF `15m | 1h | 4h | 1D | 5m | 15`, HTF Bias,
  Exit „Time exit", greške „Overmanaged", „Against HTF bias", „Counter HTF trend", Risk %
  `0.25–1`. Seed (`tj_seed_categories`) puni samo PRAZNU knjigu — ova nije prazna, pa novi seed ne bi
  promenio ništa kod trejdera.
- **Tracker pravila u bazi**: 8 auto + 10 ručnih. Ručna koja su već day-trading pravila i mogu da
  postanu auto: „max 2 trejda dnevno", „Walk Away Target (USD)", „Max Daily Loss (USD)" (sada ga
  pokriva DLL iz F3), „bez ulaza 15 min pre/posle crvenih vesti", „pozicije samo u mom vremenskom
  okviru". Auto ključevi su zatvoren skup sa CHECK-om u bazi (`AUTO_RULE_KEYS`) — novo pravilo =
  migracija + evaluator.

### Predlog izmene (posle odluka)

- Tabela `tj_session_briefs` (G1-B): datum (Topstep dan), raspon NQ/ES, crveni prozori
  `[{od, do, naziv}]`, Topstep kraj dana, ugovori danas; `brief.py` je upisuje preko `journal_api`,
  `/daily` je čita. Bez nje `no_entry_in_red_window` i praznični `flat_by_close` nemaju izvor.
- `/daily`: kartica „Pred sesiju" (raspon, crveni prozori, kraj dana, ugovori, DLL danas sa banera,
  plan dana) na mestu gde je bila check-in kartica (G2, uklonjena u H1.3); „Bez pregleda" ostaje.
- Forma: time stop u minutima (G3); teza ostaje opciona (F1 je već ocenjuje samo na planu).
- Kategorije (G4) i nova auto pravila (G5, G6) po odlukama.

### Odluke koje traži trejder (pre koda)

- **G1 — Odakle `/daily` čita brief.** (A) samo link na HTML/Telegram; (B) brief upisuje strukturisan
  red u journal (nova tabela), `/daily` ga prikazuje i pravila ga čitaju. Preporuka: **B**.
- **G2 — Check-in po poziciji.** (A) ukloniti karticu sa `/daily` (tabela i istorija ostaju);
  (B) prikazivati je samo kad postoji pozicija otvorena preko noći. Preporuka: **A**.
- **G3 — Time stop.** (A) nova kolona `time_stop_minutes` + izbor „do kraja sesije"; stara
  `time_stop_days` ostaje za istoriju, forma je više ne nudi; (B) bez time stop-a u formi.
  Preporuka: **A**.
- **G4 — Kategorije.** Predlog novih stavki: Entry TF `1m | 2m | 5m | 15m`; „Bias dana (brief)"
  `Long | Short | Neutral` umesto HTF Bias; Exit + „Flat by close"; greške + „Overtrading", „Trade
  after DLL plan", „Revenge re-entry", „Traded red window". Pitanje: (A) migracija DODAJE nove stavke
  u tvoje postojeće liste i GASI (ne briše) swing stavke — vrednosti na starim trejdovima ostaju;
  (B) samo seed za nove knjige, svoje liste menjaš u Settings. Preporuka: **A**, uz tvoju potvrdu
  tačnih lista.
- **G5 — Nova auto pravila i brojevi.** Predlog: `max_trades_per_day` (N — tvoje ručno pravilo kaže
  2), `stop_after_losses` (N uzastopnih gubitaka u Topstep danu), `flat_by_close` (nijedna pozicija
  posle Topstep kraja dana, uz rani kraj iz brief-a), `no_entry_in_red_window` (traži G1-B),
  `walk_away_target` (posle dnevnog cilja u USD nema novog ulaza). Koja od njih, sa kojim N i
  iznosom, i da li se odgovarajuća ručna pravila penzionišu (`deleted_at`, istorija ostaje).
- **G6 — Vremenski prozor ulaza** („pozicije samo u mom okviru"): auto pravilo sa prozorima u ET
  ovde, ili tek u F5 zajedno sa sesijskim prozorima. Preporuka: **F5** (iste granice).
- **H1 — Uklanjanje FTMO / swing / CFD** (trejder: „verovatno se više neće koristiti"; baza
  28.09.2026: nijedan FTMO ni CFD trejd). Predlog obima: FTMO mod (evaluator, baner, zamrzavanje,
  Settings), MT5 statement uvoz i `mt5_excursion.py`, swap metrike, check-in po poziciji, swing
  insights (vikend, time stop u danima, teza „intact"), procentualni % pragovi samo ako nema
  ne-Topstep naloga. Kolone u bazi OSTAJU (migracije su aditivne) — briše se kod. Pitanje: (A) kao
  posebna faza ODMAH posle F4 (umesto „Legacy (CFD)" u F6), ili (B) pre F4, da F4–F5 ne prilagođavaju
  kod koji će nestati. Preporuka: **B** — manje posla ukupno; obim potvrditi stavku po stavku.

### Testovi (prvo padaju)

- `session-brief` čitanje i prikaz na `/daily` (render), prazan dan bez brief-a kaže „brief nije
  stigao", ne prazan raspon.
- Evaluatori novih pravila u `tracker/auto-rules.test.ts`: brojanje trejdova po Topstep danu, niz
  gubitaka, pozicija posle kraja dana (i rani kraj), ulaz u crvenom prozoru (granice uključene).
- Forma: time stop u minutima se pečati; `time_stop_days` se više ne nudi, stari trejdovi ga čitaju.

### Izlaz iz F4

- Gate zelen; migracije primenjene tek posle zelenog gate-a i uz odobrenje trejdera.
- README § Routes `/daily`, § Process tracking (broj auto pravila), § A trading day; u
  `futures-trading` README § Dnevni brief (upis u journal).
- Ovde: F4 ✅, detaljan plan sledeće faze.

## F5–F6 — okvir (detaljno kad dođu na red)

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
