# Trading Journal

Swing/ICT trading dnevnik za jednog trejdera. Ručni unos, bez AI chat-a — disciplinovan zapis šta
je odtrgovano i koliko je proces ispoštovan, i poštena aritmetika nad tim zapisom. Jedini
automatski upis je **bot most** (§ Bot most): on beleži isključivo ono što je broker već učinio,
a sve što je procena i dalje se kuca rukom.

Pravljen da metrikama, beleškama i izveštajima pokrije ono što TradeZella radi, minus delovi koji
imaju smisla samo za višekorisnički SaaS. Gde se razlikuje, razlika je zapisana i obrazložena —
ovde ili u `ROADMAP.md`.

Interfejs je **pretežno na engleskom**. Srpski je ostao tamo gde tekst objašnjava a ne imenuje —
rečenice pored polja, pitanja dnevnog i nedeljnog pregleda, poruke karantina bot mosta: oko 46 od
nekih 1700 vidljivih stringova. Kod, komentari i `CODE_REVIEW.md` su na engleskom.

Deploy: Vercel · Baza: Supabase Postgres (odvojen projekat od dashboard-a)

---

## Jedno pravilo oko kojeg je sve građeno

**Pogrešan broj prikazan kao činjenica gori je od pada aplikacije.**

Pad je vidljiv i neko ga popravi. Win rate izračunat nad polovinom trejdova, drawdown od „0 %" na
nalogu koji je samo gubio, Sickre Score 33 na nalogu bez ijednog trejda — to se prikaže kao
činjenica, poveruje mu se, i promeni način na koji neko trguje.

Sve konvencije ispod postoje zbog toga, i svaka je bar jednom bila stvarna greška zabeležena u
`CODE_REVIEW.md`:

- **Null nije nula.** Statistika bez podataka odgovara `null`, a prikaz pokazuje `—`. Sva tri
  nalaza runde 3 oko skora (`S1`, `S2`, `S3`) bila su jedna `0` koja je stajala umesto „nema
  dokaza".
- **Odbij umesto da pogađaš.** Dvosmislen datum sa izvoda (`02-03-2026`) ili dvosmislen decimalni
  zapis (`1,234`) se odbija, ne tumači. Odbijena ćelija se vidi u uvozu; pogođena je stostruko
  pogrešna i tiha.
- **Veličina uzorka putuje uz broj.** Red izveštaja nosi svoj `n`; kompozitni skor odbija da
  postoji ispod pet trejdova i označen je kao privremen ispod trideset.
- **Jedan odgovor po pitanju.** Dva parsera, dva prozora „poslednjih 90 dana" ili dva filtera za
  životni vek pravila — razići će se, i jedan će biti pogrešan. Runda 3 je našla četiri takva para.

---

## Gde ovo stoji

Treći repo trading desk-a. **Nisu integrisani kodom** — nema deljene baze ni API poziva između
njih. Veza je semantička.

