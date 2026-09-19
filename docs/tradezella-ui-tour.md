# TradeZella — referenca za gradnju

Zapis onoga što je **stvarno viđeno** u TradeZella UI-ju tokom žive ture kroz plaćeni nalog
(2026-08-22), preuređen tako da se iz njega može graditi.

**Šta ovaj dokument NIJE**: nije `PARITY.md` (koji poredi naše metrike naspram njihovog čeklista) i
nije spisak zadataka. Ovo je opis KAKO je njihov proizvod sklopljen, sa procenom šta je od toga
vredno nama.

**Kako je nastao**: ulogovan nalog, 8 probnih trejdova ubačeno preko CSV-a (EUR/USD, GBP/USD,
18–21. avgust 2026) plus 1 ručno unet, da bi se videli popunjeni ekrani umesto praznih stanja.
Svaki nalaz je viđen na ekranu, ne izveden iz dokumentacije.

**Pouzdanost**: gde nešto nije provereno ili je pretpostavka, tako i piše. Ranije verzije ovog
dokumenta imale su dve pogrešne tvrdnje (nepostojanje filter panela na Trade View-u i priroda
"Running P&L" grafikona) — obe su ispravljene i ispravke su UGRAĐENE u odgovarajuće sekcije, ne
dopisane na kraj.

---

# DEO 1 — Mapa proizvoda

## Dva nivoa navigacije

**Gornji nivo** (`/home`): Home · Journal · Backtesting · Agents · Mentor Mode (BETA) · PropFirm
Sync. Home je „hub" sa AI pretragom i karticama-prečicama.

**„Journal" vodi na `/tracking`** i otvara SVOJ sidebar — to je pravi proizvod:

| Ekran | Ruta | Naš ekvivalent |
|---|---|---|
| Dashboard | `/tracking` | `/` (dashboard) |
| Day View | `/tracking/day-view` | delimično `/daily` |
| Trade View | `/tracking/trade-view` | `/journal` |
| Notebook | `/tracking/notebook` | `/notebook` |
| Reports | `/tracking/reports` | `/reports` |
| Strategies | `/tracking/strategy/my-strategy` | `/playbooks` |
| Trade Replay | `/tracking/replay-scenarios` | — |
| Progress Tracker | `/tracking/progress-tracker` | — (delovi razbacani) |
| Resources | `/tracking/resources` | — |

Plus `+ Add Trade` dugme na vrhu sidebar-a i `/settings/*` grana.

**Terminologija**: interno „Playbook" (aria-label linka je doslovno „Playbooks/Strategies"), UI
oznaka „Strategies" — nedovršen rebrand. Mi koristimo „Playbook" dosledno.

---

# DEO 2 — Ekran po ekran

## Dashboard (`/tracking`)

Fiksan raspored widget-a (nema „Layout"/„Sections" prilagođavanja — **to MI imamo a oni nemaju**):

- **Net P&L** · **Trade win %** (poluokrugli gauge) · **Profit factor** (donut)
- **Day win %** (gauge, tri boje: win/breakeven/loss dana)
- **Avg win/loss trade** — horizontalna traka, prosečan dobitak levo (zeleno) / gubitak desno
  (crveno), brojevi na krajevima
- **Zella score** — heksagonalni RADAR sa 6 osa: Win %, Profit factor, Avg win/loss, Recovery
  factor, Max drawdown, Consistency. Ispod: broj 0–100 na gradijent traci (crveno→žuto→zeleno).
  Sa 9 trejdova: 58.79.
- **Daily net cumulative P&L** (linijski, fill) · **Net daily P&L** (bar, zeleno/crveno)
- **Recent trades / Open positions** — tab prekidač
- **Account balance** — dve serije: balans (ljubičasta) + Deposits/Withdrawals (crvena)
- **Drawdown** — obrnuta „kapljica", crvena ispuna
- **Kalendar** — mesečni grid, ćelija po danu obojena sa $ iznosom i brojem trejdova

Gornja traka: prekidač jedinica (vidi Deo 3) · **Filters** · **Date range** · **All accounts** ·
`View my day` · „Last import: … Resync".

## „Start my day" — vođeni dnevni ritual

**Najvredniji nalaz cele ture.** Nije ekran nego TOK od 4 koraka koji spaja Dashboard + Notebook +
import + Progress Tracker u jednu sekvencu. Dostupno i unazad, sa bilo kog starog dana (Day View →
AI ikonica vodi pravo u Korak 4).

