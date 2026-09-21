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

## 10. Process · Survival · Edge (`scorecard.ts`) — kompozit je rasformiran

```
Process  = 0.6 × tracker compliance + 0.4 × follow rate        (0–100)
Survival = prosek prisutnih delova:
             100 − maxDrawdownPctOfEquity
             100 − underWaterDays / 90 × 100
             ftmoHeadroomPct                                    (0–100)
Edge     = mean(decidedRs) sa bootstrap intervalom              (u R, NE 0–100)
```

**Verdikt: ✅ ispravljeno — i to upravo po preporuci iz prethodne verzije ove
sekcije.**

Kompozitni Sickre Score (sedam ponderisanih komponenti, 0–100) više ne postoji.
Razlog nije ni jedan pojedinačni ponder nego sama konstrukcija: **jedan broj koji
se menja i kad trguješ drugačije i kad stigne više podataka nije merenje.** Tiha
nedelja ga je spuštala, odgovaranje na još playbook pravila ga je dizalo, a
čitalac nije mogao da razazna koje se od to dvoje desilo. Kartica je to i
priznavala — imala je radar, procenat pokrivenosti i sklopljenu listu komponenti
ispod naslova, jer se naslov morao rasklopiti da bi se pročitao.

**Preporuka iz prethodne verzije ove sekcije je sprovedena.** Tu je pisalo:
„razmotriti da drawdown komponenta skora koristi istu peak-equity-relative bazu
kao i ostatak aplikacije (konzistentnost + stabilnost)". Survival sada koristi
`maxPctOfEquity`. Argument za peak-PnL bazu bio je uporedivost sa TradeZella
skorom — a taj skor je rasformiran, pa je sa njim otišao i jedini razlog da se
drži baza koja se nigde ne prikazuje.

**⚠️ Nalaz koji je ta izmena otkrila (i koji je odmah zatvoren).**
`maxPctOfEquity` je vraćao `0` kad pad nema pozitivan vrh kapitala da se njime
podeli — nalog bez početnog stanja koji nikad nije bio iznad nule. To je ista
rupa zbog koje je `maxPctOfPeakPnl` još u rundi 3 dobio `null`, samo na drugoj
bazi: Survival bi tu pročitao savršenih 100 za knjigu koja je samo gubila.
Sada vraća `null`, a `balance.test.ts` drži obe polovine razlike — pad bez
imenioca nije knjiga koja nikad nije pala.

**Edge namerno NIJE ocena.** Expectancy stoji u R, sa svojim intervalom i svojim
uzorkom, i priguši se dok interval obuhvata nulu. Spljoštiti interval u ocenu od
0 do 100 znači baciti tačno onu informaciju koju je Faza B dodala.

**Šta je izašlo sa kompozitom:** consistency, avg win/loss i recovery factor.
Sve tri su racia čije su tabele bandova pisane za intraday knjigu i nijedna ne
odgovara na pitanje na koje tri ose ne odgovaraju bolje. Ostaju kao kolone u
`/reports`.

**Kapije dokaza su preživele**, jer greška koju sprečavaju nije nestala: ispod
5 zatvorenih trejdova dva trejdom-izvedena dela Survival-a se uskraćuju, a Edge
se uskraćuje ispod 5 **odlučenih** — svaki na svom imeniocu. FTMO headroom nije
gejtovan jer `evaluateFtmo` već vraća `null` za izazov bez zatvorenih trejdova:
dokaz putuje sa proizvođačem.

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

## 16. Rizik preuzet na ulazu (`risk-taken.ts`, `equity-at-entry.ts`)

```
riskMoney  = plannedRiskPts(entry_price, stop_price, avg_entry)
           × entry_qty × point_value × fx_rate
riskPct    = riskMoney / equity_at_entry × 100
intentGap  = |riskPct − parseRiskPct(risk_pct)|
dispersion = populaciona σ od riskPct
```

Imenilac je **equity na otvaranju dana ulaska**, zamrznut u koloni
`tj_positions.equity_at_entry` u trenutku kad trejd prvi put dobije entry fill; nikad se ne prepisuje.
Brojilac se ne čuva — svi njegovi ulazi su već nepromenljivi po trejdu (`point_value_at_trade`,
`fx_rate_at_trade`, fill-ovi), pa bi čuvanje izvedene vrednosti pored njenih ulaza bilo tačno ono što
`tj_position_stats` postoji da spreči.

