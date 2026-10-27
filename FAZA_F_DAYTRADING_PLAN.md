# Faza F — journal sa swing-a na day trading

**Status na 28.09.2026:** trgovanje je prešlo sa FTMO CFD swing-a (XAUUSD, NAS100, bakar; MT5) na
**intraday CME fjučerse na Topstep-u** (NQ / MNQ, ES / MES; 6E / M6E u katalogu). Četiri commita od
28.09. su uvela ulaz za day trading; ovaj fajl je popis svega što je u kodu **još uvek swing** i šta
ga zamenjuje. README opisuje stanje koda kakvo jeste — i swing ostatke — dok ovde stoji šta sledi.

**Kako je fajl složen.** Posao je podeljen u **šest faza, F1–F6**; jedna faza = jedna sesija, sa
jasnim ulazom i izlazom, da nijedna ne zavisi od konteksta koji živi samo u razgovoru. **Detaljan
plan postoji samo za fazu koja je sledeća** (Faza F je završena 29.09.2026 — F1–F6 i H1, H2, K ✅). Ostale imaju okvir — cilj, stavke, odluke koje
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
| 28.09.2026 | F4 | G7: `no_entry_in_red_window` čita **samo prozore iz brief-a** (visoke −5/+15, srednje −2/+5 min, po modelu brief-a), ne fiksnih 15 min |
| 28.09.2026 | F4 | G8: penzionišu se ručna pravila „Dnevni limit trejdova (max 2)", „15 min oko crvenih vesti", „Max Daily Loss (USD)"; „Walk Away Target" ostaje ručno |
| 28.09.2026 | F4 | G9: `max_trades_per_day` i `stop_after_losses` se broje **po nalogu** (dan pada ako padne bilo koji nalog, kao E1) |
| 28.09.2026 | F4 | G10: Exit „Time exit" ostaje; Entry TF „15" (duplikat „15m") se gasi |
| 28.09.2026 | F4 | G11: brief NE upisuje broj ugovora — journal ga računa sam iz `topstep.ts` (jedno mesto, bez druge kopije) |
| 29.09.2026 | — | F4 rad posle `3ba08d7` (tabela za brief, kartica, upis iz brief.py) nije bio pushovan i izgubljen je sa kontejnerom sesije; F4 kreće ponovo od `main`. Odluke G7–G11 su sačuvane iz razgovora |
| 29.09.2026 | H2 | Trejderu ne trebaju ostaci: `tj_position_checkins`, `time_stop_days`, swap kolone (fill, katalog, neto P&L), % tracker pragovi. Posebna faza **H2 posle F4**, migracija koja briše (nepovratno) — primena tek uz odobrenje |
| 29.09.2026 | F4.5 | Time stop je kolona `time_stop` (tekst, CHECK na 5 vrednosti), ne `time_stop_minutes`: „do kraja sesije" je pravi izbor, a ne magičan broj, i razlikuje se od „nije upisano" (NULL). Uvoz (`import/actions.ts`) ima eksplicitan spisak kolona; `time_stop` je dodat posle primene migracije |
| 29.09.2026 | H2 | Backtest nalozi više ne trebaju (samo Topstep) → % pragovi i ne-Topstep grana tracker-a idu u H2 |
| 29.09.2026 | F4 | Trejder odobrio primenu četiri F4 migracije; primenjene istog dana |
| 29.09.2026 | — | Grane: posle punog (ne plitkog) preuzimanja sve udaljene grane oba repoa su već sadržane u `main`; dve kojima je jedini commit već bio na `main` kao isti patch spojene su merge commit-om bez promene sadržaja (Trading_Journal `claude/supabase-migrations-apply-pynzxn`, futures-trading `claude/journal-swing-to-day-trading-a49d56`) |
| 29.09.2026 | — | Migracije: 14 fajlova bez zapisa u `schema_migrations` su u bazi (puštene ručno — objekti postoje); dve nisu bile: `drop_dead_ratings` (`conviction`, `setup_grade`, funkcija spajanja) i `drop_daily_prose` (`macro_note`, impulse kolone). Kolone prazne, kod ih ne čita; primenjene po nalogu trejdera („migracije koje nije pokrenuo prethodni agent ako treba primeni") |
| 29.09.2026 | H2 | Odluke I1–I5 izvedene iz trejderovih poruka („Koristi odgovore sa slike i moje poruke"): **I1-B** svaka grupa svoja migracija; **I2 da** FTMO kolone se brišu („ništa od ovog mi ne treba"); **I3 da** swap izlazi i iz neto P&L-a (isto); **I4-A** `max_loss_per_week` se penzioniše, `risk_pct` i lista „Risk %" se brišu; **I5-A** backtest odlazi — `account_kind`, TradingView backtest uvoz i prazan arhivirani „Backtesting XAUUSD" („Ne, samo Topstep") |
| 29.09.2026 | H2 | „Obriši taj backtest nalog slobodno, samo Topstep ostavi" — potvrda I5-A; nalog je bio aktivan (podrazumevani), pa je „Topstep-practice" postao podrazumevani |
| 29.09.2026 | K | Šest zahteva trejdera tokom H2 (redosled pravila, tagovi na srpskom, uvoz puni plan, fiksni breakeven, zona, slike) → faza **K** pre F5 |
| 29.09.2026 | F4 | Trejder: `/daily` nema logike („Oba pitanja…", a pitanja nema; prošlo vreme; upućuje na karticu koje nema). Stranica je preuređena hronološki (1 · Pre sesije, 2 · Tokom sesije, 3 · Posle sesije), kartica „Pre nego što uđeš" ima dva numerisana pitanja u budućem vremenu, faze pravila na srpskom |
| 29.09.2026 | F6 | M1-A: promašaj „košta" samo ako je cena posle plana dodirnula ulaz; onda prvi od stop (−1R) / target (+R plana) do kraja Topstep dana, inače 0; bez dodira ulaza → `no_entry`, broji se odvojeno. M2-A: `against_macro_bias` i `cot_chase` se gase, polja ostaju u bazi. M3-A: plan je zastareo kad prođe njegov Topstep dan (trejder: „A, A, A") |
| 29.09.2026 | posle F | Trejder ulazi uglavnom market nalogom („uradi sva tri"): (1) trejd upisan posle prvog fill-a meri R, rizik, planirani reward i MAE/MFE od prosečnog fill-a, ne od ukucane cene (view `risk_pts`, `20260930020000`; `plannedEntryOf`); (2) entry slippage se za njega ne navodi; (3) izlaz na stopu ili kroz njega = „Pogođen stop", target na ili preko = „Pogođen target" |
| 30.09.2026 | posle F | Probna knjiga (10 trejdova, 2 promašaja, zastareo plan, brief i dnevni izveštaj za 23.09) uneta u bazu i proverena na telefonu i na PC-u: brojevi tačni. Ispravljeno: tooltip-i čitljivi u tamnoj temi, equity kriva prati balans, slippage chart od nule, zapažanja po grani pravila, Survival samo za naloge iz filtera, heatmap otvara najnovije nedelje, mentor export (mentalno /5, R2 ishod promašaja, bez duplih tabela, kratki nazivi pravila, oznaka market ulaza). Probni podaci obrisani |
| 30.09.2026 | posle F | Breakeven po R (trejder: „Da, uradi breakeven po R“): na Topstep nalogu trejd je scratch ako je neto unutar ±0,1R **svog** rizika do stopa; bez stopa, i za dan/nedelju, ostaje ±0,1R početnog budžeta plana (±$25/38/56). Razlog: ceo stop na 1 MES ugovoru (−1,13R, −$22,25) padao je u ±$25, pa je expectancy pokazivao +1,27R umesto +0,91R |
| 30.09.2026 | posle F | „Delete all data“ briše i fajlove slika iz Storage-a (`trade-images/<uid>/`, posle redova). Fabrička podešavanja (`20260930030000`): nalog ostaje bez Topstep režima; Entry TF 30s/1m/2m/5m/15m/1h; ručna pravila trackera = trejderova sopstvena (7) uz 11 automatskih; folderi Plan sesije, Osvrt na sesiju, Trade Notes, Nedeljni osvrt sa intraday šablonima. Postojeći podaci se ne menjaju |
| 30.09.2026 | posle F | Nov playbook odmah dobija tri prazne sekcije: „Zašto ulazim?“, „Gde ulazim?“, „Gde izlazim?“ (trejder). Pravila ispod njih piše trejder; sekcije se menjaju i brišu kao i sve druge. Postojeći playbook-ovi se ne menjaju |
| 30.09.2026 | posle F | Log Trade: slika ulaza (`ltf_pre`) uz sliku izlaza. Trejd bez exita se čuva kao otvoren (samo fill ulaza); TopstepX uvoz ga upari po vremenu i ceni ulaza, doda exit i zatvori, i upiše razlog izlaska ako ga trejd nema (undo ga briše). Na nalogu preko MLL-a otvoren trejd se odbija kao plan |
| 30.09.2026 | posle F | Slike charta kao lista (trejder: „jedan plus, koliko hoću“): „+ Add chart“ u Log Trade, pregledu uvezenog trejda, novoj i postojećoj formi; do 20 po trejdu, redom (`sort_order`). Tri fiksna slota (HTF pre / LTF pre / LTF post) i jedinstveni indeks po slotu uklonjeni (`20260930050000`); spajanje trejdova prenosi sve slike |
| 30.09.2026 | posle F | Spajanje trejdova ima dva načina: „isti trejd upisan dvaput“ (fill-ovi se zamene, kao ranije) i „dve pozicije, jedan trejd“ (fill-ovi se saberu: 2 + 2 = 4 ugovora). Podrazumevano sabiranje kad su fill-ovi oba trejda iz uvoza (`20260930060000`). Povod: trejder spojio dva reda TopstepX izvoza i dobio 2 umesto 4 ugovora |
| 30.09.2026 | posle F | Dan se zaustavlja na novcu, ne na broju trejdova (trejder: „ne treba uopšte da se ograniči broj trejdova, nego max daily loss i max daily profit, kao na Topstepu; i MLL"). Odgovori: `stop_after_losses` i tilt zapažanje **se brišu** zajedno sa `max_trades_per_day`; lični dnevni limit gubitka i cilj profita su **polja na Topstep nalogu + pravila** (lični DLL zamenjuje DLL plana gde je uži; novo pravilo `no_entry_after_daily_target`); **Risk % na Topstep-u = rizik ÷ prostor do MLL-a na ulazu** (`room_at_entry`). Spojeni MNQ trejd od 30.09. ostaje kako je upisan. Migracija `20260930070000`; brief (`racun.py`) računa isto |
| 30.09.2026 | posle F | Isplata (trejder: „da buffer pada sa isplatom, a MLL ostaje gde je stao"). Provereno na Topstep pravilima: MLL prati balans na kraju dana i staje na početnom balansu (150K: od 145.500 do 150.000); posle prve isplate MLL = početni balans, a isplata izlazi iz balansa. Journal je do sada isplatu samo datumom zaključavao pod, a balans nije smanjivao — prostor i budžet rizika bili bi preveliki. Sada: isplata = cash event tipa Payout / Withdrawal na Topstep nalogu, oduzima se od balansa, prva je i datum isplate; brief isto. Bez migracije |
| 30.09.2026 | L | Šta bi bilo (trejder): SL × TP mreža L1 (SL 0,5–2× stvarnog, TP 1–5R), horizont L2 do kraja Topstep dana (15:10 CT), L3 isti rizik u $ (rezultat u R varijante), L4 posle izlaza 15/30/60 min + kraj dana, posle stopa da li je pukao TP i koliki SL je trebao. Migracija `20260930080000` (`scenario`) |
| 30.09.2026 | R | Rizik (trejder, posle pregleda oba repoa i simulacije `testovi/rizik/nalog.py`): **R1** rizik po trejdu 8 % prostora i **R2** lični DLL $1.200 dok journal nema 30+ trejdova — podešavanja naloga (Settings › Accounts › Topstep, TopstepX Risk Limits), ne kod; podrazumevanih 12,5 % se ne menja (na njemu stoji breakeven pojas, K4). **R3** donja granica rizika (`risk_rule_min` / min plana) važi samo dok je prostor ≥ trećine MLL-a plana (150K: $1.500); ispod toga rizik je čist procenat prostora. **R4** veličina u ugovorima uračunava 1 tik proklizavanja stopa po ugovoru, uz proviziju u oba smera |
| 30.09.2026 | posle R | Backup (trejder: „i backup i readme reši“, Opus stavke kasnije): noćni snimak svih 28 tabela i slika charta u R2 (`futures-trading/tools/journal_backup.py`, 04:10 BG), provera čitanjem nazad, 35 dana + prvi snimak meseca; vraćanje = SQL u jednoj transakciji bez okidača, provereno na bazi iz svih migracija. README oba repoa: zastareli brojevi ispravljeni (migracije, testovi po projektu, metrike, dimenzije, jezik, fajlovi) |
| 30.09.2026 | posle R | Nivoi (trejder: „svi bitni nivoi u brief, šta je London pokupio a šta je ostalo, weekly i monthly, Azija“): **posebna poruka posle Londona** (05:12 NY = 11:12 BG), **oba PDH/PDL** (RTH i ceo Topstep dan), **NQ i ES**. Definicije iz istraživanja (`testovi/profil_dana`, `sweep_nivoi`, `london_ny`); pokupljen = prošao nivo za tik. Samo `futures-trading` (`tools/brief/nivoi.py`), journal se ne menja |
| 30.09.2026 | posle R | London u poruci (trejder: „do kad London traje samo do 11 BG?“ → „Oba“): **London jutro** 08–11 BG u 11:12 i **London do NY** od 09:00 BG (08:00 po Londonu) u 15:15 BG, pred otvaranje |
| 30.09.2026 | S | „Šta bi bilo“ realno (trejder: „napravi plan za šta bi bilo i to samo popravi“): **S1** TP i planirani limit ulaz važe tek kad cena prođe nivo za 1 tik — dodir nije izvršenje. **S2** stop u mreži košta 1 tik proklizavanja (isto kao R4 u veličini). **S3** ulaz promašenog setupa je limit kad je cena pri pisanju plana s druge strane ulaza, inače stop-ulaz (dodir). **S4** scenario v2; stari v1 se sam preračuna, promašaji jednom ručno (`--recompute`) |
| 30.09.2026 | T | Faza naloga (trejder: pravi nalog je **50K Combine**, 150K je praksa; put isplate „ne znam još“; samo TopstepX; 50K kupljen sa DLL-om; „da, kreni“): **T1** `tj_accounts.topstep_stage` combine / xfa (podrazumevano combine — ništa se ne menja dok se ne izabere XFA). **T2** XFA Scaling Plan: najviše mini ugovora po balansu na početku sesije (kraj prethodnog Topstep dana). **T3** XFA nema „passed“ ni 55 %: prate se OBA puta isplate od poslednje isplate (Standard: 5 dana ≥ $150; Konzistentnost: 3 dana, najbolji ≤ 40 % neto profita) i najveća isplata (50 % balansa, limit po planu i putu, min $125). **T4** DLL plana ostaje u računu i na XFA (oprezno; trejder ga ima). **T5** brief računa isto |
| 01.10.2026 | T | Practice (trejder: „kako da razlikujem practice nalog od combine i xfa“): treća faza `practice` u istoj migraciji (još nije bila primenjena) — **pravila kao Combine**, ništa se ne „prolazi“; **statistika odvojeno** (podrazumevano samo pravi nalozi, Practice u filteru naloga sa oznakom „(practice)“ — urađeno na svim stranicama; /daily, tracker i playbooks čitaju samo prave naloge); **brief i podsetnik samo pravi nalozi** |
| 01.10.2026 | U | Poeni i tikovi na dashboardu (trejder: „da ovde dodamo tick i point“): **U1** poen trejda = neto (ili bruto, po prekidaču) u $ ÷ vrednost poena ugovora — **puta broj ugovora** (2 MNQ × 10 poena = 20), pa zbir prati $; tik isto ÷ (vrednost poena × tik). **U2** NQ i ES nisu ista jedinica: na dashboard dolazi **filter instrumenta** po porodici (MNQ uz NQ, MES uz ES, M6E uz 6E); Points / Ticks rade kad su svi trejdovi u izboru iz jedne porodice, inače su siva |
| 02.10.2026 | V | Pregled od Claude-a (trejder: „da Claude vidi moj journal sa rutinom … week review, daily, trejdove, notes“): **V1** posebna poruka „📓 Pregled dana“, **V2** nedelja subotom ujutru, **V3** samo pravi nalozi, **V4** dan bez trejdova bez poruke osim kad postoji dnevni izveštaj. Paket se sklapa samo u journal-u (jedno mesto računa), futures-trading ga preuzima preko rute sa Bearer tokenom; rutina ne dobija pristup bazi |
| 03.10.2026 | R | Podrazumevani rizik 8 % (trejder: „8 % koristim, 12,5 treba obrisati gde god da piše — to je zastarelo“). Zamenjuje deo odluke R1 od 30.09. („podrazumevanih 12,5 % se ne menja“): `TOPSTEP_DEFAULT_RISK_PCT` = 8, isto `racun.py` (`RIZIK_PCT`) i paritetni `topstep-parity.json`; default kolone `tj_accounts.risk_rule_pct` 8 (migracija `20261003010000`). Oba naloga su već imala 8, pa se njihov broj ugovora ne menja. Posledica: breakeven pojas bez stopa (K4) je 0,1 × 8 % × MLL = **±$16 / 24 / 36** (50K/100K/150K, bilo ±25/38/56); trejd sa stopom se i dalje sudi po svom riziku. Kante „Risk %” u izveštajima oko 8 % (< 5, 5–8, 8–10, 10–15, 15–20, ≥ 20). Forma trejda i podešavanja naloga više nemaju zakucanih 12,5 |
| 08.10.2026 | M | Mentor tok (trejder: „weekly skroz da ga više nema, daily skrati, preuredi mentor pack“): refleksija (zatvaranje dana / nedelje, pravila) seli se u privatni repo `trading-mentor`, gde Claude ispituje trejdera prema mentor pack-u. Journal meri i izvozi, ne sudi. **M-a** `/weekly` (pregled, eksperimenti, Napredak) se briše sa tabelama `tj_weekly_reviews` i `tj_experiments`, **bez arhive** (ostaje noćni backup). **M-b** focus goal se briše sa tabelom `tj_focus_goals` (dupliran sa „domaćim“ iz `trading-mentor`). **M-c** /daily = brief, mentalna ocena, „ne trgujem“, tracker, review gaps, zaključavanje |
| 08.10.2026 | posle M | Tracker pravila (trejder, sa mentorom; podaci, ne kod): penzionisana ručna „Provera kalendara i HTF-a“, „Mentalni check-in“, „Vreme trgovanja“, „Kontrola rizika“, „Walk Away Target“ (dupliraju automatska ili su nemerljiva); nova ručna: HTF nivoi i bias, vreme 03:00–16:00 ET, **dva SL zaredom = kraj dana** (isti dan trejder traži automatsko: `stop_after_two_losses`, fiksno 2, gubitak = ispod breakeven pojasa, migracija `20261008140000`; ručno penzionisano), iskreni tagovi. Lični DLL 650 namerno ostaje (prostor za provizije) |
| 08.10.2026 | O | Prvo uvoz, pa dopuna iz snimka (trejder, OBS snimak sesije): **O-a** propušteni setupi ostaju kroz malu formu iz snimka; **O-b** `/trades/new` i `/trades/log` se uklanjaju; **O-c** TopstepX izvoz trejdova i naloga se uvoze odjednom. Test trejdera 08.10. (Practice, SL niže → BE): izvoz naloga čuva samo POSLEDNJU cenu stopa — originalni stop dolazi iz fajla samo kad nije mogao biti pomeren, inače sa snimka |
| 09.10.2026 | W | Vremenski stop (trejder: „da meri koliko je dobitnom trejdu trebalo da krene, a koliko je gubitni bio u minusu dok nije udario SL — da sečem vremenski“). **W1-A** „krenuo u smeru“ = u plusu i više se nije vratio ispod ulaza (ne +X tikova ni +0,5R). Merenje u `futures-trading` `journal_mae.py` iz istih R2 sveća kao `time_underwater_pct`; journal samo čita. Kolona lestvice „Losers still open“ je gornja granica — da li je gubitnik u minuti N bio u minusu ne čuva se |
| 14.10.2026 | P | Jedna stranica trejda (trejder: „ima nepotrebnih stvari jer se sad unose trejdovi preko importa … napravi detaljan plan da to rešiš sa jednom stranicom“). Bias dana, Entry TF i Technical tags **ostaju**; stavke za biranje trejder preuređuje sam u Settings. Odluke P-1 … P-3 su u sekciji P |
| 14.10.2026 | Y | Vreme upisa (mentor Z-028, Z-031, Z-032; trejder: „A, A, A, A“): **Y-1 A** `playbook_linked` pada kad je playbook napravljen posle ulaza; **Y-2 A** kolona `tj_daily_reports.mental_temp_at` (aditivna migracija); **Y-3 A** kapija posle prvog ulaza je samo oznaka na /daily i u paketu; **Y-4 A** zaključani dani ostaju zamrznuti |
| 15.10.2026 | Y | Proširenje Y (trejder preko mentora: „reši i ovo“): **preokreće Q-2 „Vreme trgovanja: povučeno“** — novo automatsko pravilo `trading_window`, prozor po Beogradu u Settings › Tracker jer se nedelje smenjuju London / NY. **Y-5** London 09:00–12:00, NY **14:30–18:00** (trejder). **Y-6 A** prozor pamti od kog dana važi (`config.windows[]` sa `since`), pa promena ne preocenjuje prošle dane. `honest_tags` dobija uslov „Vodio po planu“ bez playbook-a ili sa playbook-om posle ulaza → ✗. Pravilo za dane u nedelji se ne pravi (od 19.10. pon–pet, pravila već važe 1–5) |
| 15.10.2026 | J | Jezik (trejder preko mentora: „sve na srpskom“, gramatika svuda): naslovi kategorija u kodu idu na srpski kao u bazi; u paketu pobeđuje naziv polja iz baze; fabrička lista = lista trejdera od 15.10.2026; tagovi koje kod čita doslovno se ne menjaju; kategorije lista (`Context` …) ostaju |
| 15.10.2026 | J | Posle J (trejder: „ostatak ostaje“): ostatak interfejsa (/reports okvir, dashboard, Settings, /import) ostaje na engleskom, kako README „On language“ kaže; faza za ceo interfejs na srpskom se ne radi |
| 14.10.2026 | P | **P-1** fill-ovi se ne menjaju ručno nigde; ručno se upisuje samo originalni SL sa snimka (trejder: „samo SL treba ja da upišem jer ako ga pomerim na BE u toku trejda onda se ne slaže na uvozu“). **P-2** ocena izvršenja A/B/C svuda. **P-3** promena playbook-a briše odgovore na pravila prethodnog playbook-a; meko obrisana pravila istog playbook-a ostaju |
| 17.10.2026 | D | Bias dana (trejder: „karticu daily bias … da se meri koji mi je winrate u predviđanju biasa … i koji bi winrate bio da je uvek long“): **D-1 A** pogodak = neto pomeraj od početka do kraja merenja uz neutralni opseg; **D-2** početak = kasnije od 09:00 BG i trenutka upisa, kraj 18:00 BG (upis posle 18:00 se ne ocenjuje); **D-3** Neutral je prognoza, Gore/Dole na neutralan dan je promašaj i za trejdera i za uvek long; **D-4** opseg bira mentor, fiksno u kodu, bez Settings (trejder: „nek radi u pozadini i nek bude podešeno“); **D-5** NQ, ES, GC, mikro deli bias sa mini; **D-6** kartica zamenjuje polje „Bias dana“ na trejdu. Radi se direktno na `main`, migracija se primenjuje posle zelenog gate-a (trejder: „odmah ide na glavnu granu … da odmah bude primenjeno na produkciju“) |
| 26.10.2026 | X | Neutralan journal (trejder: „skroz ćemo izbaciti bilo kakva pravila iz journala, ne može da bude vezan za prop firmu … ja sam taj koji poštuje ili ne pravila“; prelazak na Tradeify). Faza **X**: plan napisan. Odluke istog dana: **X-1 B** (tracker samo proces — „ako bude više naloga na prop firma biće konflikta“), X-2 … X-6, X-8, X-9 **A**, **X-7** uvoz univerzalan (prepoznaje format, i TopstepX i NinjaTrader), **X-10** brief „na kraju“. NinjaTrader uvoz (AddOn šalje svaki fill preko HTTPS-a, red kad nema mreže — trejderu se „svidja“) je posebna faza posle X |
| 26.10.2026 | B | Brzi unos (trejder: „što manje ručnog rada po pojedinom trejdu, a praviti jedan dnevni izveštaj zatvaranjem dana“; „1A, 2 ne, 3 ne, 4 da“): bez detekcija koje traže novčani limit ili broj trejdova, bez auto grafika i audio priloga; X4 migracija puštena, faza B pre X5–X7 |
| 27.10.2026 | E | Bez biasa dana (trejder: „Ne koristim više bias dana — market ne može da se predvidi, nego se trguje uz njega, uz reakciju.“): predviđanje smera izlazi iz celog toka journala, kao pravila prop firme u X. Kartica, ocena iz sveća, panel, paket i pravilo `htf_bias_set` odlaze; `tj_daily_bias` i `custom.htf_bias` ostaju kao istorija. Jutarnja poruka (🧠 Sklonost) čeka odgovor trejdera |
| 27.10.2026 | G | Put do profesionalca (trejder posle poređenja journala sa `trading-transkripti/PUT-DO-PROFESIONALCA.md` i Lance-ovim dnevnim izveštajem, transkript 032; „ništa ne ubacujemo njegovu karticu u kompletu nego predloži … optimizovano za mene“ → „Da, prepiši plan faze G ovako i kreni redom“): **G-1** Propušten setup (ulaz/stop/cilj, ishod u R) odlazi, zamenjuju ga do 3 prilike dana (jedna najlakša); **G-2** mentalna ocena 1–5 odlazi → san %, sati sna, smena, dete; **G-3** pravilo „bez ulaza prvih 10 min“ London i NY; **G-4** „1 trejd dnevno“ samo merenje (30.09. ostaje); **G-5** NY prozor 14:30–17:30 od 28.10.; **G-6** vesti i tip dana se ne rade; **G-7** cilj procesa je ručno pravilo trackera (bez koda), od kartice samo „sutra menjam“; size po oceni i nedelji samo u paketu; backtest = Practice nalog |

Nova odluka se upisuje ovde pre koda, sa datumom. Ako odluka nedostaje, agent PITA trejdera i ne
pogađa.

## Kako nastaviti (nova AI sesija)

1. Grana: `main` — od F1 (28.09.2026) trejder je tražio da se radi direktno na `main`, bez posebnih
   grana; `claude/journal-swing-to-day-trading-a49d56` je ostala na stanju pre F1. Isti naziv grane
   postoji i u `0xsickre/futures-trading`; F2 tamo ne menja kod (vidi F2 → „Utvrđeno u kodu").
2. Pročitaj ovaj fajl ceo, pa `AGENTS.md` (Next.js 16 — dokumentacija u `node_modules/next/dist/docs/`),
   pa README sekcije koje faza navodi.
3. Radi **samo prvu fazu u Mapi čiji status nije ✅ ni ⛔** (⛔ = trejder obustavio — ne dirati bez njegovog novog naloga), po Protokolu. Ako faza nema sekciju
   „Detaljno", prvo je napiši ovde, odluke koje traže trejdera upiši kao pitanja i stani.
4. Na kraju faze: status ✅ + hash commita u Mapi, detaljan plan SLEDEĆE faze, README 1:1, push.
5. Stani i traži jači model ako faza ispadne veća od procene (kolona Model).

## Mapa faza

| Faza | Cilj | Stavke | Zavisi od | Migracija | Model | Status |
|---|---|---|---|---|---|---|
| **F1** | Tačnost odmah: ono što danas pogrešno ocenjuje, a ne traži nijednu veliku odluku | #2, #5, #21 | — | ne | Sonnet | ✅ `c0077e1` (28.09.2026) |
| **F2** | Topstep dan (17:00 → 17:00 CT) kao ključ dana svuda gde se dan broji | #1 | F1 | ne (D2-A: izvedeno iz `topstep_mode`) | **Opus** | ✅ `3644c05` (28.09.2026) |
| **F3** | Topstep pravila u tracker-u i Survival-u | #3, #4, #6 | F2 | da: `20260928160000` (`risk_budget_at_entry`) | **Opus** | ✅ `a8e63f9` (28.09.2026) — migracija primenjena 28.09.2026 uz odobrenje trejdera |
| **H1** | Uklanjanje FTMO / MT5 / swing koda (trejder, 28.09.2026) | #19 i delovi #13, #14 | F3 | ne (kolone ostaju) | **Opus** | ✅ `09752cd` · `69e5124` · `67feff6` · `0fb9d3f` (28.09.2026) |
| **F4** | Dnevni tok: pred-sesija umesto check-in-a, forma, kategorije, nova auto pravila | #7, #8, #9, #10 | F2, F3 | da: `20260929100000`, `…110000`, `…120000`, `…130000` | **Opus** | ✅ `80fceea` · `6dcf72b` · `94796d1` · `4dba3e9` + `132ce35` (futures-trading), 29.09.2026 — migracije primenjene uz odobrenje trejdera |
| **H2** | Brisanje ostataka iz baze: check-in tabela, `time_stop_days`, swap, % pragovi, backtest grana | — | F4 | da, **briše**: `20260929140000` … `…190000` (šest) | **Opus** | ✅ `b3b6d7e` · `01eaf8b` · `9434f05` · `49dda83` · `cbca316` · `0cb6f55` + `c72f61d` (futures-trading), 29.09.2026 — migracije primenjene uz odobrenje trejdera |
| **K** | Zahtevi trejdera od 29.09.2026: redosled pravila, tagovi na srpskom, uvoz puni plan, fiksni breakeven, vremenska zona, slike charta | — | H2 | da: `20260929200000`, `…210000`, `…220000`, `…230000` | **Opus** | ✅ `31030a9` · `286cc06` · `df91b1c` · `65d0817` · `576f574` · `a232849`, 29.09.2026 — migracije primenjene |
| **F5** | Intraday analitika: sesija, trajanje u minutima, insights, uzorak | #11–#13, #15, #17, #18 (#14 zatvorio H2) | K | da: `20260929235000` (`time_underwater_pct`), `20260930000000` / `…000100` (`baseline_trades`) | Sonnet, Opus za #13 | ✅ `2e59f2e` · `5095e43` · `3183236` · `20f9626` + `8c35148` (futures-trading) · `ea0461b` · `d9ccf9c` · `8dff0cf`, 29.09.2026 — migracije primenjene |
| **F6** | Nasleđe i `futures-trading`: cena promašaja iz R2, ostaci vault-a, komentari, PARITY | #16, #20, #22, #23 (#19 zatvorili H1/H2) | F5 | da: `20260930010000` (`no_entry`, `r2`) | Sonnet, Opus za #16 | ✅ `16c3a04` + `a59307d` (futures-trading) · `e515552` · `a5a8ff3` · `db9c3b3` + F6.5, 29.09.2026 — migracija primenjena |
| **L** | Šta bi bilo: SL × TP mreža, posle izlaza, posle stopa — iz berzanskih sveća | — | F6 | da: `20260930080000` (`scenario`) | **Opus** | ✅ `89915aa` · futures-trading `f60b5ea`, 30.09.2026 — migracija primenjena |
| **R** | Rizik blizu MLL-a i proklizavanje stopa u veličini (journal + brief isto) | — | L | ne | **Opus** | ✅ `7f14d81` · futures-trading `2870b3d`, 30.09.2026 — bez migracije |
| **S** | „Šta bi bilo“ i cena promašaja realno: TP / limit ulaz kroz nivo, tik na stopu | — | L, R | ne | **Opus** | ✅ `95c63e7` · futures-trading `aacc20b`, 30.09.2026 — bez migracije |
| **T** | Faza naloga Combine / XFA: Scaling Plan, oba puta isplate, bez „passed“ na XFA (journal + brief) | — | S | da: `20260930090000` (`topstep_stage`) | **Opus** | ✅ 30.09.2026 — migracija `20260930090000` primenjena |
| **U** | Poeni i tikovi na dashboardu + filter instrumenta (NQ / ES) | — | T | ne | **Opus** | ✅ 01.10.2026 — bez migracije |
| **V** | Pregled dana / nedelje od Claude-a: isti „Export for Claude“ paket preuzima futures-trading i šalje rutini | — | U | ne | **Opus** | ⛔ obustavljeno (trejder, 02.10.2026) — ne raditi bez novog naloga trejdera |
| **M** | Mentor tok: bez /weekly, kraći /daily, compliance bez praznih dana, pun mentor pack (Dan / Nedelja) | — | U | da, **briše**: `tj_weekly_reviews`, `tj_experiments`, `tj_focus_goals` | **Opus** | ✅ 08.10.2026 — M1 `d6391df` · M2 `8076b93` · M3 `6be8e87` (migracija `20261008120000` primenjena) + futures-trading `6827ce7` · M4 `786a035` |
| **O** | Prvo uvoz, pa dopuna iz snimka: izvoz naloga (stop, cilj, izlaz), dopuna iz snimka, propušten setup, bez plan-forme | — | M | da: `20261009090000` (aditivna) | **Opus** | ✅ 08.10.2026 — O1 `af9c0cc` (migracija `20261009090000` primenjena) · O2 `c15dc20` + futures-trading `bc1f28d` · O3 `800474d` · O4 `95222f9` |
| **W** | Vremenski stop: koliko dobitniku treba da krene, koliko gubitnik stoji u minusu do SL | — | O | da: `20261009120000` (`last_underwater_seconds`, aditivna) | **Opus** | ✅ `bff96eb` + futures-trading `b8c9da1`, 09.10.2026 — migracija `20261009120000` primenjena uz odobrenje trejdera |
| **P** | Jedna stranica trejda: snimak, checklist, kategorije i review na jednom mestu; bez plan-forme | — | O, W | ne | **Opus** | ✅ `1f8a832`, 14.10.2026 — bez migracije; ručna provera u pregledaču preskočena na zahtev trejdera |
| **Q** | Manje ručnog rada: ručna pravila trackera postaju automatska, /daily javlja trejd bez naloga | — | P | da: `20261014120000` (`auto_key` check, pravila) | **Opus** | ✅ 14.10.2026 — Q-1 = C, Q-2 (5 automatski, Vreme trgovanja povučeno), Q-3 = A |
| **N** | Sesije trejdera umesto „Globex noć“: osam sesija kao linije na chartu, minuti od otvaranja sesije, sva vremena u paketu i na /daily po Beogradu | — | Q | ne | **Opus** | ✅ 14.10.2026 — N-1 = A, N-2 = A, N-3 = A; bez migracije |
| **Y** | Vreme upisa: playbook i checklist napisani posle trejda, kapija pre sesije upisana posle prvog ulaza | — | N | da: `20261014200000` (`mental_temp_at`), `20261015090000` (`trading_window`) | **Opus** | ✅ 14.10.2026 — Y1 `14a992f` · Y2 `7281007` · Y3 `80dee18` · Y4/Y5 `9de8441` (migracije `20261014200000`, `20261015090000` primenjene); Y-1 … Y-4 = A, Y-5 NY 14:30–18:00, Y-6 = A |
| **J** | Jezik: nazivi kategorija u paketu, /reports i gridu na srpskom; fabrička lista tagova = lista trejdera | — | Y | da: `20261015120000` (nova definicija `tj_seed_categories`, podaci se ne menjaju) | **Opus** | ✅ 15.10.2026 — J1 `61f5c79` · J2 `c415355` (migracija `20261015120000` primenjena) |
| **D** | Bias dana: prognoza pre sesije na /daily, ocena iz 1m sveća, moj winrate prema „uvek long“ | — | J | da: `20261017120000` (`tj_daily_bias`, aditivna) | **Opus** | ✅ kod 18.10.2026 — `a7456ed` · D1 `8af430f` · D2 `18d7077` · D4 `fcdf8ee` · D5+D6 `293067b` + futures-trading `adb046c`; migracija `20261017120000` primenjena 18.10.2026 |
| **X** | Journal bez pravila prop firme: bez Topstep mašine, MLL/DLL plana, Survival-a i banera; tvoji limiti na nalogu, CME dan | — | D | da: aditivna (neutralne kolone) + **briše** `topstep_*` (uz odobrenje) | **Opus** | ✅ 27.10.2026 — X1–X9 isporučeni; migracije `20261026120000`–`…140000`, `…180000`, `…190000`, `20261027090000` (brisanje `topstep_*` / `risk_rule_*`) primenjene |
| **B** | Brzi unos: trejd ~30 s (checklist „Zašto ulazim“, kraće liste, TF po playbook-u, automatske greške), psihologija i zatvaranje dana na /daily | — | X4 | da: aditivne (TF playbook-a, psihologija dana), podaci (liste, tekst pravila) | **Opus** | ✅ 27.10.2026 — B1–B8 isporučeni; migracije `20261026150000`, `…160000`, `…170000`, `20261027100000` primenjene; pregled koda `b83cef7` |
| **E** | Bez biasa dana: bez kartice, ocene, panela, pravila `htf_bias_set` i greške „Bez biasa“; staro polje read-only | — | B | da, podaci: penzionisanje pravila, tekst `review_complete`, polje `htf_bias` gasi se, fabrička lista bez biasa (uz odobrenje) | **Opus** | ✅ 27.10.2026 — `504a3f0` + futures-trading `c3168eb`; migracija `20261027120000` primenjena 27.10.2026 uz odobrenje trejdera |
| **G** | Put do profesionalca: stanje pre sesije (san, smena, dete), „sutra menjam“, prilike dana umesto Propuštenog setupa, prvih 10 min, NY do ručka, size po oceni u paketu | — | E | da: `20261027140000` (aditivna + podaci, uz odobrenje) | **Opus** | 🔄 27.10.2026 |
| **I** | Univerzalni uvoz: format se prepoznaje po zaglavlju (TopstepX, NinjaTrader, Tradovate), zapamćeno mapiranje za nepoznat CSV; posle toga NinjaTrader AddOn | — | E | da, aditivna: tabela zapamćenih mapiranja (I2) | **Opus** | ⏸ plan 27.10.2026 — čeka primere izvoza od trejdera |

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
- **H1.4** `0fb9d3f` — metrika `total_swap` (38 → 37), red „Swap per holding day" i insight
  `swap_ate_the_trade` (24 → 23 pravila). Red „Swap" u kartici Costs ostaje, ali se prikazuje samo
  kad opseg ima swap (mapa #14): na CFD istoriji bi inače provizije bez njega davale pogrešan zbir
  ispod sebe. Swap po fill-u, `swap_long/short/triple_day` u katalogu instrumenata i swap u neto P&L-u
  ostaju. `PARITY.md`: FTMO → Topstep u §6 i §8, `total_swap` izbačen iz §1.
- Procentualni tracker pragovi ostaju: backtest nalog nije Topstep i čita ih.

## F4 — Dnevni tok za day tradera (detaljno) — ✅ `80fceea` · `132ce35` (futures-trading) · `6dcf72b` · `94796d1` · `4dba3e9`

**Isporučeno po odlukama G1–G11 (29.09.2026).** Van plana ili drugačije od predloga:
- Rad posle `3ba08d7` iz prethodne sesije nije bio pushovan i izgubljen je; F4 je urađen ponovo od
  `main`, podkorak po podkorak, svaki pushovan čim je bio zelen.
- **Time stop je kolona `time_stop` (tekst, 5 vrednosti), ne `time_stop_minutes`** — vidi dnevnik.
- **Brief ne upisuje link** (`source_url` ostaje prazan): HTML živi u repou `futures-trading`, a link na
  GitHub prikaz HTML-a pokazuje izvorni kod, ne stranicu. Kolona ostaje za kasnije.
- **Crveni prozori uključuju i vesti važne samo za 6E** (brief ih tako prikazuje; G7 = „samo prozori iz
  brief-a"); `impact` ih označava sa „6E …". Ako NQ/ES ulaz u 6E prozoru ne treba da pada, to je nova
  odluka.
- Provera migracija: lokalni Postgres 16 sa redovima žive knjige — sve četiri se primenjuju i ponovo
  primenjuju čisto; CHECK za `count` odbija 0, 1,5, 21 i „2"; upsert brief-a menja isti red pod RLS-om,
  drugi korisnik ne vidi ništa; seed nove knjige daje 14 pravila i 58 stavki.
- **Primenjeno na živu bazu 29.09.2026** (odobrio trejder): u bazi zabeleženo kao `session_briefs`,
  `day_trading_tracker_rules`, `day_trading_categories`, `time_stop`. Stanje posle: 4 nova auto
  pravila (count 2), 3 ručna penzionisana, „Walk Away" ostao; stavke dodate, swing stavke ugašene.
- Gate zelen, 3.003 testa (+39 u odnosu na 2.964 posle H1); `futures-trading`: 32 unit testa, ruff.

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

### Podkoraci F4 (29.09.2026, posle odluka G1–G11)

Svaki podkorak: test koji pada → kod → gate → **commit + push odmah** (rad posle `3ba08d7` je jednom
izgubljen jer nije bio pushovan). Migracije se pišu u podkoracima, a primenjuju zajedno na kraju, uz
odobrenje trejdera. Kod mora raditi i PRE primene: čitanje tabele koje nema daje „brief nije stigao",
ne pad stranice (Vercel objavljuje `main` odmah).

| Korak | Šta | Repo | Status |
|---|---|---|---|
| F4.1 | `tj_session_briefs` (migracija: tabela, RLS, reset lista); `session-brief.ts` (čist: red → brief, prozori, `flat_by` sa podrazumevanih 15:10 CT); upit; kartica **„Pred sesiju"** na `/daily` (raspon NQ/ES, crveni prozori, kraj dana; „brief nije stigao" kad reda nema); opis `/daily` bez swing teksta | journal | ✅ kod; migracija `20260929100000` primenjena 29.09.2026 |
| F4.2 | `brief.py`: prozori kao UTC trenuci (`prozor_utc`), red za journal (čista funkcija + test), `Journal.upsert`, upis posle HTML-a; `--bez-journala` i u probi; greška upisa ne ruši brief (glasno u izlazu) | futures-trading (`main`) | ✅ `132ce35` |
| F4.3 | Auto pravila `max_trades_per_day`, `stop_after_losses` (config `count`, po nalogu, G9), `flat_by_close` (Topstep kraj dana iz brief-a, inače 15:10 CT), `no_entry_in_red_window` (samo brief, G7; bez brief-a `na/no_brief`); kontekst `briefOf` + `now` za sve pozivaoce (i zaključavanje dana); Settings menja `count`; migracija: CHECK, 4 pravila za postojeće knjige i seed, penzionisanje 3 ručna (G8) | journal | ✅ kod; migracija `20260929110000` primenjena 29.09.2026 |
| F4.4 | Kategorije (G4-A, G10): migracija dodaje day-trading stavke i gasi swing stavke; seed za nove knjige | journal | ✅ migracija `20260929120000` primenjena 29.09.2026 |
| F4.5 | Time stop u minutima + „do kraja sesije" (G3-A); `time_stop_days` se više ne nudi (briše ga H2) | journal | ✅ kod; migracija `20260929130000` primenjena 29.09.2026. Kolona je `time_stop` (tekst: `5`/`15`/`30`/`60`/`close`), ne celobrojni `time_stop_minutes` — vidi dnevnik |
| F4.6 | README 1:1, `futures-trading` README, ROADMAP, plan: F4 ✅ i detaljan plan H2; primena migracija uz odobrenje | oba | ✅ |

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

## H2 — Brisanje ostataka iz baze (detaljno) — ✅ 29.09.2026

**Ulaz:** `main` posle F4 (`4dba3e9`), gate zelen (3.003 testa). **Odluka (29.09.2026):** trejderu ne
trebaju check-in tabela, `time_stop_days`, swap (fill, katalog, neto P&L) ni % tracker pragovi, a ni
backtest nalozi — samo Topstep. **Za razliku od H1, ovde se briše iz BAZE** (nepovratno): migracija se
piše, proverava na lokalnom Postgres-u sa redovima žive knjige, a primenjuje tek uz izričito odobrenje.

### Utvrđeno u bazi i kodu (29.09.2026, samo čitanje)

- **Podataka nema, gubitka nema:** 0 redova u `tj_position_checkins`, 0 trejdova sa `time_stop_days`,
  0 fill-ova i 0 instrumenata sa swap-om, 0 trejdova sa `risk_pct`, 0 FTMO naloga. Backtest nalog je
  jedan, arhiviran i prazan („Backtesting XAUUSD").
- **Ali ih šest SQL funkcija i view referencira** — pre `DROP COLUMN` svaka se prepisuje:
  `tj_merge_positions`, `tj_replace_executions`, `tj_save_trade`, `tj_undo_import_batch`,
  `tj_reset_my_data`, `tj_seed_instruments_defaults`, i view `tj_position_stats` (neto =
  bruto − provizije − swap). View: `DROP VIEW` → `DROP COLUMN` → `CREATE VIEW` →
  `security_invoker = on` (README § Migrations), a njegov TypeScript blizanac `position-stats.ts` i
  test koji ih drži zajedno menjaju se u istom koraku.
- Kod: `swap_funding` u `trade-form`, `scale-out-editor`, `import-wizard`, `costs.ts`,
  `instrument-costs.ts`, `instrument-manager`, `cost-defaults.ts`; `time_stop_days` u
  `plan-snapshot`, `merge-positions`, `trade-input-schema`, `reserved-keys`, `import/actions`;
  % pragovi u `tracker/auto-rules.ts` (`evalPct*`), `equity-ladder.ts`, `tracker-types.ts`
  (`AUTO_RULES_NEEDING_PCT`), Settings → Tracker; `account_kind` i TradingView backtest uvoz.
  Novčani moduli imaju 100 % coverage prag — brisanje ide sa njihovim testovima.

### Podkoraci (svaki: test koji pada → kod → gate → commit + push; migracija na kraju)

| Korak | Šta |
|---|---|
| H2.1 | `tj_position_checkins`: `DROP TABLE`; iz `tj_merge_positions` i `tj_reset_my_data` (lista po imenu) |
| H2.2 | `time_stop_days`: kod (pečat, spajanje, uvoz, šema, rezervisani ključevi), `tj_merge_positions`, `tj_save_trade` (ako ga imenuje), `DROP COLUMN` + CHECK |
| H2.3 | Swap: view i `position-stats.ts` (neto = bruto − provizije), `tj_replace_executions`, `tj_undo_import_batch`, seed instrumenata; kolone `tj_executions.swap_funding`, `tj_instruments.swap_*`, `tj_accounts.default_swap_per_day`; UI (forma, uvoz, katalog) |
| H2.4 | % pragovi i ne-Topstep grana tracker-a: evaluatori samo po Topstep planu; `max_loss_per_week` (Topstep nema nedeljni limit) i `pct` config po odluci I4 |
| H2.5 | Backtest i ostatak FTMO-a po odlukama I5 |
| H2.6 | README 1:1, plan: H2 ✅ i detaljan plan F5 |

### Odluke koje traži trejder (pre koda)

- **I1 — Obim brisanja iz baze.** (A) sve četiri grupe odjednom (check-in, `time_stop_days`, swap,
  % pragovi) u jednoj migraciji posle svih podkoraka; (B) svaka grupa svoja migracija, primenjena čim
  je njen podkorak zelen. Preporuka: **B** — manji korak, lakše vraćanje ako nešto zapne.
- **I2 — FTMO kolone na nalogu** (`ftmo_mode`, `ftmo_*`, 12 kolona; H1 je obrisao samo kod). Obrisati
  i njih u H2? Preporuka: **da** — 0 FTMO naloga.
- **I3 — Swap u neto P&L-u.** Posle H2 neto = bruto − provizije. Na fjučersu je isto kao danas (swap je
  0); CFD istorije nema. Potvrdi.
- **I4 — Pravilo `max_loss_per_week`.** Topstep nema nedeljni limit, a bez % pragova pravilo nema šta da
  meri. (A) penzionisati ga (`deleted_at`, istorija ostaje); (B) nedeljni limit u dolarima kao novo
  podešavanje. Preporuka: **A**. Uz to: `risk_pct` kolona i lista „Risk %" — obrisati (0 trejdova ih ima)?
  Preporuka: **da**.
- **I5 — Backtest.** (A) obrisati `account_kind` (svaki nalog je Topstep/trading), TradingView backtest
  uvoz i arhivirani prazan „Backtesting XAUUSD"; (B) zadržati TradingView replay fjučersa kao backtest
  (MAE/MFE iz R2 ga već meri, 1-minutne sveće). Preporuka: **B ako ćeš ikad raditi replay na
  TradingView-u, inače A** — to je tvoja odluka.

### Izlaz iz H2

- Gate zelen; migracije primenjene uz odobrenje; README 1:1 (Data model, Migrations, Costs, Import,
  Process tracking, Reset); ovde H2 ✅ i detaljan plan F5.

### H2 urađeno (29.09.2026)

| Korak | Commit | Migracija | Šta |
|---|---|---|---|
| H2.1 | `b3b6d7e` | `20260929140000` | `tj_position_checkins` obrisana; spajanje i reset bez nje (28 tabela) |
| H2.2 | `01eaf8b` | `20260929150000` | `time_stop_days` obrisan; spajanje popunjava `time_stop` |
| H2.3 | `9434f05` | `20260929160000` | Swap iz fill-ova, kataloga, naloga, view-a (neto = bruto − provizije) i UI-ja |
| H2.4a | `49dda83` | `20260929170000` | Novčana pravila tracker-a samo po Topstep planu; `max_loss_per_week` i `pct` obrisani; tri pravila na srpskom. **Usput nađen bag iz F4:** `parseConfig` je čitao samo `pct`, pa `max_trades_per_day` i `stop_after_losses` nikad nisu bili ocenjeni — sada čita `count` |
| H2.4b | `cbca316` | `20260929180000` | `risk_pct`, lista „Risk %", podrazumevani rizik playbook-a, grana veličine po % equity-ja u formi, metrika `risk_intent_gap` |
| H2.5 | `0cb6f55` + `c72f61d` (futures-trading) | `20260929190000` | `account_kind`, prekidač Live/Backtest u izveštajima, TradingView uvoz (i njegov MAE/MFE), 11 `ftmo_*` kolona; prazan „Backtesting XAUUSD" obrisan (bio je AKTIVAN, ne arhiviran kako je plan pisao), „Topstep-practice" postao podrazumevani nalog. `journal_mae.py` prestao da čita `account_kind` pre brisanja kolone |

Ostaje (namerno): `tj_import_rows.excursion_written` i grana `clear_excursion` u
`tj_undo_import_batch` — za batch-eve pre H2; `excursion_source = 'tradingview'` nije ni na jednom
trejdu.

## K — Zahtevi trejdera od 29.09.2026 (detaljno) — ✅ 29.09.2026

**Ulaz:** `main` posle H2 (`0cb6f55`), gate zelen (2.855 testova). Trejder je tokom H2 poslao šest
zahteva; rade se pre F5 jer ih je tražio izričito, jedan commit po zahtevu.

| Korak | Zahtev (trejderovim rečima, skraćeno) | Plan |
|---|---|---|
| K1 | „pravila koja idu automatski uvek ispod ovih što se čekiraju, i kad se nova dodaju" | `TrackerStageSection`: ručna pravila prva, automatska ispod, `sort_order` važi unutar grupe. Samo prikaz na `/daily` |
| K2 | „sve tagove koji postoje prevesti na srpski" | Migracija: `label` stavki seed lista (Technical tags, Exit reason, Miss reason, Emotion, Discipline, Mistake) i nazivi lista/polja na srpski; `value` ostaje (trejdovi ga čuvaju kao tekst) — ili se prevodi i `value` uz UPDATE trejdova. **Proveriti** kako grid i filteri čitaju `value` vs `label` pre odluke; `tj_seed_categories` isto |
| K3 | „ako uvezem trejd preko CSV-a, u planned treba da se popune TP, SL i entry, ako ga pre nisam uneo" | Novi trejd iz uvoza: `entry_price` = prosečan ulaz, `stop_price` i `target_price` iz fajla kad ih ima (TopstepX nema stop kolonu — proveriti koje kolone izvoz nosi), pa pečat plana. Postojeći trejd: ne dira se (README § Import: „Stop. Not imported" važi za MERGE) |
| K4 | „breakeven range po defaultu, profesionalan, da se ne može menjati" | Predlog: **±1 tik × broj ugovora × vrednost tika, plus provizija** — trejd čiji je neto unutar troška jednog tika je scratch. Jednostavnija alternativa: fiksno ±$10 po ugovoru. Polja u Settings postaju read-only tekst |
| K5 | „timezone ne kucam — uvek moja evropska zona; sistem sam prepoznaje zonu CSV-a" | `Europe/Belgrade` podrazumevano za nalog i prikaz; polje u Settings bez kucanja. Uvoz: vreme sa offset-om (TopstepX) se čita tačno; vreme bez offset-a se čita u zoni naloga. **Topstep dan (17:00 CT) ostaje ključ dana** bez obzira na zonu prikaza |
| K6 | „da se mogu čuvati slike za chartove, a ne linkovi" | Supabase Storage bucket (privatan, RLS po korisniku), upload u `trade-images`/quick-log, `tj_trade_images.image_url` → putanja u storage-u + potpisani URL za prikaz; TradingView link ostaje kao opcija |

## F5–F6 (detaljno)

### K urađeno (29.09.2026)

| Korak | Commit | Migracija | Šta je urađeno |
|---|---|---|---|
| K1 | `31030a9` | — | `/daily`: ručna pravila prva, automatska ispod, u svakoj fazi |
| K2 | `286cc06` · `335106b` | `20260929200000` | Stavke i VREDNOSTI tagova na srpskom (i na postojećim trejdovima); Long/Short, ICT skraćenice, FOMO, ocene i TF ostaju. `NO_MISTAKE` = „Bez greške", razlozi izlaza u `quick-log.ts` na srpskom |
| K3 | `df91b1c` | — | Nov trejd iz uvoza: entry iz fill-ova, SL/TP iz S/L i T/P kolona. **TopstepX „Trades" izvoz nema stop ni target**; uvoz „Orders" izvoza se NE pravi (trejder, 29.09.2026) |
| K4 | `65d0817` | — | Breakeven fiksan: ±0,1R početnog budžeta rizika plana — ±$25 (50K), ±$38 (100K), ±$56 (150K); Settings ga samo prikazuje |
| K5 | `576f574` | `20260929210000`, `…230000` | `DEFAULT_TZ` = Europe/Belgrade, nalog i seed prebačeni; zona se ne kuca; fajl sa offset-om se konvertuje; Topstep dan ostaje 17:00 CT |
| K6 | `a232849` | `20260929220000` | Slike charta: upload / paste iz clipboard-a / TradingView link; privatni bucket po korisniku, `storage:<uid>/<fajl>`, potpisani URL |

### F5 — Intraday analitika (detaljno, napisano 29.09.2026 posle H2)

**Ulaz:** `main` posle K. **Cilj:** izveštaji, insights i tekstovi mere dan tradera u minutima i
sesijama, ne u danima i nedeljama.

**Utvrđeno u kodu (29.09.2026):**
- `reports/dimensions.ts`: vremenske dimenzije su `month`, `dow_entry`, `entry_hour`, `dow_exit`,
  `hold_duration` (korpe iz `hold-time.ts`: `<1d`, `1–3d`, `3–7d`, `1–2w`, `>2w` — na day trading-u
  SVAKI trejd pada u `<1d`). Nema sesijskog prozora, minuta od otvaranja, rednog broja u danu.
- `progress.ts` već računa redni broj trejda u danu i „trejd posle gubitka" za Napredak — logika
  postoji, samo nije dimenzija.
- `insights/registry.ts` → `OMITTED_RULES`: `most_time_in_drawdown`, `deep_in_drawdown_day`,
  `patience_paid_off` isključeni zbog „nema feed-a"; R2 sveće sada postoje.
- `co-exposure.ts` meri preklapanje u **danima** i korelaciju po danima zatvaranja („40–70 trejdova
  godišnje" u komentarima); `risk-ratios.ts` izvodi periode godišnje iz podataka (ostaje).
- `mentor-export.ts` (33 srpska stringa) pita swing pitanja.

**Podkoraci:**

| Korak | Šta | Fajlovi |
|---|---|---|
| F5.1 ✅ | Korpe trajanja u minutima: `<1m`, `1–5m`, `5–15m`, `15–60m`, `>60m`; prikaz min:s. `avgDays`/`maxDays` → `avgMinutes`/`maxMinutes`, `durationDays` → `durationMinutes`, filter `duration_minutes`. `tilt_week` čita minute uz staru granicu od 1440 (dan) — zamenjuje ga F5.3 | `hold-time.ts`, `units.ts`, `reports/dimensions.ts`, `insights/trade-rules.ts` (`exceed_avg_hold_time`) |
| F5.2 ✅ | Nove dimenzije `session_window`, `minutes_from_open`, `trade_no_in_day`, `after_loss` (`session-window.ts`; polja `sessionWindow`, `openOffset`, `tradeNoInDay`, `lossStreakBefore` u `EnrichedTrade`). Ključ je `session_window`, ne `session`: korisnik može da ima svoje polje sa ključem `session`, a registar dimenzija ga tada ne bi uzeo | `reports/dimensions.ts`, `progress.ts` |
| F5.3a ✅ | Insights intraday bez novih podataka: `revenge_trade` 5 min na istom nalogu; `overtrading_day` i `low_efficiency_day` umesto nedeljnih (10 dana istorije); `tilt_after_losses` umesto `tilt_week` (L3: svaki ulaz posle 2 gubitka zaredom tog dana na nalogu, sa minutima do ponovnog ulaza, ugovorima, R, novcem i prosekom R van tilta); `patience_paid_off` vraćen (zeleni dan, prvi ulaz 30+ min posle 09:30 ET). Nivo „week" više nema pravila | `insights/*`, `registry.ts`, `session-window.ts` (`minutesAfterOpen`) |
| F5.3b ✅ | `most_time_in_drawdown` i `deep_in_drawdown_day`: udeo vremena „pod vodom" po trejdu (tekući P&L < 0) računa `futures-trading` `journal_mae.py` iz istih R2 sveća i upisuje u `tj_positions.time_underwater_pct` (migracija `20260929235000`); journal ga samo čita. Prag 75 % za oba; dan samo kad je svaki trejd izmeren. Već izmereni trejdovi dobijaju vrednost jednom, sledećim pokretanjem. `maximize_your_profit_day` ostaje izostavljen (`gave_back_profit` pokriva) | migracija, `journal_mae.py`, `insights/*` |
| F5.4 ✅ | Eksperiment: prozor „pre" = poslednjih **40 trejdova** zatvorenih pre početne nedelje (`baseline_trades`, 10–500; odluka trejdera 29.09.2026: „Trejdovi"), „posle" = svi trejdovi od početka; kartica datira „pre" po trejdovima. Tekstovi o uzorku bez „40–70 trejdova godišnje" (`uncertainty.ts`, `scorecard.ts`, kartica Scorecard, `book-overview.tsx`); `co-exposure.ts` ide u F5.5. `lang-count` više ne broji „Pre-open" kao srpsko | `experiments.ts`, `experiment-card.tsx`, migracije `20260930000000` / `…000100` |
| F5.5 ✅ | Co-exposure u minutima (intervali iz vremena fill-ova, preklapanja istog instrumenta se broje jednom; korelacija ostaje po trading danu zatvaranja). Otvoreni rizik Topstep naloga prema DLL-u preostalom danas: „25 % of DLL left ($400)", crveno od 100 % | `co-exposure.ts`, `portfolio-heat.ts`, `co-exposure-panel.tsx`, `open-positions-widget.tsx` |
| F5.6 ✅ | Mentor export za day tradera (trejder: „da bude što bolje za AI da zna sve što treba"): uputstvo i legenda za CME fjučers na Topstep-u; stanje Topstep naloga (MLL, DLL, konzistentnost, pravilo rizika); pravila trackera i usklađenost; oblik dana u statistici; dnevni pregled (prvi ulaz ET, niz gubitaka, ulazi posle 2+ gubitka, ugovori, pravila, DLL, crveni prozori, mentalno); tabele po sesiji/minutima/rednom broju/stanju/trajanju/satu/danu sa ⚠ ispod 10; trejdovi hronološki sa vremenom u tvojoj zoni i ET i celim intraday kontekstom | `mentor-export.ts`, `mentor-intraday.ts`, `dashboard.tsx` |
| F5.7 | README 1:1, plan F5 ✅ i detaljan plan F6 | — |

**Odluke koje traži trejder (pre koda):**
- **L1 — Granice sesijskih prozora (ET).** ✅ prihvaćeno 29.09.2026: Globex noć 18:00–08:00,
  pre-open 08:00–09:30, otvaranje 09:30–10:00, jutro 10:00–11:30, ručak 11:30–13:30, popodne
  13:30–15:00, poslednji sat 15:00–16:00 (Topstep kraj 15:10 CT = 16:10 ET).
- **L2 — Korpe trajanja.** ✅ prihvaćeno 29.09.2026: `<1m`, `1–5m`, `5–15m`, `15–60m`, `>60m`.
- **L3 — Tilt.** ✅ 29.09.2026: **2** gubitka zaredom u istoj sesiji, na istom nalogu (trejder: „Ok 2").
  Insight ne zabranjuje ništa — meri cenu: R sledećeg trejda, minute do ponovnog ulaza, broj ugovora,
  i koliko je to koštalo u dolarima, u odnosu na trejdove koji ne dolaze posle niza gubitaka.

**F5 urađeno (29.09.2026).** Svi podkoraci ✅ (tabela iznad). Izvan plana: F5.3 je podeljen na
F5.3a (pravila bez novih podataka) i F5.3b (vreme „pod vodom" iz R2 — nova kolona i
`journal_mae.py`); F5.4 je tražio odluku trejdera (eksperiment u trejdovima, 40 pre početka); F5.6 je
proširen na zahtev trejdera („da AI zna sve što treba"): stanje Topstep naloga, pravila i usklađenost,
dnevni pregled, crveni prozori. Usput: `lang-count` više ne broji „Pre-open" kao srpsko. Gate zelen,
2.906 testova. Prvo pravo pokretanje `journal_mae.py` posle F5.3b (29.09. uveče) upisalo je vreme
pod vodom za sva četiri trejda, dopunilo jedan stariji.

### F6 — Nasleđe i `futures-trading` (detaljno, napisano 29.09.2026 posle F5)

**Ulaz:** `main` posle F5. **Cilj:** poslednja mesta gde journal još govori ili meri kao swing
knjiga, i cena promašenog setupa za fjučerse.

**Utvrđeno u kodu (29.09.2026):**
- **#19 je zatvoren.** H1 je uklonio FTMO mod, MT5 uvoz i `mt5_excursion.py`, H2 backtest nalog,
  TradingView replay i `ftmo_*` kolone; u knjizi nije bilo nijednog CFD trejda. „Legacy (CFD)" u
  UI-ju nema šta da prikaže — stavka ostaje u katalogu samo kao istorija.
- **#16:** `missed-cost.ts` ume da sabere `missed_r`, ali ga niko ne piše od H1 (izvor je bio MT5).
  `tj_positions.missed_outcome` / `missed_r` / `missed_source` postoje (`20260921140000`); panel
  danas kaže „N promašenih, nijedan izmeren". R2 sveće (1 s) i `journal_mae.py` već postoje.
- **#20:** dva insight-a čitaju polja vault ciklusa: `against_macro_bias` (`macro_align`) i
  `cot_chase` (`cot_filter`), plus kolona `cot_filter` i polje `macro_align` u `custom`.
  README § „Where this sits" i dalje opisuje vault (makro bias, COT) kao izvor konteksta; za day
  trading kontekst daje `futures-trading` brief. `stale_plan` smatra plan zastarelim posle
  **14 dana** (`STALE_PLAN_DAYS`), a plan day tradera važi jedan trading dan.
- **#22:** reč „swing" je još u komentarima 21 fajla (`survival.ts`, `period-stats.ts`,
  `activity.ts`, `costs.ts`, `excursion-scan.ts`, `form-config.ts`, `dashboard.tsx`, …). Deo je
  istorija („went with the swing book, H1") i ostaje; deo tvrdi da je knjiga swing i ide.
- **#23:** `PARITY.md` (259 redova) i `docs/formulas-audit.md` (504) opisuju stanje pre F5: bez
  sesija, trajanja u minutima, intraday insights-a, vremena pod vodom.

**Podkoraci:**

| Korak | Šta | Fajlovi |
|---|---|---|
| F6.1 ✅ | Cena promašenog setupa iz R2 (#16): `journal_mae.py` hoda od trenutka plana do kraja njegovog Topstep dana (ili do M1 prozora) i piše `missed_outcome` / `missed_r` / `missed_source = 'r2'`; journal samo čita | `futures-trading/tools/journal_mae.py`, `missed-cost.ts`, CHECK `missed_source` (migracija ako `'r2'` nije dozvoljen) |
| F6.2 ✅ | Vault ostaci (#20) po odluci M2; `stale_plan` po odluci M3; README § „Where this sits" → brief | `insights/process-rules.ts`, README |
| F6.3 ✅ | Komentari (#22): prepisati one koji tvrde da je knjiga swing; istorijske ostaviti | 21 fajl |
| F6.4 ✅ | `PARITY.md` i `docs/formulas-audit.md` (#23): sesije, minuti, intraday insights, pod vodom, co-exposure u minutima, DLL | `PARITY.md`, `docs/formulas-audit.md` |
| F6.5 ✅ | README 1:1, F6 ✅ — kraj Faze F | — |

**Odluke koje traži trejder (pre koda):**
- **M1 — Cena promašaja: kad setup „vredi".** (A, preporuka) Samo ako je cena **dodirnula ulaz**
  plana posle trenutka plana; onda šta je prvo dodirnuto od toga: stop (−1R) ili target (+plan R);
  ništa do kraja Topstep dana → „neither", 0. Promašaj koji nikad nije došao do ulaza nije koštao
  ništa i broji se odvojeno („nije ni došlo do ulaza"). (B) Bez uslova ulaza: od trenutka plana, šta
  je prvo dodirnuto, stop ili target.
- **M2 — Vault polja.** (A, preporuka) `against_macro_bias` i `cot_chase` se gase, `macro_align` i
  `cot_filter` ostaju u bazi za istoriju, bez prikaza u formi; bias dana dolazi iz brief-a
  (`htf_bias`, F4). (B) Ostaju ako još koristiš vault za dnevni pravac.
- **M3 — Zastareo plan.** (A, preporuka) Plan je zastareo kad prođe njegov Topstep trading dan
  (17:00 CT) a nije ni otvoren ni označen promašenim. (B) Fiksno N sati.

**Pročitati pre koda:** README § Learning („The missed setup gets a price"), § MAE/MFE;
`futures-trading` README § MAE/MFE.

**F6 urađeno (29.09.2026).** Sva četiri podkoraka po planu, odluke M1–M3 = A. Izvan plana: M2-A nije
tražio promenu forme — polja `macro_align` / `cot_filter` već nisu postojala kao definicije polja u
bazi, pa su dva insight-a samo uklonjena. Gate zelen, 2.907 testova; `futures-trading` 43.

## Faza F — završeno (29.09.2026)

Svaka stavka kataloga #1–#23 je isporučena ili svesno zatvorena (#14 i #19 u H1/H2). Journal meri
intraday Topstep knjigu: Topstep dan, pravila i veličinu u novcu plana, dnevni tok sa brief-om,
analitiku u minutima i sesijama, cenu promašaja i vreme pod vodom iz berzanskih sveća. Nova
sesija koja otvori ovaj fajl nema otvorenu fazu; novi zahtevi trejdera idu kao nova faza ili kao
zahtev u stilu K, sa odlukama u dnevniku pre koda.

**Otvoreno van koda:** Cloudflare Worker (precizan okidač poslova u `futures-trading`) nije objavljen —
korak objave traži tajne `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GH_DISPATCH_TOKEN`; do tada
brief, `pokretaci` i `popodne` zavise od GitHub cron-a, koji kasni satima ili preskače.

## L — Šta bi bilo: SL × TP, posle izlaza, posle stopa (detaljno, 30.09.2026)

**Zahtev trejdera:** „kako da merim da li je posle TP-a cena išla još, da li sam trebao da držim; na kom TF-u koji SL i TP;
i da se meri posle SL-a da li je cena otišla u moj pravac i pukla TP — sve što je bitno.“

**Utvrđeno u kodu (pre L):** MAE/MFE (`futures-trading/tools/journal_mae.py`) meri samo od ulaza do poslednjeg izlaza, pa
posle TP-a nema šta da pokaže; „Capture %“ i „Target %“ čitaju isti prozor. Promašeni setup (F6.1) već ima hod kroz 1m
sveće do kraja Topstep dana sa dvosmislenom minutom na 1 s (`prosetaj`) — L to koristi, ne pravi drugi sistem.
Backtestovi u `futures-trading/testovi` mere nasumične ulaze i nivoe (sweep, OR, Turtle Soup), ne OB / FVG / OTE — pravi
odgovor za trejderove setupe može doći samo iz njegovih trejdova.

### Odluke (trejder, 30.09.2026)

- **L1 — mreža:** SL 0,5× / 0,75× / 1× / 1,25× / 1,5× / 2× stvarnog stopa; TP 1 / 1,5 / 2 / 2,5 / 3 / 4 / 5 R te varijante (42 ćelije).
- **L2 — horizont:** do kraja Topstep dana (15:10 CT); ni SL ni TP → zatvara se po ceni u 15:10 CT.
- **L3 — poređenje:** isti rizik u $ — širi SL = manje ugovora; rezultat svake ćelije je u R TE varijante.
- **L4 — posle izlaza:** 15 / 30 / 60 min i do kraja dana: najdalje u pravcu trejda i protiv, u poenima (R se računa
  u journalu iz rizika trejda). Plus: posle SL-a da li je cena pogodila planirani TP (i za koliko minuta), a za svaki
  trejd koliki je SL bio potreban da preživi do planiranog TP-a.

### Tehničke odluke (bez uticaja na trejderov izbor, zapisane radi ponovljivosti)

- Scenario kreće od **prosečne cene ulaza** u trenutku **prvog ulaznog fill-a**; stop je **zapečaćeni stop** (plan na ulazu),
  target zapečaćeni target. R scenarija = |prosečan ulaz − stop|. Delimični izlazi i dodavanja se ne modeluju — scenario
  pita „šta da je ceo ulaz imao ovaj SL i TP“.
- Sveće: 1m tog Topstep dana (deli ih svaki trejd tog dana, ~$0,005 po ugovoru i danu), ostatak minute ulaza i izlaza na
  1 s, dvosmislena minuta (i SL i TP) na 1 s; dvosmislena sekunda = **stop** (konzervativno — nikad pogođen dobitak).
- Računa se tek kad se Topstep dan trejda završi i Databento objavi (8 h), samo tačni podaci (bez Yahoo privremenih).
  Trejd bez stopa se preskače (nema R).
- Upis: `tj_positions.scenario` (jsonb, verzija 1, izvor `r2`, ugovor, rezolucija); journal ga samo čita.

### Podkoraci

1. **L.1 futures-trading:** čist modul `tools/scenario.py` (mreža, posle izlaza, posle stopa, potreban SL) sa unit
   testovima na veštačkim svećama; `journal_mae.py` ga poziva za zatvorene trejdove sa stopom posle kraja dana.
2. **L.2 migracija** `20260930080000`: `tj_positions.scenario jsonb` (+ tipovi, rezervisani ključ, šema, spajanje ga ne nosi).
3. **L.3 journal logika** `src/lib/journal/scenario.ts`: čitanje/provera jsonb-a, agregat mreže (prosečan R po ćeliji,
   broj trejdova, % pogodaka), najbolja ćelija uz prag uzorka, poređenje sa stvarnim R, statistike posle izlaza i posle stopa.
4. **L.4 prikaz:** kartica „Šta bi bilo“ na trejdu (posle izlaza, posle stopa, mreža tog trejda); panel „SL × TP“ u
   `/reports` sa grupisanjem po setupu (playbook), Entry TF-u, sesijskom prozoru, instrumentu i smeru, uz postojeće filtere;
   mentor pack dobija sažetak.
5. **L.5 dokumentacija 1:1**, gate, push, primena migracije.

### Izlaz iz L

Za svaki zatvoren trejd sa stopom: 42 „šta da je“ ishoda, pomeranje cene posle izlaza, da li je posle stopa došao TP i
koliki je SL trebao. U izveštajima: koja kombinacija SL × TP daje najviše R po setupu i TF-u, sa oznakom malog uzorka
(ispod 30 trejdova po grupi je hipoteza, ne nalaz).

## R — Rizik blizu MLL-a i proklizavanje stopa (detaljno, 30.09.2026) — ✅ `7f14d81` · `2870b3d` (futures-trading)

**Povod:** pregled oba repoa (30.09.2026). Simulacija naloga 150K, 60 dana, ishod 45 % × 1,5R: sa 12,5 % prostora i
DLL-om $2.000 nalog padne u ~30 % simulacija, sa 8 % i $1.200 u ~14 %. Journal još nema nijedan trejd, pa prednost nije
izmerena. Odluke R1–R4 u dnevniku.

**Utvrđeno u kodu (pre R):**
- `computeTopstepRisk` (`plan-calculations.ts`) i `racun.rizik` (brief): `min(max(prostor × %, min), max, DLL danas, prostor)`.
  Donja granica važi i kad je prostor mali: $400 prostora na 150K → rizik $180, 45 % onoga što je ostalo.
- `computeFuturesContracts` i `racun.ugovora`: gubitak po ugovoru = stop × vrednost poena + 2 × provizija. Stop koji
  prokliza tik ne ulazi; tracker posle toleriše +10 % (E3-B). Na ES stopu od 2 poena jedan tik je +12,5 % gubitka.
- Iste dve funkcije zovu: forma trejda (veličina i par mini/micro), `riskBudgetAt` (budžet na ulazu za tracker),
  `expectedContracts` u tracker-u (`risk_matched_intent`), brief (tabela ugovora, šum po zoni), PDF uputstvo i
  simulacija naloga.

### Izmena

- **R3:** `computeTopstepRisk` dobija `minFromRoom` — prostor od kog važi donja granica; ispod njega
  `min(prostor × %, max, DLL danas, prostor)`. Prag = `topstepMinRiskFromRoom(pravila)` = MLL plana ÷ 3
  (50K $666,67, 100K $1.000, 150K $1.500). `racun.rizik` isto (`min_od`, obavezan argument, `racun.min_od(plan)`).
- **R4:** `computeFuturesContracts` dobija `tickSize`: gubitak po ugovoru = stop × vrednost poena + 2 × provizija
  + `STOP_SLIPPAGE_TICKS` (1) × tik × vrednost poena. Forma čita tik iz kataloga, tracker `tick_size_at_trade`
  (zamrznut na trejdu). Bez tika (instrument van kataloga bez `tick_size`) proklizavanje je 0 — stari račun, ne pogađa
  se. Brief: `racun.TIK` (CME tik po simbolu), `racun.po_ugovoru` jedino mesto formule; ista formula u tabeli, šumu po
  zoni, PDF-u.
- Bez migracije. Zapečaćen `risk_budget_at_entry` se ne menja; trejd bez pečata čita izvedeni budžet po novom pravilu,
  a „Sized to intent" (`expectedContracts`) broji sa tikom — na nezaključanim prošlim danima očekivan broj ugovora
  ponekad je za jedan manji; zaključani ostaju. Baza na 30.09.2026 nema nijedan trejd.
- **Simulacija** (`futures-trading/testovi/rizik/nalog.py`): sa R3 rizik blizu MLL-a teži nuli, pa nalog skoro nikad ne
  dotakne MLL — a trgovati se ne može. Zato najmanji trejd = 1 MNQ na stopu od 10 poena (sa provizijom i tikom); kad ga
  prostor ne nosi, nalog je **zaglavljen** (broji se kao pad u isplatama); preživeo nalog sa prostorom ispod trećine MLL-a
  je **oslabljen**. 150K, 8 % / $1.200, 45 % × 1,5R: 0 % pad, 2 % zaglavljen, 23 % oslabljen, cilj 32 % (pre R3 isto
  podešavanje: 14 % pad).

### Testovi (prvo padaju)

- `plan-calculations.test.ts`: prostor ispod praga → čist procenat; na pragu → min; proklizavanje (MNQ 10 poena, $562,5 →
  25, ne 26); bez tika → kao ranije.
- `topstep.test.ts`: prag po planu; `riskBudgetAt` blizu MLL-a.
- `racun.py --selftest`: isti primeri, isti brojevi.

### Izlaz iz R

Forma, tracker i brief daju isti broj ugovora, sa tikom proklizavanja; blizu MLL-a rizik pada sa prostorom. README oba
repoa 1:1, ovde ✅ + commit, `ROADMAP.md` jedan red.

## S — „Šta bi bilo“ realno (detaljno, 30.09.2026) — ✅ `95c63e7` · `aacc20b` (futures-trading)

**Povod:** pregled repoa (30.09.2026). Mreža SL × TP, „posle izlaza“ i cena promašenog setupa računaju TP i limit ulaz
kao izvršen čim ga cena **dodirne** (`high ≥ target`). Limit na dodiru se često ne izvrši (red čekanja na toj ceni), a
stop strana je već konzervativna (dvosmisleno = stop). Zato mreža sistematski precenjuje daleke TP-ove i uske stopove,
a promašaj izgleda skuplji nego što bi bio. Istraživanje u `testovi/` već računa ulaz i stop sa tikom.

**Utvrđeno u kodu (pre S):**
- `tools/scenario.py`: `_dodir` za stop i za target isto; `ishod`, `sl_za_target`, `posle_izlaza` čitaju target na dodir;
  stop u mreži je tačno −1R.
- `tools/journal_mae.py` (`korak`, `prosetaj`): ulaz promašaja na dodir (sa prethodnim zatvaranjem, za preskok), target
  na dodir, stop na dodir.
- Journal (`scenario.ts`) prepoznaje pogođen TP kao ćeliju jednaku `tp[j]`, stop ne prepoznaje po vrednosti — stop
  −1 − tik/R ne menja brojanje. Parser prima samo `v: 1`.

### Izmena
- **S1**: target (limit) = izvršen kad sveća prođe nivo za 1 tik (long: high ≥ TP + tik; short: low ≤ TP − tik). Isto
  za planirani limit ulaz promašaja (long: low ≤ ulaz − tik).
- **S2**: stop u mreži = −(1 + tik ÷ R te varijante). Rezultat „ništa do kraja dana“ ostaje po ceni u 15:10 CT.
- **S3**: vrsta ulaza promašaja iz cene u trenutku plana (otvaranje prve sveće): long sa cenom iznad ulaza (short:
  ispod) = limit → kroz nivo; inače stop-ulaz → dodir (sa preskokom, kao do sada).
- **S4**: `VERZIJA = 2`; `journal_mae.py` preračuna svaki scenario čija verzija nije 2. Journal prima v1 i v2 (isti
  oblik). Promašaji nemaju verziju: posle objave jednom Actions → Journal MAE/MFE → `recompute` (na 30.09.2026 baza
  nema nijedan promašaj).
- Ostaje isto: dvosmislena minuta na 1 s, dvosmislena sekunda = stop, „SL za TP“ = najveći pomak protiv pre prvog
  **izvršenja** TP-a + tik.

### Testovi (prvo padaju)
- `tests/test_scenario.py`: TP dodirnut tačno → ne računa se; tik preko → računa se; stop u mreži −1 − tik/R;
  posle stopa TP samo kroz nivo; verzija 2.
- `tests/test_alati.py` (promašaj): limit ulaz dodirnut tačno → `no_entry`; tik preko → ulaz; stop-ulaz na dodir;
  target kroz nivo.
- Journal: parser prima v2.

### Izlaz iz S
Mreža i promašaj računaju izvršenje kao na berzi: limit tek kroz nivo, stop sa tikom. README oba repoa 1:1, ovde ✅ +
commit, `ROADMAP.md` jedan red.

## T — Faza naloga: Combine / XFA (detaljno, 30.09.2026) — ✅

**Povod:** trejder je poslao pravila XFA (30.09.2026); provereno pretragom (help.topstep.com je iz okruženja blokiran,
pa preko više nezavisnih izvora — spisak u odgovoru trejderu). Pravi nalog je 50K Combine; XFA dolazi posle prolaza.

**Provereno (XFA):**
- Balans kreće od $0; MLL $2.000 / $3.000 / $4.500 ispod, prati balans na **kraju dana**, zaključava se na $0; posle
  prve isplate MLL = $0 zauvek. **Prati se uživo** (sa otvorenim P&L): dodir poda gasi nalog odmah — ne na kraju dana
  (tekst koji je trejder dobio to greši).
- **Scaling Plan** (mini; micro 10:1; novi limit važi od sledeće sesije):

| balans XFA | 50K | 100K | 150K |
|---|---|---|---|
| < $1.500 | 2 | 3 | 3 |
| $1.500–1.999 | 3 | 4 | 4 |
| $2.000–2.999 | 5 | 5 | 5 |
| $3.000–4.499 | 5 | 10 | 10 |
| ≥ $4.500 | 5 | 10 | 15 |

- **Isplate:** Standard = 5 dobitnih dana ≥ $150; Konzistentnost = bar 3 dana trgovanja i najbolji dan ≤ 40 % neto
  profita; brojanje kreće od poslednje isplate. Po zahtevu najviše 50 % balansa, limit Standard / Konzistentnost:
  50K $2.000 / $3.000, 100K $3.000 / $4.000, 150K $5.000 / $6.000; najmanje $125; 90 / 10.
- DLL opcion na TopstepX-u ($1.000 / $2.000 / $3.000); do 5 XFA naloga; 30 dana bez trejda = zatvaranje.

**Utvrđeno u kodu (pre T):** `topstep.ts` ima jedan skup pravila (Combine): `maxMini` fiksno po planu, status `passed`
na cilju sa 55 % pravilom, isplata samo kao događaj (balans, MLL). `racun.py` isto; `nalog.py` isplata max $2.000.

### Izmena
- **T1** migracija `20260930090000`: `tj_accounts.topstep_stage` text NOT NULL DEFAULT 'combine', CHECK (combine, xfa);
  tipovi, zapis šeme, `accounts.ts`, Settings (izbor „Faza“), dupliranje naloga je kopira.
- **T2** `evaluateTopstep`: na XFA `rules.maxMini` = nivo Scaling Plana za balans na kraju poslednjeg završenog
  Topstep dana (isplata ga spušta), `nextMaxMini` za sledeću sesiju. Forma trejda i tracker (`expectedContracts`,
  stanje na ulazu) čitaju taj broj; `topstepMaxContracts` ostaje za mini / micro.
- **T3** XFA: status samo `active` / `failed`; `xfa` = { od poslednje isplate: dobitnih dana ≥ $150, dana trgovanja,
  najbolji dan, neto profit, oba puta ispunjena ili ne, najveća isplata po putu }. Baner prikazuje to umesto cilja.
- **T4** DLL plana se i dalje računa (oprezno).
- **T5** `racun.py`: `stanje(..., faza)` isto (Scaling Plan u tabeli ugovora, linija isplate); `nalog.py` limit
  isplate po planu i putu.

### Testovi (prvo padaju)
- `topstep.test.ts`: nivoi Scaling Plana (granice), sledeća sesija, isplata spušta nivo; XFA nikad `passed`; Standard
  5 dana ≥ $150 od poslednje isplate; Konzistentnost 40 % i 3 dana; najveća isplata (50 %, limit, $125).
- `racun.py --selftest`: isti primeri.

### Izlaz iz T
Na XFA nalogu journal i brief ne predlažu više ugovora nego što Scaling Plan dozvoljava i pokazuju koji put isplate je
ispunjen. README oba repoa 1:1, ovde ✅ + commit, `ROADMAP.md` jedan red; migracija u bazi posle zelenog gate-a.

## U — Poeni i tikovi na dashboardu (detaljno, 01.10.2026) — ✅

**Povod:** prekidač `$ · % · Privacy` na dashboardu (trejder: „da ovde dodamo tick i point“). Points / Ticks su ranije
izbačeni jer portfelj više instrumenata nema jednu vrednost poena; odluke U1 i U2 to rešavaju.

### Izmena
- `futures-units.ts` (čisto): porodica instrumenta (mikro uz mini), faktor trejda (1 ÷ vrednost poena × kurs, za tik
  još ÷ tik) i trejdovi prevedeni u poene / tikove (neto, bruto, troškovi); `null` kad nekom trejdu fali vrednost.
- Dashboard: izbor instrumenta (samo kad ih ima više od jedne porodice) suzi trejdove na stranici; kapital (% i
  Topstep) ga ne prati. Points / Ticks dostupni kad je izbor jedne porodice; menjaju iste brojeve koje menja `%`
  (Net, Gross, Best, Worst, Max drawdown, Total costs, Avg daily DD, poslednji trejdovi, tabela po tagu); grafikoni
  ostaju u $. Prekidač i instrument se pamte kao ostatak opsega.

### Testovi (prvo padaju)
- `futures-units.test.ts`: porodice (MNQZ6 → NQ, MES → ES), faktor sa i bez tika, 2 MNQ × 10 poena = 20, mešano → null.
- `dashboard-view.test.ts`: opseg pamti points / ticks i instrument.
- `dashboard.render.test.tsx`: filter instrumenta, Points pokazuje „pts“, mešan izbor gasi Points.

## V — Pregled dana i nedelje od Claude-a (detaljno, 02.10.2026) — ⛔ obustavljeno

**Obustavljeno** (trejder, 02.10.2026: „obustavi, ne treba ništa“). Kod nije pisan. Plan i odluke ostaju zapisani
ako se trejder predomisli; nijedna sesija ne kreće na V bez njegovog novog naloga.


**Povod** (trejder, 02.10.2026): „da Claude vidi moj journal sa rutinom jednom i da da komentar na protekli dan — da
vidi moj week review i daily i moje trejdove i notes i sve". Dugme „Export for Claude" (`mentor-export.ts`) već pravi
pun paket (trejdovi sa beleškama i ocenama, dnevni izveštaj, tracker pravila i ispunjenje, Topstep stanje, brief,
propušteni setupi, zapažanja; brojevi izračunati u journal-u). Danas se paket sklapa samo u pregledaču
(`dashboard.tsx` → `handleExportMentorPack`). Cilj: isti paket, bez klika, svako veče rutini „Futures — poruke"
(futures-trading, `tools/claude_poruka.py`), koja uz njega ima i tržište dana, brief, vesti, dnevnik i svoju jutarnju
procenu — i trejder dobija „📓 Pregled dana" na Telegram; subotom nedelja sa nedeljnim pregledom.

**Princip:** jedno mesto računa. Paket se ne prepisuje u Python — futures-trading ga preuzima gotovog sa journal-a.
Rutina ne dobija pristup bazi; dobija samo tekst paketa (samo čitanje, kroz `/fire` payload).

### Izmena (predlog; posle odluka V1–V4)
1. **Sklapanje paketa iz dashboarda u čistu funkciju** — `lib/journal/mentor-compose.ts`:
   `composeMentorPack(podaci, opseg)` radi tačno ono što danas radi `handleExportMentorPack` (filtriranje po danu
   naloga, insights za opseg, Topstep stanje, compliance, brief, dnevni izveštaji). Dashboard je zove; ponašanje
   dugmeta se ne menja (test: isti Markdown pre i posle).
2. **Serverski loader** — `lib/journal/mentor-data.ts`: učita sve što paket traži istim upitima kao
   `app/(app)/page.tsx` (trejdovi sa statistikom, nalozi, cash eventi, dnevni izveštaji, field defs, tracker pravila
   i check-in-i, playbook pravila, user prefs, brief-ovi) + nedeljni pregled (`tj_weekly_reviews`).
3. **Nedeljni pregled u paketu** — nova sekcija „Nedeljni pregled" (ocena, šta je išlo dobro / loše, jedan obrazac,
   jedna promena, da li je prošla promena zadržana, katalizatori sledeće nedelje) kad opseg obuhvata nedelju; i na
   dugmetu.
4. **Ruta** — `app/api/mentor-pack/route.ts` (GET, `?od=YYYY-MM-DD&do=YYYY-MM-DD`): auth samo `Authorization: Bearer
   <Supabase access token>` (futures-trading se već prijavljuje tvojim nalogom, `journal_api.py`); RLS važi kao i u
   aplikaciji; odgovor `text/markdown`. Proxy (`src/proxy.ts`) ne preusmerava tu rutu na /login (ruta sama proverava
   token: bez važećeg → 401). Ne piše ništa u bazu. Pre koda: Next docs u `node_modules/next/dist/docs` za route
   handlere i proxy (AGENTS.md).
5. **futures-trading** (isti commit-niz, README 1:1 u oba repoa):
   - `podsetnik.yml` (22:20 BG): preuzme paket za taj Topstep dan i doda ga podacima rutini; rutina piše „📓 Pregled
     dana" (V1); paket ne ide u sirovu poruku ni u log;
   - nedeljno (V2): paket za nedelju + nedeljni pregled → „📓 Pregled nedelje" (spaja se sa subotnjim pregledom
     zapažanja iz `BAZA_PLAN.md` korak 3);
   - `RUTINA.md`: šabloni „📓 Pregled dana / nedelje" — kao mentor: plan prema izvršenju, pravila (tracker), emocije
     (dnevni izveštaj), stop / MAE, šta je bilo dobro i jedna stvar za popraviti; veže za tržište tog dana (linije od
     ponoći, vesti, Zona 3); bez izmišljanja, mišljenje sa 🧠;
   - tajna `JOURNAL_URL` (adresa journal-a na Vercel-u) u podsetniku.

### Odluke (trejder, 02.10.2026)
- **V1** Pregled dana je **posebna poruka** „📓 Pregled dana" posle podsetnika.
- **V2** Pregled nedelje **subotom ujutru**.
- **V3** **Samo pravi nalozi** (Combine / XFA), bez Practice — kao brief i podsetnik.
- **V4** Dan bez trejdova: **bez poruke**, osim kad postoji dnevni izveštaj (tada Claude komentariše njega).

### Testovi (prvo padaju)
- `mentor-compose.test.ts`: isti Markdown kao današnji izvoz za isti ulaz (snimak), filtriranje po danu naloga,
  Practice van opsega (V3).
- `mentor-pack` ruta: bez tokena 401, pogrešan token 401, ispravan → Markdown samo za vlasnika (RLS), opseg dana.
- Sekcija „Nedeljni pregled": prikazuje se kad je opseg nedelja, prazna polja se ne ispisuju.
- futures-trading: payload podsetnika sadrži paket; bez `JOURNAL_URL` ili na grešku rute → red sa razlogom, poruka
  ide; paket se ne ispisuje u log.

### Izlaz iz V
Trejder svako veče dobija „📓 Pregled dana" (i subotom nedelje) od Claude-a sa celim journal-om i tržištem dana;
dugme „Export for Claude" daje isti paket kao ruta; README oba repoa 1:1.

## M — Mentor tok (detaljno, 08.10.2026) — ✅

**Povod** (trejder, 08.10.2026): zatvaranje dana i nedelje radi sa Claude-om u privatnom repou `trading-mentor`
(ispitivanje, zapažanja, „domaći“), pa weekly pregled u journal-u postaje dupla evidencija, a daily treba da ostane
samo merenje. Mentor pack mora da nosi sve što mentoru treba za ispitivanje — i dan bez trejdova. Ovo je drugačiji
put od obustavljene faze V (nema rute ni rutine; trejder sam izvozi paket).

### Utvrđeno u kodu (08.10.2026)
- **Bug veličine:** `enriched-trade.ts` čita `position_size` (planirana veličina; prazna kod trejda upisanog posle
  ulaza i kod uvoza), a stvarni broj ugovora je `stats.entry_qty` — paket je pisao „Max ugovora —“ i
  „Prosečna veličina —“ za trejd sa 3 MNQ. Test fixture je postavljao oba polja, pa bug nije viđen.
- **„29 % na 3 dana“:** radni dan bez trejdova i bez štikliranja broji ručna pravila kao prekršena (0 %);
  `no_trade_day` ne utiče ni na šta iako forma kaže suprotno; današnji dan (`pending`) ulazi u prosek.
- `/weekly` je zatvoren klaster: van njega ga čita samo dimenzija „Week rating“ u `/reports`. Eksperimenti nemaju
  drugi dom. Focus goal živi samo na /daily.

### Podkoraci (svaki: test koji pada → kod → gate → commit + push)
- **M1** Brisanje `/weekly` (ruta, lib, komponente, testovi, nav, revalidate, „Week rating“ u /reports), README.
- **M2** /daily skraćen (bez focus goal-a, statistike dana i streak trake); compliance: `no_trade_day` gasi ručna
  pravila faze „trade“, prošli dan bez trejdova / check-in-a / izveštaja je „bez prijave“ (ne 0 %), `pending` dan
  ne ulazi u prosek.
- **M3** Migracija: `DROP` tri tabele + lock guard funkcije, `tj_reset_my_data` i `tj_delete_account` bez njih,
  rollback skripta, `types.ts`; futures-trading `journal_backup.py` bez tri tabele. Primena posle zelenog gate-a
  M1+M2 i deploy-a.
- **M4** Mentor pack: veličina iz `entry_qty`; fill-ovi po trejdu (učitani pri izvozu); plan prema kraju
  (pomeren stop); budžet rizika i prostor na ulazu; playbook; provizije; svaki radni dan u dnevnom pregledu;
  tracker po danu i crveni prozori dana; uputstvo po periodu (Dan = ispitivanje, Nedelja = pregled + domaći).
- **M5** `trading-mentor`: dnevni tok sa paketom za Dan; zapažanja Z-002 / Z-003.

### Izlaz iz M
Nema /weekly ni tabela; /daily je merenje; prosek pravila ne kažnjava dane bez sesije; paket za Dan i Nedelju
nosi veličinu, fill-ove, plan prema kraju i svaki dan sa trackerom; README 1:1.

## O — Prvo uvoz, pa dopuna iz snimka (detaljno, 08.10.2026) — ✅

**Povod** (trejder, 08.10.2026): ulazi marketom, stop stavlja ručno i pomera ga (i na BE), snima sesiju u OBS-u;
journal treba da radi samo uvoz TopstepX fajlova i dopunu iz snimka. Izvoz trejdova nema stop ni cilj; izvoz naloga
ima bracket, ali stop samo sa POSLEDNJOM cenom (test trejdera, 08.10).

**Pravilo za stop:** pomeren je sigurno kad je poslednji SL na ulazu ili u profitu (pri uvozu) ili kad je MAE
prošao poslednji SL a trejd nije izbačen stopom (pri čitanju, MAE stiže iz R2). Nepomeren → `stop_price` = poslednji
SL iz fajla; pomeren → originalni sa snimka (dopuna, `/daily` „Bez pregleda“).

### Podkoraci
- **O1** Izvoz naloga u uvozu: `topstepx-orders.ts`, wizard sa dva fajla, `final_stop_price` / `entry_order_type`
  (`20261009090000`), razlog izlaska iz naloga, merge samo na prazno + undo.
- **O2** Dopuna iz snimka (originalni stop, cilj, „šta sam rekao pre klika“), `stop-moved.ts`, „Bez pregleda“ za
  stop, mentor pack „Stop:“ linija, podsetnik u futures-trading.
- **O3** Propušten setup iz snimka (`/trades/missed/new`).
- **O4** Uklanjanje `/trades/new` i `/trades/log`, glavna akcija Uvoz, mrtvi kod, README.

## W — Vremenski stop (detaljno, 09.10.2026) — ✅

**Povod** (trejder, 09.10.2026): evidencija koliko dobitniku treba da krene i koliko gubitnik stoji u minusu do
SL-a, da bi trejd koji do tog vremena ne krene sekao vremenski. Postojalo je: prosečno trajanje po ishodu
(Hold time) i `time_underwater_pct` (koliki deo, ne kada).

### Izmena
- `futures-trading` `journal_mae.py`: `_deonice` (tekući P&L po deonicama, deli ga `pod_vodom`) i `poslednji_minus` —
  s od prvog ulaza do kraja poslednje deonice ispod nule; upis u `last_underwater_seconds`, dopuna jednom.
- Migracija `20261009120000`: `tj_positions.last_underwater_seconds numeric` (≥ 0, NULL = nije izmereno).
- `time-stop.ts` + kartica **Time stop** na dashboardu (pored Recent trades): dobitnici medijana / 75 % / 90 %
  do trajnog plusa i koliko nikad nije bilo u minusu; gubitnici vreme u minusu (`time_underwater_pct` × trajanje)
  i trajanje; lestvica 1–60 min: dobitnici već u plusu naspram gubitnika još otvorenih.

### Izlaz iz W
Migracija primenjena (tek tada push `futures-trading` na `main` — skript čita novu kolonu), README oba repoa,
status ✅. **Sledeći korak, ako trejder traži:** R koji bi vremenski stop u minuti N sačuvao ili izgubio (cena u
minuti N po trejdu iz R2) — sada lestvica pokazuje samo udele.

## P — Jedna stranica trejda (detaljno, 14.10.2026) — ✅ `1f8a832`

**Povod** (trejder, 14.10.2026): kartica „Plan & Setup“ ima nepotrebne stvari, jer trejd ulazi uvozom i više
ne može da se planira u journal-u. Traži jednu stranicu po trejdu, uređenu za day tradera. Kategorije
(Bias dana, Entry TF, Technical tags) **ostaju**; njihove stavke trejder sam preuređuje u Settings (podaci,
ne kod).

### Utvrđeno u kodu i bazi (14.10.2026)
- **Dva ekrana za jedan trejd.** `/trades/[id]/review` („Dopuna iz snimka“, `quick-log-form.tsx`) ima stop i
  cilj sa snimka, rečeno pre klika, setup, A/B/C, greške, emocije, rečenicu i slike, ali **nema checklist
  playbook-a ni kategorije**. `/trades/[id]/edit` (`trade-form.tsx`, ~2.000 redova) ima checklist, ali je
  napravljen za plan pre ulaza. Lista, Recent trades, Open positions, tracker, insights i beleške vode na
  `/edit`, a „Bez pregleda“ na `/daily` vodi na `/review`.
- **Plan & Setup posle uvoza.** „Fill this in before entering the trade“. Planned Entry Price je fill (market
  ulaz). Position Size predlaže veličinu za trejd koji je već uzet (rizik je fiksnih 300). Scale-out,
  Invalidation i Time stop su 0/3 u bazi i nijedan playbook ih nema. Thesis je ista kolona kao „Šta sam rekao
  pre klika“. Slippage prema planiranom ulazu je za market ulaz uvek 0.
- **Edit forma briše.** `updateTrade` ide kroz `tj_save_trade`, koji pri svakom čuvanju zamenjuje SVE fill-ove
  i SVE odgovore na pravila (`p_rules`). Trejd #1 ima 15 odgovora na pravila koja su meko obrisana (09.10.)
  i forma ih ne prikazuje, pa bi ih jedno čuvanje obrisalo (PLAYBOOK.md u `trading-mentor`).
- **`getAllFormFields` nije samo forma.** Iz `BASE_TABS` se izvode dozvoljena polja za čuvanje
  (`positionFieldNames`), brojčana i tag polja, CSV izvoz, dimenzije izveštaja i polja trejda u mentor
  pack-u (`detailFieldsFor`). Izbacivanje polja iz forme menja i sve to.
- **Ocena izvršenja:** Edit ima zvezdice 1–5, Dopuna A/B/C (`GRADE_RATING` A=5, B=3, C=1). U bazi #1 = 4,
  #2 = 2 (iz zvezdica), pa bi ih A/B/C prikazao kao B i C.
- **Propušten setup** (`status = 'missed'`) se pravi na `/trades/missed/new`, a menja se samo kroz Edit formu.
- Baza 14.10.: 3 trejda, sva tri iz uvoza (po 2 fill-a), nijedan propušten.

### Kako stranica izgleda (`/trades/[id]`, redosled snimka)
1. **Trejd, samo za čitanje, iz uvoza.** `#`, instrument, nalog, Topstep dan, smer, ugovori, ulaz → izlaz sa
   vremenom po zoni naloga, trajanje, Net P/L, R, MAE/MFE (R i traka), provizije, rizik prema budžetu.
   Poslednji stop u platformi i upozorenje „stop pomeren“ (`stop-moved.ts`, kao sada u Dopuni).
2. **Sa snimka.** Originalni stop, cilj, šta sam rekao pre klika (`thesis`). Planirani R:R se računa iz
   originalnog stopa i cilja prema prosečnom fill-u, samo prikaz.
3. **Setup.** Izbor playbook-a i checklist (`PlaybookChecklist`, sva pravila izabranog playbook-a, u
   tri stanja), pa izračunata ocena setupa A+/A/B/C.
4. **Kontekst.** Kategorije faze `always` iz `tj_field_defs` (danas Bias dana, Entry TF, Technical tags), u
   redosledu iz Settings. Nova kategorija iz Settings se pojavi sama, bez koda.
5. **Review.** Razlog izlaska (sam se računa kao sada, može da se promeni), ocena izvršenja (P-2), greške,
   psihologija i ostale kategorije faze `active`, jedna rečenica.
6. **Slike.** Postojeće (redosled, brisanje) i dodavanje novih.
7. **Šta bi bilo** (`TradeScenarioCard`), samo za čitanje, kad ga futures-trading izmeri.

Dno: **Sačuvaj**, **Obriši trejd**, **Nazad**. Posle čuvanja stranica vraća tamo odakle je otvorena
(`?from=daily` → `/daily`, inače `/journal`).

**Propušten setup** otvara istu stranicu sa zaglavljem „Propušten setup“: izmenljivi su smer, ulaz, stop,
cilj i vreme (polja iz `missed-setup-form.tsx`), razlog propuštanja, playbook i checklist, kategorije i
beleška. Nema ocene izvršenja ni grešaka.

**Nestaje iz forme** (kolone u bazi ostaju, bez migracije): Planned Entry Price kao unos, Position Size,
Scale-out, Invalidation, Time stop, Slippage, unos fill-ova (P-1), „MAE/MFE Price“ i „Gross P&L (broker)“
(za fjučers ih piše R2, a CFD se više ne trguje).

### Podkoraci (svaki: test koji pada → kod → gate → commit + push)
- **P1 Čuvanje bez brisanja.** `saveTradeReview` dobija `rule_answers` i kategorije.
  - Čista funkcija `ruleAnswerChanges(prethodni, novi, pravilaPlaybooka)` → upsert / delete po
    `(position_id, rule_id)`. Dira **samo pravila izabranog playbook-a**: odgovor „bez odgovora“ briše taj
    jedan red, a odgovori na meko obrisana pravila (#1) ostaju. Pri promeni playbook-a važi P-3.
  - Kategorije idu kroz `field-values.ts` (kolona za `technical_tags`, `mistake`, `psychology_tags`,
    `exit_reason`, a `custom` za ostale), uz proveru da ključ postoji u `tj_field_defs`.
  - `updateMissedSetup(id, …)` sa istom šemom kao `createMissedSetup`.
  - Testovi: `ruleAnswerChanges` (svaki slučaj iznad, #1 kao fixture), šema, kategorija sa nepoznatim ključem
    se odbija.
- **P2 Stranica `/trades/[id]`.** Server komponenta čita trejd, statistiku, playbook-ove (i povučene), field
  defs, redosled kategorija, slike i scenario. Klijentska komponenta `TradePage` sa sekcijama iznad;
  delovi iz `quick-log-form.tsx` (čipovi, A/B/C, slike, „Sa snimka“) se premeštaju, ne kopiraju. Render
  testovi: uvezen trejd, pomeren stop, trejd bez playbook-a, propušten setup, prazne kategorije.
- **P3 Rute.** `/trades/[id]/edit` i `/trades/[id]/review` → `redirect` na `/trades/[id]` (stari linkovi i
  obeleživači rade). Svi linkovi u aplikaciji vode direktno na novu stranicu: `journal-grid`,
  `recent-trades-widget`, `open-positions-widget`, `tracker-checklist`, `insights-panel`, `note-editor`,
  `review-gaps-card` (sa `?from=daily`).
- **P4 Brisanje stare forme.** `trade-form.tsx`, `quick-log-form.tsx`, plan grupe u `form-config.ts`,
  `updateTrade` i `tradeInputSchema` ako ih više niko ne zove, `scale-out-editor`, izbor time stopa i sve
  što `dead` (knip) posle toga prijavi. `getAllFormFields` se zamenjuje izričitim spiskom polja trejda koji
  koriste CSV izvoz, dimenzije izveštaja i mentor pack; polja iz „Nestaje“ izlaze iz njega. `tj_save_trade`
  ostaje u bazi dok ga uvoz ili spajanje koriste.
- **P5 Mentor pack i izveštaji.** Paket više ne piše prazne redove Position size, Scale-out, Invalidation i
  Time stop. Planned RR, Stop: linija, checklist i kategorije ostaju. Test: paket za Dan na fixture-u
  13.10. je isti kao pre, osim izbačenih praznih redova.
- **P6 Dokumentacija.** README (forma trejda, rute, Dopuna), ovaj fajl (✅ + commit), `ROADMAP.md` jedan
  red. U `trading-mentor`: tok zatvaranja u `CLAUDE.md` („Dopuna iz snimka“ → stranica trejda, checklist
  na istom mestu), `PLAYBOOK.md` (checklist više nije samo u Edit formi, a upozorenje „#1 ne čuvaj kroz Edit“
  otpada).

### Odluke trejdera (14.10.2026): P-1 A uz ručni originalni SL, P-2 A, P-3 A
- **P-1 Fill-ovi.** (A) Ne menjaju se ručno nigde: uvoz je istina, a ispravka je undo uvoza i ponovni uvoz
  ili spajanje u listi. (B) Ostaje skriveno dugme „Ispravi fill-ove“. Preporuka: **A**. Ručna izmena fill-a
  je jedini način da broj u paketu ne odgovara berzi.
- **P-2 Ocena izvršenja.** (A) A/B/C svuda, kao u Dopuni (A = po planu, B = manja greška, C = prekršaj);
  #1 i #2 se prikazuju kao B i C. (B) Zvezdice 1–5 svuda. Preporuka: **A**, jer je to pitanje „po planu ili
  ne“, a pet nivoa za to nema značenje.
- **P-3 Promena playbook-a na trejdu.** (A) Odgovori na pravila prethodnog playbook-a se brišu, da ne ulaze
  u njegovu statistiku. (B) Ostaju u bazi. Preporuka: **A**. Ne važi za meko obrisana pravila istog
  playbook-a (#1).

### Izlaz iz P
Jedna stranica po trejdu sa snimkom, checklistom, kategorijama i review-om. `/edit` i `/review` vode na nju.
Čuvanje ne briše fill-ove ni odgovore koje stranica ne prikazuje. Stara forma je obrisana, mentor pack je
isti osim praznih redova, a README i `trading-mentor` su usklađeni 1:1. Bez migracije.

## Q — Manje ručnog rada (detaljno, 14.10.2026) — ✅

**Povod** (trejder, 14.10.2026, posle prvog dana sa uvozom i snimkom): „uđi dublje u ovo i nađi rešenje“ za
ručni rad i greške koje su 13. i 14.10. potrošile sate: pravilo rizika u journal-u drugačije od tvog (15 % /
350 prema 300), uvoz koji je preskočio #3, originalni stop koji izvoz ne čuva i ručno štiklirano „Teza
naglas ✓“ koje nije bilo tačno.

### Utvrđeno u kodu, bazi i dokumentaciji (14.10.2026)
- **Pravilo rizika:** rešeno danas (`3fde87b`, jedno polje u USD; nalog upisan na 300, baza potvrđena). Ostaje
  istorija: #3 (13.10.) ima zapečaćen budžet 350, jer je tada bilo 350. Odluka Q-3.
- **Uvoz:** duplikat je poređen samo po fill-ovima i novcu (popravljeno `a155d5f`). Uzrok koji ostaje: posle
  uvoza stiže samo toast „0 created, 0 merged, 2 skipped“, a /daily ne zna da trejd nema naloge. U bazi se to
  vidi: TopstepX trejd bez naloga ima `final_stop_price` i `entry_order_type` prazne (#3 do ponovnog uvoza).
- **Originalni stop:** TopstepX izvoz naloga ima jedan red po nalogu sa POSLEDNJOM cenom stopa (komentar u
  `topstepx-orders.ts`, test trejdera 08.10.). Pomeren stop se iz fajla ne može rekonstruisati; bliže pomeren
  stop se ne može ni otkriti (`stopStatus` vidi samo stop u profitu ili MAE iza stopa).
- **TopstepX API** bi video svaku izmenu stopa (14,50 USD mesečno). Trejder ga ne uzima (Q-1 = C, 14.10.):
  originalni stop pomerenog stopa ostaje ručni unos sa snimka, a uvoz ostaje dva CSV fajla.
- **Ručna pravila trackera** (baza 14.10.): 6 od 15 je ručno, i svih 6 može da se izračuna iz onoga što je već
  na trejdu (`custom.htf_bias`, `custom.entry_tf`, `execution_rating`, `exit_reason`, `mistake`,
  `psychology_tags`, `tj_trade_images`, vreme ulaza):
  | Pravilo | Danas | Predlog: računa se iz |
  |---|---|---|
  | HTF nivoi i bias | ručno | svaki trejd dana ima „Bias dana“, i nijedan nije „Nisam odredio unapred“ (13.10.: oba jesu → ✗) |
  | Vreme trgovanja | ručno, tekst još kaže 03:00–16:00 ET | svaki ulaz i izlaz u prozoru iz podešavanja pravila (od–do po Beogradu); W42: 09:00–12:00 |
  | Teza naglas | ručno (13.10. ✓, a teza posle klika) | novo polje na trejdu „Teza: pre klika / posle klika / nisam rekao“; ✓ samo kad je svuda „pre klika“ |
  | Iskreni tagovi | ručno | po trejdu: „Ispoštovao rizik“ uz pao `risk_per_trade` / `stop_loss_set` / `max_loss_per_trade` na tom trejdu, ocena A („Bez greške“) uz bilo koji pad na tom trejdu, ili „Vodio po planu“ uz tezu koja nije „pre klika“ → ✗ |
  | Dnevnik i tagovi | ručno | svaki trejd ima ocenu, razlog izlaska, bias, Entry TF, bar jednu emociju, i bar jednu grešku ili ocenu A |
  | Screenshotovi | ručno | svaki trejd ima bar jednu sliku |
  Tako /daily ostaje bez ijednog ručnog štikliranja osim „Danas ne trgujem“. Pravila koja traže snimak (da je
  bias napisan na chartu, šta je tačno rečeno) i dalje proverava mentor iz snimka; journal proverava ono što
  trejder sam upiše, ali po trejdu, a ne jednim štikliranjem za ceo dan.

### Rešenje, po podkoracima (svaki: test koji pada → kod → gate → commit + push)
- **Q1 /daily: trejd bez naloga.** `missingReview` dobija `"orders"`: TopstepX trejd (uvezen) bez
  `final_stop_price` i `entry_order_type`. Isto pravilo u `futures-trading` `journal_podsetnik.py` (komentar u
  `review-gaps.ts`: menjaju se oba ili nijedan). Posle uvoza sa preskočenim redovima: upozorenje koje ostaje
  na ekranu, ne toast. Bez migracije.
- **Q2 Ručna pravila → automatska** (posle Q-2). Novi ključevi u `AUTO_RULE_KEYS` i `evaluateAutoRulesForDay`
  (`htf_bias_set`, `trading_window`, `thesis_before_click`, `honest_tags`, `review_complete`,
  `screenshot_per_trade`); `trading_window` ima `config: { from, to }` po Beogradu, menja se u Settings ›
  Tracker. Polje „Teza“ je kategorija u `tj_field_defs` (podaci, ne kod) koju stranica trejda već prikazuje.
  Migracija: proširenje `tj_tracker_rules_auto_key_check` i prebacivanje 6 postojećih redova na nove ključeve
  (stari dani ostaju zamrznuti, `compliance.ts`). Testovi: svako pravilo na fixture-u 13.10. daje ono što je
  mentor ručno ocenio u `trading-mentor/dnevnik/2026-10-13.md`.
- **Q3 Dokumentacija.** README 1:1, ovaj fajl, `trading-mentor` `CLAUDE.md` (/daily bez ručnih štikliranja).

### Odluke trejdera
- **Q-1 Izvor podataka: C** (trejder, 14.10.): bez TopstepX API-ja. Originalni stop sa snimka, uvoz iz CSV-a.
- **Q-2 Ručna pravila** (trejder, 14.10.2026): HTF bias, Iskreni tagovi, Dnevnik i tagovi i Screenshotovi automatski
  kako piše u tabeli. **Teza:** bez novog polja („polje za unos teksta treba da bude samo jedno“): `thesis_recorded` je ✓
  kad je „šta sam rekao pre klika“ upisano na svakom trejdu, a da li je rečeno pre klika proverava mentor sa snimka; zato
  „Iskreni tagovi“ nemaju uslov „Vodio po planu“. **Vreme trgovanja:** povučeno, bez podešavanja prozora („nepotrebno“);
  prozor proverava mentor iz fill-ova.
- **Q-3 Istorija budžeta: A** (trejder, 14.10.): #3 ostaje sa zapečaćenih 350.

### Izlaz iz Q
/daily nema ručnih štikliranja osim „Danas ne trgujem“ (uz Q-2 = A); trejd bez naloga se vidi pre zaključavanja
dana. README i `trading-mentor` usklađeni 1:1.

## N — Sesije po Beogradu (detaljno, 14.10.2026) — ✅

**Povod** (trejder, 14.10.2026, posle faze Q): sesije u paketu i analitici neka budu Azija, London, NY AM i NY PM,
umesto „Globex noć“. Mentor je to tražio kao Z-015 (09.10.): London trejdovi su u paketu „Globex night 18:00–08:00“
i „Before the open“, pa statistika po sesiji za trejdera koji trguje London ne govori ništa.

### Utvrđeno u kodu (14.10.2026)
- **Sesije** (`session-window.ts`, F5.2, odluka L1 od 29.09.): sedam prozora po NY satu, sve pre 08:00 ET je jedan
  prozor „Globex night 18:00–08:00“. Pravljeno za NY trejdera; za London ne postoji ni jedan prozor.
- **Minuti posle otvaranja** (`minutesAfterOpen`, `openOffsetBucket`): samo od 09:30 ET. Svaki London ulaz je „Before
  the open“ (paket 13.10.: oba trejda), a red trejda u paketu ne piše ništa.
- **Gde se koristi:** `enriched-trade.ts` (polja `sessionWindow`, `openOffset`), dimenzije izveštaja
  `session_window` i `minutes_from_open` (`reports/dimensions.ts`), mentor paket (`mentor-intraday.ts`: tabele
  „Sesijski prozor (ET)“ i „Koliko posle otvaranja 09:30 ET“, red trejda), legenda paketa (`mentor-export.ts`).
  Insights i tracker ih ne čitaju. U bazi se ne čuvaju (nema sačuvanih izveštaja), pa **bez migracije**.
- **Vremena u ET i CT, a trejder čita Beograd** (trading-mentor CLAUDE.md, 09.10.): u paketu „Prvi ulaz (ET)“,
  „Crveni prozori (ET)“, „flat do … ET“, „= 03:24 ET“ u redu trejda, „Ulaz u crvenom prozoru … ET“, „Fill-ovi
  (ET)“, „Šta bi bilo … do 15:10 CT“, legenda („sesije po ET“, Topstep dan „17:00–17:00 CT“); na /daily tri teksta
  sa „CT“ (`tracker-checklist.tsx`, kraj Topstep dana).
- **Chart je već dogovoren** (`trading-mentor/GRAFIK.md`): Azija 18:00–00:00 NY, London 08:00–13:00 po Londonu,
  cash open 09:30 NY, ručak 11:30–13:30 NY, cash close 16:00 NY, pauza CME 17:00–18:00 NY. Granice sesija u
  journal-u treba da budu iste linije, da paket i chart pričaju istim jezikom.
- **Nedelja 25.10.–01.11.:** Evropa je prešla na zimsko vreme, SAD još nisu, pa su NY linije po Beogradu sat
  ranije (cash open 14:30). Sesija se računa po satu svoje berze (NY ili London), a natpis piše uobičajeno
  vreme po Beogradu; legenda to kaže jednom rečenicom.

### Predlog (granice po satu berze, natpisi po Beogradu)
| Sesija | Berza | Beograd (obično) |
|---|---|---|
| Azija | 18:00–00:00 NY | 00:00–06:00 |
| Pre Londona | 00:00 NY – 08:00 London | 06:00–09:00 |
| London | 08:00 London – 08:00 NY | 09:00–14:00 |
| NY pre otvaranja | 08:00–09:30 NY | 14:00–15:30 |
| NY AM | 09:30–11:30 NY | 15:30–17:30 |
| Ručak | 11:30–13:30 NY | 17:30–19:30 |
| NY PM | 13:30–16:00 NY | 19:30–22:00 |
| Posle zatvaranja | 16:00–18:00 NY | 22:00–00:00 |

London se završava kad počinje NY pre otvaranja: obično je to isti trenutak kao 13:00 London (C3 u GRAFIK.md),
a u nedelji 25.10.–01.11. NY ima prednost.

### Podkoraci (svaki: test koji pada → kod → gate → commit + push)
- **N1 Sesije.** `session-window.ts`: prozori iz tabele (posle N-1), svaka granica po zoni svoje berze; natpis po
  Beogradu. Testovi: 13.10. 09:24 i 09:44 → London; granice sa obe strane svake linije; nedelja 25.10.–01.11.;
  nedelja uveče (Globex otvaranje) → Azija sledećeg dana.
- **N2 Minuti posle otvaranja** (posle N-2). `minutesAfterOpen` / `openOffsetBucket` broje od otvaranja sesije
  kojoj ulaz pripada; red trejda u paketu piše „N min posle otvaranja Londona / NY“.
- **N3 Vremena po Beogradu** (posle N-3). Paket: svaka kolona i red iz „Utvrđeno“ u zoni naloga (`displayTz`), bez
  ET i CT; legenda piše sesije po Beogradu i Topstep dan kao „00:00–00:00 po Beogradu (17:00 CT)“ jednom.
  /daily: kraj Topstep dana po Beogradu.
- **N4 Dokumentacija.** README (sesije, paket), ovaj fajl, `trading-mentor`: Z-015 rešeno, CLAUDE.md legenda paketa.

### Odluke trejdera
- **Odluke trejdera (14.10.2026): N-1 = A** (osam sesija kao na chartu), **N-2 = A** (minuti od otvaranja sesije:
  London 09:00, NY 15:30 po Beogradu), **N-3 = A** (sve po Beogradu, ET i CT nigde u paketu ni na /daily).
- Uz to: insight „Patience paid off“ broji od otvaranja sesije, ne od 09:30 NY.

### Izlaz iz N
London trejd je u paketu i izveštajima „London“, minuti se broje od otvaranja njegove sesije, a paket nema nijedno
vreme koje trejder mora da preračunava. Bez migracije.

## Y — Vreme upisa (detaljno, 14.10.2026) — ✅

**Povod** (mentor, `trading-mentor` Z-028, Z-031, Z-032, pregled journal-a 14.10.2026): journal broji playbook i
kapiju pre sesije kao da su postojali pre ulaza, a ne proverava kad su upisani. Nije softverska greška, nego provera
koja fali: playbook napisan posle ishoda je priča, ne plan (PRAVILA-MENTORA §25), i tracker ga danas boduje kao plan.

### Utvrđeno u kodu i bazi (14.10.2026)
- **Tracker `playbook_linked`** (`tracker/auto-rules.ts`, `evaluateAutoRulesForDay`): `evalOpenDayFlag(…, t.hasPlaybook)`,
  a `hasPlaybook` je samo `playbook_id != null`. Vreme playbook-a se ne čita; `buildTradeDayIndex` ga i ne dobija
  (četiri mesta: `/daily` page i `tracker-actions.ts`, `/calendar`, dashboard).
- **Checklist** (`tj_position_rules`, kolone `created_at`, `updated_at`): mentor paket ga čita za tabelu „Setup
  Grade“, bez vremena upisa. Promena playbook-a briše stare odgovore (P-3), pa `created_at` je vreme ovog playbook-a.
- **Kapija pre sesije** (`tj_daily_reports.mental_temp`): red ima samo `created_at`, `updated_at`, `locked_at`; vreme
  upisa same ocene ne postoji. `updated_at` se menja i zaključavanjem, pa ne govori ništa. `created_at` je tačan samo
  kad je ocena prvo što je upisano tog dana (red može nastati i kroz „Danas ne trgujem“). Paket je štampa u
  `mentor-intraday.ts` (kolona „Mentalno“), /daily u `daily-report-form.tsx`.
- **Baza 14.10.2026 (po Beogradu):**
  | Trejd | Ulaz | Zatvoren | Playbook (napravljen) | Checklist upisan |
  |---|---|---|---|---|
  | #1 | 07.10. 16:20 | 07.10. 17:49 | Ponoc pojas reversal (14.10. 10:16) | 14.10. 11:21 |
  | #2 | 13.10. 09:24 | 13.10. 09:40 | — | — |
  | #3 | 13.10. 09:44 | 13.10. 11:58 | 3 candle 5min BOS (14.10. 08:52) | 14.10. 09:25 – 10:54 |

  | Dan | Prvi ulaz | Kapija (red napravljen) |
  |---|---|---|
  | 07.10. | 16:20 | 07.10. 19:09 — **posle ulaza** (mentor ovo nije znao) |
  | 13.10. | 09:24 | 14.10. 11:15 — posle ulaza |
- **Zaključani dani:** presuda automatskog pravila se zamrzava pri zaključavanju (`compliance.ts`). 07.10. je
  zaključan 09.10. (tada #1 još nije imao playbook), pa ga nova provera ne menja; 13.10. nije zaključan.

### Predlog
1. **Playbook posle ulaza.** `TrackerTrade` dobija `playbookCreatedAt`; `playbook_linked` pada za trejd čiji je playbook
   napravljen posle prvog fill-a (`tj_playbooks.created_at > opened_at`), sa razlogom „playbook napisan posle ulaza“ na
   /daily (Y-1). Paket u redu trejda piše „playbook napravljen DD.MM. HH:MM, posle ulaza“.
2. **Checklist posle zatvaranja.** Paket u redu trejda piše „checklist upisan DD.MM. HH:MM, posle zatvaranja“ kad je
   bilo koji odgovor napravljen posle `closed_at` (štampa se najkasnije vreme). Tracker se ne menja: checklist posle
   trejda je normalan tok (stranica trejda se popunjava posle sesije); mentor ga čita kao pregled, ne kao plan.
3. **Kapija posle prvog ulaza.** Vreme upisa ocene (Y-2) poredi se sa prvim ulazom tog Topstep dana. /daily ispod
   ocene i paket u koloni „Mentalno“: „3/5 · upisano posle prvog ulaza (09:24), 14.10. 11:15“. Sva vremena po Beogradu.

### Podkoraci (svaki: test koji pada → kod → gate → commit + push)
- **Y1 Playbook u tracker-u.** `buildTradeDayIndex` dobija mapu playbook id → `created_at` (četiri pozivaoca);
  `evalOpenDayFlag` za `playbook_linked` po Y-1. Testovi: fixture #1 i #3 → pada / oznaka; playbook napravljen pre
  ulaza → prolazi; zaključan dan ostaje zamrznut (Y-4).
- **Y2 Paket: playbook i checklist.** `mentor-export.ts` / `tradeContextLines`: vreme playbook-a i checklist-a po
  Beogradu (`displayTz`), oznaka samo kad je posle. Dashboard učitava `created_at` playbook-a i odgovora. Legenda
  paketa jednom rečenicom.
- **Y3 Kapija pre sesije.** Po Y-2 (migracija `mental_temp_at` ili `created_at`); `daily/actions.ts` pečati vreme kad
  se ocena promeni; /daily i `mentor-intraday.ts` oznaka po Y-3. Testovi: 13.10. → „posle prvog ulaza (09:24)“; dan
  bez trejda → bez oznake; ocena pre ulaza → bez oznake.
- **Y4 Dokumentacija i produkcija.** README (tracker, paket, /daily), ovaj fajl, `ROADMAP.md`, `trading-mentor`
  CLAUDE.md (šta paket sada pokazuje) i Z-028 / Z-031 / Z-032; provera Vercel produkcije.

### Odluke trejdera (pre koda)
**Odluke trejdera (14.10.2026): Y-1 = A, Y-2 = A, Y-3 = A, Y-4 = A** (sve preporuke).
- **Y-1 Playbook napravljen posle ulaza:** **A** `playbook_linked` pada (preporuka: playbook posle ishoda nije plan);
  **B** prolazi, ali /daily i paket ga označe; **C** novo posebno pravilo „playbook pre ulaza“, `playbook_linked`
  ostaje kakav jeste.
- **Y-2 Vreme kapije:** **A** nova kolona `tj_daily_reports.mental_temp_at` (aditivna migracija, stari redovi dobiju
  `created_at`), tačno i kad se ocena upiše posle „Danas ne trgujem“ (preporuka); **B** bez migracije, čita se
  `created_at` reda.
- **Y-3 Kapija posle prvog ulaza:** **A** samo oznaka na /daily i u paketu (preporuka); **B** i novo automatsko pravilo
  trackera koje pada.
- **Y-4 Već zaključani dani (07.10.):** **A** presuda ostaje zamrznuta, oznake u paketu se ipak vide (preporuka:
  istorija se ne prepisuje); **B** jednokratno preračunati zaključane dane.

### Proširenje (15.10.2026): Y4 i Y5
- **Y4 `trading_window`.** `config = { windows: [{ since, from, to }] }`, vremena po Beogradu; za dan važi prozor sa
  najkasnijim `since` ≤ dan. Prekršaj: ulaz pre `from` ili od `to`, ili pozicija otvorena posle `to` (izlaz u minuti
  `to` je izlaz po vremenu, nije prekršaj; otvorena pozicija pre isteka minute `to` se još ne sudi). Bez prozora →
  `unconfigured`. Settings › Tracker: od–do i „važi od“ za to pravilo. Evaluator dobija pravila kroz `AutoContext`
  (`rules`), pa sva četiri pozivaoca čitaju isti prozor. Migracija: `auto_key` check + red pravila sa London prozorom od
  12.10. (W42); pravilo važi od dana kad je napravljeno (`created_at`), pa prošli dani ostaju kakvi su. Testovi: 13.10.
  #2 i #3 ✓ (#3 izlaz 11:58:57), ulaz 08:59 ✗, izlaz 12:00:40 ✓, izlaz 12:01 ✗, otvorena posle 12:01 ✗, NY nedelja
  14:30–18:00, promena prozora ne menja raniji dan.
- **Y5 `honest_tags`.** Tag „Vodio po planu“ na trejdu bez playbook-a ili sa playbook-om napravljenim posle ulaza (isto
  merilo kao `playbook_linked`) → ✗. Tekst pravila u bazi dopunjen istom migracijom.
- **Isporučeno (15.10.2026):** `9de8441` (Y4 i Y5 u jednom commit-u: oba menjaju `auto-rules.ts`), gate zelen (2931
  testova), Vercel Production uspešan, pa migracija `20261015090000` primenjena (kod pre migracije: stari kod ne zna
  `trading_window`). Pravilo napravljeno 15.10. 00:14 po Beogradu, pa se ocenjuje od 15.10.; 13.10. ga nema.

### Izlaz iz Y
Trejd sa playbook-om napisanim posle ulaza više ne prolazi kao plan, a paket i /daily pokazuju kad su playbook,
checklist i kapija upisani u odnosu na ulaz i zatvaranje. Oba pravila u produkciji, testovi zeleni.

**Isporučeno (14.10.2026):** Y1 `14a992f`, Y2 `7281007`, Y3 `80dee18`; migracija `20261014200000` primenjena (stari redovi:
`mental_temp_at` = `created_at`, `updated_at` i zaključavanja netaknuti). Gate zelen (2916 testova), Vercel Production
`80dee18` uspešan. Ručna provera u pregledaču nije rađena (produkcija je iza Vercel prijave). Posledica u podacima:
13.10. (nezaključan) `playbook_linked` sada pada (#2 bez playbook-a, #3 playbook posle ulaza); 07.10. ostaje zamrznut.

## J — Jezik: nazivi kategorija i fabrički tagovi (detaljno, 15.10.2026) — ✅

**Povod** (trejder preko mentora, 15.10.2026: „sve na srpskom“, gramatika svuda): mentor je u bazi trejdera upisao
listu tagova za day trading na srpskom (duplikati spojeni, greške u kucanju ispravljene, dodate greške koje trejder
stvarno pravi) i preveo nazive lista i polja. Kod i dalje štampa engleske naslove u paketu, izveštajima i gridu, a
fabrička lista (`tj_seed_categories`) je stara, pa bi posle „Delete all data“ vratila stare tagove.

### Utvrđeno u kodu i bazi (15.10.2026)
- **Baza** (`tj_option_lists`, `tj_field_defs`, jedan korisnik): liste Smer, Bias dana, TF ulaza, Tehnički tagovi,
  Ocena setupa, Razlog izlaza, Razlog propuštanja, Emocije, Disciplina, Greške; polja Bias dana, TF ulaza, Tehnički
  tagovi, Razlog izlaza, Greške, Psihologija, Razlog propuštanja. 10 lista, 76 stavki, sve aktivne. Kategorije lista
  (`Context`, `ICT Setup`, `Risk`, `Psychology`) su u bazi i dalje na engleskom; J ih ne menja.
- **Paket** (`mentor-export.ts`, `FIXED_BREAKDOWNS`): fiksni naslovi „Setup Grade“, „Direction“, „Technical Tags“,
  „Psychology Tags“, „Mistake“ pobeđuju naziv iz baze (dedup po ključu, fiksni idu prvi); detalj trejda „Miss reason“.
- **/reports** (`reports/dimensions.ts`): „Direction“, „Setup grade“, „Exit reason“, „Mistake“, „Technical tags“,
  „Psychology tags (all)“, „Emotion“, „Discipline“ zakucani (fiksne dimenzije ne čitaju naziv iz baze).
- **Grid** (`journal-grid.tsx`): filteri „Direction“, „Grade“, „Technical tag“, „Mistake“; masovni tagovi
  „Technical“, „Psychology“, „Mistake“. **Forma** (`form-config.ts`): „Direction“. /daily (`tracker-checklist.tsx`):
  „Entry TF“ u tekstu.
- **Seed:** poslednja definicija `tj_seed_categories` je `20260930030000` (Bias dana Long/Short/Neutralno, „Ispoštovao
  plan“, „Trejd posle DLL plana“ …, engleski nazivi lista i polja). `field-defs.fixture.ts` kaže da prati seed, a ima
  pet polja sa engleskim nazivima.
- **Doslovno u kodu** (ne menjaju se): Bez greške, Ispoštovao rizik, Vodio po planu, Pogođen stop, Pogođen target, Na
  nuli, Prateći stop, Zatvoreno ranije, prefiks „Nisam odredio“. Svi postoje u bazi trejdera.

### Podkoraci (svaki: test koji pada → kod → gate → commit + push)
- **J1 Naslovi na srpskom.** Paket: naslov kategorije je naziv polja iz baze kad postoji, inače srpski (Ocena setupa,
  Smer, Tehnički tagovi, Psihologija, Greške); „Razlog propuštanja“. /reports: Smer, Ocena setupa, Razlog izlaza,
  Greške, Tehnički tagovi, Psihologija (sve), Emocije, Disciplina. Grid, forma i /daily isto. `field-defs.fixture.ts` =
  sedam polja iz baze. Bez migracije.
- **J2 Fabrička lista = lista trejdera.** Nova migracija ponovo definiše `tj_seed_categories` sa listama, stavkama i
  poljima kakvi su u bazi 15.10.2026 (samo SELECT; podaci trejdera se ne menjaju — funkcija i dalje ne radi ništa kad
  korisnik ima liste). Test čita poslednju definiciju funkcije i poredi je sa listom, i proverava da su doslovni tagovi
  u njoj.
- **J3 Mentor i dokumentacija.** `trading-mentor` (ZATVARANJE.md, CLAUDE.md) i dalje čita iste nazive; README
  (fabrička podešavanja, paket), ovaj fajl, `ROADMAP.md`; provera Vercel produkcije.

### Izlaz iz J
Paket i /reports pišu nazive kategorija na srpskom, isto kao Settings, a reset naloga vraća listu koju trejder sada
ima.

**Isporučeno (15.10.2026):** J1 `61f5c79` (naslovi u paketu, /reports, gridu, formi i na /daily; u paketu pobeđuje
naziv polja iz baze; u „By …“ se naziv kategorije više ne spušta u mala slova), J2 `c415355` (migracija
`20261015120000`, test `seed-categories.test.ts` čita poslednju definiciju funkcije). Gate zelen (2944 testa), Vercel
Production `c415355` uspešan, pa migracija primenjena (verzija u bazi `20261014224514`, UTC). Baza posle: 10 lista, 76
stavki, 7 polja — podaci trejdera netaknuti. Ručna provera u pregledaču nije rađena (produkcija je iza Vercel prijave).
**Van obima J (svesno):** ostatak /reports, dashboard-a, grida i Settings je i dalje na engleskom (README „On
language“: deo koji meri je engleski; ~3.150 stringova); kategorije lista (`Context`, `ICT Setup`, `Risk`,
`Psychology`) ostaju kakve su u bazi. **Odluka trejdera (15.10.2026): „ostatak ostaje“** — interfejs van naziva kategorija ostaje na engleskom, nema posebne faze.

## D — Bias dana (detaljno, 17.10.2026) — 🔄

**Povod** (trejder, 17.10.2026: „da svaki dan odredim prvo bias za taj dan i to će da se meri … koji mi je winrate u
predviđanju biasa i da se povežu cene koje će automatski da prepoznaju jesam li bias pogodio“, pa „mora da pokazuje
koliko sam u plusu mojim biasom a koji bi winrate bio da je uvek long … da se upoređuju“). Mentor Z-016: bias nastaje
dok trejder gleda cenu i nije zapisan pre ulaza. Danas je bias polje **na trejdu** (`custom.htf_bias`), bira se posle
sesije, dan bez trejda nema bias, a tačnost se ne meri.

### Utvrđeno u kodu i bazi (17.10.2026)
- Bias trejda: `reviewOf()` → `TradeReview.htfBias`, `biasWasSet`, `evalHtfBiasSet` (`tracker/auto-rules.ts`); seed
  `20261015120000` (lista `htf_bias`: Gore (bullish), Dole (bearish), Nema biasa, Nisam odredio unapred; polje
  `always`); prikaz u „4 · Context“ na stranici trejda.
- /daily: `daily/page.tsx`, slot `beforeSession` uz `SessionBriefCard`; šablon akcije `daily/actions.ts`.
- Tabela po danu koju puni skripta: šablon `tj_session_briefs` (`20260929100000`) i `missingTable()` fallback.
- Fabrički instrumenti (`default-instruments.ts`) nemaju GC/MGC; postoje `MICRO_OF` / `MINI_OF`, nema funkcije koren.
- `futures-trading`: sveće po ugovoru iz R2 (`tools/cene/ugovor.py`, Databento dopuna sa limitom), upis kroz
  `tools/journal_api.py`, pokretanje svaki sat 08–23 BG (`journal_mae.py`). **GC nije podržan** (meseci samo H/M/U/Z,
  regex korena bez GC).

### Odluke trejdera (17.10.2026)
- **D-1 Pogodak = A:** neto pomeraj od početka do kraja merenja, uz neutralni opseg.
- **D-2 Prozor:** početak = kasnije od **09:00 BG** i trenutka upisa (upis u 07:00 → 09:00; upis popodne → od upisa);
  kraj **18:00 BG**. Upis posle 18:00 se ne ocenjuje.
- **D-3 Neutral je prognoza.** Gore ili Dole na neutralan dan je promašaj, i za trejdera i za uvek long.
- **D-4 Opseg bira mentor, fiksno u kodu**, bez Settings.
- **D-5 Instrumenti NQ, ES, GC**; mikro (MNQ, MES, MGC) deli bias sa mini ugovorom.
- **D-6 Kartica zamenjuje polje „Bias dana“ na trejdu**; tracker `htf_bias_set` čita karticu.
- Grana: direktno `main`, migracija posle zelenog gate-a.

### Opseg (D-4)
Neutralan dan: |pomeraj| < **25. percentil |pomeraja| istog prozora** (isti minut početka po BG → 18:00) u **60
prethodnih trgovačkih dana**, iz istih 1m sveća, svaki dan na svom front ugovoru (pomeraj je razlika, roll ne smeta).
Manje od 40 dana istorije → `bez_istorije`. Zašto ne ATR × k: ATR meri raspon celog Globex dana, a ocenjuje se neto
pomeraj u prozoru; percentil iste veličine drži udeo neutralnih dana oko 1 od 4 u svakom režimu, sam se skraćuje kad je
prozor kraći i ne kvare ga ekstremi (CPI, FOMC). Kalibracija u `futures-trading` (`testovi/bias_opseg/`).

### Podkoraci (svaki: test koji pada → kod → gate → commit + push)
- **D1 Baza i koren.** Migracija `20261017120000_daily_bias.sql`: tabela `tj_daily_bias` (dan, koren NQ/ES/GC, bias
  gore/dole/neutral, razlog, `set_at` iz triggera; kolone ocene `eval_*`). Više redova po (dan, koren); meri se
  najraniji `set_at`. Trigger: bias, razlog, dan, koren i `set_at` se ne menjaju posle upisa; nema DELETE politike;
  tabela ulazi u `tj_reset_my_data()`. `rootOf(symbol)`; GC i MGC u fabričkim instrumentima.
- **D2 Kartica na /daily** (`daily-bias-card.tsx`, akcija `addDailyBias`, samo insert; zaključan dan odbija).
- **D3 `futures-trading`:** kalibracija opsega; GC/MGC u `ugovor.py`; korak ocene u `journal_mae.py`.
- **D4 Statistika:** `daily-bias.ts` — dani `ok` sa biasom pre prvog ulaza na korenu; moj winrate i uvek long na istim
  danima; poeni (moji: Gore +pomeraj, Dole −pomeraj, Neutral 0; uvek long +pomeraj); pravi net $ i R trejdova u smeru /
  protiv biasa. Panel u /reports (dve kumulativne linije), red na kartici.
- **D5 Mentor paket:** red po danu i sekcija „Bias dana“.
- **D6 Trejd nasleđuje bias sa kartice;** `htf_bias_set` čita karticu; polje „Bias dana“ se ne prikazuje na trejdu
  (stara vrednost ostaje u bazi).
- **D7 Dokumentacija:** README 1:1 (oba repoa), ovaj fajl, `ROADMAP.md`, `trading-mentor`.

### Izlaz iz D
Bias se upisuje jednom dnevno po instrumentu pre trgovanja, journal ga sam oceni iz cena, a /daily, /reports i paket
pokazuju moj winrate i poene prema uvek long na istim danima.

**Isporučeno (18.10.2026):** D1 `8af430f` (tabela `tj_daily_bias`, guard trigger, reset; `rootOf`; GC/MGC u katalogu
i, jednom, u postojećoj knjizi — provizije TopstepX 4.32 / 1.92 round turn, 18.10.2026), D2 `18d7077` (kartica i akcija
`addDailyBias`, samo današnji dan, samo insert), D3 futures-trading `adb046c` (`tools/journal_bias.py` u satnom
`journal_mae.py`; `ugovor.py` zna GC/MGC — meseci G/J/M/Q/Z, rol 3 radna dana pre first notice day-a, selftest;
kalibracija `testovi/bias_opseg` prošla: 23–29 % neutralnih u obe polovine, NQ 1h 2024–26 i spot zlato 1h 2016–26),
D4 `fcdf8ee` (/reports panel), D5+D6 `293067b` (paket; `htf_bias_set` i `review_complete` čitaju karticu od
`BIAS_CARD_SINCE = 2026-10-19`, stranica trejda više ne traži polje). Gate zelen (2978 testova).
Migracija `20261017120000` primenjena 18.10.2026 uz odobrenje trejdera (posle dva otkazana poziva): tabela sa RLS
(4 politike) i 2 okidača, GC i MGC u knjizi trejdera (sada 8 instrumenata). **Otvoreno:** (2) ES nije kalibrisan (nema
časovnih sveća ES fjučersa u repou); ponoviti `bias_opseg` na Databento 1m (NQ, ES, GC) i proveriti udeo neutralnih
posle ~30 stvarnih ocena. (3) Rol zlata (3 radna dana pre FND) nije proveren prema `GC.v.0` po volumenu. (4) Ručna
provera u pregledaču nije rađena.

## X — Journal bez pravila prop firme (detaljno, 26.10.2026) — ✅ 27.10.2026

**Povod** (trejder, 26.10.2026: „skroz ćemo izbaciti bilo kakva pravila iz journala, ne može da bude vezan za prop
firmu, treba da bude neutralan … treba da služi za trejdove i journal, a ne za pravila prop firmi, a ja sam taj koji
poštuje ili ne pravila“). Trejder prelazi sa Topstep-a na **Tradeify** (NinjaTrader / Tradovate), a kasnije i na
automatski uvoz iz NinjaTrader-a (AddOn šalje svaki fill journalu preko HTTPS-a, sa redom kad nema mreže). Taj
uvoz je **posebna faza posle X**. X samo čisti journal.

**Cilj:** journal beleži trejdove, meri ih i nosi dnevnik. Ne zna ni za jednu prop firmu: nema MLL, DLL plana,
konzistentnosti, Combine / XFA / Scaling Plan-a, puteva isplate, „passed / failed“, Topstep banera ni Topstep dana.
Tracker meri samo proces (X-1 B). Novčana pravila poštuje trejder sam, na platformi svakog naloga.

### Utvrđeno u kodu i bazi (26.10.2026)
- **Obim:** 162 fajla pominju Topstep / MLL / DLL / XFA / isplatu (`src`, migracije, testovi). Od toga je 71 u
  `src/lib/journal` i 26 u `src/components/journal`. Najviše pominjanja imaju `topstep.ts` (188), `tracker/auto-rules.ts`
  (87), `account-settings.tsx` (77), `import-wizard.tsx` (60), `topstepx-export.ts` (51), `dashboard.tsx` (45),
  `topstep-status.ts` (34) i `survival.ts` (28).
- **Mašina pravila:** `topstep.ts`. Tu su planovi 50K/100K/150K, trailing MLL po EOD, DLL, 55 %, XFA Scaling i
  isplata, `riskBudgetAt`, `topstepBreakevenBand`, `TOPSTEP_SLIPPAGE_TOLERANCE` i `TOPSTEP_DEFAULT_RISK_PCT`. Uz nju:
  `topstep-status.ts`, `topstep-banner.tsx` i paritetni `topstep-parity.json` (968 redova, deli ga brief u
  `futures-trading`).
- **Dan:** `time.ts` → `topstepTradingDay`, `TopstepDayZone`, `accountDayZone`. Kad je `topstep_mode` uključen, dan
  traje 17:00 → 17:00 CT (F2). Isti ključ koriste kalendar, /daily, tracker, izveštaji, `missed-cost.ts` (M3-A) i
  `scenario.ts` (horizont „do kraja Topstep dana“).
- **Tracker:** novčana pravila rade **samo na Topstep nalogu** (posle H2 nema % grane). To su `max_loss_per_day`
  (DLL / lični DLL), `max_loss_per_trade` (budžet na ulazu + 10 %), `risk_per_trade`, `risk_matched_intent` (broj
  ugovora iz budžeta) i `no_entry_after_daily_target`. Ostala pravila ne zavise od firme. Pravilo `flat_by_close` u
  bazi se zove „Ravno do kraja Topstep dana“.
- **Rizik:** `room_at_entry`, `risk_budget_at_entry` i `equity_at_entry` na `tj_positions`. Risk % u /reports =
  rizik ÷ prostor do MLL-a (kante oko 8 %). Breakeven pojas bez stopa = ±0,1 × budžet plana (K4).
- **Survival:** `simulateTopstepSurvival` (trailing MLL), widget „Topstep status“ (ne može da se sakrije) i „Survival
  simulation“ na dashboardu.
- **Nalog u bazi:** `tj_accounts.topstep_mode / _plan / _stage / _reset_at / _payout_at / _personal_dll /
  _daily_target`.
- **Baza na dan 26.10.2026:** jedan nalog, „50K Combine“ (Topstep, combine, neaktivan, 7 trejdova, 0 cash eventa).
  Rizik je fiksnih $300 (`risk_rule_pct` 100, min = max = 300), lični DLL $650, cilj dana $1.500.
- **Uvoz:** `topstepx-export.ts` i `topstepx-orders.ts` su format platforme TopstepX, ne pravila firme.
- **Katalog:** fabričke provizije u `default-instruments.ts` su Topstep-ove (help.topstep.com).
- **`futures-trading`** (brief, `tools/brief/racun.py`) računa ugovore, DLL i MLL isto kao `topstep.ts`.
  **Taj repo nije u ovoj sesiji.**

### Šta ostaje (nije pravilo firme)
Trejdovi, fill-ovi, provizije, P&L, R, MAE/MFE, „šta bi bilo“, bias dana, playbook-ovi i checklist, tagovi, slike,
/daily (brief, mentalna ocena, zaključavanje), /reports, mentor paket, cash eventi (uplata, isplata, povlačenje,
korekcija kao obični tokovi novca), sesije po Beogradu i trackerova pravila koja ne čitaju Topstep brojeve.

### Odluke trejdera (26.10.2026)
- **X-1 B — novčana pravila trackera se brišu, tracker meri samo proces** (trejder: „jer ako bude više naloga na prop
  firma biće konflikta“). Odlaze `max_loss_per_day`, `max_loss_per_trade`, `risk_per_trade`, `risk_matched_intent`,
  `no_entry_after_daily_target`, njihovi razlozi i osnovice (`basis`). Iz koda izlazi i auto ključ, a postojeći redovi
  se penzionišu (`deleted_at`). Polja lični DLL, cilj dana i budžet rizika nemaju više čitaoca, pa nema ni
  neutralnih kolona za njih. Pravila procesa ostaju: `stop_after_two_losses` (broji stopove, ne novac),
  `trading_window`, `flat_by_close`, `no_entry_in_red_window`, playbook, stop, teza, bias, tagovi, slike, review.
  `honest_tags` gubi uslov „Ispoštovao rizik uz pao rizik“, a uslov uz pogođen stop ostaje.
- **X-2 A** — brišu se Survival, prostor do MLL-a, baner i widget. Risk % = rizik ÷ balans naloga na ulazu
  (`equity_at_entry`), a kante u /reports se ponovo dele. **Breakeven bez stopa** (posledica X-1 B, jer nema više
  budžeta): pojas naloga iz Settings (`breakeven_from/to/unit`, već postoji). Trejd sa stopom ostaje ±0,1R svog rizika.
- **X-3 A** — CME dan 17:00 → 17:00 CT za fjučers nalog, preimenovan (`cmeTradingDay`). Ne zavisi od prop režima.
- **X-4 A** — oznaka naloga „practice / demo“ (`tj_accounts.practice`), statistika odvojeno kao danas.
- **X-5 A** — prvo aditivna migracija (`practice`, `flat_by`) sa prepisom vrednosti, pa posebna migracija koja briše
  `topstep_*` i `risk_rule_*`, samo uz odobrenje trejdera. **Uslov za brisanje:** pre toga proveriti šta brief u
  `futures-trading` čita iz `tj_accounts` (vidi X-10). Ako čita `topstep_*`, kolone ostaju dok se brief ne reši.
- **X-6 A** — „50K Combine“ postaje običan nalog i arhivira se, 7 trejdova ostaje. Tradeify nalog trejder pravi sam.
- **X-7 → univerzalni uvoz** (trejder: „trebali bi biti uvozi univerzalni da prepoznaje sve ako se nekad vratim na
  TopstepX ili neku drugu firmu“). U X se TopstepX parseri **ne brišu**. Ostaju kao jedan od formata, nazvani po
  platformi, ne po firmi. Uvoz je posebna faza posle X: sam prepoznaje format fajla (TopstepX, NinjaTrader,
  Tradovate …) i prima NinjaTrader AddOn preko HTTPS-a. Format se tamo bira po zaglavlju fajla, ne po nalogu.
- **X-8 A** — fabričke provizije 0. Trejder ih upisuje po instrumentu, a kasnije stižu iz NT fill-a. Knjiga se ne menja.
- **X-9 A** — „ravno do“ je polje naloga (`flat_by`, podrazumevano 16:00 CT). Čitaju ga `flat_by_close`, horizont
  „šta bi bilo“ i cena promašaja.
- **X-10 odloženo** — brief se razmatra na kraju (trejder: „brief ćemo na kraju da razmislimo“). Journal u X briše
  svoj `topstep.ts` i paritetni test. `futures-trading` se ne dira.
- **X-10 odlučeno (26.10.2026):** trejder: „Brief ne treba uopšte da piše o trejdovima nego samo o instrumentima i o
  tome ostalom. Nikakve veze sa journalom.“ Na pitanja: (1) **prekid skroz** — brief više ne čita naloge i trejdove
  i više ne upisuje `tj_session_briefs`; (2) večernji Telegram podsetnik se **gasi**; (3) uputstvo za rizik (PDF) se
  **briše**. MAE/MFE, „šta bi bilo“ i ocena biasa (`journal_mae.py`, `journal_bias.py`) nisu brief i ostaju; noćni
  backup ostaje.

### Podkoraci (svaki: test koji pada → kod → gate → commit + push)
- **X1 Tracker samo proces** (X-1 B). Iz `auto-rules.ts`, `tracker-types.ts`, `tracker-checklist.tsx`,
  `tracker-rule-manager.tsx` i fabričkog seeda izlazi pet novčanih ključeva. Migracija penzioniše postojeće redove i
  sužava CHECK na `auto_key`. Prilagođava se `honest_tags`.
  **Isporučeno (26.10.2026):** pet ključeva izlazi iz `AUTO_RULE_KEYS`, evaluatori, `LimitBasis`, `limit` / `basis` /
  `observed` iz rezultata i budžet / broj ugovora iz `TrackerTrade`. Checklist više ne prikazuje novac. Migracija
  `20261026120000_tracker_process_only.sql` penzioniše redove, `honest_tags` čita samo stop, a fabrička lista je bez
  novčanih pravila i bez „Walk Away Target“. CHECK se **ne sužava**: zaključani dani (u bazi po 1 zamrznuta ocena
  na svakom od pet pravila) pokazuju na te redove. Iz `topstep.ts` izlaze `topstepMaxContracts` i
  `TOPSTEP_SLIPPAGE_TOLERANCE` (bez čitaoca). Gate zelen, 2956 testova. Migracija primenjena 26.10.2026 uz
  odobrenje trejdera („Ajde“).
- **X2 Neutralni nalog** (X-4, X-5 aditivno, X-6, X-9). Kolone `practice` i `flat_by` sa prepisom
  (`practice` = `topstep_stage = 'practice'`). Settings › Accounts bez Topstep sekcije (plan, faza, reset, isplata,
  lični DLL, cilj, budžet rizika); ostaju practice i „ravno do“. `isPractice` čita novu kolonu. „50K Combine“ se
  arhivira (podaci, uz migraciju).
  **Isporučeno (26.10.2026):** migracija `20261026130000_account_practice.sql` (`tj_accounts.practice`, prepis iz
  `topstep_stage = 'practice'`). `isPractice` čita kolonu. Settings › Accounts ima „Practice / demo account“ umesto
  Topstep sekcije (bez plana, faze, isplate, reseta, ličnog DLL-a, cilja i rizika po trejdu). `updateAccount`
  prima samo `practice` od tih polja, `resetTopstepAccount` je obrisan, a duplikat ne nosi `topstep_*` ni
  `risk_rule_*`. Upozorenje TopstepX naloga čita `practice`. **Promene u odnosu na plan:** (1) `flat_by` ide u X4,
  zajedno sa čitaocima, da polje ne stoji bez upotrebe; (2) „50K Combine“ se ne arhivira iz baze, jer journal ne
  dozvoljava arhiviranje poslednjeg aktivnog naloga. Trejder ga arhivira u Settings kad napravi Tradeify nalog.
  Gate zelen, 2955 testova.
- **X3 Bez mašine pravila** (X-2). Brišu se `topstep.ts`, `topstep-status.ts`, `topstep-banner.tsx`,
  `topstep-parity.json` i njihovi testovi, widget „Topstep status“ i „Survival simulation“, `survival.ts` i deo
  skora „Survival“, upis `room_at_entry` / `risk_budget_at_entry` u uvozu i na trejdu, veličina u ugovorima iz budžeta
  i prop-firm headroom. Risk % ide na balans na ulazu, a breakeven bez stopa na pojas naloga.
  **Isporučeno (26.10.2026):** obrisani su `topstep.ts`, `topstep-status.ts`, `topstep-banner.tsx`, `survival.ts`,
  `survival-card.tsx`, `tracker/equity-ladder.ts`, `topstep-parity.json` sa testovima i `.gitattributes`, kao i
  widget-i „Topstep status“ i „Survival simulation“ („Time stop“ je sada pune širine). Uklonjeni su i DLL na kartici
  „Pred sesiju“ i u toploti otvorenih pozicija, deo „Prop-firm room“ iz Survival ose, Topstep sekcija mentor paketa,
  upis `room_at_entry` / `risk_budget_at_entry` pri uvozu, budžet rizika na stranici trejda (sada „rizik do stopa“),
  `computeTopstepRisk` / `computeFuturesContracts` i ostaci zaštite „blown account“ (`addsExposure`, polje
  `origin`). Risk % = rizik ÷ `equity_at_entry` (svih 7 trejdova ga ima). Kante u /reports: < 0,25 %, 0,25–0,5 %,
  0,5–0,75 %, 0,75–1 %, 1–2 %, ≥ 2 %. Breakeven: ±0,1R rizika do stopa na **svakom** nalogu, a bez stopa pojas
  naloga (`breakevenRangeResolver` za tracker). Za „50K Combine“ pojas bez stopa je sada 0–0 umesto ±$16.
  Gate zelen, 2769 testova.
- **X4 Dan i sesija** (X-3, X-9). `topstepTradingDay` → `cmeTradingDay`, `TopstepDayZone` → `CmeDayZone`, uključeno
  za fjučers nalog. `scenario.ts`, `missed-cost.ts` i `flat_by_close` čitaju `flat_by`.
  **Isporučeno (26.10.2026):** `cmeTradingDay` / `CmeDayZone` (bili su `topstepTradingDay` / `TopstepDayZone`).
  `accountDayZone` daje CME dan **svakom** nalogu, jer knjiga drži samo CME fjučerse, pa `topstep_mode` više niko ne
  čita. Migracija `20261026140000_account_flat_by.sql` dodaje `tj_accounts.flat_by` (`HH:MM` po Čikagu, '16:00', CHECK)
  i menja tekst pravila „Ravno do kraja Topstep dana“ → „Ravno do kraja dana“. `flatByFor(dan, brief, flat_by)`:
  vreme naloga, osim kad brief javi RANIJE zatvaranje (praznik). Obično 15:10 iz brief-a više ne važi, jer je to bilo
  Topstep-ovo vreme. `flat_by_close` ocenjuje svaki nalog po njegovom vremenu (`flatByResolver`, kontekst `flatByOf`),
  a razlog `no_topstep_trades` je obrisan. Settings › Accounts ima „Flat by (Chicago time)“, a kartica „Pred sesiju“
  prikazuje vreme primarnog naloga. **Promena u odnosu na plan:** horizont „Šta bi bilo“ i cena promašaja (15:10 CT)
  računa `futures-trading`, pa ostaju do odluke o brief-u (X-10); journal samo menja tekst u „do kraja dana (15:10
  CT)“. Gate zelen, 2773 testa. Migracija čeka odobrenje trejdera.
- **X5 Tekstovi i podaci** (X-8). Mentor paket, /reports hintovi, razlozi trackera, `nav.ts`, komentari kataloga.
  Red „Ravno do kraja Topstep dana“ → „Ravno do kraja dana“. Fabričke provizije 0.
  **Isporučeno (26.10.2026):** migracija `20261026180000_neutral_factory_data.sql`: fabrički katalog ima proviziju 0
  (samo prazan nalog, postojeći instrumenti ostaju), fabričke liste imaju „Kraj dana (ravno)“ umesto „Kraj Topstep
  dana“ i nemaju „Ulaz posle dnevnog cilja“ / „Ulaz posle DLL-a“, a trejderova opcija „Kraj Topstep dana“ dobija novo
  ime (nijedan trejd je nema). Tekstovi: „Šta bi bilo“ panel, cash event „Payout“, komentari (katalog, scenario,
  missed-cost, sesije, brief kartica, tracker, plan rizika). Mentor paket, /reports hintovi, razlozi trackera i
  `nav.ts` već su bili neutralni (X1–X4); TopstepX ostaje ime formata uvoza (X-7). Migracija primenjena.
- **X6 Brisanje kolona** (X-5 A, uz odobrenje; tek kad se proveri brief). Brišu se `topstep_*`, `risk_rule_*`, a
  `room_at_entry` i `risk_budget_at_entry` ako ih brief ne čita. `schema:check`.
  **Provereno 26.10.2026 (`futures-trading` @ 3c22796): blokirano do X-10.** `tools/brief/racun.py` čita
  `topstep_plan`, `topstep_payout_at`, `topstep_reset_at`, `topstep_personal_dll`, `topstep_daily_target`,
  `topstep_stage`, `risk_rule_pct/min/max` i filtrira naloge po `topstep_mode = true` (bez `practice`).
  `tools/journal_podsetnik.py` (Telegram 15:20 CT) filtrira po `topstep_mode` i `topstep_stage`. Brisanje bi srušilo
  brief i podsetnik, pa kolone ostaju dok trejder ne odluči o brief-u. `room_at_entry` / `risk_budget_at_entry` brief
  ne čita. Kad se X-10 reši, podsetnik treba da bira naloge po `practice = false` i `archived_at`, a brief bez
  Topstep računa.
- **X8 Brief bez journala** (`futures-trading`, X-10). Briše se `tools/brief/racun.py` (koren simbola `KOREN`
  prelazi u brief), sekcija „Rizik danas“ i broj ugovora, naslov po Topstep nalozima, `za_journal` /
  `upisi_u_journal` i `--bez-journala`. Brišu se `tools/journal_podsetnik.py`, `podsetnik.yml`, `test_podsetnik.py`,
  `tools/uputstvo/uputstvo_rizik.py`, `test_topstep_parity.py` + `topstep_parity.json` i selftest u `provera.yml`.
  Brief workflow više ne dobija ključeve journala. README i `tools/brief/RUTINA.md` (pravilo tog repoa) u istom
  commitu.
- **X9 Journal bez brief-a** (X-10). Journal više ne čita `tj_session_briefs`; tabela i njeni redovi ostaju kao
  istorija. Odlazi kartica „Pred sesiju“ (ostaje vreme „ravno do“ naloga), pravilo `no_entry_in_red_window` se
  penzioniše (`deleted_at`, ključ ostaje u CHECK-u zbog istorije), auto greška „Ulaz u crvenom prozoru“ odlazi,
  `flat_by_close` čita samo vreme naloga (praznik i rano zatvaranje više se ne vide — trejder ih poštuje sam),
  mentor paket bez crvenih prozora i raspona. Testovi, README.
  **X8 isporučeno (26.10.2026, `futures-trading` 06a8b6a):** brief bez „Rizik danas“, tabele ugovora, XFA pravila,
  Topstep CPI pravila i upisa `tj_session_briefs`; `racun.py` premešten u `testovi/rizik/` (samo za stare testove
  rizika). **Promena u odnosu na odluku (2) „podsetnik se gasi“:** podsetnik je nosio i večernji pregled tržišta (dan
  na NQ/ES, linije iz brief-a, ocena jutarnje procene za Claude rutinu), pa je po pravilu trejdera „brief treba da
  bude brief za tržište, ne za journal“ ugašen samo njegov journal deo; `tools/podsetnik.py` šalje samo tržište.
  Obrisani `uputstvo_rizik.py`, test pariteta, journal tajne iz brief i podsetnik workflow-a. README i RUTINA.md.
  **X9 isporučeno:** `session-brief.ts` → `flat-by.ts` (vreme naloga i dan plana), bez kartice „Pred sesiju“,
  `getSessionBriefs`, auto greške „Ulaz u crvenom prozoru“ i prozora u mentor paketu; `no_entry_in_red_window` izlazi
  iz koda, a migracija `20261026190000` ga penzioniše i skida iz fabričke liste. Gate zelen, 2801 test.
  **X6 isporučeno (27.10.2026):** migracija `20261027090000_drop_prop_firm_columns.sql` briše 10 kolona naloga i 2
  trejda (provereno: nijedna funkcija, view ni trigger ih ne pominje); tipovi, `accounts.ts`, rezervisani ključevi,
  zapis baznih tabela i test fiksture bez njih. `testovi/rizik/racun.py` u `futures-trading` posle brisanja čita
  nalog samo iz argumenata (journal vraća grešku → `--bez-journala` put).
- **X6** posle X8 (brief i podsetnik više ne čitaju kolone): briše `topstep_*`, `risk_rule_*`, `room_at_entry`,
  `risk_budget_at_entry`, uz odobrenje.
- **X7 Dokumentacija 1:1.** README (Topstep, Survival, A trading day, Risk, tracker, Settings), `ROADMAP.md`, ovaj
  fajl, `AGENTS.md` („Current work“).
  **Isporučeno (26.10.2026):** README (uvod, breakeven po riziku, „danas“, cena promašaja, mentor paket, zastareo
  plan, „šta bi bilo“, § No prop firm's rules sa X5 i stanjem X6), `ROADMAP.md` (redovi X i B), `AGENTS.md`. Topstep
  ostaje u README-u samo za brief i podsetnik iz `futures-trading` (X-10), za uvoz TopstepX (X-7) i kao istorija.

**Veličina i model:** **Opus**. Oko 160 fajlova, dve ili tri migracije, više sesija (X1–X2, X3, X4–X7). Svaki
podkorak se pushuje odmah.

### Izlaz iz X
U kodu, bazi i README nema nijedne prop firme (osim naziva formata uvoza TopstepX). Journal na bilo kom nalogu meri
trejdove i proces, a postojećih 7 trejdova se čita kao i pre.

## B — Brzi unos: trejd za ~30 s, razmišljanje na zatvaranju dana (detaljno, 26.10.2026) — ✅ 27.10.2026

**Povod** (trejder, 26.10.2026: „cilj je napraviti što manje ručnog rada po pojedinom trejdu, a praviti jedan dnevni
izveštaj zatvaranjem dana“). Pravila: ništa istorijsko se ne briše. Polje skinuto sa forme ostaje u bazi i vidi se
(read-only) na starim trejdovima. Svaka izračunata vrednost na trejdu nosi oznaku „auto“.

### Odluke trejdera (26.10.2026)
- **B-1 A:** „Ulaz posle dnevnog cilja“, „Ulaz posle DLL-a“, „Prevelika pozicija“ i „Previše trejdova“ se **ne**
  detektuju. Traže novčani limit ili broj trejdova po nalogu, što X-1 B (konflikt više prop naloga) i odluka od
  30.09. (broj trejdova se ne ograničava) isključuju.
- **B-2 ne:** nema automatskog grafika iz sveća. Sveće su u R2 i čita ih samo `futures-trading`.
- **B-3 ne:** nema audio priloga.
- **B-4 da:** X4 migracija puštena (26.10.2026). Faza B ide pre X5–X7.
- „Teza naglas“ ostaje pravilo koje trejder isključuje sam (Settings › Tracker, penzionisanje). Novo podešavanje ne
  treba.

### Utvrđeno u kodu i bazi
- Checklist (`playbook-checklist.tsx`) prikazuje sve sekcije playbook-a. Setup A/B/C se računa iz pravila sa
  `is_setup_criterion`, a to su tačno pravila iz „Zašto ulazim“ u oba playbook-a. `offeredRuleAnswers` šalje odgovor
  za svako ponuđeno pravilo, a čuvanje (`tj_replace_position_rules`) zamenjuje sve odgovore trejda.
- Kategorije na formi čitaju samo aktivne opcije (`getOptionsMap(true)`). Opcija sa `is_active = false` se ne nudi,
  a vrednost koju stari trejd već ima ostaje i vidi se.
- Već postoje kao pravila trackera sa listom prekršilaca: `trading_window`, `no_entry_in_red_window`,
  `stop_after_two_losses`, `htf_bias_set`, `playbook_linked`. Postoji i `stopStatus` (pomeren stop, iz izvoza
  naloga), MFE u R (`futures-trading`) i planirani R:R (stop i cilj).
- /reports već ima redni broj trejda u danu (1., 2., 3., 4.+), Setup A/B/C, playbook, sesijski prozor i panel „Bias
  dana“ (sa biasom / protiv, $ i R). Nedostaje cena grešaka koja sabira ručne i automatske.

### Podkoraci (svaki: test → kod → gate → commit + push)
- **B1 Checklist samo „Zašto ulazim“:** nudi se samo kriterijum setupa. Odgovor koji stari trejd ima na ostala
  pravila vidi se read-only i čuva se netaknut. Playbooks: upozorenje kad su „Gde ulazim“ ili „Gde izlazim“ prazni.
- **B2 Liste:** tehnički tagovi na formi samo Sweep likvidnosti, SMT divergencija i FVG. Ručne greške samo Rani
  ulaz, Jurio cenu, Teza posle klika, Osvetnički ponovni ulaz, Rano zatvorio dobitak i Stop postavio bracket, ne ja
  (plus „Bez greške“, koju ocena A upisuje sama). Ostale opcije dobijaju `is_active = false` (migracija podataka).
  Greške se traže samo kad ocena nije A.
- **B3 TF po playbook-u:** `tj_playbooks.default_entry_tf` (aditivno; „3 candle 5min BOS“ → 5m). Trejd bez TF-a ga
  dobija unapred popunjenog, uz oznaku „auto (playbook)“. Polje se menja u Settings › Playbooks.
- **B4 Automatske greške** (`auto-mistakes.ts`, čista funkcija, testovi za granice): ulaz van prozora, ulaz u
  crvenom prozoru, ulaz posle 2 SL, bez biasa dana pre ulaza, ulaz bez setupa iz playbook-a, cilj ispod 2R,
  pomerio stop, dobitak pretvorio u gubitak (MFE ≥ 1R, net < 0). Računaju se pri čitanju, ne upisuju se u kolonu
  „Greške“. Na trejdu stoje kao „auto“ uz razlog. Kad podatka nema (prozor nije upisan, nema brief-a, nema izvoza
  naloga, nema MFE, nema cilja), greška se ne pogađa. /reports dobija dimenziju „Sve greške (ručne + auto)“.
- **B5 Psihologija dana na /daily:** `tj_daily_reports.psychology_tags` (aditivno). Novo automatsko pravilo
  `daily_psychology`: dan sa trejdom bez psihologije dana = ✗. Na trejdu psihologija ostaje opciona.
- **B6 Pravila trackera:** „Dnevnik i tagovi“ bez TF-a i psihologije, a uz ocenu C traži i rečenicu.
  „Screenshotovi“: slika obavezna za trejd sa ocenom C i za najbolji i najgori trejd dana (po neto). Novi tekst
  pravila u bazi; zaključani dani se ne menjaju.
- **B7 Zatvaranje dana na /daily:** jedna kartica posle sesije. Sadrži psihologiju dana, mentalnu ocenu, najbolji i
  najgori trejd (sa slikom ili bez), greške dana (ručne + auto) sa cenom u R i $, pa zaključavanje.
- **B8 Dokumentacija:** README 1:1, ovaj fajl.

**Model:** Opus. Oko 20 fajlova i tri migracije (playbook TF, liste, psihologija dana + pravila).

### Isporučeno (26.10.2026)
- B1–B8 u kodu, gate čist, spojeno u `main`. Stanje migracija: prve dve primenjene, treća delom (vidi mapu). Migracije: `20261026150000` (liste), `20261026160000`
  (`default_entry_tf`), `20261026170000` (`psychology_tags`, `daily_psychology`, novi tekstovi pravila). Kod
  čita obe nove kolone, pa migracije idu pre spajanja u `main`.
- **Nije urađeno (namerno):** detekcije iz B-1 A; auto grafik (B-2); audio (B-3). „Dodao protiv pozicije“ je
  skinuta sa ručne liste, a automatski se ne detektuje (podatak o dodavanju protiv pozicije nije u pravilima ni
  u spec-u). Playbook „Ponoc pojas reversal“ sa praznim „Gde ulazim“ / „Gde
  izlazim“ dobija samo upozorenje „Prazne grupe“ u Settings › Playbooks — pravila se ne izmišljaju.

## E — Bez biasa dana (detaljno, 27.10.2026) — ✅ 27.10.2026

**Povod** (trejder, 27.10.2026): „Ne koristim više bias dana — market ne može da se predvidi, nego se trguje uz njega,
uz reakciju.“ Predviđanje smera izlazi iz celog toka journala, kao što je faza X izbacila pravila prop firme. Faza D
(kartica, ocena iz cena, „uvek long“) se gasi. Istorija ostaje: tabela `tj_daily_bias` i njeni redovi, polje
`custom.htf_bias` na starim trejdovima, zamrznute ocene zaključanih dana.

### Utvrđeno u kodu i bazi (27.10.2026, posle `0dfdd04`)
- **Biblioteka:** `daily-bias.ts` (`BIAS_CARD_SINCE`, `firstBiasResolver`, `summarizeBias`, `splitTradesByBias`,
  `biasPackSection` …), `daily-bias-queries.ts` (`getDailyBiases`), `rootOf` / `BIAS_ROOTS` u
  `default-instruments.ts`, koje čitaju samo bias i tracker.
- **Čitaoci `getDailyBiases`:** `/daily` (kartica, rezultat), `/calendar`, `/reports`, dashboard `/` (paket),
  `daily/tracker-actions.ts`, `auto-mistakes-queries.ts`, stranica trejda.
- **/daily:** `daily-bias-card.tsx` + `daily/bias-actions.ts` (`addDailyBias`).
- **Tracker:** `htf_bias_set` (`evalHtfBiasSet`, `biasWasSet`, `TrackerTrade.biasRoot`, `review.htfBias`,
  `AutoContext.biasOf`), `review_complete` traži bias (`biasKnown`), `honest_tags` ga čita POSREDNO (ocena A ili „Bez
  greške“ uz pao `htf_bias_set` = ✗). Tekstovi u `tracker-checklist.tsx`. Ključ je u `AUTO_RULE_KEYS`.
- **Baza, pravila:** `htf_bias_set` aktivno i obavezno („HTF nivoi i bias: na svakom trejdu upisan bias dana …“);
  `review_complete` u tekstu traži „bias dana“. Fabrička lista pravila (`tj_seed_tracker_rules`, `20261027100000`)
  **već nema** `htf_bias_set`, pa se ne menja.
- **Automatske greške:** `no_bias` u `auto-mistakes.ts` (iz prekršilaca `htf_bias_set`). Opcija „Bez biasa dana pre
  ulaza“ na listi grešaka je u bazi **već** `is_active = false` (B2).
- **Polje trejda:** `tj_field_defs.htf_bias` aktivno, `show_phase = always`, lista `htf_bias` sa četiri aktivne opcije.
  Stranica trejda ga od `BIAS_CARD_SINCE` krije i pokazuje napomenu sa kartice; ranije ga traži. Čuvanje
  kategorija spaja `custom` (`mergeCustom`), pa polje koje forma ne šalje ostaje netaknuto.
- **Fabričke kategorije:** `tj_seed_categories` (`20261026180000`) i dalje seje listu i polje `htf_bias` i grešku
  „Bez biasa dana pre ulaza“.
- **/reports:** `bias-panel.tsx` + `bias-chart.tsx` (moj bias prema uvek long, novac u smeru / protiv biasa).
- **Mentor paket:** sekcija „Bias dana“ (`biasPackSection` u `mentor-export.ts`). Uputstvo i legenda paketa ne pominju
  bias (provereno grep-om).
- **Uvidi:** `flip_flop_day` kaže „the bias was not settled“ (tekst, ne čita bias).
- **futures-trading:** `tools/journal_bias.py` nema svoj workflow ni red u rasporedu; zove ga korak 7 u
  `journal_mae.py` (satni `journal_mae` workflow). Test `tests/test_journal_bias.py`, README sekcija „Bias dana“.
  `testovi/bias_opseg/` je istraživanje i ostaje.

### Odluke
- **E-1** Kod koji samo služi biasu dana se briše (git čuva istoriju); podaci u bazi ostaju.
- **E-2** `htf_bias_set` se penzioniše (`deleted_at`), ključ ostaje u CHECK-u, isto kao `no_entry_in_red_window`
  (`20261026190000`): bez evaluatora otključan prošli dan ga izostavlja, zaključan čuva zamrznutu ocenu.
- **E-3** Polje `htf_bias` dobija `is_active = false`; na trejdu koji ima vrednost vidi se kao tekst samo za čitanje.
- **E-4 PITANJE trejderu:** jutarnja Telegram poruka (`tools/brief/RUTINA.md`, „🧠 Moje mišljenje — Sklonost
  gore/dole“, i `tools/dnevnik/procene.py`) daje Claude-ovu procenu smera. Ide li i ona, ili ostaje kao kontekst
  tržišta (brief, ne journal)? Do odgovora se ne menja.

### Podkoraci (svaki: test → kod → gate → commit + push)
- **E1 Journal kod:** bez kartice, akcije, panela, grafika, sekcije paketa, `daily-bias*.ts`, `rootOf`/`BIAS_ROOTS`;
  `htf_bias_set` van `AUTO_RULE_KEYS`; `review_complete` bez biasa; `no_bias` van `auto-mistakes.ts`; stranica
  trejda bez napomene, staro polje read-only; tekstovi trackera i `flip_flop_day`; testovi.
- **E2 Migracija** `20261027120000_without_daily_bias.sql` (podaci, uz odobrenje, SQL Editor): penzionisanje
  `htf_bias_set`, nov tekst `review_complete`, `tj_field_defs.htf_bias` → `is_active = false`, nova definicija
  `tj_seed_categories` bez liste / polja `htf_bias` i greške „Bez biasa dana pre ulaza“.
- **E3 futures-trading:** korak 7 iz `journal_mae.py`, `journal_bias.py` i njegov test odlaze; README.
- **E4 Dokumentacija:** README 1:1 (testovi, `lang:count`), ovaj fajl, `ROADMAP.md`.

**Model:** Opus.

### Isporučeno (27.10.2026)
- E1 + E4 `504a3f0`, gate čist (2.768 testova). E3 futures-trading `c3168eb` (237 testova).
- E2: migracija `20261027120000` primenjena 27.10.2026 uz odobrenje trejdera. Provereno upitom: `htf_bias_set`
  penzionisan, nov tekst `review_complete`, `tj_field_defs.htf_bias` `is_active = false`, `tj_seed_categories` bez
  biasa. Tri trejda imaju staro `custom.htf_bias` i vide ga samo za čitanje; `tj_daily_bias` je prazna.
- **Čeka odgovor:** E-4 (jutarnja poruka „🧠 Sklonost“).

## G — Put do profesionalca (detaljno, 27.10.2026) — 🔄

**Povod.** Trejder je tražio proveru da li journal podržava `trading-transkripti/PUT-DO-PROFESIONALCA.md`, pa poslao
Lance-ov video o dnevnom izveštaju (transkript 032). Od kartice ne ulazi sve: samo ono što fali, uz najveće
korišćenje postojećeg (trejder: „optimizovano za mene“).

### Utvrđeno u kodu i bazi (27.10.2026)
- `tj_daily_reports` ima `mental_temp` 1–5 (8 dana sa ocenom) i `mental_temp_at` (okidač `20261014200000`); forma
  `daily-report-form.tsx`, akcija `daily/actions.ts` (`mental_temp` 1–5), dimenzija `mental_temp` i uvid
  `low_mental_temp_entry` čitaju je. Tabela nije među 9 baznih u `production_base_tables.sql`.
- Propušten setup: `status = 'missed'`, forma `/trades/missed/new` (`createMissedSetup` traži ulaz, stop i cilj),
  merenje u futures-trading `journal_mae.py` korak 5 (`izmeri_promasaj`), `missed-cost.ts`, `reports/missed-panel.tsx`,
  sekcija paketa. **U bazi 0 propuštenih setupa.** Status `missed` se čita u ~45 fajlova.
- `trading_window` u bazi ima samo London 09:00–12:00 od 12.10.; NY prozor nije upisan. Settings forma predlaže
  poslednji prozor ili 09:00–12:00 (`tracker-rule-manager.tsx`).
- `afterSessionOpen` (`session-window.ts`) već daje minute posle otvaranja Londona (08:00 London) i NY (09:30), uz
  letnje računanje — osnova za pravilo prvih 10 minuta.
- Cilj procesa: ručno pravilo trackera već ima `created_at` / `deleted_at` i dnevni odgovor; ne treba nov kod.

### Podkoraci (svaki: test → kod → gate → commit + push)
- **G0** transkript 032 u `trading-transkripti` — ✅ `c01b5c4`.
- **G1** ovaj plan — ✅ `ff9d63e`.
- **G2** migracija `20261027140000_put_do_profesionalca.sql`: kolone stanja i `state_at` (okidač), `tomorrow_change`,
  `opportunities` (≤ 3), CHECK + red + fabrička lista za `no_entry_first_minutes`, NY prozor od 28.10. Uz
  odobrenje, pre G4 (kod G4 čita nove kolone). — ✅ primenjena 27.10.2026 (`20261027112909 put_do_profesionalca`);
  provereno upitom 27.10.2026: sve kolone, okidač `tj_daily_reports_state_at`, CHECK i pravilo
  `no_entry_first_minutes`, NY prozor od 2026-10-28, fabrička lista. Commit `ff9d63e` je pisao „nije primenjena“ —
  to je bilo stanje pre puštanja.
- **G3** `no_entry_first_minutes` (evaluator, tekst u checklist-i, automatska greška „Ulaz u prvih 10 min“) i dugmad
  „London 09:00–12:00“ / „NY 14:30–17:30“ u Settings › Tracker. — ✅ `db0ce0e`.
- **G5** mentor paket: „Size po oceni setupa i po nedeljama“ (broj trejdova, prosečni ugovori, rizik $ / %; nedeljna
  promena u %). Samo merenje. — ✅ `db0ce0e`.
- **G7** Propušten setup odlazi (oba repoa); stari status `missed` se i dalje čita bez greške, kolone ostaju. — ✅
  `924c438` + futures-trading `2dc54b8`.
- **G4** /daily: stanje pre sesije (san %, sati, smena, dete) umesto zvezdica, juče upisano „sutra menjam“ na vrhu;
  na „Zatvaranju dana“ polje „sutra menjam“ i do 3 prilike (opis, u playbook-u, mogao sam, najlakša); paket i
  /reports dimenzije po snu, smeni i detetu. — ✅ 27.10.2026, bez migracije.
- **G8** README 1:1 oba repoa, ovaj fajl, ROADMAP. Backtest: napomena o Practice nalogu „Backtest“.

### G4 — tehničke odluke (bez uticaja na trejderov izbor, zapisane radi ponovljivosti)
- **Šta se čuva:** `daily-report-schema.ts` (zod, sa testovima): stanje (`sleep_hours` na jednu decimalu kao
  `numeric(3,1)`), `tomorrow_change` (prazno → NULL, do 2000 znakova), `opportunities` (do 3, opis 1–500 znakova,
  najviše jedna najlakša). `mental_temp` se više ne šalje; upsert piše samo poslate kolone, pa stara ocena ostaje.
- **Prazan red prilike** (bez opisa) se pri čuvanju izostavlja, ne javlja grešku. Označavanje „najlakša“ skida oznaku
  sa ostalih.
- **„Danas menjam“ na vrhu /daily** = poslednji upisan `tomorrow_change` PRE tog dana (ponedeljak čita petak), ne
  doslovno jučerašnji (`getLastTomorrowChange`).
- **Kapija posle prvog ulaza** se datira po `state_at` kad dan ima stanje, inače po `mental_temp_at` (stari dani,
  `gateWrittenAt`). Stara ocena se na danu bez stanja prikazuje samo za čitanje; komponenta zvezdica (`star-rating.tsx`)
  je obrisana jer je nijedan ekran više ne koristi.
- **Grupe za /reports i paket** (pomoć pri čitanju, ne pravilo): san < 60 % / 60–79 % / 80 %+, sati < 6 / 6–6.9 / 7+;
  smena i dete po vrednosti. Po danu ULAZA, kao stara ocena; trejd čiji dan nema stanje ne ulazi u tabelu.
- **Uvid `low_mental_temp_entry`** ostaje i radi samo na starim danima sa ocenom: za stanje trejder nije postavio
  prag, pa nema novog uvida (ne izmišlja se pravilo) — stanje se čita kroz dimenzije.
- **Paket:** kolona „Mentalno“ → „Stanje pre sesije“ (stari dan: „mentalno 4/5“); nove sekcije „Zatvaranje dana
  (sutra menjam, prilike)“ i „Stanje pre sesije i rezultat“ (izostaju bez podataka); Dan-prompt pita da li je
  urađeno „sutra menjam“ i zašto najlakša prilika nije uzeta.

**Model:** Opus.

## I — Univerzalni uvoz (detaljno, 27.10.2026) — ⏸ čeka primere izvoza

**Povod** (trejder, X-7 i 27.10.2026): kad promeni prop firmu, ne sme da treba kodiranje. Uvoz zavisi od
**platforme** (NinjaTrader, Tradovate, Rithmic, TopstepX/ProjectX, Quantower), ne od firme. Trejder prelazi na
Tradeify (NinjaTrader / Tradovate).

### Utvrđeno u kodu i bazi (27.10.2026)
- `/import` (`import-wizard.tsx`) prepoznaje po zaglavlju samo TopstepX: `isTopstepXTrades` (`topstepx-export.ts`) i
  `isTopstepXOrders` (`topstepx-orders.ts`). Izvoz trejdova se čita direktno (`readTopstepXTrades`), više redova jedne
  pozicije spaja `groupTopstepXTrades`, a izvoz naloga daje cilj, poslednju cenu stopa i način izlaza.
- Svaki drugi CSV/XLSX ide na ručno mapiranje: `CANONICAL` kolone (instrument, smer, količina, ulaz, vreme ulaza …),
  `autoMap` pogađa po ključnim rečima (`KEYWORDS`). Jedan red = jedan trejd sa ulazom i izlazom; **fill-ovi
  (izvršenja) se preko ručnog mapiranja ne uvoze**.
- **`tj_column_mappings` NE postoji u bazi:** obrisala ju je `20260816140000` kao mrtvu šemu (provereno upitom
  27.10.2026). Zapamćeno mapiranje zato traži novu, aditivnu tabelu, uz migraciju i odobrenje.

### Podkoraci
- **I1 Prepoznavanje formata** (`import-formats.ts`: zaglavlje → format; TopstepX ostaje kakav je). NinjaTrader i
  Tradovate: fill-ovi u poziciju kao `groupTopstepXTrades`; stop, cilj i razlog izlaza iz izvoza naloga gde ga
  platforma daje. **Parser se piše tek iz stvarnog fajla** (testovi na tom fajlu, bez ličnih podataka).
- **I2 Zapamćeno mapiranje:** tabela (npr. `tj_import_mappings`: korisnik, otisak zaglavlja, mapa kolona, naziv),
  RLS po vlasniku; fajl sa istim zaglavljem prolazi bez mapiranja, uz dugme „promeni mapiranje“.
- **I3 NinjaTrader AddOn** (posebna podfaza): šalje svaki fill journalu preko HTTPS-a, sa redom kad nema mreže.
- **I4 Dokumentacija:** README 1:1, ovaj fajl.

### Pitanja za trejdera (bez odgovora se ne počinje)
- **I-1 Primeri izvoza** sa Tradeify naloga, jedan dan sa bar jednim trejdom (najbolje sa pomerenim stopom i jednim
  delimičnim izlazom): NinjaTrader (Trades / Executions / Orders iz Account Performance ili Control Center) i/ili
  Tradovate (Orders, Fills, Position History / Performance). Svaki fajl tačno kako ga platforma izveze.
- **I-2 Koju platformu stvarno koristiš** na Tradeify-u za trgovanje i za izvoz (NinjaTrader desktop, Tradovate web, oba)?
- **I-3 AddOn (I3):** autentikacija (lični token iz Settings, rotacija) i endpoint (Next.js ruta ili Supabase Edge
  Function) — dogovor pre koda.

**Model:** Opus.

## Katalog stavki

### P0 — brojevi koji su posle prelaska pogrešni

| # | Swing danas | Day trading | Fajlovi |
|---|---|---|---|
| 1 | **Dan = kalendarski dan u zoni naloga.** Kalendar, `/daily`, tracker presude, dnevni insights, `max_loss_per_day` | Za Topstep nalog dan je **Topstep dan 17:00 → 17:00 CT** (`topstepTradingDay` već postoji). Na New York nalogu (seed) fill između 18:00 i ponoći ET ide u taj kalendarski dan, a Topstep ga broji u sledeći — kalendar i „DLL danas" na baneru se ne slažu za isto veče | `time.ts`, `activity.ts`, `calendar-view.ts`, `tracker/*`, `daily-report*.ts`, `insights/day-rules.ts`, `review-gaps.ts` (i `journal_podsetnik.py`) |
| 2 | **Auto pravilo `thesis_written`** se ocenjuje na svakom trejdu | `/trades/log` piše rečenicu u `trade_journal_notes`, ne u `thesis` → svaki brzo upisan trejd pada pravilo i Process osa pada bez razloga. Ili rečenica ide u `thesis`, ili se pravilo gasi za quick-log/Topstep naloge (odluka trejdera) | `quick-log.ts`, `tracker/auto-rules.ts` |
| 3 | **Tracker limiti u % equity-ja** (`max_loss_per_trade/day/week`, `risk_per_trade`) | Topstep limiti su **novac**: dnevni gubitak = DLL plana, rizik po trejdu = `computeTopstepRisk` (8 % prostora iznad MLL, min/max plana). Na Topstep nalogu pravila čitaju plan, a ne unet procenat | `tracker/auto-rules.ts`, `tracker-types.ts`, `topstep.ts` |
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
