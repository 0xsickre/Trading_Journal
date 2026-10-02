## Šta sam pregledao

Prošao sam šemu (`supabase/schema/production_base_tables.sql` + 60+ migracija), registar metrika i dimenzija, insight engine, Sickre Score, tracker, playbooks, dnevni/nedeljni sloj i formu za unos. Ne komentarišem "utisak" — svaka tvrdnja ispod ima fajl i kolonu iza sebe.

---

# 1. Ocena profesionalnog nivoa i kompletnosti

**Ocena: 8/10 kao žurnal, 5/10 kao sistem za donošenje odluka o riziku.**

Ovo je iznad 95% komercijalnih žurnala po jednoj stvari: **novac se ne unosi, nego izvodi iz fill-ova** (`tj_executions` → `tj_position_stats`), instrument specifikacija se zamrzava u trenutku upisa (`point_value_at_trade`, `fx_rate_at_trade`), a troškovi su per-simbol (`commission_per_lot`, `swap_long/short`, `swap_triple_day`). Većina žurnala ovde laže — ovaj ne može.

Šta feedback loop **stvarno** pokriva:

| Sloj | Pokriveno | Gde |
|---|---|---|
| Egzekucija | entry slippage u R, target attainment (ponderisan po scale-out ladderu), exit efficiency, MAE/MFE iz MT5 ticka | `metrics.ts`, `entry-slippage.ts`, `exit-efficiency.ts` |
| Plan vs realnost | `delta_r`, planirani R vs realizovani nad **istim** skupom trejdova | `risk-metrics.ts:computePlannedRStats` |
| Proces | tracker sa 6 auto-pravila, lock dana, `na` umesto `pass` na danu bez trejdova | `tracker/auto-rules.ts` |
| Psihologija | `mental_temp`, impulse flagovi, position check-in (`thesis_state`, `touched`) | `tj_position_checkins` |
| Teza i njena smrt | `thesis`, `invalidation`, `time_stop_days`, insight "Held past invalidation" | `insights/swing-rules.ts` |
| Prop ograničenja | FTMO daily/max/target/min-days + `headroomPct` (najbliži prilaz limitu) | `ftmo.ts` |
| Disciplina po pravilima | playbook rules → `follow_rate` po pravilu | `reports/playbook-dimensions.ts` |

Detalji koji odaju da je ovo pisano od nekog ko je pogrešio pa popravio: R je **uvek bruto** i ne prati net/gross toggle; novac se datira po danu zatvaranja a **odluke po danu otvaranja**; `periodsPerYear` se meri iz podataka umesto hardkodovanih 252; win rate izbacuje breakeven iz imenioca; "All accounts" odbija da sabere EUR i USD.

**Ali:** žurnal meri **ishod** izvrsno, a **rizik koji si preuzeo** skoro nikako. To je rupa koja poništava deo ostalog.

---

# 2. Argumentovani nedostaci — poređani po šteti

### 2.1 Rizik koji je stvarno preuzet se nigde ne meri (KRITIČNO)

`risk_pct` je **TEXT kolona, popunjena iz dropdowna** (`tj_positions.risk_pct`, forma u `form-config.ts:122`). To je *namera*. `position_size` je broj koji si otkucao. **Nigde se ne računa stvarni rizik na ulazu**: `planned_risk_pts × entry_qty × point_value / equity_u_trenutku_ulaska`, i nigde se ne poredi sa izabranim `risk_pct`.

Posledice, konkretno:

- Trejd dimenzionisan na 3% koji je **dobio** — nevidljiv. Nema ga ni u jednoj metrici, ni u jednom insightu, ni u treckeru.
- `max_loss_per_trade` pravilo (`tracker/auto-rules.ts:274`) gleda **`netPl` realizovanog gubitka**, ne rizik na ulazu. Znači: prekoračenje veličine se detektuje tek pošto te je koštalo, i to samo ako je stop pogođen. Ako si izašao ranije — pravilo kaže `pass`.
- Sickre Score daje 30 poena procesu, ali proces ne sadrži jedinu varijablu koja ubija prop nalog.
- FTMO `headroomPct` meri koliko si blizu prišao — **posle činjenice**. Ne meri koliko si *mogao* prići pri riziku koji si nosio.

Ovo je najskuplja slepa mrlja u sistemu: sve ostalo meri kvalitet odluke, ovo meri da li ćeš preživeti da je ponoviš.

### 2.2 Nema agregatnog rizika — portfolio heat i korelacija

`open-positions.ts` zna `daysInTrade` i `pastTimeStop`. Ne zna **sumu otvorenog rizika**. Tvoj katalog je XAUUSD, US100, XCUUSD i slično — tri pozicije na 1% nisu 3% rizika, nego negde između 1.5% i 3% u zavisnosti od korelacije, a u risk-off danu su praktično jedna pozicija sa 3×.