**Verdikt: ✅ Ispravno, sa jednim bespoke izborom.** Lanac u novcu je identičan onom koji
`computePositionStats` već koristi za `realized_r_net` — dve formule za istu veličinu bile bi dva
različita rizika na dva ekrana. Osnovica „equity na otvaranju dana" je isti izbor koji
`equity-ladder.ts` brani za dnevne limite: imenilac koji se pomera sa svakim zatvaranjem unutar dana
daje istom trejdu dva odgovora u zavisnosti od toga kad se pita.

⚪ **Bespoke: `risk_intent_gap` je prosek APSOLUTNE razlike**, ne razlike sa predznakom. Sa
predznakom se prevelik i premali trejd potiru, pa knjiga koja nikad ne pogađa svoju nameru čita kao
savršena. Tolerancija za tracker pravilo (`RISK_INTENT_TOLERANCE = 0.1` procentnih poena) je
apsolutna, ne relativna: na veličinama koje ova knjiga trguje „1 %" i „1.05 %" su ista odluka
zaokružena granularnošću lota, dok „1 %" i „1.5 %" nisu.

**Svuda `null`, nikad 0**, kad bilo koji činilac nedostaje (nema stopa, neocenjen instrument, nepoznat
equity na ulasku) — trejd bez merljivog rizika ne sme da čita kao trejd koji nije rizikovao ništa.

---

## 17. Intervali poverenja (`uncertainty.ts`)

```
win rate      → Wilson score interval, z = 1.96, imenilac = pobede + gubici
expectancy    → percentilni bootstrap nad R odlučenih trejdova (2.5 / 97.5)
profit factor → percentilni bootstrap nad P&L po izabranoj osnovi, racio se
                 računa iznova u svakom uzorku
```

Generator je zasejan iz samih vrednosti (mulberry32 + FNV hash nad bit-obrascem), pa isti red uvek
daje iste granice — broj koji se menja pri svakom sortiranju bio bi gori od nikakvog.

**Verdikt: ✅ Ispravno, standardni postupci, sa dva svesna izbora.**

Wilson umesto normalne aproksimacije jer normalna na malom uzorku daje granice ispod 0 i iznad 100 —
a mali uzorak je jedini koji ova knjiga ima. Bootstrap umesto zatvorene formule jer je raspodela
P&L-a iskošena sa teškim repovima, a racio suma nema upotrebljiv zatvoren oblik.

⚪ **Bespoke 1: percentilni bootstrap**, ne BCa. Percentilni je blago pristrasan na jako iskošenim
raspodelama; BCa to ispravlja uz osetno više računanja. Na uzorcima od 40–70 trejdova razlika je
manja od širine koju interval ionako ima, a cena je vidljiva u tabeli koja računa sve redove odjednom.

⚪ **Bespoke 2: „neutralna vrednost" po metrici** (0 za sredinu, 50 za stopu, 1 za racio). To nije
test hipoteze nego pravilo prikaza: ćelija se priguši kad interval i dalje obuhvata neutralno. Nema
korekcije za višestruka poređenja — tabela sa 25 dimenzija × 38 metrika bi je tražila, ali cilj ovde
je da se broj čita sa rezervom, ne da se donese formalna odluka.

**Rangiranje ide po konzervativnom kraju intervala** (donja granica kad je veće bolje, gornja kad je
manje bolje). Zato „najbolji" više ne može biti grupa od tri trejda: njena donja granica je loša.

---

## 18. Preživljavanje — heat, trajanje drawdowna, simulacija (`portfolio-heat.ts`, `balance.ts`, `survival.ts`, `co-exposure.ts`)

```
heat        = Σ (riskMoneyAtEntry × openQty/entryQty) / tekući equity naloga × 100
dd trajanje = dani od vrha do vrha, po ključevima dana u zoni naloga
simulacija  = blok-bootstrap dnevnih prinosa (% equity-ja), 2000 pokretanja
korelacija  = Pearson nad zajedničkim danima zatvaranja + Fisher-z interval
```

**Verdikt: ✅ Standardni postupci, sa četiri svesna izbora.**

⚪ **Heat se ne sabira preko naloga.** Procenat ima imenilac, a dva naloga ga ne dele. Pozicija bez
stopa se broji posebno umesto da uđe kao nula — isti razlog zbog kog `sickre-score.ts` odbija da
nulti drawdown oceni kao savršeno upravljanje rizikom.

⚪ **Blok-bootstrap umesto i.i.d.** Dani se vuku u uzastopnim blokovima jer serija gubitaka obara
nalog, a ne jedan loš dan. Veličina bloka je izbor na ekranu, ne skrivena pretpostavka; i.i.d. (blok
= 1) sistematski potcenjuje rep.

