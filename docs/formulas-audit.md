# Revizija formula — sve računice u Trading Journal-u

Ovaj dokument popisuje **svaku formulu i metriku** koju journal računa, tačno kako je implementirana u kodu (fajl + logika), i za svaku daje **nezavisan verdikt** — proveren protiv stvarne trgovinske/finansijske prakse i web izvora, **ne protiv sopstvenih komentara u kodu** (komentar u kodu može biti pogrešan isto koliko i formula).

Oznake verdikta:
- ✅ **Standardno** — odgovara opšteprihvaćenoj praksi, potvrđeno eksternim izvorima.
- 🔵 **Namerni izbor, nije greška** — validna, odbranjiva odluka, ali odstupa od najčešće konvencije; vredi da to znate.
- ⚠️ **Nalaz — vredi popraviti** — pronađen je stvaran problem u logici ili u načinu na koji se metrika koristi.
- ⚪ **Bespoke/interno** — nema eksternog standarda za poređenje (proizvod je dizajna ovog journala), ocenjuje se samo na unutrašnju logičku ispravnost.

---

## 1. Osnovne trgovinske metrike (`analytics.ts`)

### Win rate
```
winRate = wins / (wins + losses) × 100
```
Breakeven trejdovi (po asimetričnom pojasu iz `breakeven.ts`) **isključeni su iz imenioca** — ne broje se ni kao pobeda ni kao gubitak.

**Verdikt: ✅ Standardno.** Isključivanje breakeven trejdova iz win-rate imenioca je uobičajena praksa u trgovinskim journal alatima (TraderVue, Edgewonk) — breakeven nije ni pobeda ni poraz, pa ne treba da razblažuje ni jedan ni drugi procenat.

### Profit factor
```
profitFactor = grossProfit / grossLoss
```
`Infinity` kad nema gubitaka, `null` kad nema ničega za deljenje.

**Verdikt: ✅ Standardno.** Ovo je tačna, opšteprihvaćena formula (gross profit / gross loss). `Infinity`-konvencija za "nema gubitaka" je uobičajena; neke platforme prikazuju "N/A" umesto — kozmetička razlika, ne greška.

### Expectancy (u R jedinicama)
```
expectancy = winRate × avgWinR + (1 − winRate) × avgLossR
```
Računa se isključivo nad populacijom trejdova koji IMAJU R vrednost (decided population).

**Verdikt: ✅ Standardno.** Ovo je tačno Van Tharp-ova formula za "trader's edge" izražena u R-multiple jedinicama — `(win% × avg dobitni R) − (loss% × avg gubitni R)`. Potvrđeno spoljnim izvorima kao standardna formula za expectancy.

### R-multiple — uvek GROSS, nezavisno od net/gross prekidača
Total R i avg R se računaju iz `realized_r` (cenovna distanca, iz `tj_position_stats` view-a) — **nikad** se ne menjaju kad korisnik prebaci prikaz na "net".

**Verdikt: 🔵 Namerni izbor, ispravan.** R-multiple po originalnoj definiciji (Van Tharp) meri kvalitet trejda u odnosu na PLANIRANI rizik (cenovna distanca do stop-a), ne u odnosu na troškove izvršenja. Provizije/swap su trošak izvršenja, ne deo "koliko je trejd bio dobar u odnosu na rizik". Ovo je i praksa kod ozbiljnih journal alata — R se ne kontaminira sa fee/swap. Ispravno postavljeno.

### Max drawdown — dve odvojene baze ($ i %)
- **$ drawdown**: iz čisto kumulativnog realizovanog P&L-a (slep na cash flow — depoziti/povlačenja se ne računaju).
- **% drawdown**: iz equity krive (starting balance + P&L + cash flow), `maxPctOfEquity` = peak-to-trough u odnosu na equity u tom trenutku.

