# Trading Journal

Swing/ICT trading dnevnik za jednog trejdera. Ručni unos, bez AI chat-a — disciplinovan zapis šta
je odtrgovano i koliko je proces ispoštovan, i poštena aritmetika nad tim zapisom. Jedini
automatski upis je **bot most** (§ Bot most): on beleži isključivo ono što je broker već učinio,
a sve što je procena i dalje se kuca rukom.

Pravljen da metrikama, beleškama i izveštajima pokrije ono što TradeZella radi, minus delovi koji
imaju smisla samo za višekorisnički SaaS. Gde se razlikuje, razlika je zapisana i obrazložena —
ovde ili u `ROADMAP.md`.

Interfejs je na srpskom. Kod, komentari i `CODE_REVIEW.md` su na engleskom.

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
| `npm run build` | Produkcijski build — 14 ruta |
| `npm run lint` | ESLint. **Očekuje se tačno jedno upozorenje** (vidi ispod) |
| `npm test` | Vitest — 2124 testa u 132 fajla, u dva projekta (`lib` u node-u, `components` u jsdom-u) |
| `npm test -- --coverage` | Izveštaj o pokrivenosti |
| `npx knip` | Mrtvi fajlovi, eksporti i zavisnosti |

**Lint upozorenje je nosivo.** `journal-grid.tsx:651` prijavljuje *„Compilation Skipped: Use of
incompatible library"* — React Compiler odbija da memoizuje komponentu koja koristi
`useReactTable` iz TanStack Table. Razumemo ga i prihvatamo. To što ih je **tačno 1** je kontrolna
vrednost: svaki drugi broj znači da je neka izmena nešto uvela.

### CI

`.github/workflows/gate.yml` vrti tih pet provera na svakom push-u na `main` i na svakom pull
request-u. Do runde 4 gate je postojao samo kao dogovor — vrteo se pred commit zato što je tako
dogovoreno — a dogovor ne obara pull request.

Dva koraka traže više od jedne komande, jer im alat sam po sebi ne čuva ništa:

- **lint** — ESLint izlazi sa 0 i na upozorenjima, pa se broj MERI i poredi sa jedinim prihvaćenim.
- **knip** — izlazi sa 0 kad nađe samo neiskorišćene EXPORT-e (22 su re-export-i iz `shadcn/ui`).
  Mrtav FAJL i mrtva ZAVISNOST se traže odvojeno i obaraju prolaz.

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

28 tabela i 1 view, sve sa prefiksom `tj_`. **Row-level security je uključen na svih 28 tabela**,
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
| **Konfiguracija** | `tj_option_lists`, `tj_option_items`, `tj_field_defs`, `tj_user_prefs` |
| **Dnevni proces** | `tj_daily_reports`, `tj_focus_goals`, `tj_position_checkins` |
| **Nedeljni proces** | `tj_weekly_reviews` |
| **Tracker** | `tj_tracker_rules`, `tj_tracker_checkins` |
| **Playbook-ovi** | `tj_playbooks`, `tj_playbook_rules`, `tj_playbook_rule_links`, `tj_position_rules` |
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
| `/playbooks` | Definisanje playbook-a i dokaz na istom ekranu — pravila, per-rule scorecard, kartice se mogu skupiti/raširiti |
| `/reports` | Radni sto za izveštaje — bilo koja metrika protiv bilo koje dimenzije, plus pivot |
| `/tracker` | Preusmerava na `/daily` (ostalo jer je tracker nekad živeo ovde) |
| `/notebook` | Beleške, folderi, tagovi, markdown |
| `/import` | Čarobnjak za CSV uvoz, istorija batch-eva, undo |
| `/settings` | Nalozi, instrumenti, liste opcija, korisnička polja, playbook-ovi, tracker pravila, brisanje naloga i reset |
| `/login` | Supabase auth |

---

## Metrike

33 metrike u jednom registru (`src/lib/journal/reports/metrics.ts`), 12 ugrađenih dimenzija plus po
jedna za svako korisničko polje. Bilo koja metrika ide protiv bilo koje dimenzije — zato postoji
jedan report engine umesto deset stranica sa izveštajima.

**Registar je registar, ne druga implementacija.** Svaki unos delegira funkciji koja već postoji i
već je testirana na drugom mestu. Metrika koja bi računala nešto u sebi razišla bi se sa modulom
koji to isto računa.

### Novac i brojanje

| Metrika | Formula | Napomena |
|---|---|---|
| Neto P&L | `Σ (bruto − provizije − swap)` | Datira se po danu **zatvaranja**, u zoni naloga |
| Bruto P&L | `Σ (izlaz − ulaz) × količina × point_value × smer` | |
| Win rate | `dobici / (dobici + gubici) × 100` | **Breakeven trejdovi su van imenioca** |
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