Za swing knjigu koja drži preko noći i preko vikenda (`weekend_hold` dimenzija postoji — znači znaš da je to bitno) ovo nije akademski. Jedan gap otvara sve tri pozicije istovremeno. Ništa u aplikaciji ne može to da ti kaže ni unapred ni unazad.

### 2.3 Point estimate bez intervala — na uzorku od 40–70 trejdova godišnje

`DEFAULT_MIN_SAMPLE = 5` (`reports/engine.ts:25`) je **filter, ne mera nesigurnosti**. Profit factor od 2.4 na 12 trejdova i profit factor od 2.4 na 300 trejdova izgledaju identično na ekranu.

Na 40 trejdova sa win rate 40%, 95% interval poverenja za win rate je otprilike **25%–57%**. Profit factor na istom uzorku lako ima interval 0.9–4.0. To znači da ti `/reports` tabela sa 24 dimenzije × 34 metrike **garantovano** isporučuje lažne nalaze: "XAUUSD ponedeljkom je moj najbolji setup" na n=6.

Sickre Score komentar u kodu sâm priznaje "confidence interval about forty points wide" — ali interval se nigde ne računa niti prikazuje. Priznanje bez implementacije.

### 2.4 Plan se može prepisati posle ishoda — nema pečata

Dan se zaključava (`tj_daily_reports.locked_at`, trigger blokira izmene). Nedelja se zaključava. **Trejd plan se ne zaključava nikad.**

`entry_price`, `stop_price`, `target_price`, `thesis`, `conviction`, `scale_out_levels` — sve je editabilno zauvek, bez istorije izmena. A na tim poljima stoje:

- `avg_entry_slip` — planirani ulaz vs fill
- `target_attainment` — realizovani R / planirani R
- `delta_r` — plan vs realnost
- `thesis_written` tracker pravilo

Komentar u `auto-rules.ts:376` kaže tačno pravu stvar: *"A thesis written after the fact is a rationalisation"* — pa ipak jedino što se proverava je da li teza **postoji** danas, ne da li je postojala pre `opened_at`. `created_at` i `opened_at` oba postoje; niko ih ne poredi. Cela "plan vs reality" analiza je, formalno, falsifikabilna od strane jedinog korisnika sistema.

### 2.5 Nema trajanja drawdowna

Imaš `maxDrawdown` u novcu, `maxPctOfEquity`, `maxPctOfPeakPnl`, `recovery_factor`. Nemaš **koliko dugo si bio pod vodom** ni **koliko je trebalo da se vratiš na peak**. `equity.ts` nema nikakvu dimenziju vremena u drawdownu.

Za prop nalog i za psihu to je odlučujući broj. -8% za tri dana i -8% za četiri meseca su dva različita događaja; tvoj žurnal ih prikazuje identično. I računa se bez ijednog novog podatka — iz krive koju već crtaš.

### 2.6 Promašeni trejdovi nemaju cenu

`status = 'missed'` + `miss_reason` postoje, insight "Missed A-setups" postoji. Ali `NOT_IN_REPORTS` izbacuje `miss_reason` i `status` iz dimenzija, a promašen trejd nema izvršenja pa nema P&L. Znači: znaš **da** si promašio, ne znaš **koliko te je koštalo**.

A možeš da znaš: imaš plan (entry/stop/target) i imaš `scripts/mt5_excursion.py` koji čita tickove po simbolu i vremenu. Hipotetički R promašenog setupa je merljiv istim alatom koji već koristiš. Bez toga je "strah od ulaska" jedina greška u knjizi koja se ne naplaćuje.

### 2.7 Psihologija je write-only

Četiri boolean-a (`impulse_fomo`, `impulse_fear`, `impulse_greed`, `impulse_fear_wrong`) + `impulse_note` se upisuju svaki dan. Provera šta ih čita: **jedan chip u `month-day-list.tsx:185`**. Nisu dimenzija, nisu metrika, nisu input u skor, ne postoji insight nad njima.

Gore od toga — oni su na **danu**, a tvoj vlastiti kod je već rešio tačno taj problem za `micromanage`: komentar u `reports/dimensions.ts` objašnjava da je day-level kolona osuđivala i netaknutu poziciju, pa je zamenjena position-level check-inom. Ista greška je ostala kod impulsa, samo neprimećena jer ih niko ne čita.

### 2.8 Nema poređenja dva perioda ni testiranja promene

`filters.ts:11` u komentaru piše *"Compare mode passes an array of them"* — **compare mode ne postoji nigde u kodu** (`grep compareMode` = 0 rezultata). Postoji filtriranje, ne postoji dva skupa jedan pored drugog.