| Repo | Odgovara na | Smer podataka |
|------|-------------|---------------|
| [`trading-fundamental-vault`](https://github.com/0xsickre/trading-fundamental-vault) | Koji smer? Je li ulaz kvalitetan? | Write (agent, F1–F4) |
| [`trading-dashboard`](https://github.com/0xsickre/trading-dashboard) | Gde je ciklus stao? Šta je spremno? | Read-only prikaz |
| **`Trading_Journal`** (ovaj repo) | Šta sam odtrgovao i sa kakvom disciplinom? | Write (ti, posle F5) |

Watchlist instrumenata je usklađen sa vault `instrument_registry`, a polja `macro_align` /
`cot_filter` beleže vault odluku **u trenutku ulaska** — zapis odluke, ne njena rekonstrukcija. TA
plan za F5 (entry trigger, timeframe, izvršenje) živi u Notion-u, van ovog repoa.

Teza: **P&L je posledica, proces je uzrok.** Zato dnevna ocena meri napredak na aktivnom procesnom
cilju, nikad zaradu, a analitika razlaže rezultat po dimenzijama koje su pod tvojom kontrolom.

---

## Pokretanje

Traži Node 20.9+ (zahtev Next.js-a 16) i Supabase projekat.

```bash
npm install
cp .env.example .env.local   # pa popuni dve vrednosti ispod
npm run dev
```

Dve env promenljive, obe javne po dizajnu — anon ključ je bezbedan u pregledaču zato što je svaka
tabela zaštićena row-level security politikom, a ne tajnošću ključa:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon ključ>
```

| Komanda | Šta radi |
|---|---|
| `npm run dev` | Razvojni server |
| `npm run build` | Produkcijski build — 16 ruta (15 stranica + `/_not-found`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run scan` | Bajtovi, ne značenje: NUL, nevalidan JSON, `.only`/`.skip`, `console.log`, konflikt markeri |
| `npm run schema:check` | Zapis baznih tabela (`supabase/schema/`) protiv generisanih tipova |
| `npm run lint` | ESLint. **Očekuje se nula problema i nula upozorenja** |
| `npm test` | Vitest — 2344 testa u 140 fajlova, u dva projekta (`lib` u node-u, `components` u jsdom-u) |
| `npm test -- --coverage` | Izveštaj o pokrivenosti |
| `npm run dead` | knip: mrtvi fajlovi, eksporti i zavisnosti |

**Prag lint-a je nula, i nekad nije bio.** `journal-grid.tsx` prijavljivao je *„Compilation Skipped:
Use of incompatible library"* — React Compiler ne ume da memoizuje komponentu koja koristi
`useReactTable` iz TanStack Table. Poruka je tačna i trajna, pa je **ućutkana na licu mesta, sa
zapisanim razlogom**, umesto da se toleriše kao „tačno 1" u CI fajlu koji niko ne čita dok ne pukne.
Izuzetak sad stoji pored koda na koji se odnosi.

### CI

`.github/workflows/gate.yml` vrti **sedam** provera na svakom push-u na `main` i na svakom pull
request-u, poređanih od najjeftinije ka najskupljoj: `typecheck` → `scan` → `schema:check` →
`test --coverage` → `lint` → `build` → `dead`. Do runde 4 gate je postojao samo kao dogovor — vrteo
se pred commit zato što je tako dogovoreno — a dogovor ne obara pull request. Runner je na Node 22.

Jedan korak traži više od jedne komande, jer mu alat sam po sebi ne čuva ništa:

- **lint** — ESLint izlazi sa 0 i na upozorenjima, pa se izlaz MERI. Prag je **nula problema**;
  jedini poznati izuzetak (React Compiler nad TanStack Table) ućutkan je u samom fajlu.

`knip` je na **nuli za sve tri vrste nalaza** — mrtav fajl, mrtva zavisnost i neiskorišćen export.
Ranije je tolerisao 22 export-a (re-export-i iz `shadcn/ui` koje ništa ne uvozi); obrisani su, jer
spisak koji uvek ima 22 stavke je spisak u koji se prestane gledati — i tako je 23. prošla
neopaženo.

Build traži `NEXT_PUBLIC_SUPABASE_URL` i `NEXT_PUBLIC_SUPABASE_ANON_KEY` kao **repo varijable**
(Settings → Secrets and variables → Actions → Variables), ne kao tajne — obe su javne po dizajnu,
jer anon ključ sam po sebi ne daje pristup nijednom redu iza RLS-a. Kad nisu podešene, korak to
kaže rečenicom umesto da padne na nerazumljivoj grešci iz Next-a.

### Stack

Next.js 16.2.9 (App Router, Server Components, Server Actions — **bez REST route handler-a**),
React 19.2.4, TypeScript 5, Tailwind 4, shadcn/ui, TanStack Table 8, Recharts 3, Zod 4, Supabase
(PostgREST + RLS), Vitest 4.

---

## Model podataka

30 tabela i 1 view, sve sa prefiksom `tj_`. **Row-level security je uključen na svih 30 tabela**,
svaka politika po istom vlasničkom obrascu:

```sql
CREATE POLICY ... FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()));
```

### Trejd nije jedan red

Centralna odluka. Pozicija je parent red plus njeni fill-ovi:

```
tj_positions  ──1:N──▶  tj_executions        ulazi i izlazi, svaki sa svojom cenom,
     │                                        količinom, vremenom, provizijom i swap-om
     └──────────────▶  tj_position_stats     VIEW koji izvodi prosečan ulaz/izlaz, bruto,
                                              neto, R, trajanje — nikad se ne upisuje dvaput
```

Skaliranje unutra, skaliranje napolje i delimična zatvaranja time postaju obični podaci umesto
specijalnih slučajeva, a nijedan izvedeni broj se ne upisuje u kolonu gde bi mogao da zastari.

`tj_position_stats` ima `security_invoker = on`, pa se filtrira RLS-om korisnika koji pita, a ne
vlasnika view-a. Ima i **TypeScript blizanca**, `src/lib/journal/position-stats.ts`, koji mora da
računa isto — SQL je ono što aplikacija čita, a TypeScript je ono što forma prikazuje pre snimanja.
Test drži oba nad istim ulazima.

### Tabele

| Grupa | Tabele |
|---|---|
| **Trejdovi** | `tj_positions`, `tj_executions`, `tj_trade_images` |
| **Nalozi i novac** | `tj_accounts`, `tj_cash_events`, `tj_instruments` |
| **Konfiguracija** | `tj_option_lists`, `tj_option_items`, `tj_field_defs`, `tj_user_prefs`, `tj_dashboard_templates` |
| **Dnevni proces** | `tj_daily_reports`, `tj_focus_goals`, `tj_position_checkins` |
| **Nedeljni proces** | `tj_weekly_reviews` |
| **Tracker** | `tj_tracker_rules`, `tj_tracker_checkins` |
| **Playbook-ovi** | `tj_playbooks`, `tj_playbook_sections`, `tj_playbook_rules`, `tj_playbook_rule_links`, `tj_position_rules` |
| **Notebook** | `tj_notes`, `tj_note_folders`, `tj_note_tags` |
| **Uvoz** | `tj_import_batches`, `tj_import_rows` |
| **Bot most** | `tj_bot_tokens`, `tj_bot_events`, `tj_broker_symbol_map` |

### Korisnički definisana polja

`tj_field_defs` omogućava dodavanje polja bez migracije. Vrednosti idu u `tj_positions.custom`
(jsonb) umesto u novu kolonu, i svako takvo polje automatski postaje dimenzija po kojoj se može
grupisati izveštaj. Prave kolone ostaju prave kolone — `src/lib/journal/trade-fields.ts` deli
podnesak između to dvoje.

Upis u jsonb zamenjuje ceo dokument, pa izmena spaja preko prethodnog sadržaja umesto da ga dodeli.
Inače bi svako polje koje forma nije iscrtala — uključujući ono deaktivirano prošlog meseca — bilo
obrisano nevezanim snimanjem.

---

## Rute

| Ruta | Šta je |
|---|---|
| `/` | Dashboard: KPI-jevi, equity kriva, drawdown, heatmap kalendari, breakdown-ovi, Sickre Score, insights |
| `/journal` | Tabela trejdova — sortiranje, filtriranje, biranje kolona |
| `/trades/new`, `/trades/[id]/edit` | Forma trejda: plan, fill-ovi, playbook checklist, psihologija, slike |
| `/daily` | Dnevni izveštaj + tracker checklist za jedan dan; zaključavanje dana |
| `/calendar` | Mesečna mreža P&L-a po danu, nedeljni zbirovi |
| `/weekly` | Nedeljni pregled: ocena nedelje, pet pitanja, brojke nedelje (`week-recap.ts`) |
| `/playbooks` | Spisak svih setup-ova kao tabela: Trades / Net P&L / Win Rate / Missed / Expectancy po redu |
| `/playbooks/[id]` | Jedan playbook: identitet, Stats, Rules (uređivač sekcija i pravila), Trades, Notes |
| `/reports` | Radni sto za izveštaje — bilo koja metrika protiv bilo koje dimenzije, plus pivot |
| `/tracker` | Preusmerava na `/daily` (ostalo jer je tracker nekad živeo ovde) |
| `/notebook` | Beleške, folderi, tagovi, markdown |
| `/import` | Čarobnjak za CSV uvoz, istorija batch-eva, undo |
| `/settings` | Šest tabova: Categories (liste opcija + korisnička polja, jedan potez pravi oboje), Tracker, Instruments, Accounts (uklj. FTMO), Deposits / withdrawals, Bot most. Brisanje naloga i reset su u Accounts |
| `/login` | Supabase auth |

---

## Metrike

34 metrike u jednom registru (`src/lib/journal/reports/metrics.ts`), 25 ugrađenih dimenzija u četiri
grupe (11 sa trejda, 9 izvedenih, 4 procesne, 1 insight) plus po jedna za svako korisničko polje.
Bilo koja metrika ide protiv bilo koje dimenzije — zato postoji jedan report engine umesto deset
stranica sa izveštajima. Tabele ispod nabrajaju svih 34.

**Registar je registar, ne druga implementacija.** Svaki unos delegira funkciji koja već postoji i
već je testirana na drugom mestu. Metrika koja bi računala nešto u sebi razišla bi se sa modulom
koji to isto računa.

### Novac i brojanje

| Metrika | Formula | Napomena |
|---|---|---|
| Neto P&L | `Σ (bruto − provizije − swap)` | Datira se po danu **zatvaranja**, u zoni naloga |
| Bruto P&L | `Σ (izlaz − ulaz) × količina × point_value × smer` | |
| Trades | Broj zatvorenih trejdova u obuhvatu | |
| Win rate | `dobici / (dobici + gubici) × 100` | **Breakeven trejdovi su van imenioca** |
| Avg win / Avg loss | Prosečan novčani dobitak i gubitak, odvojeno | |
| Avg win/loss | `avg win / \|avg loss\|` | Novčani racio, ne R — komponenta Sickre Score-a |
| Profit factor | `bruto profit / bruto gubitak` | `Infinity` kad nema gubitka — stvarni maksimum, ne nedostatak podataka. `null` samo kad nema šta da se deli |
| Expectancy | `winRate × avgWinR + (1 − winRate) × avgLossR` | Računa se samo nad R populacijom — samo trejd sa stopom ima R |
| Najbolji / najgori | Najveći i najmanji pojedinačni neto rezultat | |
| Breakeven | Trejdovi unutar breakeven pojasa naloga | |
| **R (svuda)** | `bruto poeni / (rizik u poenima × ulazna količina)` | **R je uvek BRUTO**, i ne prati net/gross prekidač — taj prekidač menja samo novac |

**Zašto je R bruto, a novac može biti neto.** To su namerno dva različita pitanja. R meri **setup**: da
li je cena otišla tamo gde je plan rekao, u odnosu na rizik koji je preuzet. Provizija i swap nisu
svojstvo setupa nego cena držanja, i za swing knjigu su posebna stavka koju treba videti odvojeno —
zato imaju svoj tajl (`Swap`) na `/reports` i zato postoji net/gross prekidač nad novcem.

Posledica koju treba znati čitajući ekran: **trejd može biti gubitak u novcu i pozitivan u R-u.**
Držan tri dana, cena je otišla tvojim putem za +0.03R, a carry je pojeo i to — neto minus. To nije
nesaglasnost nego dva tačna odgovora na dva pitanja: setup je odradio svoje, držanje se nije
isplatilo. `tj_position_stats` računa i `realized_r_net` za slučaj da neto R ikad zatreba, ali ga
nijedan ekran namerno ne čita — jedan R po knjizi, da dva ne bi počela da se razilaze.

**Breakeven pojas** je po nalogu (`breakeven_from`, `breakeven_to`, u valuti ili procentu). Scratch
od ±20 $ nije ni dobitak ni gubitak, i izbacuje se iz win rate-a umesto da se broji kao gubitak —
što bi knjigu punu scratch-eva potcenilo za nekoliko poena.

**„All accounts" ne sabira različite valute.** €500 i $300 nisu $800. Kad nalozi u obuhvatu nemaju
zajedničku valutu, dashboard, `/reports` i „Export for Claude" odbijaju da izračunaju pooled novčanu
figuru — ceo novčani deo ekrana se zamenjuje upozorenjem umesto da tiho pokaže broj u pogrešnoj
jedinici. Isti nalozi u istoj valuti se i dalje normalno sabiraju.

### Rizik

| Metrika | Formula | Napomena |
|---|---|---|
| Max drawdown | Najdublji pad od vrha do dna kumulativnog P&L-a | U novcu, unutar grupe |
| Avg daily DD | Prosečan pad unutar dana, od dnevnog vrha | Dan bez pada ulazi kao 0 |
| Recovery factor | `neto profit / max drawdown` | `null` dok kriva nikad nije pala |
| Sharpe | `prosečan dnevni P&L / σ × √periodsPerYear` | |
| Sortino | Isto, ali brojilac gleda samo padove ispod nule — imenilac i dalje broji **sve** dane, ne samo gubitaške | `null` kad nijedan dan nije bio u minusu — rast nije rizik |
| Calmar | `godišnji prinos / max drawdown` | Recovery factor podeljen vremenom koje mu je trebalo |
| Consistency | `100 − cv × 20`, gde je `cv = σ / \|prosek\|` | 0 za knjigu koja gubi |
| Avg MAE u R | Prosek koliko su trejdovi išli protiv pozicije | Prosečava se samo nad trejdovima koji *imaju* MAE |

**Planirani reward se PONDERIŠE kad se izlazi u delovima.** Ulaz-do-targeta je ceo plan samo kad
cela pozicija izlazi na jednoj ceni. Skini 30 % na 1R, 30 % na 2R i ostatak na 3R i plan vredi
`0.3×1 + 0.3×2 + 0.4×3 = 2.1R`, ne 3R. Pošto je taj broj **imenilac** Target attainment-a,
precenjivanje stiže kao nizak rezultat — metrika bi te kažnjavala baš zato što skaliraš izlaz.
Najbliži nivo je ista greška u ogledalu (1R, pa naduvan rezultat); nijedan pojedinačan nivo ne
odgovara na to pitanje, samo ponderisan plan. `blendedPlannedRewardR` je ista funkcija za oba
oblika: bez nivoa ona JESTE ulaz-do-targeta. Ovo nije botova stvar — ručno ukucan scale-out je
oduvek imao istu aritmetiku i isti pogrešan odgovor.

**Godišnja skala se meri, ne pretpostavlja.** `periodsPerYear = (dana trgovanja × 365) /
kalendarskih dana raspona` — izvedeno iz podataka umesto zakucano na 252. Swing trejder sa 40 dana
trgovanja preko 300 kalendarskih dana dobija svoj faktor; zakucanih 252 naduvalo bi svaki racio.
Sva tri racija vraćaju `null` ispod `MIN_RATIO_DAYS` (5).

**Consistency meri odnos prema proseku, ne prema sumi.** Prva verzija je delila σ sa *ukupnim*
profitom — a ukupan profit raste sa brojem trejdova dok σ ne opada, pa je isti obrazac trgovanja
posle godinu dana čitao doslednije nego posle meseca, bez ijedne stvarne promene u ponašanju. `cv`
(koeficijent varijacije, σ prema proseku po trejdu) ne zavisi od veličine uzorka na taj način.

Dva različita imenioca za drawdown postoje namerno:

- **`maxPctOfEquity`** — nad vrhom equity-ja, uključujući uplate i isplate. To je broj koji se
  pokazuje čoveku, jer uplata stvarno menja šta dati dolar gubitka znači.
- **`maxPctOfPeakPnl`** — nad vrhom kumulativnog P&L-a, po TradeZella formuli, da bi kompozitni
  skor ostao uporediv sa njihovim. **Nikad se ne prikazuje.** Vraća `null` — ne `0` — kad je kriva
  pala sa vrha koji nikad nije bio iznad nule, jer knjiga koja je samo gubila nema vrh profita
  prema kojem bi se pad izrazio.

### Troškovi, plan i izvršenje

| Metrika | Formula |
|---|---|
| Ukupne provizije / swap | Zbirovi po fill-ovima |
| Trošak % bruta | `troškovi / bruto profit dobitnika × 100` |
| Avg planned R | Prosečan planirani reward, nad trejdovima koji ga imaju |
| Planned vs realized R | `avg realized R − avg planned R`, nad **istim** trejdovima |
| Target attainment | Realizovani R kao procenat planiranog reward-a |
| Winner target attainment | Isto, **samo nad dobitnicima** — koliko je plana uzeto pre ranog izlaska |
| Avg entry slip | Planirani ulaz naspram prosečnog fill-a, u R protiv planiranog stopa. Negativno = fill lošiji od plana |
| Total slip R | Zbir svakog R-a ustupljenog na ulaznom slippage-u u periodu |
| Setup score | Udeo ispunjenih setup kriterijuma (§ Ocena setupa se izvodi) |
| Avg hold | Prosečno vreme držanja u sekundama |
| Follow rate | Ispoštovana playbook pravila / **odgovorena** pravila × 100 |

`follow_rate` je jedina metrika čije značenje zavisi od toga u kom je bucket-u: na izveštaju po
pravilu broji odgovore na *to* pravilo. Engine prosleđuje bucket svakoj metrici da bi to ostalo
generično i da nijedan ključ dimenzije ne bi bio specijalan slučaj.

### Pripisivanje danima

Ako se ovo pogreši, ništa ne pukne — brojevi se prosto zavedu pod dane koje nisi živeo.

- **Novac se datira po danu ZATVARANJA.** Swing otvoren u ponedeljak a zatvoren u petak pripada
  petku, jer je tad novac stigao.
- **Odluke se datiraju po danu OTVARANJA.** „Da li je svaki trejd imao stop?" je pitanje o trenutku
  ulaska. Na pripisivanju po zatvaranju, još otvoren trejd je tom pravilu nevidljiv, pa bi deset
  nevezanih otvorenih trejdova prijavilo savršen dan.
- **Dani su uvek u zoni NALOGA**, razrešeni na serveru. `new Date()` pročitan u pregledaču pomera
  ceo kalendar za jednu kolonu svakome ko ne sedi u zoni naloga.
- **ISO dani u nedelji, 1 = ponedeljak … 7 = nedelja.** Nikad `Date#getDay`.

---

## Sickre Score

Jedan kompozit, 0–100, preko sedam komponenti. **Tablice bandova** su prepisane iz TradeZella
specifikacije. **Ponderi više nisu** — ta specifikacija kalibriše intraday scalp knjigu, a ovde se
vodi swing knjiga na prop nalogu: 40–70 trejdova godišnje, fiksni target oko 3× stop.

| Komponenta | Ponder | Boduje se po |
|---|---|---|
| **Process adherence** | **30** | 60 % tracker compliance + 40 % playbook follow rate |
| Max drawdown | 25 | `100 − maxPctOfPeakPnl` |
| Profit factor | 20 | Tablica bandova, 1.8 → 2.6 mapira na 20 → 100 |
| Consistency | 15 | Prosleđuje se kakav jeste |
| **FTMO headroom** | 10 | `100 − najbliži prilaz limitu`, u % |
| Avg win/loss | 5 | Ista tablica kao profit factor, u novcu |
| Recovery factor | 5 | Svoja tablica, 1.0 → 3.5 |

Trgovinske komponente daju **70**; sa procesom je 100, sa oba opciona 110. Kartica deli stvarnim
zbirom a ne zakucanom stotkom.

### Zašto ovi ponderi, a ne prepisani

**Win % je izbačen iz skora, ne samo prepondersan.** Njegova skala (`win% / 60 × 100`) kodira „viši
je bolji". Kod targeta od 3R matematički očekivani win rate je 35–45 %, pa je knjiga koja trguje
tačno po planu dobijala oko 67 na toj komponenti — kažnjena za sopstveni dizajn. Win rate ostaje
kao KPI tajl na dashboard-u i kao metrika u `/reports`, gde je podatak a ne ocena.

**Avg win/loss je pao sa 20 na 5.** Kod fiksnog targeta taj racio je određen dizajnom, ne
izvršenjem — uvek će biti blizu 3. Dvadeset poena je merilo konstantu, i uz to delimično dubliralo
profit factor.

**Process adherence je najteža komponenta, sa 30.** Jedina je koja ne zavisi od varijanse. Na
40–70 trejdova godišnje sve ostale mere ishod na uzorku premalom da bi bio pouzdan, dok follow rate
i tracker compliance mere ponašanje, gde n=40 već nešto znači. Teza ovog README-a je „P&L je
posledica, proces je uzrok"; stari ponderi su davali uzroku 15 od 115, a posledici 100 od 115.

**FTMO headroom je nov.** Meri koliko je nalog bio blizu dnevnog ili ukupnog limita — i to
**najbliži prilaz kroz ceo izazov**, ne koliko prostora ima danas. Nalog koji završi na +8 % ali je
usput dodirnuo 4.5 % na 5 % limitu bio je jedan loš dan od kraja, a nijedna druga komponenta to nije
videla. Zato je jedina komponenta koja namerno ignoriše period filter: prozor izazova definišu
`ftmo_reset_at` i fiksni starting balance, a ne to šta korisnik trenutno gleda. Kad nijedan nalog
nema FTMO mod, komponente nema — ne 100.

Kad u prozoru izazova nema nijednog zatvorenog trejda, `evaluateFtmo` vraća `null` a ne 100. Svež
nalog koji nikad nije rizikovao ne sme da dobije maksimum za upravljanje rizikom — to je ista
greška kao nalaz 1 ispod, samo modul ranije.

**Komponenta bez podataka se izbacuje a preostali ponderi renormalizuju**, da mlad track record ne
bude kažnjen za aritmetiku koja nema šta da deli. Da bi to bilo tačno trebalo je tri odvojene
popravke u rundi 3, sve tri ista greška na različitim dubinama:

1. Drawdown i consistency vraćaju `0` na praznoj knjizi — pošteno kao *statistike*, a
   `100 − 0 = 100` je „nikad nije trgovao" pretvorilo u besprekorno upravljanje rizikom.
2. Jedan dobitnički trejd davao je **100/100**: beskonačan profit factor, nula drawdown-a jer nema
   od čega da padne i nulta varijansa nad jednim uzorkom. Sve sami maksimumi, svaki artefakt n=1.
3. Knjiga od šest uzastopnih gubitaka dobijala je **100 za upravljanje rizikom**, jer procenat
   drawdown-a nije imao pozitivan vrh da njime deli pa je vraćao `0`.

Zato skor sad nosi kapiju dokaza:

- **Ispod 5 zatvorenih trejdova skora nema.** Kartica odbrojava do njega.
- **Ispod 30 se prikazuje ZAJEDNO sa uzorkom**, označen kao privremen. Profit factor nad pet odluka
  ume da skoči preko cele tablice bandova na jedan trejd, ali krijenje skora nedeljama je
  nepoštenje u drugom smeru.
- **Ispod 50 % pokrivenih pondera skora nema** — jedna komponenta pod naslovom sedmokomponentnog
  kompozita nije kompozit. Prazan nalog sa tracker istorijom pokriva process 30 + FTMO headroom 10
  = 40 od 110, i dalje ispod kapije.

Svaka kapija čita svoj imenilac: `trades` za statistike zavisne od putanje (drawdown hoda kroz niz,
consistency je njegov rasap), `decided` (dobici + gubici) za one građene od dobitaka protiv
gubitaka. Knjiga od samih breakeven scratch-eva ima putanju za merenje i nema odluka koje je dobila.

**Rebalans je oslabio kapiju pokrivenosti na jednom mestu, i to je zapisano a ne prećutano.** Dok je
win % bio u skoru, komponente gejtovane po `decided` nosile su 60 od 100 pondera; bez njega nose 25
od 70. Knjiga od samih breakeven trejdova zato sad prelazi prag sa drawdown-om i consistency-jem
(40 od 70) i dobija skor umesto ćutanja — privremen, sa uzorkom uz broj i sa „2 of 5 components" na
kartici. Ograđeno testom u `book.fixture.test.ts`; ako je presudno da to i dalje ćuti, ručica je
`MIN_COVERAGE_SHARE`, a ona pomera svaki skor u journalu.

Kalibracione konstante su zaključane vrednošću u `sickre-score.test.ts`. Menjanje bilo koje pomera
svaki skor koji je ikad prikazan, pa sad mora da menja i test.

---

## Sekcija pripada PLAYBOOK-u, a ne nalogu

`tj_playbook_rules.category` je nosio `CHECK IN ('context','entry','management','exit','no_trade')`,
a kartica je crtala svih pet sekcija bez obzira da li ih knjiga koristi. To je bila tuđa taksonomija:
trejderu čiji je metod „ovo su uslovi da uđem, ovo da izađem, i jedno pravilo za rizik" daje tri
naslova koja je napisao i dva koja nije, trajno prazna. Prazna sekcija tad prestaje da bude
podsetnik i postaje forma koja ne pristaje.

Prvo rešenje je sekciju pretvorilo u opcionu listu (`rule_category`) po **nalogu**. Popravilo je
taksonomiju i ostavilo tri žalbe, sve tri iz istog korena — sekcija i veza pravila sa njom bile su
**globalne**:

- nov playbook je crtao sve sekcije koje nalog ima, prazne ili ne;
- sekcija se nije mogla obrisati jer je pravilo iz **druge** knjige stajalo pod istim imenom;
- isto pravilo je moralo da stoji u istoj sekciji u svakoj knjizi.

**Sad je sekcija red u `tj_playbook_sections`, vezan za jedan playbook** (migracija
`20260824100000`). Model veze je već bio tačan — pravilo je biblioteka sa jednim `id`-jem, veza je
zaseban red, `sort_order` stoji na vezi pa isto pravilo može biti treće u jednoj knjizi i prvo u
drugoj. Falila su mu dva stupca, i oba su se preselila na `tj_playbook_rule_links`:

| Šta | Gde sad živi | Zašto |
|---|---|---|
| veza sa sekcijom | `tj_playbook_rule_links.section_id` (uuid) | sekcija je stvar knjige |
| `is_setup_criterion` | `tj_playbook_rule_links` | koje pravilo ocenjuje setup je takođe stvar knjige — `criteriaByPlaybook` u `rule-lookup.ts` je to ionako već računao po knjizi, samo je izvodio iz globalne zastavice |
| `show_when` | **ostaje na pravilu** | odgovori (`tj_position_rules`) vise o `rule_id`, a `show_when` određuje imenilac follow rate-a. Po knjizi bi isto pravilo imalo dva imenioca nad jednim skupom odgovora |

**Nema više stabilnog `value`, i to je poenta.** Veza pokazuje na `section_id`, pa je preimenovanje
sekcije besplatno i ne dira nijedno pravilo — ranije je rename smeo da menja samo `label` baš zato
što bi prepisivanje `value`-a bio UPDATE preko svih pravila svih playbook-ova, i svaki propušten red
bi ispao iz svoje sekcije.

**Uređuje se na stranici playbook-a, ne u Settings.** Trejder koji piše playbook ne treba da ga
napusti, nađe pravi padajući spisak u podešavanjima, doda vrednost i vrati se. Akcije su
`addPlaybookSection`, `updatePlaybookSection`, `deletePlaybookSection`, `movePlaybookSection` i
`reorderPlaybookSections`, uz `moveRuleToSection` i `setRuleCriterion` za pravila. Nova knjiga
**kreće prazna** — sekcije se dobijaju tako što se napišu.

**Brisanje sekcije nikad ne odbija.** `ON DELETE CASCADE` na `section_id` uklanja **veze**, ne
pravila: svako pravilo ostaje u biblioteci sa svakim odgovorom koji je ikad prikupilo, i svaki drugi
playbook koji ga vezuje ostaje netaknut. Brisanje sekcije je odvezivanje više pravila odjednom, a
odvezivanje ovde nikad nije bilo destruktivno. Opreznost stoji u rečenici koju trejder pročita pre
potvrde — nabroji pravila koja kartica ionako već prikazuje — a ne u odbijanju na koje ne može da
odgovori.

**Dva naslova sa istim imenom u istoj knjizi su zabranjena u bazi**, preko unikatnog indeksa nad
`(playbook_id, lower(btrim(label)))`: „Entry" i „entry " razlikuju se samo za mašinu, a crtale bi dve
kartice nad istim pitanjem.

---

## Playbook je stranica, ne kartica u skrolu

Deset playbook-ova je nekad značilo deset razvijenih kartica na jednom ekranu — svaka sa punim
uređivačem pravila — pa je i pronalaženje jednog imena bilo skrolovanje pored devet drugih. Prva
popravka je karticu skupila u red tabele sa kontrolama za skupljanje i razvijanje. Druga je pitanje
uklonila: **svaki setup sad ima svoju stranicu.**

- `/playbooks` je samo indeks — tabela sa „Trades / Net P&L / Win Rate / Missed / Expectancy" po redu.
- `/playbooks/[id]` je jedan playbook, u tabovima: **Stats**, **Rules** (uređivač sekcija i pravila),
  **Trades** (isti `JournalGrid` kao `/journal`, sužen na tu knjigu) i **Notes**.

Zato `tj_user_prefs.playbooks_expanded` više ne postoji — obrisana je migracijom `20260824110000`,
pošto je niko nije ni pisao ni čitao od trenutka kad je razvijanje prestalo da bude stanje ekrana.

**Missed kolona se ne može pročitati iz istog `row`-a kao ostale.** `runReport` računa nad
realizovanim (zatvorenim) trejdovima, a promašen trejd nikad nema neto P&L pa nikad ne uđe u taj
skup. Zato se broji posebno u `page.tsx`, nad sirovim redovima pre `toRealized`, grupisano po
`playbook_id` (`stringFieldValue`) — i prosleđuje kao običan `Record<string, number>`, ne `Map`: to
je oblik koji svaki drugi prop preko server/client granice u ovoj aplikaciji već koristi
(`OptionsMap` među njima).

**Spisak čita i penzionisana pravila** (`getPlaybooks({ includeDeleted: true })`). Pravilo skinuto sa
ček-liste i dalje poseduje posmatranja koja je prikupilo, a stranica o dokazu mora da ih pokaže.

**`tj_position_rules` se drenira jednom.** To je jedan red po pravilu po trejdu — najbrže rastuća
tabela u šemi — pa se čita jednom i prosleđuje u `getPlaybooks`, koji iz istog niza izvodi broj
odgovora po pravilu. Čitati je dvaput po renderu je greška koju je `/reports` već morao da ispravi.

**Kreiranje ide kroz dijalog, ne kroz inline input.** „+ Create Playbook" otvara `Dialog` sa Ime +
Opis; nema drugog koraka za pravila kao kod TradeZella-e, jer bi to duplikovalo uređivač sekcija koji
stranica playbook-a već ima. `addPlaybook` vraća novi `id`, pa dijalog vodi pravo na tu stranicu.

---

## Ocena setupa se izvodi, ne procenjuje

`setup_grade` je bilo otkucano slovo (A+/A/B/C) — i **jedino polje koje je bilo pogrešno, ne samo
sporo**. Popunjavalo se pošto se zna ishod, pa gubitnik postane B a dobitnik A+. To je dimenzija po
kojoj dashboard podrazumevano razlaže rezultat, pa je ocena „objašnjavala" performans etiketom koja
je delom **izvedena iz** performansa. Kružno, i nevidljivo dok se dešava.

Sve za zamenu je već postojalo: biblioteka pravila, odgovori po trejdu, `follow_rate` i
`ruleScorecard`. Falila je samo oznaka **koja pravila definišu kvalitet setupa** —
`is_setup_criterion`, koja od `20260824100000` stoji na **vezi** (`tj_playbook_rule_links`), ne na
pravilu: koje pravilo ocenjuje setup je stvar knjige, pa isto pravilo sme da bude kriterijum u
jednoj a običan podsetnik u drugoj.

**Ocena = udeo ispunjenih kriterijuma.** Sve → A+, ≥80 % → A, ≥60 % → B, ispod → C. A+ traži baš
sve: oznaka znači „ovo je setup koji sam čekao", a setup kome fali jedan od sopstvenih uslova je
drugi setup.

**„Kriterijum mora da se pita na svakom trejdu" je suština, ne dekoracija.** Kriterijum vezan za
pobednike bio bi **hindsight po konstrukciji** — ocenjivao bi setup pitanjem koje se postavlja tek
kad znaš rezultat. Baza tu kombinaciju odbija umesto da veruje da je UI neće ponuditi.

Dok je zastavica stajala na pravilu, to je bio jedan `CHECK (is_setup_criterion = false OR show_when
= 'always')`. Otkad stoji na vezi, uslov spaja dve tabele i `CHECK` ga ne vidi, pa ga drže **dva
okidača, po jedan sa svake strane**: `tj_link_criterion_always` odbija označavanje veze čije pravilo
nije `always`, a `tj_rule_show_when_vs_criterion` odbija menjanje `show_when` na pravilu koje je
negde kriterijum. Ista zabrana, isto mesto — baza, ne UI.

**Ne ocenjuje se dok ček-lista nije cela odgovorena**, i tu se namerno razilazi sa `computeFollowRate`,
koji neodgovorena pravila izbacuje iz brojioca *i* imenioca. To je ispravno za *stopu* i rupa za
*ocenu*: odgovoriš jedan kriterijum, ispuniš ga, i pokupiš A+. Zato se broji prema onome što playbook
**definiše**, ne prema odgovorima koji postoje — neodgovoreno pravilo nema red, pa bi brojanje redova
tri od četiri kriterijuma pročitalo kao tri od tri.

**Šta ovo NE rešava:** ne postaje objektivno. Čekiranje „MSS with displacement" je i dalje procena.
Dobija se dekompozicija (nekoliko malih pitanja umesto jednog velikog), doslednost, proverivost — i
prava dobit, **testabilnost**: `ruleScorecard` već meri win rate kad je pravilo ispoštovano naspram
prekršenog, pa se kriterijum koji ništa ne predviđa može naći i izbaciti. Slovo to nikad ne može, jer
ne zna *koji* deo onog „A+" je radio posao.

Kolona `tj_positions.setup_grade` ostaje i **nosi istoriju** ručno ocenjenih trejdova — izvedena
vrednost ima prednost, kolona je rezerva. Isti obrazac prvenstva koji `plannedRewardFromTrade` već
dokumentuje, samo obrnutim redom, jer je ovde izvedeno bolje a kolona nasleđe.

---

## Ocene se biraju klikom, u jednoj jedinici

Četiri polja tražila su da se kuca ono što se bira, i tri različite skale za isto pitanje.

| Polje | Bilo | Sad |
|---|---|---|
| Time stop | slobodan broj, **bez gornje granice u bazi** | pet dugmadi 1–5, `CHECK` do 5 |
| Mental temperature | `Select` 1–10 | **5 zvezdica** |
| Week rating | `A–F` | **5 zvezdica** |
| Execution rating, conviction | 5 zvezdica / 1–5 | nepromenjeno |

**Deset nivoa je preciznost koju čovek nema o sopstvenoj glavi.** Tražena svakog jutra, daje šum
koji posle hrani dimenziju izveštaja i `low_mental_temp_entry` pravilo kao da je signal. Pet zvezdica
je i brže i poštenije, a usput je i jedina jedinica u kojoj dnevnik sad traži procenu — pre ovoga su
postojale tri.

**Postojeća vrednost je PREVEDENA, ne zadržana.** Na skali 1–10 petica je ispod proseka; na 1–5 ista
cifra je maksimum. Zadržati je značilo bi obrnuti joj značenje a ostaviti je da izgleda netaknuto.
`ceil(staro / 2)` čuva relativan položaj — sredina stare skale pada u sredinu nove. Prvi nacrt te
migracije delio je prevod na tri `UPDATE`-a po opsegu i bio je pogrešan dvaput: devetka bi u prvom
prolazu postala 5 pa je drugi prolaz („= 5") spustio na 3, dok 2 i 3 nijedan prolaz nije ni dodirnuo.
Jedan `UPDATE` čita originalnu vrednost svakog reda tačno jednom, pa nijedan od ta dva kvara nije ni
izraziv.

**Time stop nisu zvezdice, i to je namerno.** Zvezdice su monotone — tri popunjene čitaju kao „tri
od pet dobrote". To je tačno za ocenu i pogrešno za količinu: „3 dana" nije bolje ni gore od „5 dana",
to je drugi broj. Zato `NumberChoice` iscrtava cifre i boji samo izabranu.

**Klik na već izabranu vrednost je briše.** Bez puta nazad do `null`, prvi promašen klik ostao bi
zauvek kao vrednost koju niko nije mislio, a „nije upisano" i „1" su različiti odgovori.

---

## Praćenje procesa

**Tracker pravila** su dnevne obaveze, po danu u nedelji. **Šest** se ocenjuje automatski iz
podataka — max gubitak po trejdu, po danu i po nedelji, svaki trejd vezan za playbook, svaki trejd
ima stop, svaki trejd ima napisanu tezu — a ostala se čekiraju rukom.

Tri limita su **procenat dnevnog otvarajućeg equity-ja, ne iznos novca** (migracija
`20260822190000`). Fiksnih 200 € je različito pravilo na nalogu od 5 000 i na onom od 50 000, pa
limit postavljen jednom prestaje da opisuje rizik čim nalog poraste — a broj koji se mora ponovo
ukucati da bi ostao pošten je broj koji niko ne kuca ponovo.

Koja pravila su važila za dati dan odlučuje se poređenjem dana sa `created_at` i `deleted_at`
pravila; zato su to vremenske oznake i zato tabela nema `is_active` boolean. Pravilo dodato danas ne
sme da obori godinu prošlih dana; pravilo penzionisano sutra ne sme da podigne jučerašnji skor. Isto
važi i za **konfiguraciju** pravila: dan u maju ostaje ocenjen limitom koji je važio u maju.

**Dan bez trejdova je `na`, nikad `pass`.** „Nisam prekoračio max gubitak" je prazno tačno na dan
kad nisi trgovao, i bodovanje toga kao prolaza omogućilo bi da se serija od 200 dana farma
netrgovanjem. `na` ispada i iz brojioca i iz imenioca, pa disciplinovan dan bez trejdova i dalje
nosi 100 % na pravilima na koja *je* mogao da odgovori.

**Zaključavanje dana** zamrzava automatske verdikte u redove i nepovratno je — sprovodi ga triger
koji puca na svaku izmenu zaključanog izveštaja, pa nema akcije za otključavanje koju bi trebalo
napisati. Trejdovi sa zaključanog dana ostaju izmenljivi: P&L je činjenica koja mora da može da se
ispravi, a zamrznuti verdikti su ono što sprečava da compliance krene za njom.

**Playbook-ovi** drže grupe pravila; odgovaranje na njihov checklist upisuje `tj_position_rules`,
što hrani follow rate. Neodgovoreno pravilo ne broji se ni u brojiocu ni u imeniocu.

**Insights** su 37 pravila na četiri nivoa — trejd (24), dan (6), nedelja (3), portfolio (4) — koja
čitaju iste obogaćene trejdove kao i izveštaji. Svako pravilo deklariše `minSample` i nijedno ne
okida na n=1. Nijedan insight se ne čuva u bazi: pragovi se menjaju, a sačuvan insight bi zastareo
naspram promenjenog praga dok i dalje izgleda merodavno.

**FTMO režim** je po nalogu: dnevni gubitak, ukupni gubitak, profitni cilj i minimalni broj dana.
Proboj pravila zamrzava nalog — nov trejd se ne može ni napraviti ni aktivirati dok se izazov ne
resetuje u Settings.

Dnevni limit ima **podesivu bazu**, jer se stvarni FTMO nalozi razlikuju po tome: fiksna (procenat
od početnog balansa, ceo izazov) za 2-Step tip, ili rolling (procenat od balansa na kraju
prethodnog trgovinskog dana) za 1-Step tip. Ukupan gubitak (drawdown pod) ostaje uvek fiksan na
početni balans — to je zajedničko oba tipa.

`evaluateFtmo` uz verdikt vraća i `headroomPct` — koliko je prostora ostalo od **najbližeg prilaza**
bilo kom uključenom limitu kroz ceo izazov. To je komponenta Sickre Score-a (§ Sickre Score), i
jedini broj u aplikaciji koji razlikuje nalog koji je prošao od naloga koji je prošao za dlaku.

---

## Uvoz

CSV unutra, sa mapiranjem kolona, pregledom i odlukom create/merge/skip po redu.

**Merge menja samo objektivne fill-ove.** Plan, psihologija, ocena i beleške se ne diraju — uvoz ih
nikad nije ni posedovao.

**Undo je jedina operacija uvoza koja briše podatke.** Uklanja pozicije koje je batch
napravio, vraća fill-ove koje je istisnuo, pa briše batch i njegove audit redove.
`tj_import_rows.prev_executions` je jedini primerak onoga što je merge istisnuo, i undo ga vraća
polje po polje, zajedno sa poreklom — dokazano nad živom bazom u transakciji koja se rollback-uje.

Dve stvari koje čarobnjak odbija umesto da pogađa, obe zato što je pogađanje tiho:

- **Dvosmisleni datumi.** `02-03-2026` je 2. mart evropskom brokeru a 3. februar američkom. Odbija
  se. Red čije vreme ne može da se pročita prikazuje se kao nečitljiv, nikad se ne pečatira
  trenutkom uvoza — što je nekad tromesečni trejd zavodilo u današnji P&L, današnju ćeliju kalendara
  i današnju nedelju.
- **Dvosmisleni decimalni zapisi.** `1.234,56` i `1,234.56` se oba čitaju tačno, tako što se
  poslednji separator uzima za decimalnu tačku. `1,234` se odbija: to je 1234 američkom brokeru a
  1.234 nemačkom, i ništa u ćeliji ne odlučuje koje.

Svaka odbijena ćelija je imenovana na svom redu u pregledu (`nečitljivo: qty, fee`).

---

## Bot most

Jedini automatski upis u dnevnik. cBot u cTrader-u
([`TradingJournalBridge`](https://github.com/0xsickre/trading-charting/tree/master/ctrader/TradingJournalBridge))
javlja **osam** činjenica plus heartbeat, a dnevnik od njih pravi trejd:

| `kind` | Događaj kod brokera | Šta dnevnik upiše |
|---|---|---|
| `order_placed` | Postavljen pending order | Nov trejd, `status = planned` |
| `order_modified` | Order izmenjen dok još čeka | Isti trejd → nove cene i veličina |
| `order_filled` | Order se ispunio | Isti trejd → ulazni fill, status iz fill-ova |
| `order_cancelled` | Limit obrisan bez ispunjenja | Isti trejd → `status = missed` |
| `position_opened` | **Market order** — pozicija bez pending order-a | Nov trejd odmah sa ulaznim fill-om |
| `position_modified` | Take profit pomeren posle ulaska | Isti trejd → nov `target_price` i TP nivoi. **Stop se ne dira** |
| `position_excursion` | Cena išla protiv i u smeru trejda | Isti trejd → **MAE i MFE** cene |
| `position_closed` | **Izlaz** (ceo ili delimičan) | Isti trejd → izlazni fill, status se preračuna |
| `heartbeat` | Bot je živ | Ništa u trejd — samo vreme poslednjeg javljanja |

**Poslednja dva reda su zatvorila dve rupe zbog kojih je „bot bagovao" (`20260828120000`).** Most je
pratio samo pending order-e, pa market order nije proizvodio nijedan događaj — a `position_modified`
koji bi zatim stigao odlazio bi u karantin kao `unknown_position`, jer dnevnik tu poziciju nikad nije
video. Druga: izlaz se nije prijavljivao, status se izvodi iz fill-ova, pa je **svaki bot trejd
zauvek ostajao `open`** — van `toRealized`, dakle van win rate-a, expectancy-ja, profit factor-a i
svakog izveštaja.

**Status ima jedno pravilo, u SQL-u.** `tj_status_from_executions(position_id, asserted)` sabira
ulazne i izlazne količine i odatle vraća `planned` / `open` / `partial` / `closed`. Ogledalo je
`computeStatus` iz `trade-lifecycle.ts` — isti par kao `tj_position_stats` / `position-stats.ts`:
SQL je pisac, TypeScript je živi pregled u formi. Bez toga bi pravilo „exitQty < entryQty → partial"
postojalo u dve implementacije slobodne da se raziđu. `asserted` nosi ono što se iz fill-ova ne može
izvesti (`planned`, `missed`); čim fill postoji, brojanje pobeđuje tvrdnju.

**Duplikat market ordera rešava baza, ne bot.** Pozicija nastala iz pending order-a javlja se dvaput
— i `order_filled` i `position_opened` — pa oba prvo traže poziciju po `broker_position_id`, i koji
god stigne drugi postaje `already_present`. Redosled dolaska time prestaje da bude pitanje.

**Planiran trejd pokazuje svoj plan.** Svaka brojčana kolona u `/journal` čita iz `tj_position_stats`,
a taj view se gradi iz fill-ova — pa je trejd koji još čeka bio red samih crtica, i stop i target koje
je most upravo doneo nisu se videli nigde u tabeli. Zato postoje kolone **Plan / Stop / Target**, i
zato se cene formatiraju po `tick_size_at_trade` a ne na dve decimale: na dve, EURUSD stop 1.16101 i
target 1.16453 postaju isto „1.16" — jedna pogrešna činjenica tamo gde su tri različite.

**Otkazan order postaje `missed`, ali BEZ razloga.** cTrader kaže KAKO se order završio (otkazan,
istekao); lista `miss_reason` u dnevniku pita ZAŠTO trejd nije uzet („Setup invalidated", „Price ran
away", „Discretion"). To su dva različita pitanja i na drugo odgovara samo čovek — popuniti ga iz
prvog značilo bi upisati odgovor koji niko nije dao u polje koje nedeljni pregled čita kao procenu.
Brokerova reč putuje u payload-u, gde je dokaz a ne odgovor, a `needs_review` se diže da prazno polje
bude podsetnik. Trejd koji je ispunjen se **ne može** označiti kao propušten — to brani
`tj_position_missed_guard` još od `20260730140000`.

**MAE/MFE više ne moraš da prepisuješ sa grafikona.** `max_drawdown_price` i `max_profit_price` postoje od `20260720130000`, a `excursion.ts` iz njih računa `maeR`, `mfeR` i **capture %** — sve je stajalo mrtvo jer je zavisilo od dva broja koja čovek prepiše po trejdu, a to niko ne radi. Isti oblik kao `scale_out_levels`: analiza napisana i testirana, pa gladovala.

Bot meri na svaki tick i šalje checkpoint retko, pa ovde stiže tick-rezolucija po ceni par redova po trejdu.

**Ručni unos pobeđuje, i to čuva TRIGER a ne provera u ingest funkciji.** `tj_save_trade`, forma i svaki budući uvoznik pišu iste dve kolone, pa bi svaki morao da pamti isto pravilo — a repo je već zapisao gde to vodi: *„Baza je čuvar, ne akcija."* Zato odluka živi na jednom mestu kroz koje svaki upis prolazi: `tj_excursion_source_guard` čita zastavicu koju `tj_bot_ingest` diže oko **tačno jednog** `UPDATE`-a i odmah spušta. Upis bez te zastavice je, po definiciji, čovekov. Botov pokušaj nad ručno unetim trejdom **vraća vrednosti nazad** umesto da baci grešku — greška bi poništila i upis u `tj_bot_events`, pa bi događaj nestao i bot bi zauvek ponavljao isti odbijeni upis.

**Posle ulaska stop se zamrzava, take profit ne.** To su dva različita čina koja u API-ju izgledaju
isto. Povlačenje stopa na breakeven ne znači da nisi rizikovao ništa — znači da si prestao da rizikuješ
ono što je već uloženo. Pošto je `stop_price` imenilac R-a, kad bi to prošlo, R bi delio nečim blizu nule
baš na trejdovima koje si najbolje vodio, i expectancy, target attainment, MAE/MFE u R i skor bi tiho
**nagrađivali pomeranje stopa**. Stop u trenutku fill-a je rizik koji je stvarno preuzet i to je broj koji
dnevnik čuva. Take profit nije ista stvar — on kaže gde trejd sad treba da se završi, ništa u R-u ne
zavisi od njega, pa se prati. Bot stop ne stavlja ni u otisak izmene, tako da BE povlačenje ne pošalje
nijedan događaj umesto da pošalje jedan koji dnevnik mora da odbaci.

**Izmena važi samo dok order čeka, i to je cela poenta.** Pre ulaska, pomeranje stopa **menja plan** —
trejd nije počeo, rizik koji tek preuzimaš je sad drugi, i `stop_price` mora da ga prati ili planirani
R:R opisuje order koji nisi postavio. Posle ulaska, pomeranje stopa je **vođenje trejda**: povlačenje
na breakeven ne znači da nisi rizikovao ništa. Kad bi to ušlo u `stop_price`, R bi se rušio ka nuli
baš na trejdovima koji su najbolje vođeni, i svaka R metrika u knjizi bi tiho nagrađivala pomeranje
stopa. Zato `order_modified` odbija sve što više nije `planned`.

**Prazno nije brisanje.** Bot pobeđuje na četiri polja — ulazna cena, stop, target, veličina — ali
`stop_loss` koji cTrader javlja kao prazan znači „bot nema šta da kaže", ne „stopa nema". Zato se stop
i target spajaju preko `COALESCE`, pa izmena ne može da obriše stop koji si ti ukucao rukom. Cena
koju to nosi, priznata umesto sakrivena: **brisanje** zaštite u platformi se ne prenosi i skida se
ručno. Zastareo stop je vidljiv na trejdu i jedan klik od ispravke; tiho obrisan primetiš tek kad je
neka R metrika već mesec dana pogrešna.

**Šta bot NE piše.** Plan, tezu, psihologiju, ocenu setupa, playbook, `risk_pct` i `planned_rr`
ostaju prazni. To je granica koja čuva pravilo iz § Svesno izostavljeno: automatizuje se
prepisivanje, ne prosuđivanje. Trejd koji je upisao bot nosi `source = 'bot'` i vidljivu oznaku u
tabeli — red koji nisi otkucao ne sme da izgleda kao red koji jesi, jer je njegova praznina „još
nije napisano", a ne „nema šta da se kaže".

**Kako bot sme da piše.** Preko `tj_bot_ingest`, `SECURITY DEFINER` funkcije dostupne `anon` ulozi i
autorizovane **bot tokenom** — ne lozinkom i ne service-role ključem, kojih repo i dalje nema.
Plaintext tokena se pravi u pregledaču i prikazuje jednom; na server ide samo njegov SHA-256.

Funkcija namerno **ne zove `tj_save_trade`**. Ta funkcija je `SECURITY INVOKER` i upisuje
`auth.uid()`, koji je pod anon ključem `NULL`; jedini način da se natera bio bi falsifikovanje JWT
claim-a, što je jača verzija baš one rupe zbog koje je šest funkcija ostalo bez `EXECUTE` za
`authenticated`. Uz to, njeno rukovanje fill-ovima je puna zamena, pa bi u koraku sa izlazima
obrisala ulazni fill.

**Idempotencija je jedan `UNIQUE (user_id, event_key)`** nad append-only logom `tj_bot_events`.
Ponovljeno slanje, druga instanca bota i pražnjenje outbox-a posle pada su time bezopasni — u bazi,
ne u pamćenju bota.

**Karantin umesto pogađanja.** Nemapiran nalog, nemapiran simbol ili neupotrebljiv volumen ne
proizvode trejd nego karantiniran događaj sa razlogom, vidljiv u **Settings → Bot most**. To je
„Odbij umesto da pogađaš" primenjeno na mašinski feed.

**Količina po lotu se potvrđuje, ne izvodi.** Dnevnik broji `qty` u lotovima/ugovorima, cTrader
javlja `VolumeInUnits` u baznim jedinicama. Bot šalje i `Symbol.LotSize` i cTrader-ov sopstveni broj
lotova, pa panel pokazuje da li delilac reprodukuje brokerov broj — i tek onda čovek potvrdi, jednom
po simbolu. Kod index CFD-a „jedan lot" definiše broker, a pogrešan delilac je P&L pogrešan za redove
veličine, prikazan kao činjenica.

**Obrisan bot trejd se ne vraća.** Idempotencija je po `event_key`, a on je već potrošen — ponovno slanje istog događaja dobija odgovor „duplikat" i ne pravi red ponovo. Brisanje je zato konačno: order i dalje postoji u cTrader-u, ali u dnevniku ga nema dok ga ne ukucaš rukom. To je namerno — kad bi se vraćao, obrisao bi trejd i on bi se ponovo pojavio.

**`tj_bot_events` je append-only i raste.** Jedan order sa nekoliko izmena pravi pet do deset redova. To je audit log i tako je zamišljen; panel čita samo karantinirane i to sa granicom, pa dužina loga ne utiče na ekran.

**Bot ne sme na cTrader Cloud.** Cloud instance ne šalju HTTP i ne prijavljuju grešku kad ne pošalju,
pa bi most izgledao zdrav a ne bi isporučio ništa. Zato bot šalje heartbeat, a panel prikazuje kad se
poslednji put javio: ćutanje mora da bude vidljivo sa ove strane.

**Više TP nivoa je pokriveno.** cTrader-ova napredna zaštita dozvoljava do pet take-profit nivoa na
jednom orderu, svaki zatvara deo pozicije. Bot šalje `take_profit_levels` (`[{"pct","price"}]`) uz
`take_profit_final`, a ingest ih od `20260821160000` upisuje u `tj_positions.scale_out_levels`,
sortirane po ceni, odbacujući svaki nivo kome `pct` ili `price` nije pozitivan broj. Isti put koriste
`order_placed`, `order_modified`, `position_opened` i `position_modified`, pa se merdevine mogu
promeniti i posle ulaska.

To je i razlog zašto planirani reward mora da bude **ponderisan** (§ Rizik): merdevine koje stižu sa
brokera imaju istu aritmetiku kao ručno ukucan scale-out, i isti pogrešan odgovor bez ponderisanja.

---

## Brisanje

Dve operacije van uvoza koje brišu podatke, obe u `/settings` → Accounts, obe bez undo-a.

**Brisanje naloga** (`tj_delete_account`). Nalog bez trejdova, uplata i uvoza briše se jednom
potvrdom; nalog koji nešto drži traži da mu se ukuca ime i pre toga ispiše koliko trejdova,
uplata i batch-eva nestaje. Poslednji nalog se ne može obrisati — odbija i akcija i baza, jer
`accounts[0]` je izvor zone i valute u kojoj se datira svaki dan.

Zašto funkcija a ne `DELETE`: `tj_positions.account_id` je **ON DELETE SET NULL**, isto i
`tj_import_batches.account_id`. Običan delete kroz PostgREST bi sklonio nalog a **ostavio trejdove
bez naloga** — i dalje u svim zbirovima, bez valute za konverziju (`fx_rate_source = 'no_account'`),
sa nalogom kojeg više nema da to objasni. Funkcija briše zavisne redove prvo, u jednoj transakciji.
Dokazano nad živom bazom u transakciji koja se rollback-uje: nalog sa 21 trejdom ostavlja **0
osirotelih** pozicija, i 0 fill-ova, odgovora na pravila i slika.

**Reset svega** (`tj_reset_my_data`). Briše **28 od 30** tabela za pozivaoca pa zove
`tj_seed_my_defaults()` — istu seed funkciju koju dashboard vrti na praznom nalogu, pa „reset" i
„prvo učitavanje ikad" završavaju u istom stanju. Traži da se ukuca `RESET EVERYTHING`.

Od dve koje nisu na spisku, `tj_playbook_sections` pada kroz `ON DELETE CASCADE` za `tj_playbooks`.
**`tj_dashboard_templates` ne pada ni kroz šta** — vezuje se direktno za `auth.users`, a spisak u
funkciji nije dopunjen kad je tabela dodata (`20260818120000`), pa sačuvani rasporedi dashboard-a
preživljavaju „reset svega". Zapisano ovde jer je obećanje šire od onoga što funkcija radi, a ovaj
README ne sme da tvrdi više od koda.

Izmereno šta se stvarno vraća, umesto pretpostavljeno iz imena seed-a: **1 Main Account, 91
instrument, 13 lista sa 66 opcija, 8 tracker pravila, 9 korisničkih polja, 3 note foldera.**

**Šta se NE vraća: playbook-ovi.** `tj_seed_defaults` **jeste** zakačen na `tj_seed_playbooks`, ali
je ta funkcija **namerno prazna od `20260813200000`**: čuvala se sa `if exists (… ) then return`, što
ne razlikuje novog korisnika od onog koji je svaki playbook svesno obrisao — oba imaju nula redova —
pa se brisanje tiho poništavalo na sledećem učitavanju dashboard-a. Reset zato završava sa nula
playbook-ova i nula pravila bez obzira koliko ih je bilo napisano. Isto važi za sve dodato rukom —
opcije, tracker pravila, naloge. Panel to piše na ekranu, jer nabrojati šta se vraća a prećutati šta
ne znači reći tačnu polovinu.

Obe funkcije su **SECURITY INVOKER**, ne DEFINER: svaka tabela nosi
`FOR ALL TO authenticated USING (user_id = auth.uid())`, pa RLS već ograničava svaki upit na
pozivaoca, i nema šta da se izvodi ručno. `anon` je oduzet **imenom**, ne samo preko `PUBLIC` —
Supabase-ove default privilegije dodele EXECUTE svakoj novoj funkciji u `public`, a
`REVOKE ... FROM PUBLIC` ne skida eksplicitan grant na rolu. Provereno nad živim projektom.

---

## Migracije

100 fajlova u `supabase/migrations/`, imenovanih `YYYYMMDDHHMMSS_opis.sql`.

- **Aditivne.** Nikad se ne menja primenjena migracija — piše se nova delta.
- **Migracija objašnjava samu sebe.** Svaka počinje komentarom šta je bilo pogrešno i šta puca bez
  te izmene. Ti fajlovi su jedini zapis zašto šema izgleda ovako.
- **Brisanje kolone od koje zavisi view** znači `DROP VIEW` → `DROP COLUMN` → `CREATE VIEW` →
  `ALTER VIEW ... SET (security_invoker = on)`. Zaboravljena poslednja linija tiho menja kao ko se
  view filtrira.

### Bezbednosni model

- **RLS na svih 30 tabela**, vlasnički obrazac, provereno nad živom bazom.
- **`SECURITY DEFINER` + uuid argument je rupa**, jer svaki prijavljen korisnik može da je pozove sa
  tuđim id-em. Svih pet seed funkcija tog oblika — `tj_seed_defaults`,
  `tj_seed_instruments_defaults`, `tj_seed_playbooks`, `tj_seed_tracker_rules`,
  `tj_seed_note_folders` — ima oduzet `EXECUTE` od `authenticated`. Jedina koja ostaje pozivna je
  `tj_seed_my_defaults()`, koja ne prima argument i seed-uje samo podatke pozivaoca.
  `tj_status_from_executions(uuid, text)` je šesta funkcija tog oblika i nije rupa iste vrste: čita
  samo `tj_executions`, vraća `text`, i oduzeta je od `PUBLIC` i `anon`.
- **Baza je čuvar, ne akcija.** PostgREST sa korisnikovim JWT-om je živi put za pisanje, pa je
  provera koja živi samo u TypeScript-u brava oko koje se može obići. Validacija u server akciji
  postoji da bi poruka bila čitljiva; CHECK ograničenje ili triger iza nje je ono što stvarno drži.

### Čitanje preko 1000 redova

PostgREST seče odgovor na `db-max-rows` (1000) i vraća skraćenu stranu sa **HTTP 200 i bez greške**.
Svako čitanje koje raste sa istorijom ide kroz `selectAllPages`, a svaki `.in()` filter kroz
`selectAllByIds`, koji deli listu id-eva na po 500 da URL ne bi pukao.

Ovo nije briga o performansama. Dnevnik preko hiljadu trejdova bi i dalje prikazivao win rate, neto
P&L i drawdown izračunate nad delimičnim skupom, bez ijednog vidljivog simptoma.

---

## Testovi

2344 testa u 140 fajlova, podeljenih u **dva vitest projekta**: `lib` (okruženje `node`, fajlovi
`*.test.ts`, 1884 testa u 93 fajla) i `components` (okruženje `jsdom`, fajlovi `*.test.tsx`,
460 testova u 47 fajlova). Pravilo je ekstenzija, pa nijedan fajl ne može upasti u oba. Podela
postoji da čisto aritmetički testovi ne plaćaju cenu DOM-a koji ne dodiruju.

`vitest.config.ts` nosi **podove** pokrivenosti, ne ciljeve — stoje na onome što paket trenutno
postiže, pa jedino što mogu je da padnu kad izmena spusti pokrivenost. Od Faze 10 postoje **dva
odvojena poda**, provereni nezavisno umesto stopljeni u jedan prosek:

| Sloj | Statements | Branch | Functions | Lines |
|---|---|---|---|---|
| `src/lib/**` | 95 % | 89 % | 96 % | 96 % |
| `src/components/**` | 64 % | 64 % | 61 % | 65 % |

Uz njih ide i **treći, po fajlu**: četrnaest modula koji računaju ili čuvaju novac (`MONEY_MODULES`
u `vitest.config.ts` — `analytics.ts`, `balance.ts`, `costs.ts`, `position-stats.ts`,
`risk-ratios.ts` i ostali) drže **100 % izraza i funkcija** pojedinačno. Prosek preko sloja sme da
sakrije jedan takav fajl; pod po fajlu ne sme.

Zašto dva, ne jedan: `src/lib` je čista aritmetika i drži se blizu 96 % od Faze 0. `src/components`
je render sloj Faze 10 — 46 od 87 fajlova ima **posvećen** render test, ostatak je dohvaćen samo
uzgredno, kroz ono što neka testirana komponenta uveze (mnogi `src/components/ui` primitivi
izvoze pod-delove — `DropdownMenuRadioItem`, `PopoverTitle` — koje ništa u aplikaciji ne renderuje).
Jedan stopljen broj bi ili povukao bibliotečki pod na nivo render sloja, ili slagao o tome koliko
je render sloj zapravo pokriven; dva poda kažu obe stvari pošteno umesto da ih usrednje u broj koji
ne opisuje nijedno.

Četiri stvari koje brojevi namerno **ne** tvrde:

1. **`src/components`-ov pod nije „dobro testirano".** 64/64/61/65 je pošteno stanje sloja koji je
   ovu fazu počeo od nule i nije završen — Faza 10 pokriva komponente najvišeg rizika (Tier 1 i 2 u
   `ROADMAP.md`), ne svih 87. Čitati ovaj pod kao „UI je 64 % tačan" ponavlja tačno grešku na koju
   sledeća tačka upozorava, jedan sloj iznad.
2. **Isključivanje mora biti `exclude`, ne `include`.** Ista greška je napravljena i zapisana:
   `include: ["src/lib/**"]` prebacuje v8 sa „fajlovi koje je test uvezao" na „svi fajlovi koji
   odgovaraju", pa uvuče serverske upitne module koje nijedan unit test ne može dosegnuti i oceni
   ih nulom. Broj padne sa 95,5 na 86 — što liči na nazadovanje a nije: metrika je počela da meri
   drugo pod istim imenom.
3. **100 % ne bi značilo tačno, ni na jednom podu.** Pokrivenost broji *izvršavanje*, ne *tvrdnju*.
   Sva tri nalaza runde 3 oko skora živela su u fajlovima na 100 % izraza i funkcija — i sva četiri
   nalaza Faze 10 (`W1`–`W4`) su nađena render testom koji je tvrdio da već pokriven kod daje
   POGREŠAN broj, ne time što je neka linija ostala neizvršena.
4. **`src/app` (15 stranica u 33 fajla) nema nijedan broj**, i „nema broj" nije „0 %" — to je „nije
   mereno". Rute su server komponente čija je logika `await getCurrentUser()` pa `redirect()` pa
   prosleđivanje propova; propovi se tvrde na drugoj strani, gde ih render test već čita.

`src/lib/journal/book.fixture.test.ts` postoji baš zbog druge tačke. Fiksira jednu knjigu od deset
trejdova, izvodi svaku glavnu brojku na papiru u komentarima — sa vidljivom aritmetikom — pa tvrdi
kod prema papiru. Snapshot test zaključava trenutno ponašanje uključujući njegove bagove; ovaj
zaključava odgovor. Druga polovina fajla prolazi *oblike* koje knjiga može imati (prazna, jedan
trejd, sve dobitnici, sve gubitnici, sve breakeven, samo otvorene) — tako je nađen treći nalaz oko
drawdown-a. Ista knjiga, iste brojke na papiru, postaju i propovi renderovanog Dashboard-a u
`dashboard.render.test.tsx` — papir → `lib/` → ekran, jedan skup brojeva tvrđen na sva tri sloja.

**Render sloj se izvršava od Faze 10.** Osam koraka, svaki commit + push + `tsc` + `vitest` + `lint`
+ `build` + `knip`, dokumentovano u `CODE_REVIEW.md`. Dashboard (najveći fajl, 50 `useMemo`),
`journal-grid`, tri forme (`trade-form`, `daily-report-form`, `tracker-checklist`),
`import-wizard`, i 14 čistih prezentacionih komponenti uključujući `markdown-view` — jedini
renderer sa bezbednosnim značajem u aplikaciji (href allowlist na ekranu, ne samo u parseru).
Nađeno i popravljeno četvoro: `W1` (Win rate pločica čitala „0.0%" umesto „—" na nula odlučenih
trejdova), `W2` (isti nalaz na drugom mestu, `PeriodPerformanceCard`), `W3` (privacy mod je
maskirao tri od četiri polja u jednom panelu — četvrto je curilo pravi procenat), `W4` (Target
attainment u formi za unos trejda računao bez donjeg praga i sa pogrešnim prioritetom između
sačuvanog i uživo izračunatog plana). `S1`, `S2`, `S3` i `P1` iz runde 3 — svi nađeni čitanjem, ne
testom — sada svaki ima svoj render test koji bi ih uhvatio da su se ponovili.

**Šta i dalje nije utvrđeno**, rečeno otvoreno da ovde ništa ne tvrdi više nego što sme: dokazan je
`lib/` lanac od realizovanih trejdova do skora, i render sloj za komponente najvišeg rizika. 15 ruta
u `src/app` se i dalje ne izvršava ni u jednom testu — logika koja tamo živi je tanka
(dohvat + `redirect()`), a Playwright bi tražio pokrenutu aplikaciju i Supabase kredencijale kojih
ovaj kontejner nema. Ostaje kao kasnija opcija, ne kao propust.

---

## Svesno izostavljeno

| Nije napravljeno | Zašto |
|---|---|
| Backtesting i trade replay | Radi se direktno u TradingView-u. Embed ne pomaže: Bar Replay živi u njihovoj aplikaciji, a widget je crna kutija kroz koju kod ne može da korakne |
| Broker sync koji popunjava ceo trejd | Ručni unos je izbor i prednost — tera da se trejd pročita još jednom. Bot most (ispod) beleži samo ono što je broker već učinio; sve što je procena i dalje se kuca |
| Spaces, mentor, leaderboard | Jednokorisnički sistem |
| AI chat i agenti | Mentor pack izvoz i insight pravila daju isto bez API troška |
| Opcije (DTE, strike, expiry) | Ne trguju se |
| Intraday dimenzije (entry time 5–30 min) | Day-trading artefakt |
| Ekonomski kalendar | Živi u vault repou |
| Running P&L kriva po trejdu | Traži cenovni feed. Posledica: „most time in drawdown" otpada |

**Blokirano, ne odbijeno:** MAE/MFE **iz istorijskih sveća** (Faza 8B). Za trejdove koje vodi bot
most ovo više ne treba — `position_excursion` ih donosi uživo, u tick rezoluciji. Ostaje za sve
ostalo: ručno unete i uvezene trejdove, i sve odtrgovano pre nego što je most postojao.

Logika skeniranja i biranje intervala su napisani i testirani — `excursion-scan.ts` bira 1m do 1h
prema dužini držanja, a sveća se broji samo ako cela stane unutar prozora trejda. Fali samo adapter
za feed. **Izvor je promenjen sa OANDA na cTrader Open API**: OANDA je 2017. ukinula v20 pristup za
EU klijente, a pošto se ionako trguje preko cTrader-a, taj feed je doslovno isti onaj na kom se
trguje. Aplikacija je registrovana i čeka Spotware KYC; pun plan je u
[`FAZA_8B_PLAN.md`](FAZA_8B_PLAN.md).

---

## Dokumentacija

| Izvor | Za šta |
|---|---|
| **Ovaj README** | Šta postoji i kako radi |
| [`ROADMAP.md`](ROADMAP.md) | Faze, odluke i njihova obrazloženja, šta je ostalo |
| [`CODE_REVIEW.md`](CODE_REVIEW.md) | Runde 2b, 3 i 4 plus izvršenje render sloja (Faza 10), svaki nalaz sa ishodom (engleski) |
| [`PARITY.md`](PARITY.md) | Poređenje sa TradeZella-om, stavku po stavku |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) | AI ulaz (Cursor / Claude Code) |
| [trading-fundamental-vault](https://github.com/0xsickre/trading-fundamental-vault/blob/master/README.md) | F0–F5 ciklus, makro bias, COT filter |
| [vault `workflow.md`](https://github.com/0xsickre/trading-fundamental-vault/blob/master/workflow.md) | Sedmični runbook (13 koraka) |
| [trading-dashboard](https://github.com/0xsickre/trading-dashboard/blob/master/README.md) | Read-only prikaz nedeljne analize |

---

## Napomena

Privatni repo — lična upotreba. Supabase projekat journal-a je **odvojen** od dashboard projekta; ne
pokreći dashboard migracije ovde ni obrnuto. Sadržaj je lični trading zapis, ne investicioni savet.