⚪ **Dnevni prinosi, ne R po trejdu.** FTMO dnevni limit je dnevno pravilo; preuzorkovanje trejdova
pa deljenje po danima uništilo bi upravo strukturu koju to pravilo meri. Uz to, prinosi u procentima
znače da simulacija složeno raste kao i nalog.

⚪ **Korelacija po danu ZATVARANJA.** To je uža tvrdnja nego što izgleda: dve pozicije koje su tri
nedelje stajale zajedno a zatvorile se različitim danima daju nulu. Zato uz koeficijent stoji i broj
dana istovremene izloženosti, a sam koeficijent se ne prikazuje ispod pet zajedničkih dana.

**Šta simulacija NE tvrdi:** ne predviđa tržište. Ona ponavlja knjigu koja je već odigrana, što je
najjača poštena tvrdnja koja se iz ovih podataka može izvesti.

---

## 19. Pečat plana (`plan-snapshot.ts`, `tj_sealed_num` SQL)

```
plan_snapshot   = polja plana u trenutku PRVOG entry fill-a   (piše se jednom)
plan_sealed_at  = trenutak tog pisanja
plan_amended_at = prvi put kad se posle toga pomerilo neko zapečaćeno polje
sealedNumber(row, k) = k ∈ snapshot ? snapshot[k] : row[k]
```

Polja plana: `entry_price`, `stop_price`, `target_price`, `risk_pct`,
`time_stop_days`, `thesis`, `invalidation`, `scale_out_levels`.

**Šta je bio problem.** Dan se zaključava, nedelja se zaključava, a plan nikad nije.
Svaka „plan vs realnost" veličina — entry slippage, target attainment, delta R,
tracker pravila `thesis_written` i `stop_loss_set`, i **sam R**, čiji je imenilac
planirana razdaljina do stopa — čitala je živa polja. Na sistemu sa jednim
korisnikom to znači da je celo poređenje bilo falsifikabilno od strane jedine
osobe koju meri: proširi stop posle zatvaranja i svaki gubitak izražen u R se
smanji.

**Zašto snimak a ne brava.** Brava zabranjuje izmenu, što zvuči strože a nije:
samo pomera prepravku na „otključaj pa prepravi", a u međuvremenu blokira
ispravku očigledne greške u kucanju. Snimak umesto toga čini ispravku
**bezopasnom po merenje** — brojevi čitaju ono što je zapečaćeno, živa polja
ostaju izmenjiva, a izmena posle pečata dobija značku.

Tri pravila su ista kao kod `equity_at_entry`: piše se jednom (na prvi entry
fill), nikad se ne prepisuje, briše se na povratak u `planned`. Bez backfill-a —
istorija nema pečat i ne sme da glumi da ga ima; `plan_snapshot IS NULL` znači
„čitaj živa polja", što važi za svaki trejd napisan pre migracije
`20260921120000`.

**Dve implementacije istog pravila, namerno.** `sealedNumber` u TypeScript-u i
`public.tj_sealed_num` u SQL-u (koji `tj_position_stats` koristi za `entry_price`
i `stop_price`, tj. za `risk_pts`). Obe poštuju isti redosled: ključ koji snimak
ne nosi pada na živu kolonu; ključ koji nosi važi i kad drži `null` (plan koji
namerno nije imao stop ne sme da pozajmi stop ukucan kasnije); a vrednost koja
nije broj čita se kao `null` umesto da podigne grešku, jer view koji pukne ruši
svaki ekran. Da se razilaze, jedan trejd bi imao dva R.

**Šta pečat NE tvrdi.** Da je plan bio dobar, ni da je uopšte postojao: uvezeni
trejd se pečati praznim snimkom, jer „nije bilo plana" jeste nalaz. Prazan snimak
po ključu pada na živa polja, pa plan ukucan kasnije i dalje stoji na ekranu —
samo se ne tvrdi da je to ono što je odlučeno pre ulaska.

---

## 20. Razlika između dva skupa (`uncertainty.ts`, compare mode)

```
Δ            = statistika(B) − statistika(A)
Δ stopa      = Newcombe (metoda 10) iz dva Wilson intervala
Δ sredina    = dvouzoračni percentilni bootstrap (expectancy)
Δ odnos suma = isto, nad P&L-om po trejdu (profit factor)
n            = min(nA, nB)
```

**Zašto interval, a ne samo razlika.** Profit faktor 2.4 prema 1.6 izgleda kao nalaz, a na četrdeset
trejdova po pravilu nije. Jedini pošten odgovor je interval oko razmaka i pitanje da li i dalje
obuhvata nulu — ćelija se priguši kad obuhvata. Neutralna vrednost za RAZLIKU je uvek nula, nikad
metrička (50 za stopu, 1 za profit faktor): razlika dve stope od 50 % nije „bez efekta".