**Verdikt: ✅ Standardno (posle ranije ispravke u ovoj sesiji).** Peak-to-trough u odnosu na equity U TRENUTKU vrha je tačna, udžbenička definicija max drawdown-a: `MDD = (trough − peak) / peak`. Ovo je upravo bag koji je ranije u ovoj reviziji pronađen i ispravljen (Percentage-mode tajl je pre toga delio sa DANAŠNJIM equity-jem umesto sa peak-om — netačno; sada koristi identičnu peak-relative vrednost kao posvećeni tajl). $ baza koja ignoriše cash flow je razuman, journal-specifičan izbor — izoluje trgovački rezultat od depozita/povlačenja, što je korisno baš za "koliko je trading sam po sebi bio loš", ali je vredno napomenuti da to NIJE isto što i "pad stvarnog kapitala na računu" (za to služi %-verzija).

### Best/worst trejd, win/loss streak-ovi
Prost max/min i brojanje uzastopnih pobeda/gubitaka.

**Verdikt: ✅ Standardno.** Nema šta da se proveri spolja — trivijalna, tačna implementacija.

---

## 2. Breakeven pojas (`breakeven.ts`)
Asimetričan pojas (različita gornja/donja granica), inkluzivan na oba kraja, sa `EXACT_ZERO_RANGE` fallback-om kad se nalozi u obuhvatu ne slažu oko pojasa.

**Verdikt: ⚪ Bespoke/interno.** Ne postoji spoljni "standard" za širinu breakeven pojasa — to je pitanje ličnog/journal pravila. Logika (inkluzivnost, fallback na tačnu nulu kad nema saglasnosti) je interno konzistentna i konzervativna. Nema nalaza.

---

## 3. Hold time / trajanje pozicije (`hold-time.ts`)
Prosek/max u sekundama i danima, razdvojeno po winner/loser/breakeven, bucket-ovanje: `<1d, 1-3d, 3-7d, 1-2w, >2w`.

**Verdikt: ✅ Odgovara profilu korisnika.** Bucket-ovi su skalirani za swing trading (par dana do nedelju+) — tačno profil koji ste opisali (pozicije par dana do vikenda). Da su bucket-ovi bili u satima/minutima (kao za day trading), to bi bilo pogrešno podešeno za vaš stil; ovako je ispravno kalibrisano.

---

## 4. MAE / MFE i capture % (`excursion.ts`, `excursion-scan.ts`)
```
mfeR, maeR — mereno od STVARNE prosečne cene ulaska, u odnosu na PLANIRANU distancu rizika
captureR% = realizedR / mfeR × 100   (samo kad je mfeR > 0)
```

**Verdikt: ✅ Standardno, potvrđeno protiv Edgewonk konvencije.** Definicije MAE (najveći neostvareni gubitak dok je pozicija otvorena) i MFE (najveći neostvareni dobitak) su tačne standardne definicije. Formula capture rate-a (`realizedR / mfeR × 100`) je doslovno identična formuli koju koristi Edgewonk (`actual profit / MFE`) — potvrđeno pretragom. Guard da capture% nikad ne pređe 100% je ispravna zaštita (fizički ne bi trebalo da je moguće ostvariti više od maksimalnog povoljnog izleta).

---

## 5. Entry slippage (`entry-slippage.ts`)
Nepovoljni poeni, slippage u R (protiv planiranog rizika), slippage u novcu — **bez fallback-a** za point value (odbija računicu umesto da nagađa 1).

**Verdikt: ✅ Ispravan defanzivni dizajn.** Odbijanje da se izmisli point value umesto tihog pretpostavljanja "1" je tačno pravilo dobre prakse — bolje prazno polje nego tihо pogrešan broj.

---

## 6. Exit efficiency / target attainment (`exit-efficiency.ts`)
```
targetAttainment% = realizedR / plannedRewardR × 100
```
Koristi SAČUVANI `planned_rr` (upisan pre nego što je trejd zatvoren), a ne naknadno preračunat — floor na 0.1R da se izbegne eksplozija pri deljenju.

**Verdikt: ✅ Dobra praksa protiv retroaktivne manipulacije.** Korišćenje SAČUVANOG plana umesto naknadno izračunatog cilja je bitna zaštita — sprečava da neko naknadno "ispeglа" statistiku menjajući plan posle zatvaranja trejda. Ovo je upravo princip koji ozbiljni journal alati primenjuju (plan se zaključava pre exit-a).

---

## 7. Period stats — nedeljni presek (`period-stats.ts`)
Bucket-ovanje po datumu ZATVARANJA (close date), ponovna upotreba `winRateOf`/`classifyOutcome` iz analytics/breakeven modula (bez duplirane logike).

