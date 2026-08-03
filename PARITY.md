# TradeZella parity — provera stanja

> Stanje na dan poslednjeg commita faze 7. Provera obuhvata **metrike, beleške i sve što se radi
> ručno ili formulom** — po izričitoj instrukciji vlasnika. AI (Zella AI), brokerske integracije i
> marketinške stranice nisu predmet.

---

## Metod, i šta ovaj dokument NE tvrdi

**Stranice tradezella.com nisu mogle biti povučene, ali ne zato što ih TradeZella brani.** Sesija u
kojoj je ovaj dokument nastao nema opšti izlaz na web: egress politika okruženja odbija CONNECT za
sve hostove van uske dozvoljene liste, pa i `example.com` vraća 403. Status endpoint proxy-ja to
zapisuje doslovno — `gateway answered 403 to CONNECT (policy denial)`. Scraping njihovih stranica —
`/features`, `/changelog`, `/pricing`, help centar — **nije bio moguć ni za jednu**, i to se ne može
zaobići iz sesije.

Ni dva spec dokumenta iz kojih je ROADMAP izveden (`tz-moduli-kompletno.md`,
`tradezella-clone-spec.md`) **ne postoje ni u jednom GitHub repou** — pretraga po nalogu ih ne nalazi.
Bili su lokalni fajlovi u trenutku pisanja roadmap-a.

Provera se zato oslanja na:

1. **master čeklist** i dva spec dokumenta (`tz-moduli-kompletno.md`, `tradezella-clone-spec.md`) iz
   kojih je `ROADMAP.md` izveden — to je bio parity izvor od početka projekta i njegove oznake
   (A3, B12, C3, D12, F5/F6, G8, H5, I1/I2, I4/I5, J5) provlače se kroz ceo roadmap;
2. **sitemap** koji je vlasnik dostavio — daje površinu proizvoda, ne spisak funkcija;
3. **stvarni kod** ovog repoa.

Zbog toga: sve pod „imamo" je provereno **u kodu**. Sve pod „TZ ima" je izvedeno iz čeklista i
sitemap-a, i **nije potvrđeno na njihovom sajtu**. Gde nisam siguran, tako i piše.