To lomi jedini mehanizam učenja koji si ugradio: nedeljni osvrt traži **`one_change`** (jedna promena), namerno u jednini, sa follow-up kolonom. Ali ništa u sistemu ne meri da li je ta promena išta uradila. Zapisuješ nameru da se promeniš i nikad ne saznaš ishod. To je otvoren krug, ne petlja.

### 2.9 Sitnije, ali stvarno

- **Nema regime konteksta.** `vix_regime`, `market_type`, `news_nearby` su obrisani. Razumem zašto (ručni unos = šum), ali 50 trejdova godišnje se prostire preko više režima i pitanje "da li moj edge radi u niskoj volatilnosti" sada ne može da se postavi. Zamena je jeftina i objektivna: ATR percentil na ulazu, iz istog MT5 skripta.
- **`conviction` i `execution_rating` su self-rated posle ishoda.** Bez vremenske oznake unosa, `conviction` je verovatno korelisan sa rezultatom, ne sa procenom. Kao dimenzija je zato skoro bezvredan.
- **TradingView URL kao jedini nosač slike** (`tj_trade_images` CHECK na `tradingview.com/x/...`). Link rot za doživotnu arhivu — ako TV obriše snapshot, dokaz je nestao.

---

# 3. Šum — šta izbaciti

Pošteno: dnevni izveštaj je već agresivno orezan (od ~25 kolona na 9 — `mantra_*`, `sleep_quality`, `market_type`, `easiest_setup`, `celebrate_win`, `friday_flat` su obrisani). Ali ostalo je ovo:

### 3.1 34 metrike × 24 dimenzije = 816 pogleda na ~50 trejdova (NAJVEĆI ŠUM)

Ovo nije fleksibilnost, ovo je mašina za generisanje lažnih obrazaca. Sa 50 trejdova godišnje, broj statistički branjivih preseka je otprilike **tri**.

**Izbaci iz `/reports` (ili sakrij iza n≥100 dana):**

| Metrika | Zašto |
|---|---|
| `sharpe`, `sortino`, `calmar` | Estimatori sa ogromnom varijansom na 40 trgovačkih dana. Merena anualizacija ih čini *manje* pogrešnim, ne tačnim. Tri broja koja izgledaju institucionalno i ne znače ništa |
| `consistency` | `100 − cv × 20`. Konstanta 20 je izmišljena (kod to i piše: *"single place to recalibrate once there is enough live data"*). Nosi težinu u skoru na osnovu proizvoljnog broja |
| `gross_pnl` kao zasebna metrika | Imaš net/gross toggle. Dve metrike za isti toggle |
| `avg_daily_dd` | Za swing knjigu koja drži danima, "pad od dnevnog maksimuma" meri šum kotacije, ne tvoju odluku |
| `avg_win_loss` | Kod sâm kaže da je kod fiksnog 3R targeta to konstanta ~3. Duplira profit factor. Već mu je težina spuštena na 5 — spusti je na 0 |

**Podrazumevani set neka bude 8:** Net P&L, Expectancy (sa intervalom), Total R, Max DD %, vreme u drawdownu, Follow rate, Target attainment, Trades.

### 3.2 Četiri ocene kvaliteta po jednom trejdu

`setup_grade` (ručno) + `setup_score` (izvedeno iz playbook kriterijuma) + `conviction` (1–5) + `execution_rating` (1–5). Izvedeni `setup_score` je jedini koji nije subjektivan posle ishoda.

**Zadrži:** `setup_score` + `execution_rating`. **Izbaci:** `setup_grade` (već je izveden, kolona je legacy fallback), `conviction` (duplira setup score, a kontaminiran je ishodom).

### 3.3 37 insight pravila

Na 40–70 trejdova godišnje, većina ili nikad ne opali ili opali na n=5. Trade-level ih je 24 — a mnoga su varijacije istog: `green_to_red`, `green_to_breakeven`, `gave_back_profit`, `drawdown_exceeds_profit` su četiri načina da se kaže "nisi zaštitio dobit".

**Svedi na ~12**, grupisano po uzroku a ne po simptomu. Insight koji opali na svakom drugom trejdu prestaje da bude signal.

### 3.4 Pet mesta za prozu

`trade_journal_notes`, `notebook` (folderi + beleške), `impulse_note`, `macro_note`, nedeljni `went_well/went_badly`, playbook notes. Šest, zapravo.

`macro_note` posebno — tvoj makro rad živi u `trading-fundamental-vault` repou. Ovo je duplikat koji se popunjava od dužnosti.

**Izbaci:** `macro_note`, `impulse_note` (v. 2.7 — ili promoviši impulse na nivo trejda, ili obriši sve).

### 3.5 Sickre Score kao kompozit

Sedam komponenti, od kojih su tri međusobno zavisne (profit factor ↔ avg win/loss ↔ recovery factor svi su funkcije istih dobitaka i gubitaka) i jedna je proizvoljno skalirana (consistency). Renormalizacija težina na nedostajuće komponente znači da se **ista knjiga ocenjuje po drugoj formuli svake nedelje**.