**Verdikt: ✅ Standardno.** Atribucija P&L-a datumu zatvaranja (ne otvaranja) je uobičajena konvencija kod većine trgovinskih izveštaja.

---

## 8. Rizik-prilagođeni racio-i (`risk-ratios.ts`)

### Sharpe ratio
```
Sharpe = meanDaily / stdevDaily(population) × sqrt(periodsPerYear)
```
Računa se nad DNEVNIM P&L nizom (ne po trejdu), risk-free rate = 0.

**Verdikt: ✅ Standardna formula, sa dve napomene:**
- **Population vs sample stdev**: kod koristi *population* standardnu devijaciju. Spoljni izvori navode da većina finansijskih aplikacija tipično koristi *sample* (N−1) stdev za istorijski uzorak. Ovo je manje odstupanje — za kompletan, stvaran (ne uzorkovan) niz dnevnih rezultata, population stdev je opisno tačan izbor, ne greška, ali ako se ikad poredi sa brojem koji neko izračuna u Excel-u/drugoj platformi (koje po difoltu koriste sample stdev), brojevi će se blago razlikovati. Vredi navesti u UI tooltip-u.
- **Risk-free rate = 0**: razuman, uobičajen pojednostavljeni izbor za trgovinu na marginu (nije gotovinski depozit) — vidi se i kod drugih retail journal alata.

**⚠️ Nalaz — `periodsPerYear` meren iz podataka umesto fiksnih 252/365.**
```
periodsPerYear = (tradingDays × 365) / calendarSpanDays
```
Ovo je namerna, ali **genuinski nestandardna** odluka. Skoro sva finansijska praksa (potvrđeno pretragom) anualizuje Sharpe/Sortino sa **fiksnim** faktorom (obično √252 za dnevne equity podatke). Kod ovog journala, faktor anualizacije zavisi od toga koliko RETKO korisnik trguje: trejder koji trguje 20 dana u rasponu od 100 kalendarskih dana dobija `periodsPerYear ≈ 73`, ne 252 — što drastično smanjuje anualizovani racio u odnosu na ono što bi "standardni" Sharpe pokazao za iste dnevne rezultate. Ovo NIJE nužno pogrešno kao dizajn (može se argumentovati da bolje odražava stvarnu učestalost trgovanja), ali je toliko različito od onoga što svaka druga platforma/benchmark prikazuje da direktno poređenje sa objavljenim Sharpe racio-ima (npr. berzanski indeks, drugi fond) postaje besmisleno. **Preporuka: ili prebaciti na fiksnih 252 (industrijski standard za dnevne equity podatke), ili — ako se zadrži izmereni pristup — jasno obeležiti u UI da ovo NIJE direktno uporedivo sa "standardnim" Sharpe brojevima.**

### Sortino ratio
Downside deviation deli sa **SVIM** danima (ne samo gubitničkim).

**Verdikt: ✅ Ispravnije od uobičajene retail implementacije.** Ovo je zapravo tačna, akademski ispravna (Bawa-Lindenberg / BKM konvencija) formula — imenilac je UKUPAN broj perioda, ne samo broj perioda ispod cilja. Potvrđeno pretragom. Mnogi retail alati greše upravo ovde (dele samo sa brojem gubitničkih dana, što preuveličava kaznu za volatilnost) — ova implementacija je, po ovom pitanju, **bolja** od prosečne.

### Calmar ratio
```
Calmar = anualizovan ukupan P&L / max drawdown ($, ista peak-to-trough baza)
```

**Verdikt: ✅ Standardno.** Odgovara definiciji (anualizovan prinos / max drawdown preko istog perioda), potvrđeno pretragom. Brojilac i imenilac koriste istu "čistu P&L" bazu (bez cash-flow uticaja) — interno konzistentno.

### `MIN_RATIO_DAYS = 5` prag
**Verdikt: ⚪ Bespoke/interno.** Razuman minimalni uzorak pre prikazivanja racia; svaka platforma ima neki prag, konkretan broj je proizvoljan ali ne pogrešan.