**Bootstrap preuzorkuje obe strane nezavisno** i računa statistiku iznova na svakom paru. Razlika dva
odvojeno bootstrap-ovana intervala nije isto — bila bi šira od istine i odgovarala bi na drugo
pitanje. `Infinity − Infinity` se odbija: dve knjige koje nikad nisu izgubile nemaju razmak koji se
može izreći.

**Newcombe umesto bootstrap-a za stope**, jer stopa ima zatvoren oblik koji vredi koristiti, a ovaj
je građen tačno od dva Wilson intervala koje ćelije već prikazuju — tri broja u istom redu ne mogu da
protivreče jedan drugom. Kao i Wilson, ponaša se na malim i nakrivljenim uzorcima, gde normalna
aproksimacija mirno prijavi granicu izvan ±100 poena.

**`n` je tanja od dve strane.** Par je siguran onoliko koliko i njegova slabija polovina; 200 trejdova
protiv 6 je uzorak od 6.

**Šta ovo NE kontroliše.** Preklapanje. Ako skupovi dele trejdove — „Grade A" protiv „svi trejdovi" —
pretpostavka nezavisnosti pada, i nijedan od ovih intervala to ne zna. Zato tabela ispisuje koliko
trejdova dele, kao tvrdnju a ne kao fusnotu.

---

## 21. Eksperiment i cena promašaja (`experiments.ts`, `missed-cost.ts`)

```
pre    = metrika nad nedeljama [start − baseline, start − 1]
posle  = metrika nad nedeljama [start, danas]      (akumulira se)
Δ      = posle − pre, sa intervalom iz sekcije 20
verdikt: thin (<5 trejdova sa bilo koje strane) | unknown (Δ interval sadrži 0)
         | better/worse (interval prešao nulu, u smeru same metrike)

missed_r = planirani reward u R (target prvi) | −1 (stop prvi) | 0 (nijedno)
ukupno   = zbir SAMO nad izmerenima; neizmereni se broje, ne sabiraju kao nula
```

**Eksperiment nudi samo tri metrike** — win rate, profit factor, expectancy —
jer su to jedine tri koje nose interval. Eksperiment bez intervala je anegdota
sa datumom, i to odbija CHECK u bazi, ne dogovor.

**Prozori se ključaju po nedelji ZATVARANJA.** Promena u vođenju trejda vidi se
u tome kako se trejd završi; pozicija otvorena u petak pre početka a zatvorena
unutar eksperimenta vođena je po novom pravilu i pripada „posle". „Posle" se
akumulira — jedna nedelja je 4–7 trejdova, a verdikt iz toga je šum.

**Šta eksperiment NE kontroliše:** instrument, volatilnost, ostatak tržišta i
sama svest da se meri. Dva prozora iste knjige nisu eksperiment u naučnom
smislu — to je najbolje poređenje koje ovi podaci nose, što je manja tvrdnja.
Samoprijavljeno „ispoštovao sam" stoji odvojeno i tako označeno: reč o
ponašanju i broj iz knjige nisu nezavisna zapažanja.

**Cena promašaja meri i disciplinu, ne samo oklevanje.** Plan koji nikad nije
označen kao promašen ostaje `planned` zauvek, pa zbir raste samo onoliko koliko
se stari planovi razrešavaju. Zato uz zbir stoji i broj nerazrešenih planova —
bez njega „ništa nije promašeno" zapravo znači „ništa nije označeno".

**Redosled je celo pitanje.** Iz M1 svećica se ne može znati da li je prvo
stigao target ili stop kad su oba unutar iste svećice; skript to ODBIJA umesto
da pogodi, a baza odbija isti par nezavisno (`stop` sa pozitivnim `missed_r`
pada na CHECK). Na tikovima redosled postoji u samim podacima.

---

## Rezime — šta zahteva pažnju