Jedan broj koji se menja iz dva razloga (performanse ILI dostupnost podataka) nije merilo. **Razbij ga na tri koja nikad ne dele deljenik:**
1. **Process adherence** (tracker + follow rate) — jedini nezavisan od varijanse
2. **Survival** (FTMO headroom + max DD % + vreme u DD)
3. **Edge** (expectancy u R, sa intervalom poverenja i brojem uzorka na istom čipu)

---

# 4. Faze rekonstrukcije

### Faza A — Rizik kao prvorazredni podatak (2–3 dana, najveći ROI)

1. Nova kolona `risk_money_at_entry numeric` na `tj_positions`, upisana pri aktivaciji: `plannedRiskPts × entry_qty × point_value_at_trade × fx_rate_at_trade`. Nova `risk_pct_actual` = to podeljeno sa equity-jem na dan otvaranja (imaš `balance.ts` i `cash-events`).
2. Metrike: **`avg_risk_pct`**, **`max_risk_pct`**, **`risk_dispersion`** (σ rizika — mera discipline dimenzionisanja), **`risk_vs_intent`** (stvarni − nameravani).
3. `max_loss_per_trade` tracker pravilo prepiši da gleda **rizik na ulazu**, ne `netPl`. Dodaj `risk_matched_intent` kao sedmo auto-pravilo.
4. Dimenzija `risk_bucket` — jer "da li mi veći rizik donosi bolji R" je pitanje koje sad ne možeš da postaviš.

*Zašto prvo:* bez ovoga 30 poena "procesa" u skoru ne uključuje najvažniji proces.

### Faza B — Nesigurnost na ekranu (2 dana)

1. Wilson interval za win rate, bootstrap (2000 uzoraka) za expectancy i profit factor. Sve tri se računaju u `analytics.ts` bez novih podataka.
2. Svaki red u `/reports` dobija `n` **i** širinu intervala. Red čiji interval prelazi nulu se renderuje sivo — vizuelno "ovo još ne znaš".
3. Zameni `minSample` filter sa ovim. Filter krije redove; interval ih objašnjava.

### Faza C — Preživljavanje (2–3 dana)

1. **Portfolio heat**: suma otvorenog rizika u % equity-ja, uživo u `open-positions-widget`, sa upozorenjem na pragu koji sam postaviš. Istorijski `max_concurrent_risk` kao metrika.
2. **Korelaciona matrica** realizovanih dnevnih P&L po instrumentu — trivijalno iz podataka koje imaš, i odmah ti kaže da li tvoje tri pozicije jesu jedna.
3. **Drawdown duration**: dani pod vodom, najduži period, vreme do oporavka. Iz postojeće krive.
4. **Monte Carlo na FTMO limit**: pri trenutnoj distribuciji R i trenutnom riziku, verovatnoća da udariš daily/max loss u sledećih 100 trejdova. Ovo je jedini broj koji pravi razliku između "profitabilan" i "preživeće challenge".

### Faza D — Zatvaranje petlje (3–4 dana)

1. **`plan_locked_at`** na `tj_positions`. Posle `opened_at`, plan polja su read-only; izmena traži eksplicitno otključavanje koje se beleži. Uz to: `thesis_written` pravilo poredi `created_at < opened_at`.
2. **Compare mode** koji je već projektovan u `filters.ts` — dva filter seta, side by side, sa razlikom i njenim intervalom.
3. **Experiment objekat**: nedeljni `one_change` postaje red sa datumom početka, hipotezom i metrikom. Sledeći osvrt automatski prikazuje "pre" vs "posle" za tu metriku sa brojem uzorka. Ovo pretvara nedeljni osvrt iz dnevnika u eksperiment.
4. **Cena promašenih setupa**: proširi `mt5_excursion.py` da računa hipotetički R za `status='missed'` trejdove sa kompletnim planom. Nova metrika `missed_r`.

### Faza E — Rezanje (1 dan, radi se poslednje)

Sve iz sekcije 3: skloni Sharpe/Sortino/Calmar/consistency/avg_daily_dd/avg_win_loss iz podrazumevanog prikaza, obriši `conviction` i `setup_grade` kolonu, `macro_note`, `impulse_*` (ili ih pomeri na check-in), svedi insights na 12, razbij Sickre Score na tri broja.

---

**Jednom rečenicom:** ovo je žurnal koji zna tačno šta se dogodilo, ne zna koliko si rizikovao da se to dogodi, i ne zna koliko od onoga što ti pokazuje je slučajnost. Faze A, B i C to zatvaraju; faza D pretvara zapisivanje u učenje; faza E vraća fokus koji je 816 kombinacija metrika i dimenzija pojelo.