### `computeDailyDrawdown` (FTMO-stil, svaki dan počinje od nule)
**Verdikt: ✅ Odgovara stvarnoj FTMO mehanici** (videti sekciju 11) — dnevni loss limit kod pravih prop firmi se meri od početka TOG dana, ne kumulativno — ovo se poklapa.

---

## 9. Recovery factor, consistency score, avg win/loss ratio (`risk-metrics.ts`)

### Recovery factor
```
recoveryFactor = netProfit / |maxDrawdown|
```
`null` (ne `Infinity`) kad je drawdown 0.

**Verdikt: ✅ Standardno.** Ovo je opšteprihvaćena formula (Net Profit / Max Drawdown), korišćena kod većine backtest/performance izveštaja. `null` umesto `Infinity` je razumniji UX izbor od tehnički "tačnog" Infinity — nema šta suštinski da se prigovori.

### Consistency score
```
consistencyScore = clamp(0, 100, 100 − (stdev / totalProfit) × 100)
```

**⚠️ Nalaz — matematički problem sa skalom.** Ovo NIJE standardna, imenovana metrika (bespoke), pa se ne može proveriti protiv spoljnog standarda — ali unutrašnja logika ima realan nedostatak: `totalProfit` je **suma** preko svih perioda i raste sa brojem trgovinskih dana/trejdova, dok `stdev` (devijacija PO periodu) sa vremenom ne opada proporcionalno. Posledica: dva trejdera sa **identičnom** dnevnom volatilnošću i identičnim prosečnim dnevnim rezultatom dobiće **različit** consistency score samo zato što jedan ima duži istorijat (veći `totalProfit` u imeniocu automatski gura razlomak ka nuli, a score ka 100) — score se vremenom "poboljšava" sam od sebe bez ikakve stvarne promene u doslednosti. **Preporuka:** koristiti koeficijent varijacije protiv PROSEČNOG profita po periodu (`stdev / avgProfit`) umesto protiv `totalProfit`, čime skala ne zavisi od broja perioda — to je i standardni oblik "coefficient of variation" korišćen za merenje doslednosti prinosa.

### Avg win/loss ratio (novčano, ne R-bazirano)
**Verdikt: ✅ Legitimna komplementarna metrika.** Novčani win/loss racio i R-bazirani expectancy mere različite stvari (jedan uključuje veličinu pozicije, drugi je normalizovan po riziku) — uobičajeno je da journal alati prikazuju oba. Nema nalaza, samo treba da UI jasno labelira da je ovo NOVČANI racio da se ne pobrka sa R-multiple prosekom.

---

## 10. Sickre Score — kompozitni 0-100 skor (`sickre-score.ts`)

Eksplicitno bespoke — **tabele bandova** prepisane iz TradeZella spec-a, **ponderi više ne**: maxDrawdown 25, profitFactor 20, consistency 15, avgWinLoss 5, recovery 5 (=70 trgovinskih) + process 30 (=100) + ftmoHeadroom 10 (=110 max). Win % je izbačen iz skora. RATIO_BANDS/RECOVERY_BANDS sa linearnom interpolacijom unutar zona, sample-gating (`MIN_SAMPLE=5`, `RELIABLE_SAMPLE=30`, `MIN_COVERAGE_SHARE=0.5`).

**Verdikt: ⚪ Bespoke — nema eksternog standarda, ali jedan interni nalaz vredi pažnje.**

Ovaj skor je po definiciji proizvod dizajna (kao i TradeZella-in originalni skor, koji takođe nije objavljeni akademski standard) — nema šta da se "proveri protiv prakse" osim unutrašnje logičke ispravnosti. Jedan nalaz:

**⚠️ Drawdown komponenta koristi `drawdownPctOfPeakPnl` (peak-P&L-relative), NE `maxPctOfEquity` (peak-equity-relative) koji se prikazuje svuda drugde.** Ovo je eksplicitno dokumentovano kao namerno ("NOT for display"), ali vredi preispitati SAM izbor, ne samo dokumentovanost: drawdown u odnosu na kumulativni PROFIT (a ne u odnosu na kapital) je nestabilna mera rano u životu naloga — kad je kumulativni profit mali (blizu nule), i mali dolarski pad proizvodi ogroman procenat ("50% pada" od $200 kumulativnog profita, iako je to možda 0.4% stvarnog kapitala od $50,000). Ovo znači da Sickre Score za NOV nalog (mala baza profita) može nepravedno strmo da kažnjava drawdown komponentu, nezavisno od toga koliko je stvarni kapital bio ugrožen. **Preporuka:** razmotriti da drawdown komponenta skora koristi istu peak-equity-relative bazu kao i ostatak aplikacije (konzistentnost + stabilnost), ili — ako se peak-PnL baza zadrži namerno — dodati donji prag kumulativnog profita ispod kog se komponenta ne računa (slično sample-gating principu koji se već koristi za broj trejdova).

Sample-gating logika (MIN_SAMPLE/RELIABLE_SAMPLE/coverage-share renormalizacija) je razumna, standardna statistička praksa (ne verovati skoru dok nema dovoljno podataka) — nema nalaza tu.

**Dopuna posle rebalansa pondera.** Ponderi su prestali da budu prepisani i postali su kalibracija za konkretan profil (swing, fiksni target ~3R, 40–70 trejdova godišnje, prop nalog). Tri obrazloženja, sva unutrašnje-logička jer eksternog standarda i dalje nema:

- **Win % izbačen iz skora.** Skala `win%/60 × 100` kodira „viši je bolji", što je netačno za knjigu čiji dizajn podrazumeva 35–45 % win rate. Merilo je dizajn strategije, ne kvalitet izvršenja. Ostaje kao prikazana metrika.
- **Avg win/loss 20 → 5.** Kod fiksnog targeta racio je determinisan planom, ne izvršenjem — meri konstantu, i delimično dublira profit factor (isti brojilac/imenilac iz drugog ugla).
- **Process adherence 15 → 30, najteža komponenta.** Jedina koja ne zavisi od varijanse; na n≈40 godišnje ostale mere ishod na uzorku premalom za pouzdanost.

**Nova komponenta: FTMO headroom (ponder 10).** `100 − max(worstDailyUsage, maxLossUsage) × 100`, gde je svaki usage frakcija sopstvenog pravila. Meri **najbliži prilaz** limitu kroz ceo izazov, ne trenutnu rezervu — nalog na +8 % koji je dodirnuo 4.5 % na 5 % limitu bio je jedan dan od kraja. Dnevni usage se akumulira unutar dnevne petlje u `ftmo.ts` (ne naknadno iz `dailyLossLimit`), jer pod `prev_close` bazom svaki dan ima svoj limit. Bez trejdova u prozoru izazova vraća `null`, ne 100 — ista klasa greške kao nalaz S1.

⚠️ **Sporedna posledica, zabeležena a ne prećutana.** Izbacivanje win %-a je smanjilo ponder komponenti gejtovanih po `decided` sa 60/100 na 25/70, pa knjiga od samih breakeven trejdova sad prelazi `MIN_COVERAGE_SHARE` sa drawdown-om i consistency-jem (40 od 70) i dobija skor umesto ćutanja. Prikazan je kao privremen, sa uzorkom i „2 of 5 components". Ako to treba vratiti na ćutanje, ručica je `MIN_COVERAGE_SHARE` — i pomera svaki skor u journalu. Ograđeno testom u `book.fixture.test.ts`.

---

## 11. Position sizing i planirani R:R (`plan-calculations.ts`)

```
riskAmount = trenutni equity × riskPct / 100
positionSize = riskAmount / (stopDistance × pointValue)
```
Bez zaokruživanja, bez fallback point value-a (odbija umesto da defaultuje na 1).

**Verdikt: ✅ Standardno — tačna "fixed fractional" position sizing formula.** Rizik kao procenat od TRENUTNOG (ne početnog) equity-ja je udžbenički Van Tharp model position sizing-a — rizikuje se fiksni % od trenutnog kapitala, tako da se pozicija automatski smanjuje posle gubitaka i raste posle dobitaka. Ovo je tačno postavljeno.

---

## 12. FTMO-stil pravila prop-firma (`ftmo.ts`)

Max loss, dnevni loss limit, I profit target — svi pegovani na **FIKSNI starting balance** (ne rolling/trailing high-water mark); depoziti/povlačenja isključeni; `targetReached` proverava PEAK equity, ne trenutni.