Jedan kompozit, 0–100, preko sedam komponenti. Ponderi i tablice bandova su prepisani iz TradeZella
specifikacije da bi broj ostao uporediv; sedma komponenta je sopstvena.

| Komponenta | Ponder | Boduje se po |
|---|---|---|
| Profit factor | 25 | Tablica bandova, 1.8 → 2.6 mapira na 20 → 100 |
| Avg win/loss | 20 | Ista tablica, u novcu |
| Max drawdown | 20 | `100 − maxPctOfPeakPnl` |
| Win % | 15 | `win% / 60 × 100`, sa gornjim ograničenjem |
| Recovery factor | 10 | Svoja tablica, 1.0 → 3.5 |
| Consistency | 10 | Prosleđuje se kakav jeste |
| **Process adherence** | 15 | 60 % tracker compliance + 40 % playbook follow rate |

Ukupan ponder je **115** sa procesnom komponentom i 100 bez nje, pa kartica deli stvarnim zbirom a
ne zakucanom stotkom.

**Komponenta bez podataka se izbacuje a preostali ponderi renormalizuju**, da mlad track record ne
bude kažnjen za aritmetiku koja nema šta da deli. Da bi to bilo tačno trebalo je tri odvojene
popravke u rundi 3, sve tri ista greška na različitim dubinama:

1. Drawdown, win % i consistency vraćaju `0` na praznoj knjizi — pošteno kao *statistike*, a
   `100 − 0 = 100` je „nikad nije trgovao" pretvorilo u besprekorno upravljanje rizikom.
2. Jedan dobitnički trejd davao je **100/100**: beskonačan profit factor, nula drawdown-a jer nema
   od čega da padne, 100 % win rate i nulta varijansa nad jednim uzorkom. Četiri maksimuma, svaki
   artefakt n=1.
3. Knjiga od šest uzastopnih gubitaka dobijala je **100 za upravljanje rizikom**, jer procenat
   drawdown-a nije imao pozitivan vrh da njime deli pa je vraćao `0`.

Zato skor sad nosi kapiju dokaza:

- **Ispod 5 zatvorenih trejdova skora nema.** Kartica odbrojava do njega.
- **Ispod 30 se prikazuje ZAJEDNO sa uzorkom**, označen kao privremen. Win rate nad pet odluka ima
  interval poverenja širok četrdesetak poena, ali krijenje skora nedeljama je nepoštenje u drugom
  smeru.
- **Ispod 50 % pokrivenih pondera skora nema** — jedna komponenta pod naslovom sedmokomponentnog
  kompozita nije kompozit.

Svaka kapija čita svoj imenilac: `trades` za statistike zavisne od putanje (drawdown hoda kroz niz,
consistency je njegov rasap), `decided` (dobici + gubici) za one građene od dobitaka protiv
gubitaka. Knjiga od samih breakeven scratch-eva ima putanju za merenje i nema odluka koje je dobila.

Četiri kalibracione konstante su zaključane vrednošću u `sickre-score.test.ts`. Menjanje bilo koje
pomera svaki skor koji je ikad prikazan, pa sad mora da menja i test.

---

## Praćenje procesa

**Tracker pravila** su dnevne obaveze, po danu u nedelji. Četiri se ocenjuju automatski iz podataka
— max gubitak po trejdu, max gubitak po danu, svaki trejd vezan za playbook, svaki trejd ima stop —
a ostala se čekiraju rukom.

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

**Insights** su 37 pravila u četiri familije (dan, nedelja, trejd, proces) koja čitaju iste
obogaćene trejdove kao i izveštaji. Svako pravilo deklariše minimalni uzorak i nijedno ne okida na
n=1.

**FTMO režim** je po nalogu: dnevni gubitak, ukupni gubitak, profitni cilj i minimalni broj dana.
Proboj pravila zamrzava nalog — nov trejd se ne može ni napraviti ni aktivirati dok se izazov ne
resetuje u Settings.

Dnevni limit ima **podesivu bazu**, jer se stvarni FTMO nalozi razlikuju po tome: fiksna (procenat
od početnog balansa, ceo izazov) za 2-Step tip, ili rolling (procenat od balansa na kraju
prethodnog trgovinskog dana) za 1-Step tip. Ukupan gubitak (drawdown pod) ostaje uvek fiksan na
početni balans — to je zajedničko oba tipa.

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
javlja tri činjenice, a dnevnik od njih pravi trejd:

| Događaj kod brokera | Šta dnevnik upiše |
|---|---|
| Postavljen pending order | Nov trejd, `status = planned` |
| Order izmenjen dok još čeka | Isti trejd → nove cene i veličina |
| Order se ispunio | Isti trejd → `status = open` + ulazni fill |

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

