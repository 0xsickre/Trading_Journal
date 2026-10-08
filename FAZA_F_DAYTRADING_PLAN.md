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