**Verdikt: 🔵 Delimično tačno, ⚠️ jedan konkretan nalaz.**

Proverio sam stvarnu FTMO metodologiju (za 2-Step Challenge, najčešći tip):
- **Max (overall) drawdown**: FTMO ZAISTA koristi **statičan** pod vezan za početni balans na 2-Step Challenge-u — kod ovde je tačno poravnat sa stvarnom praksom. ✅
- **⚠️ Dnevni loss limit**: stvarna FTMO metodologija računa dnevni limit od **balansa na zatvaranju PRETHODNOG trgovinskog dana**, ne od originalnog starting balance-a. To je pokretna (dnevno-ažurirana) referentna tačka, različita od statičkog poda za max drawdown. Kod u ovom journalu peguje OBA limita (i max loss i dnevni loss) na isti fiksni starting balance — što znači da za nalog koji je već ostvario profit, journal-ova simulacija dnevnog limita biće **stroža** nego što bi stvarni FTMO dozvolio (pravi FTMO bi dozvolio 5% od VEĆEG, narasla balansa; kod ovde i dalje računa 5% od originalnog, manjeg iznosa). Ovo je konkretno, proverljivo odstupanje od stvarne FTMO mehanike, ne samo uopštena napomena. **Preporuka:** ili dnevni limit prevesti na "5% od balansa na kraju prethodnog trgovinskog dana" (verna simulacija), ili — ako se zadrži pojednostavljena statička verzija — UI kopija treba eksplicitno da kaže "pojednostavljena, konzervativnija verzija dnevnog pravila" umesto generičkog "aproksimacija".
- **1-Step Challenge** kod FTMO-a koristi TRAILING (rolayući) max loss, potpuno drugačiji mehanizam od onog implementiranog ovde — journal-ov modul, kako je opisan, modelira samo 2-Step logiku. Ako korisnik (ili budući čitalac ovog journala) koristi 1-Step nalog, ova simulacija bi bila suštinski pogrešna za taj tip naloga. Vredi da UI eksplicitno kaže da model pretpostavlja 2-Step/statičan tip pravila.

---

## 13. FX rezolucija (`fx.ts`, `tj_position_stats` SQL view)

Redosled: snapshot iz trenutka trejda uvek pobeđuje → ako valuta instrumenta = valuta naloga, rate = 1 → inače `null` (nikad tih default).

**Verdikt: ✅ Ispravan računovodstveni princip.** "Nikad ne izmišljaj kurs" je tačan defanzivni pristup — bolje prazno/nepoznato polje nego tihо pogrešna konverzija. Ovo je upravo ono što je testirano i potvrđeno ranije u ovoj reviziji (promena valute naloga posle trejdova je sada blokirana guard-om iz istog razloga).

---

## 14. Troškovi i swap (`costs.ts`, `cost-defaults.ts`)

```
net_pl = gross_pl − fees − swap     (pozitivan swap = trošak)
nightsBetween — broji KALENDARSKE ROLLOVER-e pređene (ne 24h blokove)
```

**Verdikt: ✅ Ispravno, poravnato sa stvarnom broker praksom.** Brojanje rollover-a (a ne proteklih 24h) je TAČAN pristup — brokeri naplaćuju swap na rollover događajima (obično u fiksno vreme, npr. 17h EST), ne na svaka 24h od otvaranja pozicije. Naivna "elapsed 24h" implementacija bi se često razminula sa stvarnim brojem naplaćenih swap-ova (npr. pozicija otvorena u 16:59 i zatvorena u 17:01 sledećeg dana bi po "24h" logici izgledala kao <24h, a po broker logici je već preživela jedan rollover). Ovaj kod je ispravno modelovan.

---

## 15. Compliance / process adherence (`tracker/compliance.ts`, `tracker/process-adherence.ts`, `tracker/auto-rules.ts`)

Dnevni compliance % = prost neponderisani odnos ispunjeno/primenjivo po danu (`na` isključeno iz oba); `PROCESS_BLEND = {tracker:60, follow:40}`; auto-pravila (`max_loss_per_day/trade`) evaluirana na NETO P&L bazi.