**Bot ne sme na cTrader Cloud.** Cloud instance ne šalju HTTP i ne prijavljuju grešku kad ne pošalju,
pa bi most izgledao zdrav a ne bi isporučio ništa. Zato bot šalje heartbeat, a panel prikazuje kad se
poslednji put javio: ćutanje mora da bude vidljivo sa ove strane.

**Još nije pokriveno, i meri se pre nego što se gradi: više TP nivoa.** cTrader-ova napredna zaštita
dozvoljava do pet take-profit nivoa na jednom orderu, svaki zatvara deo pozicije. `PendingOrder.TakeProfit`
u Algo API-ju je **jedna** vrednost i nijedan niz nivoa nije dokumentovan, pa se odavde ne može znati
koji od pet je vidljiv — prvi, poslednji ili nijedan. Bot zato loguje šta API vrati za takav order
(`Order placed | … | TP=…` u Žurnal tabu), i oblik se gradi tek kad taj log postoji. Odredište nije
sporno: `tj_positions.scale_out_levels` (`[{"pct","price"}]`) već čeka, samo izvor nije poznat.

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

**Reset svega** (`tj_reset_my_data`). Briše svih 28 tabela za pozivaoca pa zove
`tj_seed_my_defaults()` — istu seed funkciju koju dashboard vrti na praznom nalogu, pa „reset" i
„prvo učitavanje ikad" završavaju u istom stanju. Traži da se ukuca `RESET EVERYTHING`.

Izmereno šta se stvarno vraća, umesto pretpostavljeno iz imena seed-a: **1 Main Account, 91
instrument, 13 lista sa 66 opcija, 7 tracker pravila, 4 korisnička polja, 3 note foldera.**

**Šta se NE vraća: playbook-ovi.** `tj_seed_my_defaults` zove samo `tj_seed_defaults` i
`tj_seed_instruments_defaults`; `tj_seed_playbooks` postoji ali nije zakačen na njega, pa reset
završava sa nula playbook-ova i nula pravila bez obzira koliko ih je bilo napisano. Isto važi za
sve dodato rukom — opcije, tracker pravila, naloge. Panel to piše na ekranu, jer nabrojati šta se
vraća a prećutati šta ne znači reći tačnu polovinu.

Obe funkcije su **SECURITY INVOKER**, ne DEFINER: svaka tabela nosi
`FOR ALL TO authenticated USING (user_id = auth.uid())`, pa RLS već ograničava svaki upit na
pozivaoca, i nema šta da se izvodi ručno. `anon` je oduzet **imenom**, ne samo preko `PUBLIC` —
Supabase-ove default privilegije dodele EXECUTE svakoj novoj funkciji u `public`, a
`REVOKE ... FROM PUBLIC` ne skida eksplicitan grant na rolu. Provereno nad živim projektom.

---

## Migracije

73 fajla u `supabase/migrations/`, imenovanih `YYYYMMDDHHMMSS_opis.sql`.

- **Aditivne.** Nikad se ne menja primenjena migracija — piše se nova delta.
- **Migracija objašnjava samu sebe.** Svaka počinje komentarom šta je bilo pogrešno i šta puca bez
  te izmene. Ti fajlovi su jedini zapis zašto šema izgleda ovako.
- **Brisanje kolone od koje zavisi view** znači `DROP VIEW` → `DROP COLUMN` → `CREATE VIEW` →
  `ALTER VIEW ... SET (security_invoker = on)`. Zaboravljena poslednja linija tiho menja kao ko se
  view filtrira.

### Bezbednosni model

- **RLS na svih 28 tabela**, vlasnički obrazac, provereno nad živom bazom.
- **`SECURITY DEFINER` + uuid argument je rupa**, jer svaki prijavljen korisnik može da je pozove sa
  tuđim id-em. Svih šest takvih funkcija ima oduzet `EXECUTE` od `authenticated`. Jedina koja ostaje
  pozivna je `tj_seed_my_defaults()`, koja ne prima argument i seed-uje samo podatke pozivaoca.
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

2124 testa u 132 fajla, podeljenih u **dva vitest projekta**: `lib` (okruženje `node`, fajlovi
`*.test.ts`, 1725 testova u 88 fajlova) i `components` (okruženje `jsdom`, fajlovi `*.test.tsx`,
399 testova u 44 fajla). Pravilo je ekstenzija, pa nijedan fajl ne može upasti u oba. Podela postoji da čisto aritmetički testovi ne
plaćaju cenu DOM-a koji ne dodiruju.

`vitest.config.ts` nosi **podove** pokrivenosti, ne ciljeve — stoje na onome što paket trenutno
postiže, pa jedino što mogu je da padnu kad izmena spusti pokrivenost. Od Faze 10 postoje **dva
odvojena poda**, provereni nezavisno umesto stopljeni u jedan prosek:

| Sloj | Statements | Branch | Functions | Lines |
|---|---|---|---|---|
| `src/lib/**` | 95 % | 89 % | 96 % | 96 % |
| `src/components/**` | 64 % | 64 % | 61 % | 65 % |

Zašto dva, ne jedan: `src/lib` je čista aritmetika i drži se blizu 96 % od Faze 0. `src/components`
je render sloj Faze 10 — 24 od 51 fajla ima **posvećen** render test, ostatak je dohvaćen samo
uzgredno, kroz ono što neka testirana komponenta uveze (mnogi `src/components/ui` primitivi
izvoze pod-delove — `DropdownMenuRadioItem`, `PopoverTitle` — koje ništa u aplikaciji ne renderuje).
Jedan stopljen broj bi ili povukao bibliotečki pod na nivo render sloja, ili slagao o tome koliko
je render sloj zapravo pokriven; dva poda kažu obe stvari pošteno umesto da ih usrednje u broj koji
ne opisuje nijedno.

Četiri stvari koje brojevi namerno **ne** tvrde:

1. **`src/components`-ov pod nije „dobro testirano".** 64/64/61/65 je pošteno stanje sloja koji je
   ovu fazu počeo od nule i nije završen — Faza 10 pokriva komponente najvišeg rizika (Tier 1 i 2 u
   `ROADMAP.md`), ne svih 42. Čitati ovaj pod kao „UI je 64 % tačan" ponavlja tačno grešku na koju
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
4. **`src/app` (25 ruta) nema nijedan broj**, i „nema broj" nije „0 %" — to je „nije mereno". Rute
   su server komponente čija je logika `await getCurrentUser()` pa `redirect()` pa prosleđivanje
   propova; propovi se tvrde na drugoj strani, gde ih render test već čita.

`src/lib/journal/book.fixture.test.ts` postoji baš zbog druge tačke. Fiksira jednu knjigu od deset
trejdova, izvodi svaku glavnu brojku na papiru u komentarima — sa vidljivom aritmetikom — pa tvrdi
kod prema papiru. Snapshot test zaključava trenutno ponašanje uključujući njegove bagove; ovaj
zaključava odgovor. Druga polovina fajla prolazi *oblike* koje knjiga može imati (prazna, jedan
trejd, sve dobitnici, sve gubitnici, sve breakeven, samo otvorene) — tako je nađen treći nalaz oko
drawdown-a. Ista knjiga, iste brojke na papiru, postaju i propovi renderovanog Dashboard-a u
`dashboard.render.test.tsx` — papir → `lib/` → ekran, jedan skup brojeva tvrđen na sva tri sloja.

**Render sloj se izvršava od Faze 10.** Osam koraka, svaki commit + push + `tsc` + `vitest` + `lint`
+ `build` + `knip`, dokumentovano u `CODE_REVIEW.md`. Dashboard (najveći fajl, 48 `useMemo`),
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
`lib/` lanac od realizovanih trejdova do skora, i render sloj za komponente najvišeg rizika. 25 ruta
u `src/app` se i dalje ne izvršavaju ni u jednom testu — logika koja tamo živi je tanka
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

**Blokirano, ne odbijeno:** automatski MAE/MFE iz sveća (Faza 8B). Logika skeniranja i biranje
intervala su napisani i testirani — `excursion-scan.ts` bira 1m do 1h prema dužini držanja, a sveća
se broji samo ako cela stane unutar prozora trejda. Fali samo OANDA adapter, i čeka praktični token.
Ništa drugo nije potrebno.

---

## Dokumentacija

| Izvor | Za šta |
|---|---|
| **Ovaj README** | Šta postoji i kako radi |
| [`ROADMAP.md`](ROADMAP.md) | Faze, odluke i njihova obrazloženja, šta je ostalo |
| [`CODE_REVIEW.md`](CODE_REVIEW.md) | Tri runde revizije, svaki nalaz sa ishodom (engleski) |
| [`PARITY.md`](PARITY.md) | Poređenje sa TradeZella-om, stavku po stavku |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) | AI ulaz (Cursor / Claude Code) |
| [trading-fundamental-vault](https://github.com/0xsickre/trading-fundamental-vault/blob/master/README.md) | F0–F5 ciklus, makro bias, COT filter |
| [vault `workflow.md`](https://github.com/0xsickre/trading-fundamental-vault/blob/master/workflow.md) | Sedmični runbook (13 koraka) |
| [trading-dashboard](https://github.com/0xsickre/trading-dashboard/blob/master/README.md) | Read-only prikaz nedeljne analize |

---

## Napomena

Privatni repo — lična upotreba. Supabase projekat journal-a je **odvojen** od dashboard projekta; ne
pokreći dashboard migracije ovde ni obrnuto. Sadržaj je lični trading zapis, ne investicioni savet.