**Kako ovaj dokument dobiti na čvrst temelj**, ako to zatreba: dozvoliti `tradezella.com` u mrežnoj
politici okruženja (podešava se pri kreiranju okruženja —
[dokumentacija](https://code.claude.com/docs/en/claude-code-on-the-web)), ili gurnuti ona dva spec
dokumenta u repo, ili nalepiti sadržaj njihove `/features` stranice ručno. Bez jednog od toga,
odeljak §8 ostaje najbolja procena a ne provereno stanje.

---

## 1. Metrike — pokriveno

Izveštajni engine registruje **30 metrika**, i svaka nosi veličinu uzorka uz sebe:

`net_pnl` · `gross_pnl` · `trade_count` · `win_rate` · `profit_factor` · `expectancy` · `avg_r` ·
`total_r` · `avg_win` · `avg_loss` · `avg_win_loss` · `best` · `worst` · `max_drawdown` ·
`avg_daily_dd` · `recovery_factor` · `sharpe` · `sortino` · `calmar` · `consistency` · `avg_hold` ·
`total_fees` · `total_swap` · `cost_pct_of_gross` · `avg_planned_r` · `delta_r` · `avg_mae_r` ·
`target_attainment` · `breakeven_count` · `follow_rate`

> **Ispravka ovog dokumenta.** Ranija verzija je tvrdila da „nema metrike iz čeklista koja
> nedostaje" dok su **Sharpe, Sortino, Calmar i avg daily drawdown stvarno nedostajali**. Tvrdnja
> je bila netačna kad je napisana; ROADMAP je tada ispravljen a ovaj fajl nije. Sve četiri su
> otad implementirane (`risk-ratios.ts`), pa je tvrdnja sada tačna — ali je ovde zapisano da
> nije bila, jer dokument koji tiho postane tačan ne razlikuje se od dokumenta kojem se ne veri.
>
> Uz njih ide jedna razlika u odnosu na uobičajenu praksu: **godišnja skala se meri, ne
> pretpostavlja.** `periodsPerYear = (dana trgovanja × 365) / kalendarskih dana raspona`, umesto
> zakucanih 252 — koji za swing knjigu sa 40 dana trgovanja preko 300 kalendarskih dana naduva
> svaki racio. Sva tri racija vraćaju `null` ispod pet dana.

Van registra, ali izračunato i prikazano: equity kriva, kumulativni drawdown, R-histogram, dnevni
P&L, hold time po ishodu, izveštaj o troškovima, entry slippage po nedelji, target attainment po
nedelji, MFE capture po trejdu, nedeljni i mesečni period-statistike sa Week Win %, i **Sickre
Score** sa sedam komponenti.

**Formule su dokumentovane u `README.md` §Metrike**, sa svakom razlikom u odnosu na TZ napisanom
izričito. Tri koje treba znati:

- **Novac se datira po zatvaranju, aktivnost po otvaranju.** TZ koristi datum otvaranja za oboje. To
  je bezopasno intraday, ali bi swing trejd držan tri nedelje smestio profit u nedelju kad je ideja
  nastala umesto kad je novac stigao.
- **Max drawdown se računa u dve osnove**, imenovane odvojeno: `maxDrawdownPctOfEquity` ide u UI,
  `maxDrawdownPctOfPeakPnl` **isključivo** u skor — da skor ostane uporediv sa TZ-ovim.
- **Breakeven opseg deli brojanje od novca.** Broj trejdova poštuje opseg, sume novca prate stvarni
  predznak. Da nije tako, profit factor bi bio tiho naduvan.

**„Zella Scale"** (potencijal vs stvarno) kod TZ-a je par *target attainment* + *MFE capture*.
Oba postoje, oba su kolone u gridu i oba idu u izvoz.

**Verdikt: metrike su pokrivene, i na nekoliko mesta preciznije definisane.**

---

## 2. Grupisanje, filtriranje, izveštaji

Report engine sa **pivotom** i obaveznim `n` u svakoj ćeliji. Dimenzije: `direction`, `account`,
`hold_duration`, `r_bucket`, `size_bucket`, `outcome`, `month`, `dow_entry`, `dow_exit`, `insight`,
**plus svako korisničko polje automatski**, plus `playbook`, `playbook_rule` i `conviction`.

Filteri podržavaju negaciju. Kolone se biraju kroz URL. Izvoz u CSV i XLSX.

**Verdikt: pokriveno, i arhitektonski jače** — jedan engine umesto deset stranica, pa nova dimenzija
ne traži novi ekran.

---

## 3. Beleške i journaling

| TZ | Ovde |
|---|---|
| Notebook sa folderima i šablonima | ✅ `/notebook` — folderi, šabloni po folderu, tagovi, markdown, korpa |
| Dnevna beleška | ✅ `/daily` — strukturisan procesni dnevnik, jači od TZ-ove slobodne beleške |
| Beleška uz trejd | ✅ `trade_journal_notes` na trejdu + beleška vezana za trejd preko `position_id` |
| Nedeljni pregled | ✅ folder „Weekly Review" sa šablonom |
| Tagovi | ✅ dva odvojena rečnika — trejd tagovi i note tagovi, namerno se ne sinhronizuju |

**Verdikt: pokriveno.** Markdown se čuva kao čist tekst i renderuje u React elemente, nikad u HTML
string — pa je i pretraživ i izvozljiv.

---

## 4. Kalendar

Mesečna mreža sa Net P&L po danu, kolonom nedeljnog zbira, izborom metrike po ćeliji
(Net P&L · R · broj trejdova · win rate), ikonicom na danima sa dnevnikom, sivim breakeven danima po
opsegu naloga, i klikom na dan koji vodi na pun dnevni pregled.

**Verdikt: pokriveno** (isporučeno u fazi 7).

---

## 5. Playbook, čeklista, disciplina

| TZ | Ovde |
|---|---|
| Playbook sa pravilima | ✅ playbook-ovi, grupe, pravila, `show_when`, conviction |
| Statistika po pravilu | ✅ dimenzija `playbook_rule` + metrika `follow_rate` |
| Trading checklist | ✅ tracker pravila po fazi dana, sa danima u nedelji |
| **Zaključavanje dana** | ✅ **nepovratno, DB trigerom** |

**Verdikt: pokriveno, i preko toga.** Četiri tracker pravila se **ocenjuju automatski iz podataka**
(max gubitak po trejdu i po danu, playbook vezan, stop unet), a niz doslednosti i Process Adherence
ulaze u skor. TZ nema procesni skor u kompozitu.

---

## 6. Prop firm

FTMO mod po nalogu: dnevni limit, ukupni limit, profit target, minimalni broj dana, zamrzavanje
naloga na proboj, banner sa stanjem.

**Ograničenje napisano u README-u:** evaluacija se računa iz **realizovanog** neto P&L-a, dok pravi
prop firm meri intraday equity uključujući plutajući P/L. Trenira disciplinu, ne zamenjuje brokerov
obračun.

**Verdikt: pokriveno za ručni rad; nema živog sinka sa prop firmom** (v. §8).

---

## 7. Import

CSV i XLSX, auto-detekcija kolona po ključnim rečima, rekonsilijacija sa postojećim pozicijama,
istorija import batch-eva i **undo**.

**Verdikt: pokriveno za ručni import.** Brokerski preseti (`tj_column_mappings`) su tabela bez koda —
ostalo u roadmap-u.

---

## 8. Šta TradeZella ima a ovde ne postoji

Iskreno i bez ublažavanja. Poređano po tome koliko stvarno menja svakodnevni rad:

1. **Brokerski auto-sync.** Njihov sitemap nosi ~600 stranica integracija (MT4/MT5, cTrader,
   Tradovate, Rithmic, IBKR, Tradelocker…). Ovde je unos ručni ili preko CSV/XLSX importa. To je
   **najveća funkcionalna razlika u dnevnoj upotrebi**, iako je „integracija" a ne metrika.
2. **Backtesting modul.** `/backtesting` je njihov drugi stub proizvoda — ručni backtest sa bar
   replay-om, sesije, statistika backtesta odvojena od live knjige. **Ovde ne postoji ništa od toga.**
3. **Trade replay.** Reprodukcija izvršenog trejda na grafikonu. Ovde postoje samo TradingView
   snapshot slike po trejdu.
4. **Mentor mode.** Deljenje naloga sa mentorom uživo, i mentorov pogled na više učenika. Ovde
   postoji **mentor pack** — Markdown izvoz sa pre-izračunatim statistikama — što je fajl, ne
   zajednički pogled. Namerno: javni link je dvaput odbijen kao bezbednosna površina.
5. **Prop firm sync.** Živa veza sa prop firm nalogom. Ovde su FTMO pravila ručno podešena.
6. **Monte Carlo simulator.** Kod njih stoji među alatima; ovde ga nema. Od svih kalkulatora, ovo je
   jedini koji bi u aplikaciji imao smisla kao stvarna funkcija.
7. **Spaces** (`/spaces`). Iz sitemap-a se ne vidi šta je; verovatno saradnja ili zajednica.

**Kalkulatori sa `/tools/*`** (position size, risk-reward, fibonacci, futures, option profit, stock
profit, drawdown recovery, prop firm) su **javne SEO stranice, ne funkcije proizvoda** — otvorene su
bez naloga. Od njih je *position sizing* jedini koji se stvarno koristi u radu, i **on ovde postoji**,
ugrađen u formu trejda (`computePositionSize`), što je korisnije nego zaseban kalkulator.

Isto važi za `/university`, `/community`, `/strategies`, `/learning-items` — to je sadržaj i
edukacija, ne funkcije.

---

## 9. Šta ovde postoji a TradeZella nema

Iz §7 ROADMAP-a, i sve provereno u kodu:

1. **Procesni dnevnik** kao prvorazredna struktura — jutro / tokom dana / veče, Douglas mantre,
   kontrola impulsa, micromanage praćenje, ocena dana vezana za aktivan cilj fokusa.
2. **`missed` kao prvorazredan status** — propušteni setap je podatak sa razlogom, pa se može pitati
   „beže li mi sistematski A-setapi".
3. **Cena nediscipline izražena u R** — entry slippage i target attainment odvojeni od P&L-a.
4. **Per-rule atribucija edge-a** — koje pravilo iz playbook-a nosi zaradu, a koje je ritual.
5. **Process Adherence u kompozitnom skoru** — sedma komponenta, 15%.
6. **Nepovratno zaključavanje dana**, sprovedeno u bazi, sa zamrzavanjem automatskih ocena.
7. **Insight engine** sa 31 pravilom i **obaveznim pragom uzorka** na svakom nalazu.
8. **Korisnička polja** koja odmah postaju dimenzije izveštaja, bez ijedne izmene engine-a.
9. **Uplate i isplate** odvojene od P&L-a, sa dva imenioca za drawdown.

---

## Zaključak

**Za ono što je vlasnik tražio — metrike, beleške, i sve što se radi ručno ili formulom — parity je
postignut, i na više mesta pređen.** Nema metrike iz čeklista koja nedostaje, beleške su kompletne,
kalendar i dnevni pregled su isporučeni, a disciplinski sloj (tracker, zaključavanje, Process
Adherence) je nešto što TZ strukturno nema.

**Tri stvarne rupe, sve van te definicije:** brokerski auto-sync, backtesting modul i trade replay.
Prve dve su zasebni proizvodi po obimu, ne funkcije. Ako ijedna od njih treba, **backtesting je
jedina koja bi promenila kako radiš** — ostale dve su udobnost i integracija.

**Neproveravano:** ništa od faza 5–7 nije viđeno u pregledaču. Kontejner nema Supabase env
promenljive, a baza ima nula trejdova.

**Dopuna posle runde 3 revizije.** Ta poslednja rečenica je bila skuplja nego što je zvučala. Baš
zato što baza ima nula trejdova, prazan nalog je bio jedino stanje u kojem je vlasnik mogao da
vidi aplikaciju — i tu je našao nalaz koji nijedan test nije uhvatio: skor od 33/100 sa „Max
drawdown: 100" na nalogu bez ijednog trejda. Iz njega su ispala još dva iste vrste (`S1`–`S3` u
`CODE_REVIEW.md`).

Zaključak koji ostaje, i za ovaj dokument i za README: **parity na papiru nije parity na ekranu.**
Sve što je ovde označeno kao pokriveno pokriveno je u kodu i pod testom; ništa od toga nije
zamena za otvaranje stranice sa stvarnim trejdovima.