**Korak 1 — Planning**
- Market Sentiment Briefing (AI, cena po pozivu prikazana unapred: „~11.29 credits/run")
- **Notes** — pun editor + „Choose template"
- **Event Calendar** — ekonomski kalendar te nedelje

**Korak 2 — Trading**
- **Živa štoperica** (mm:ss) — meri trajanje sesije
- „Skip Trading" / „End Session"
- **Notes** — sa naznakom „Carried over from your pre-market plan" + „✓ Saved" — beleška iz Koraka 1
  se PRENOSI, ne počinje iznova
- **Screenshots** — drag-drop zona, „Capture chart snapshots as the session unfolds" (PNG/JPG, 10MB)

**Korak 3 — Import Trades**
Tri kartice: Auto-sync (siva ako broker ne podržava) · File upload („Recommended") · Add manually.
„Continue" ili „Skip for now".

**Korak 4 — Trade Review** — ovde se sve spaja:
- NET P&L / WIN RATE / TRADES za taj dan
- **Running P&L** — mini grafikon kumulativno TREJD-PO-TREJD unutar dana (Start → Trade 1 → …)
- **Your Trades** — tabela sa WIN/LOSS/BREAKEVEN bedžom
- **„Your Trading Rules", povučeno iz Progress Tracker-a** — isti spisak pravila sa ✗/✓ za TAJ DAN,
  sa linkom „from Progress Tracker". **Ovo je ključna veza**: Progress Tracker nije izolovan ekran,
  njegov rezultat se vraća tačno tamo gde zaključuješ dan.
- **Notes** — „Add a reflection on this session…" — treći sloj beleške istog dana

**Zašto je vredno**: redosled te fizički provede kroz dan i ne dozvoljava da „zaboraviš" korak. Tri
sloja beleške (plan → tokom → refleksija) i zatvaranje kruga tvojim sopstvenim pravilima naspram
onoga što se stvarno desilo.

## Day View (`/tracking/day-view`)

Prekidač **Day / Week**. Svaki dan je kartica: datum, Net P&L (obojeno), mini equity sparkline, pa
red statistika (Total Trades, Gross P&L, Winners/Losers, Commissions, Win Rate, Volume, Profit
Factor).

Akcije po danu: **AI ikonica** (→ Trade Review, Korak 4), **▶ Replay**, **+ Add note**, i jedna
mala kružna ikonica koju nisam identifikovao (moguće mood indikator).

Dan bez trejdova: „No Trade data to show for this day" + „View note" ako beleška postoji.

## Trade View (`/tracking/trade-view`) — njihov `/journal`

Vrh: Net cumulative P&L / Profit factor / Trade win % / Avg win-loss (isti rezime kao Dashboard).
Bulk actions checkbox kolona. Paginacija („Trades per page: 50").

### Filter panel („Filters" dugme)
Pet kategorija levo, set desno:
- **General** — Instrument, Intraday/Multiday, Open/Closed, **Reviewed/Unreviewed**, Side, Symbol,
  Status, Trade rating
- **Tags** — Setups / Mistakes / Custom
- **Day & Time** — Day of the week, Month, Duration (minutes), Entry time, Exit time
- **Strategy** — izbor + **„Excluding"** (invertuje) + „Only show those that match all" (AND umesto
  OR) + „None" (trejdovi BEZ strategije)
- **Zella Insights** — AI obrasci

Dno: „Reset all" / Cancel / „Apply filters". Ovo je **bogatije od naše kolone-filter logike**,
posebno Strategy grana.

### „Select columns" (gear iznad tabele)
„All / None / Default" prečice, 4-kolonski grid checkbox-ova. Pun spisak:

Account name, Adjusted cost, Adjusted proceeds, **Best exit (%)**, **Best exit P&L**, **Best exit
price**, **Best exit time**, Close date, Close time, Commissions, Custom Tags, Duration, Entry
price, Executions, Initial risk, Initial target, Instrument, Instrument type, Mistakes, Net P&L,
Net ROI, Notes, Open date, Open time, Pips, **Position MAE**, **Position MFE**, **Price MAE**,
**Price MFE**, Realized R Multiple, Return per pip, **Reviewed**, Setups, Side, Status, Strategy,
Ticks per contract, Total fees, Total swap, Trade rating, Volume, **Zella Insights**, **Zella
Scale**.

**„Best exit (%/P&L/price/time)" je ključan nalaz** — izvedeno iz MFE-a: „da si izašao na najboljoj
tački, evo koliko/kada/po kojoj ceni". To je oblik u kom bi naš MAE/MFE podatak trebalo da se
PRIKAŽE — ne sirov broj, nego „najbolji mogući izlaz naspram tvog".

## Pojedinačan trejd (`/tracking/trades/{id}`)

**Dvo-kolonska stranica**, dve nezavisne grupe tabova:
- LEVO: **Stats · Strategy · Executions · Attachments**
- DESNO: **Chart · Notes · Running P&L**

(Na uskom prozoru se kolone slažu jedna ispod druge, što ostavlja utisak jedne duge stranice.)

Header: `< >` navigacija kroz trejdove, simbol + datum, **„✓ Mark as reviewed"** (ručni prekidač),
„▶ Replay", „Share", ⚙ (CHART podešavanja + crveno **„Delete trade"** na dnu — nema „Edit trade").

### Stats
Net P&L, Side, Account, Forex traded, Pips, Return Per Pip, Commissions & Fees, Total Swap, Net
ROI, Gross P&L, Adjusted Cost, **Strategy** („Select Strategy" link), **Zella Scale** (vidi Deo 3),
**Price MAE / MFE** (dva obojena cenovna nivoa), **Running P&L** (mini sparkline), **Trade
Rating**, Profit Target, Stop loss, Initial Target, Trade Risk, Planned R-Multiple, Realized
R-Multiple, Average Entry/Exit, Entry/Exit Time.

Na dnu: tri draggable kategorije taga (Setups / Mistakes / Custom Tags) + **„+ Add new category"** +
**„Manage tags"**.

**Trade Rating je 0.5–5 zvezdica u POLUKORACIMA** (accessibility tree: „0.5 Stars, 1 Star, 1.5
Stars … 5 Stars, Empty") — finija granulacija od naših celih 1–5.

**Profit Target / Stop loss se unose NAKNADNO** (post-hoc, popunjava rupu koju CSV uvoz ostavlja),
svako sa dropdown-om **„Target in: Price / Price movement / P&L / Pips"** + Qty. Iz njih se izvode
Initial Target, Trade Risk, Planned R-Multiple, Realized R-Multiple — sve „--" dok se ne unesu.

### Executions
Tabela: Date & Time, Instrument, Quantity, Multiplier, Price, Swap, Fee, Commission, **Position**
(tekuća veličina posle tog reda), **Adjusted Cost, Adjusted Proceed, Gross P&L**. „View all" otvara
pun modal sa **„+ Add Execution"**.

### Attachments
Dropzone („Drag and drop here / Browse Files") — po trejdu, odvojeno od Screenshots iz Start-my-day.

### Chart
**Pun ugrađen TradingView grafikon**: cela leva traka alata za crtanje (linije, Fibonacci, tekst,
mera), izbor perioda sveće, Indicators, **„Show events"** (označava ulaz/izlaz na grafikonu),
„Autosaved" za crteže, replay kontrole, screenshot, fullscreen. Timeframe prečice 5y/1y/3m/1m/5d/1d
+ volume panel.

Van našeg dometa bez licenciranog price-feed provajdera, ali najimpresivniji pojedinačni element
platforme.

### Notes
Dva pod-taba: **„Trade note"** / **„Daily Journal"** (ista beleška tog dana, uređiva odavde).
„Recently used templates" + „+ Add template". Ghost-text prompt kao placeholder: „Why did you take
this trade? / Did you follow your rules? / Note any emotions, chart patterns, or trade management
lessons learned."

### Running P&L
**Mark-to-market nerealizovani P&L kroz život trejda** — vrednost pozicije protiv tvoje ulazne cene,
tačku po tačku, sve do realizovanog rezultata na izlazu.

Ovo direktno objašnjava Zella Scale: MFE je MAKSIMUM ove krive, MAE je MINIMUM, realizovano je gde
se završila. Sve troje su ista kriva gledana na tri načina.

> *Provereno na trejdu gde su moje izmišljene CSV cene (ulaz 1.087) bile daleko od stvarnog tržišta
> (~1.168), pa kriva kreće od apsurdnih ~$4.981 i pada na stvarnih $360 — što je i otkrilo da se
> računa iz NJIHOVOG price feed-a, ne iz mojih podataka.*

## Uređivanje trejda — nema posebne „Edit" forme

Add i Edit su **jedan mehanizam** (uređivanje niza egzekucija), dostupan sa dva mesta:
- **„Add Trade"** → prazna tabela → praviš nov trejd
- **Executions → „View all"** na postojećem trejdu → popunjena tabela → **klik na red ga pretvara u
  inline editable red** (✓ potvrdi / ✕ otkaži)

Symbol i Type se, izgleda, ne mogu menjati nakon kreiranja — vezani su za trejd kao celinu, ne za
egzekuciju. Scale-in/scale-out posle snimanja = „+ Add Execution".

## Add Trade + CSV import

**Put do ručnog unosa je sakriven**: nalog → „Add trades" → CSV je PODRAZUMEVANI prikaz → **„⋮" meni
pored naziva naloga → „+ Manual upload"**.

### Ručna forma
- **Type** — Stock / Option / Future / Future Option / **Forex** / Crypto / CFD. Kolone tabele
  egzekucija se MENJAJU po tipu.
- **Symbol** — autocomplete
- **Tabela egzekucija** (Forex kolone): Date & Time, Contract Multiplier, Number of contracts, Side
  (BUY/SELL; nov red dobija SUPROTNU stranu od prethodnog), Price, Comm, Fee. „+ Create new
  execution" dodaje redove pojedinačno.
- Cancel / **Save Trade** (onemogućeno dok forma nije validna)

**Date & Time je segmentiran** (MM/DD/YYYY hh:mm:ss) — nepouzdan za kucanje, radi pouzdano samo
preko kalendar-ikonice (grid dana + tri kolone sat/minut/sekunda → OK). *Ako ikad pravimo ručni unos
sa više egzekucija, koristiti običan `datetime-local`, ne ovakav segmentiran picker.*

Posle snimanja: toast „Trade added successfully" + odmah preusmerenje na punu stranicu NOVOG trejda
(ne nazad na listu). Zella Scale i MAE/MFE stoje na **„Calculating…"** (stanje učitavanja, ne
crtica).

### CSV — dva formata, dva fajla
| Format | Fajl | Namena | Ključne kolone |
|---|---|---|---|
| Execution-based | `/generic.csv` | akcije, opcije, fjučersi | `Date&Time, Date, Time, Symbol, Buy/Sell, Quantity, Price, Spread, Expiration, Strike, Call/Put, Commission, Fees` |
| Trade history | `/generic-trade.csv` | **forex i CFD** | `Open Time, Close Time, Symbol, Direction, Volume, Open Price, Close Price, P&L, Commission, Swap, Spread, Expiration, Strike, Call/Put, Currency` |

Zamke koje sam uhvatio uživo:
- Kolona **„Spread" nije spread** — to je marker tipa instrumenta (Stock/Single/Future/Forex/Crypto)
- **Format datuma se bira ODVOJENO** (combobox „MM/DD/YY"), CSV mora da se poklopi sa izborom — a
  njihov sopstveni template ima primere u `YYYY-MM-DD` što se KOSI sa podrazumevanim izborom. Prvi
  uvoz mi je pao zbog toga: „No executions were able to be imported."
- `Direction` prihvata i `Buy/Sell` i `Long` u istoj koloni (nekonzistentno)
- **Timezone combobox** odvojen od naloga (fajl može imati drugu zonu od naloga)

## Notebook (`/tracking/notebook`)

Folderi levo: All notes / Favorites / **Trade Notes** / **Daily Journal** / Sessions Recap / My
notes, „+ Add folder", Trash. Blizu identično našem Notebook-u.

### Pojedinačna beleška
Naslov = **DATUM** (uređiv, sa date pickerom), „Last update: …", ★ Favorite / Share / ⋮.
**Ugrađena kartica sa dnevnim podacima na vrhu** („Net P&L $0 · No trades this day") — Daily Journal
beleške AUTOMATSKI povlače dnevni rezime, ne kuca se ručno.

### Template biblioteka
Modal „Select template": search, **„Create new template"**, tri sekcije (Favourites / Recommended /
My templates). Trinaest ugrađenih: Daily Game Plan, All-in-One/Daily, Intra-day Check-in,
Pre-Market Prep, Quarterly Roadmap, Strengths & Weaknesses, Becoming Aware of Emotions, Weekly
Recap, Trade Recap: Timeframe Bias, Trade Recap: Basic, Daily Game plan & Report Card, Weekly
Report Card, Monthly Report Card.

Pokrivaju sve kadence (dnevno/nedeljno/mesečno/kvartalno) i različite fokuse (emocije, snage/
slabosti, timeframe bias). Preview pokazuje strukturu kao bullet listu. Primer „Daily Game Plan":

> 🏃 **Pre Market game Plan**: Market, Watchlist
> 🏃 **Day Recap**: Mistakes I made, What I did great, Reinforcement to myself
> 🏃 **Overall Recap**

Dugmad: „Add default template" (postavi kao podrazumevani sadržaj za nove beleške tog tipa) / „Edit"
/ „Use template".

## Reports (`/tracking/reports`)

Tabovi: **Performance (NEW) · Overview · Reports [dropdown] · Compare · Calendar**.

### Overview
„P&L SHOWING: NET P&L" dropdown. **„YOUR STATS (ALL DATES)"**: Best month / Lowest month / Average.
Ispod — gusta DVOKOLONSKA lista svih brojeva odjednom:

Total P&L, Average daily volume, Average winning/losing trade, Total number of trades, Number of
winning/losing/breakeven trades, Max consecutive wins/losses, Total commissions/fees/swap, Largest
profit/loss, **Average hold time (All / Winning / Losing / Scratch — 4 odvojena reda)**, Average
trade P&L, Profit factor │ Open trades, Total trading days, Winning/Losing/Breakeven days, Logged
days, Max consecutive winning/losing days, Average daily P&L, Average winning/losing day P&L,
Largest profitable/losing day, **Avg planned R-Multiple**, **Avg realized R-Multiple**, Trade
expectancy, Max drawdown (+%), Average drawdown (+%).

Pa dva grafikona sa **„+ Add metric"** (metrika se bira, nije fiksna).

### Reports [dropdown] — 7 izveštaja, JEDAN šablon

**Ovo je razlog zašto deluje dobro organizovano: jedan obrazac ponovljen sedam puta, ne sedam
različitih ekrana.** Šablon:

1. Pod-tabovi za dimenziju unutar izveštaja
2. **4 highlight kartice**: Best performing X / Least performing X / Most active X / Best win rate X
   — svaka sa ikonicom, vrednošću, brojem trejdova, $ iznosom
3. Dropdown za osnovu obračuna („NET P&L")
4. **Dual-axis grafikon** — Net P&L (levo, area fill) + Trade count (desno, linija)
5. **Bar chart** — Win % po kategoriji
6. **„Summary" tabela** — SVE kategorije uključujući prazne (npr. svih 7 dana nedelje), sa gear
   ikonicom za izbor kolona
7. **„Cross analysis"** — 2D heatmap (dimenzija × simbol) sa prekidačem metrike (Win rate / P&L /
   Trades) i „Top N" limiterom. Ćelije obojene po intenzitetu i predznaku.

| # | Izveštaj | Pod-dimenzije |
|---|---|---|
| 1 | **Day & Time** | Days · Months · Trade time (Entry/Exit prekidač + granularnost) · Trade duration (bucketi <1m…4h+) |
| 2 | **Symbols** | Symbols · Instruments · Prices (bucketi po ceni ulaska) |
| 3 | **Risk** | Volumes · Position sizes · R-multiples |
| 4 | **Strategies** | — (bucket „None" kad trejd nema playbook) |
| 5 | **Tags** | — (poseban prazan ekran kad nema tagova) |
| 6 | **Options: Days till expiration** | — (opcije-specifično, van obima) |
| 7 | **Wins vs Losses** | — (DRUGAČIJI šablon, vidi dole) |

**Wins vs Losses** odstupa od šablona: dva chip rezimea gore („WINS (5 Trades Matched)" / „LOSSES
(3 Trades Matched)"), pa PUN Statistics blok posebno za WINS, pa isto za LOSSES ispod (ređano, ne
uporedo), svaki sa svojim kumulativnim grafikonom.

### Compare — slobodan A/B graditelj segmenata
**Različito od „Wins vs Losses".** Dve grupe (**Group #1** / **Group #2**), svaka sa identičnim
filter setom: Symbol (multi-select chip), Tags, Side, Start date, Trade P&L, End date. „Reset" /
„Generate Report".

Rezultat po grupi: naslov se ažurira brojem („Group #2 (2 Trades Matched)"), **puna Statistics
lista**, **„OVERALL EVALUATION" donut** (winrate + broj winners/losers sa legendom), i kumulativni
P&L grafikon.

Testirano uživo: EURUSD naspram GBPUSD → 83% winrate, 5 winners / 1 loser za grupu 1.

### Calendar
Godišnji pregled — svih 12 meseci kao mini-kalendari u 3-kolonskom gridu, prev/next godina.

### Performance (NEW) — redizajn Overview-a
Isti grafikon-par gore, pa tri pod-taba: **Summary / Days / Trades**.

- **Summary** — iste metrike kao Overview ali u **4-kolonskom gridu kartica sa (ⓘ) tooltip-om uz
  svaku** — čitljivije od guste liste.
- **Days** — metrike kojih Overview NEMA: Largest profitable/losing day (sa link ikonicom ka tom
  danu), **Average trading days duration** („3h 52m" — od prvog do poslednjeg trejda u danu), i
  **Avg Zella Scale** (vidi Deo 3).
- **Trades** — nije otvoren.

## Strategies / Playbook (`/tracking/strategy/my-strategy`)

### Lista
Tabovi: **My Strategies (2/10)** · Shared with me · Templates · Backtest Scenarios. Pod-tabovi
Active / Archived. Prikaz grid ili tabela (prekidač + gear).

Limit „2/10" — plafon broja playbook-ova po pretplati.

**Tabela (10 kolona)**: Title, Missed trades, Shared strategies, Average loser, Average winner,
Total net P&L, Profit factor, Trades, Expectancy, Win rate.
*(Mi smo ovo već preslikali u užem obliku — 5 kolona.)*

**Grid kartice**: naslov + ⋮, donut win-rate, 6 stat polja: Win rate / Trades / Profit factor /
Daily win rate / Avg trade duration / Win-Loss.

### Detalj playbook-a
Hero slika, ikonica + naziv, autor (avatar + ime), slobodni tagovi (Intraday/Futures/Forex), opis,
red od 6 statistika. **Tabovi: Stats · Rules · Trades · Backtesting · Scenarios · Notes**

- **Rules** — „+ Add rule group". Grupe sa drag-handle (⋮⋮) i ⋮ menijem (Edit / Delete group). Po
  pravilu 4 kolone: Follow rate / Net P&L / Profit factor / Win rate.
  *(Naša podela Followed/Broken/Difference je rigoroznija — ne menjati.)*
- **Trades** — pod-prekidač **Executed / Missed / Sample**. „Sample" je treći koncept, verovatno
  hipotetički primeri za deljene template-e.
- **Backtesting** — „Backtest on your own" (ručno, bar-po-bar) i „AI Automated Backtesting" (BETA,
  Pro/Ultra). Van obima — traži istorijski price feed.
- **Scenarios** — sačuvane konfiguracije backtest-a.
- **Notes** — filtriran Notebook po strategiji.

### Kreiranje — dva puta

**A) Galerija template-a** (podrazumevani prvi ekran „Create a new strategy"):
Ovo objašnjava demo playbook-ove na nalogu — **nisu seed podaci nego JAVNA GALERIJA** koju vidi
svaki korisnik. Filter po ASSET CLASS (Futures/Crypto/Forex/Stocks/Options), search, checkbox „Show
every time I create a strategy", i **„+ Create your own"** fiksno dole levo.

Kartice nose stvarne autore iz trading-edukacije zajednice (Martin, Vincent Desiano, Marco Trades,
TG Capital, Trader Kane, Rajan Dhall, Joshua Cutler, Dylan O'Neill, Kris Verma, Lance Breitstein,
NBB Trader). 16+ template-a: ICT Model HTF POI+MSS+FVG+OTE, Break & Retest, Liquidity Playbook,
Unique High RR, SMT Divergence + PO3, Market Auction Theory, iFVG Model, Support and Resistance,
Low Volume Node, Mean Reversion, PO3 OTE + ADR, AMD Playbook…

Hover: **„Add to my strategies"** / **„Preview"**. Preview je puna stranica sa **video thumbnail-om
autora**, tabovima Notes/Rules/Trades/Stats, i dugmetom **„Backtest this template"** (prva ponuđena
akcija je testirati, ne odmah koristiti).

**B) „Create your own"** — jedna stranica, ne wizard:
- **General info**: Name · **„Icon or color"** (dva taba: pun emoji picker sa 9 kategorija i search,
  ili paleta boja) · Description · **Photo** (odvojeno od ikonice — hero slika)
- **Rules**: „Define when a trade should match this setup." Naziv grupe je **prazan input sa
  placeholder-om „E.g. Entry criteria"** — slobodan tekst, potvrđuje da je slobodno imenovanje
  njihov standard. Po pravilu: tekst + **dropdown Always / Winner / Loser / Break even** (tooltip:
  „Only show this rule when the selected trade outcome or type applies").
- Footer: Cancel / **„Save and backtest"**

> **Potvrda za nas**: `SHOW_WHEN_VALUES` (`always`/`winner`/`loser`/`breakeven`) je DOSLOVNO isti
> skup, sa istom logikom i skoro istom formulacijom kao naš komentar u `playbook-types.ts`. Slobodno
> imenovanje grupa je takođe njihov standard — što smo upravo izgradili.

## Progress Tracker (`/tracking/progress-tracker`)

Ekran za **DISCIPLINU (proces)**, ne kvalitet setupa:
- „Today's progress: X/Y", „Current streak: N days", emoji indikator raspoloženja
- **GitHub-stil heatmap kalendar** sa „Less…More" legendom
- „Current period score"
- **„Current rules" tabela**: RULE / CONDITION / RULE STREAK / AVERAGE PERFORMANCE / FOLLOW RATE

### „Edit rules" modal
Napomena na vrhu: **„Changes you make will only update your scoring for today and for future days."**
— izmene NIKAD ne menjaju istorijsko bodovanje unazad.

- **Trading days** — 7 dugmadi (Mo–Su), globalni filter dana za SVA pravila
- **Toggle „Send an email reminder when I'm about to lose my streak"** + vremenski picker
- **Tri kategorije koje prate tok dana**, svaka sa svojim „+ Add rule":

| Kategorija | Podrazumevana pravila |
|---|---|
| **PREPARE** | „Start my day by [09:30]" |
| **TRADE** | „Trading hours" (From/To, 24h, sa zonom naloga) |
| **REFLECT** | „Link trades to playbook" · „Input Stop loss to all trades" · „Net max loss /trade" (**sa $ / % prekidačem**) · „Net max loss /day" |

- **„+ Add rule"** otvara slobodnu formu: „Name the rule" + dan-raspon („Mon-Fri") — znači
  podrazumevana pravila nose ugrađenu logiku, ali korisnik može dodati i potpuno slobodna imenovana.

**Model PREPARE/TRADE/REFLECT je mentalno lakši od ravne liste pravila.** $/% prekidač na max-loss
je mala ali korisna stvar (fiksni dolar ne skalira sa rastom naloga, procenat da).

## Settings — Tags management (`/settings/*`)

Sidebar: **USER** (Profile, Security, Subscription) · **GENERAL** (Accounts, PT/SL settings,
Commissions & fees, Trade settings, Global settings, Editor, **Tags management**, Import history,
Log history, Report subscriptions, Support access).

### Categories tab
„You can create a category which can be assigned tags." Tabela: Category name, Color, ⋮ meni
(**Edit / Delete** — pravo brisanje, nema arhiviranja), „+ Add category", search, sort.
Podrazumevane tri: **Custom Tags** (zelena) · **Mistakes** (žuta) · **Setups** (ljubičasta).

### Tags tab
Filter po kategoriji, search, „+ Add tag". Tabela: **Tag name, Category, Used (brojač upotrebe),
Description, ⋮ (Edit/Delete)**. Plus **link za reset na podrazumevane tagove** — siguran izlaz ako
se pretera sa brisanjem.

Seed tagovi:
- *Setups* (akcijska terminologija, manje relevantno za forex): contract winner, earnings and
  winner, gap and go, green to red, morning breakout, morning panic, multi month/week breakout,
  news hype, red to green, volume gainer
- *Mistakes* (**univerzalno primenjivo**): bored, chased, did not cut losses quickly, **fomo**,
  not in plan, no volume, overtrade, red on the day, revenge trading
- *Custom Tags* — prazno podrazumevano

## Trade Replay (`/tracking/replay-scenarios`)

„Relive Your Trades — … second-by-second by analyzing your real-time execution, emotions, and
decisions."

**Nije bilo moguće otvoriti iz ovog okruženja**: preusmerava na Dashboard sa „this feature is not
available in mobile version". TradeZella detektuje Browser pane kao mobilni preko User-Agent-a
(sadrži „Electron/…"), ne preko širine (prozor je bio 1134px). Nisam menjao UA da zaobiđem
detekciju. Ako ikad zatreba — probati kroz pravi Chrome.

## Resources (`/tracking/resources`)

Samo ekonomski kalendar (isti izvor kao Event Calendar u Start-my-day). Minimalno.

---

# DEO 3 — Obrasci koji se ponavljaju kroz ceo proizvod

Ovo je ono što proizvod drži na okupu — iste ideje primenjene na više mesta.

## 1. Zella Scale — MAE↔MFE kao JEDNA traka

Pojavljuje se **na dva nivoa**, što potvrđuje da je centralan koncept, ne dekoracija.

**Po trejdu** (Stats tab). Tooltip na stvarnim podacima:

```
Zella Scale
Maximum Loss                          Maximum Profit
$0                                        $4,981.8
▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
              Realized Profit
                   $360
```

**Ključno: skala je u DOLARIMA, ne u ceni.** MAE i MFE se konvertuju u „koliko bi izgubio/zaradio u
najgorem/najboljem trenutku", a realizovani rezultat se markira na toj traci. Ovde: moglo je
$4.981, uzeto $360 — traka pokazuje sićušan uhvaćen deo.

Uz traku stoji i sirov **Price MAE / MFE** kao dva obojena cenovna nivoa.

**Agregatno po danima** (Performance → Days → „Avg Zella Scale"):
```
Max Avg Loss (-$1,351.11)  ←──bar──→  Max Avg Profit ($1,684.68)
        Realized Avg Loss (-$129)   Realized Avg Profit ($176.1)
```
Isti koncept usrednjen preko svih dana: „koliko od svog teoretskog raspona u proseku uhvatiš".

**Kako se sve povezuje** (potvrđeno na trejdu sa stvarnim podacima):
- **Running P&L kriva** = mark-to-market kroz život trejda
- **MFE** = maksimum te krive → „Maximum Profit"
- **MAE** = minimum te krive → „Maximum Loss"
- **Realizovano** = gde se kriva završila
- **Zella Scale** = te tri tačke prikazane kao jedna traka
- **„Best exit"** kolone = MFE izražen kao cena / vreme / P&L / %

**Odakle im podatak**: iz NJIHOVOG price feed-a za simbol+vremenski prozor, ne iz trejda koji si
uneo. (Dokaz: moje izmišljene CSV cene od 1.087 dale su MAE/MFE od 1.16866/1.17003 — stvarne
tržišne cene EURUSD-a tog dana.) Ručno uneti trejd zato stoji na „Calculating…" — nema šta da se
poveže.

> **Zašto je ovo najvažniji nalaz za nas**: MAE/MFE kod nas na trading nalozima dolazi iz MT5
> terminala (`scripts/mt5_excursion.py`), a na backtest nalozima iz TradingView izvoza pri uvozu (README §
> „MAE/MFE comes from MT5 on live accounts"). Ono što ovde dobijamo je OBLIK PRIKAZA, nezavisno od izvora. Ovaj ih daje gotov, na tri nivoa: traka po trejdu, „best exit" kolone u
> gridu, i agregatna traka po danima.

## 2. Korisnik upravlja svojim kategorijama (bez izmene koda)

Isti obrazac na tri mesta:
- **Tagovi trejda** — Setups / Mistakes / Custom Tags + „+ Add new category" + „Manage tags"
- **Grupe pravila u playbook-u** — slobodno imenovanje, placeholder umesto fiksnog spiska
- **Folderi u Notebook-u** — „+ Add folder"

Svugde: dodaj / preimenuj / obriši, sa pravim brisanjem (ne arhiviranjem) i **reset-na-podrazumevano**
kao sigurnosnom mrežom.

*Mi smo ovo upravo izgradili za sekcije playbook-a — isti obrazac, samo primenjen na jedno mesto.*

## 3. Prekidač jedinica — identičan našem `ViewMode`

Dashboard, gornja traka:

| Opcija | Napomena koju sami prikazuju |
|---|---|
| **Dollar** | ✓ podrazumevano |
| **Percentage** | |
| **Privacy** | |
| **R-multiple** | „shown for trades with entered initial risk only" |
| **Ticks** | „for future trades only" |
| **Pips** | „for forex trades only" |
| **Points** | „for future trades only" |

**Sedam vrednosti, identičnih našem `ViewMode` tipu** (`dollars | percentage | r | ticks | pips |
points | privacy`). Vredno preslikati: oni ispisuju OGRANIČENJE svake jedinice odmah u meniju, pa
korisnik zna zašto je nešto prazno.

## 4. Beleške u tri sloja istog dana

plan (pre) → beleška koja se prenosi (tokom) → refleksija (posle). Plus template biblioteka koja
svaki od tih slojeva pretvara iz prazne stranice u imenovana pitanja.

## 5. Isti šablon za svaki izveštaj

4 highlight kartice → dual-axis grafikon → win% bar → summary tabela → cross-analysis heatmap.
Sedam puta isto. To je jedina razlika između „ima mnogo izveštaja" i „deluje organizovano".

---

# DEO 4 — Šta je primenjivo kod nas, po prioritetu

## Visok prioritet — direktno primenjivo, imamo podatke

**1. Zella Scale ekvivalent za naš MAE/MFE**
Podatke već snimamo botom. Fali prikaz: traka po trejdu (min ↔ max sa markerom realizovanog),
„best exit" kolone u gridu, i agregatna traka. Vidi Deo 3.1 za tačnu strukturu.

**2. Vođeni dnevni tok („Start my day")**
Imamo delove razbacane (Daily Check-in, insights, Notebook). Nemamo REDOSLED koji ih spaja. Četiri
koraka + vraćanje procesnih pravila u završni korak.

**3. Progress Tracker (disciplina kao svoj ekran)**
PREPARE / TRADE / REFLECT kategorizacija, heatmap kalendar, streak, follow rate po pravilu. Naš
`insights/process-rules.ts` već računa deo ovoga — fali ekran i kategorizacija.

**4. Šablon izveštaja**
Naš `/reports` je fleksibilniji (slobodan izbor dimenzije+metrike), njihov čitljiviji (unapred
sastavljen po dimenziji). Ne zameniti naš — dodati par unapred sastavljenih pogleda po istom
šablonu.

**5. Cross-analysis heatmap**
2D pivot sa bojenjem po intenzitetu. Proveriti da li naš pivot već ume bojenje ćelija.

## Srednji prioritet — jasno, ali traži novi koncept

**6. Tagovanje trejdova** (Setups / Mistakes / Custom + korisničke kategorije) — ✅ URAĐENO
(`34041d4`, `78cf78d`, na osnovu plumbing-a iz `b953f8e`). Settings → Categories/Tags daje pun
CRUD (ime, boja, broj upotreba, premeštanje taga između kategorija, pravo brisanje sa
upozorenjem), a `TagMultiSelect`/`EditableSelect` čitaju/pišu isti `OptionItem`/`addOption`
mehanizam. `technical_tags`, `mistake`, `psychology_tags` su rezervisana `type: "tags"` polja
(`form-config.ts`) mapirana na `text[]` kolone; kreiranje kategorije sad automatski kreira i
njeno polje na formi. Ovo je bio taj isti mehanizam koji smo već koristili za sekcije playbook-a
— korisnik ga je proširio na tagove nezavisno od ovog dokumenta.

**7. Template biblioteka za beleške**
Par gotovih struktura sa imenovanim pitanjima + „Select template" modal. Ne traži AI ni spoljne
podatke.

**8. Post-hoc unos SL/TP sa „Target in" izborom**
Price / Price movement / P&L / Pips — isti cilj izražen u jedinici u kojoj razmišljaš.

**9. Trade Rating u polukoracima** (0.5–5)
Finije od naših celih 1–5. Sitna izmena ako se ikad poželi.

**10. „Reviewed" prekidač po trejdu**
Ručna oznaka „pregledano", odvojena od postojanja beleške, sa filterom u gridu.

## Nisko / van obima

- **TradingView grafikon** — traži licenciran price-feed provajder. Najveći skok kvaliteta ako se
  ikad reši, ali to je zaseban projekat.
- **Backtesting + Scenarios + Trade Replay** — sve traži istorijske (i tick) podatke.
- **Template galerija sa autorima** — traži ceo poslovni model (kreatori, kuracija, revenue-share).
- **AI (Zella AI, Agents, Mentor Mode)** — isključeno po izričitom zahtevu vlasnika.
- **PropFirm Sync** — isključeno po izričitom zahtevu vlasnika.

## Gde smo MI bolji (ne dirati)

- **Followed / Broken / Difference** po pravilu — njihov flat „follow rate" ne kaže da li je
  poštovanje pravila STVARNO donelo bolji ishod. Naša podela to meri.
- **Prilagodljiv dashboard** (Layout / Sections) — njihov je fiksan.
- **Slobodan izbor dimenzije + metrike** u izveštajima — njihov je unapred sastavljen.
- **MAE/MFE** — kod njih iz rekonstrukcije feed-a; kod nas trading iz brokerovih MT5 tikova (bid za
  long, ask za short), backtest iz TradingView-ovog sopstvenog excursion-a.

---

# DEO 5 — Metod, podaci, i šta nije provereno

## Test podaci na TradeZella nalogu (ostavljeni)
- 8 trejdova preko CSV-a (Trade history format): EUR/USD i GBP/USD, 18–21. avgust 2026
- 1 ručno unet trejd (EURUSD, +$250, 22. avgust) — služio da se vidi ceo tok ručnog unosa
- Ukupno u trenutku pisanja: 9 zatvorenih + 1 otvoren, Net P&L +$743.5, Win rate 66.67%, PF 2.92

Ništa nije obrisano — vlasnik nije tražio, i to je njihov nalog, ne naš. Nijedan postojeći podatak
nije izmenjen (jedan red egzekucije sam otvorio za inline izmenu radi provere i otkazao bez čuvanja).

## Sadržaj koji je već bio na nalogu (nije moj)
- Playbook „fdgdsfgd" (raniji test)
- Playbook „ICT Model: HTF POI + MSS + FVG + OTE" (by Martin) — **iz javne galerije template-a**, ne
  seed podatak vezan za nalog
- Beleška „ICT MODEL 3 CHECKLIST"
- Progress Tracker pravila (Start my day by 09:30 itd.)

## Namerno preskočeno (zahtev vlasnika)
Agents · Mentor Mode · PropFirm Sync · top-level Backtesting.

## Nije provereno / ostaje otvoreno
- **Trade Replay** — blokiran UA detekcijom (vidi sekciju)
- **Performance → Trades** pod-tab
- **Strategies**: Stats tab, „Templates" i „Backtest Scenarios" tabovi na listi, „Shared with me",
  gear na listi
- **Zella Insights** vrednosti (AI kolona — van obima, ali nikad nisam video popunjen primer)
- Day View — jedna neidentifikovana kružna ikonica po danu
- Settings — sve osim Tags management i Global settings
- Notebook — „Create new template" tok
- Progress Tracker — onboarding koraci 2–4

## Ispravljeno u odnosu na ranije verzije ovog dokumenta
1. **Trade View filteri** — prvo zapisano da ne postoje. Postoje, i bogati su; „Filters" dugme je
   bilo van vidljive širine uskog prozora.
2. **Running P&L** — prvo protumačeno kao izloženost/margin. Zapravo je mark-to-market nerealizovani
   P&L, i direktno objašnjava Zella Scale.
3. **Struktura stranice trejda** — prvo zapisano kao jedan dugačak scroll. Zapravo dvo-kolonska sa
   dve nezavisne grupe tabova.
4. **Reports tabovi** — „Recaps & Insights" ne postoji; stvarna lista je Performance / Overview /
   Reports / Compare / Calendar.
5. **Demo playbook-ovi** — nisu seed podaci naloga nego javna galerija template-a.
6. **Add Trade** — redovi egzekucija se dodaju pojedinačno, ne automatski u BUY+SELL paru.