| # | Metrika | Verdikt | Akcija |
|---|---|---|---|
| 1 | Sharpe/Sortino/Calmar `periodsPerYear` mereno iz podataka | 🔵 namerni izbor, potvrđeno | Kod već objašnjava zašto (swing trader ≠ svaki dan u tržištu); korisnik je potvrdio da algoritam ostaje. **Urađeno**: hint tekst u report UI (`reports/metrics.ts`) sad eksplicitno kaže da brojevi nisu direktno uporedivi sa "standardnim" Sharpe/Calmar racio-ima objavljenim drugde. Usput ispravljen i pogrešan Sortino hint (tvrdio je "losing days only" u imeniocu — kod ispravno deli sa SVIM danima). |
| 2 | Consistency score deo sa `totalProfit` (sumom) umesto prosekom | ✅ ispravljeno | `risk-metrics.ts`: score sada koristi `cv` (stdev/\|mean\|) umesto `raw` (stdev/total); `CONSISTENCY_SCALE` rekalibrisan 100→20. `raw` polje ostaje dostupno (nekorišćeno za score) radi poređenja. Dokazano testom da score više ne zavisi od dužine uzorka. |
| 3 | Sickre Score drawdown komponenta = peak-PnL-relative, ne peak-equity-relative | ✅ ispravljeno (Faza E) | Kompozit je rasformiran; Survival osa koristi `maxPctOfEquity`, tačno kako je ova preporuka tražila. Usput je otkriveno da je i ta baza vraćala `0` umesto `null` kad nema pozitivnog vrha — ista rupa kao nalaz S1, na drugoj bazi, sada zatvorena. Detalji u sekciji 10. |
| 3b | Sickre Score ponderi kalibrisani za intraday scalp, ne za ovaj profil | ✅ prevaziđeno (Faza E) | Ponderi više ne postoje — skor je razbijen na tri ose koje se ne mešaju (sekcija 10). Raniji rebalans, radi zapisa: win % izbačen, avgWinLoss 20→5, process 15→30, maxDrawdown 20→25, profitFactor 25→20, consistency 10→15, recovery 10→5, FTMO headroom 10. |
| 4 | FTMO dnevni loss limit pegovan na starting balance umesto na balans prethodnog dana | ✅ ispravljeno | Novo polje po nalogu, `ftmo_daily_loss_basis` (Settings → FTMO), sa dve vrednosti: "starting balance (fixed — FTMO 2-Step)" i "previous day's close (rolling — FTMO 1-Step)". Default ostaje fiksna baza (nepromenjeno ponašanje za postojeće naloge). `ftmo.ts::evaluateFtmo` sad računa dnevni limit po danu kad je izabrana rolling baza. |
| 5 | FTMO modul modelira samo statičan (2-Step) tip pravila za MAX total loss | 🔵 van scope-a ove revizije | Max total loss (drawdown floor) ostaje uvek statičan — to je van scope-a stavke #4, koja je menjala isključivo dnevni loss limit. Settings napomena sad eksplicitno kaže da je max total loss uvek statičan. |
| 9 | Nema zbirnog otvorenog rizika, trajanja drawdowna ni pogleda unapred | ✅ ispravljeno | Faza C: `portfolio-heat.ts` (po nalogu, preostala količina, „3 od 4 izmereno"), `drawdownEpisodes`/`drawdownDuration` u `balance.ts`, `survival.ts` (blok-bootstrap, radi i bez FTMO-a), `co-exposure.ts` (istovremenost + Fisher-z) |
| 8 | Tačka bez intervala — profit factor 2.4 na 12 trejdova izgleda isto kao na 300 | ✅ ispravljeno | Faza B: `uncertainty.ts` (Wilson + bootstrap), interval ispod tri metrike u tabeli, prigušena ćelija kad obuhvata neutralno, rangiranje po konzervativnom kraju, `minSample` sveden na kapiju za rangiranje |
| 7 | Rizik preuzet na ulazu se nigde nije merio (`risk_pct` je bila samo namera iz dropdowna) | ✅ ispravljeno | Faza A: kolona `equity_at_entry`, modul `risk-taken.ts`, 4 metrike, dimenzija `risk_bucket`, filter `risk_pct_taken`, kolona „Risk %" u žurnalu i dva auto tracker pravila (`risk_per_trade`, `risk_matched_intent`). Staro pravilo `max_loss_per_trade` namerno ostaje: ono meri ISHOD na dan zatvaranja, novo meri ODLUKU na dan ulaska |
| 6 | Sve ostalo (win rate, profit factor, expectancy, R-multiple konvencija, max drawdown %, MAE/MFE/capture%, Sortino downside-deviation baza, recovery factor, position sizing, FX rezolucija, swap/nights logika) | ✅ potvrđeno standardno | Nema akcije |

Sve stavke označene ⚪ (bespoke: breakeven pojas, compliance blend) su proizvod dizajna ovog journala — nemaju eksterni standard za poređenje, ocenjene su samo na unutrašnju logičku doslednost i nisu pronađeni problemi osim gde je eksplicitno navedeno.