**Verdikt: ⚪ Bespoke/interno, bez nalaza.** Ovo su interna journaling pravila (nema akademskog standarda za "koliko treba da se ponderiše tracker vs. followed-rules disciplina") — logika je unutrašnje konzistentna. Evaluacija na NETO bazi (uključuje troškove) je razumnija/strožija varijanta od bruto, što je konzervativan i opravdan izbor za risk-limit proveru.

---

## Rezime — šta zahteva pažnju

| # | Metrika | Verdikt | Akcija |
|---|---|---|---|
| 1 | Sharpe/Sortino/Calmar `periodsPerYear` mereno iz podataka | 🔵 namerni izbor, potvrđeno | Kod već objašnjava zašto (swing trader ≠ svaki dan u tržištu); korisnik je potvrdio da algoritam ostaje. **Urađeno**: hint tekst u report UI (`reports/metrics.ts`) sad eksplicitno kaže da brojevi nisu direktno uporedivi sa "standardnim" Sharpe/Calmar racio-ima objavljenim drugde. Usput ispravljen i pogrešan Sortino hint (tvrdio je "losing days only" u imeniocu — kod ispravno deli sa SVIM danima). |
| 2 | Consistency score deo sa `totalProfit` (sumom) umesto prosekom | ✅ ispravljeno | `risk-metrics.ts`: score sada koristi `cv` (stdev/\|mean\|) umesto `raw` (stdev/total); `CONSISTENCY_SCALE` rekalibrisan 100→20. `raw` polje ostaje dostupno (nekorišćeno za score) radi poređenja. Dokazano testom da score više ne zavisi od dužine uzorka. |
| 3 | Sickre Score drawdown komponenta = peak-PnL-relative, ne peak-equity-relative | 🔵 namerni izbor, potvrđeno | Osnova ostaje peak-PnL; sample-gating (min. 5 trejdova) štiti od nestabilnosti kod novih naloga. Korisnik je potvrdio: ostaje bez izmene. (Argument „radi uporedivosti sa TradeZella-om" je posle rebalansa pondera oslabio — ponderi više nisu njihovi — ali sam izbor osnove nije menjan, pa ni ovaj red.) |
| 3b | Sickre Score ponderi kalibrisani za intraday scalp, ne za ovaj profil | ✅ ispravljeno | Rebalans: win % izbačen iz skora, avgWinLoss 20→5, process 15→30 (najteža), maxDrawdown 20→25, profitFactor 25→20, consistency 10→15, recovery 10→5, nova FTMO headroom komponenta sa 10. Detalji i obrazloženja u sekciji 10 gore. |
| 4 | FTMO dnevni loss limit pegovan na starting balance umesto na balans prethodnog dana | ✅ ispravljeno | Novo polje po nalogu, `ftmo_daily_loss_basis` (Settings → FTMO), sa dve vrednosti: "starting balance (fixed — FTMO 2-Step)" i "previous day's close (rolling — FTMO 1-Step)". Default ostaje fiksna baza (nepromenjeno ponašanje za postojeće naloge). `ftmo.ts::evaluateFtmo` sad računa dnevni limit po danu kad je izabrana rolling baza. |
| 5 | FTMO modul modelira samo statičan (2-Step) tip pravila za MAX total loss | 🔵 van scope-a ove revizije | Max total loss (drawdown floor) ostaje uvek statičan — to je van scope-a stavke #4, koja je menjala isključivo dnevni loss limit. Settings napomena sad eksplicitno kaže da je max total loss uvek statičan. |
| 6 | Sve ostalo (win rate, profit factor, expectancy, R-multiple konvencija, max drawdown %, MAE/MFE/capture%, Sortino downside-deviation baza, recovery factor, position sizing, FX rezolucija, swap/nights logika) | ✅ potvrđeno standardno | Nema akcije |

Sve stavke označene ⚪ (bespoke: breakeven pojas, Sickre Score ponderi/bande van gorenavedenog nalaza, compliance blend) su proizvod dizajna ovog journala — nemaju eksterni standard za poređenje, ocenjene su samo na unutrašnju logičku doslednost i nisu pronađeni problemi osim gde je eksplicitno navedeno.
