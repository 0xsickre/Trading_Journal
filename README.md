# Trading Journal

[![gate](https://github.com/0xsickre/Trading_Journal/actions/workflows/gate.yml/badge.svg)](https://github.com/0xsickre/Trading_Journal/actions/workflows/gate.yml)

A day-trading journal for a single trader: intraday CME index futures on Topstep — NQ / MNQ and
ES / MES, with 6E / M6E in the catalog. No AI chat — a disciplined record of what was traded and
how well the process was followed, plus honest arithmetic over that record. A trade is logged right
after it closes (`/trades/log`) or imported from the TopstepX trades export or a broker CSV; the
one thing written from outside is MAE/MFE on a future, from the exchange's own candles
(§ MAE/MFE).

**It was built as a swing journal** (FTMO CFDs on MT5, positions held for days), and the move to
day trading is under way. **FTMO mode and the MT5 statement import went in H1** (28.09.2026: no
FTMO or CFD trade was in the book), with the per-position check-ins on `/daily` and the five swing
insights (thesis, time stop, weekend). **H2 (29.09.2026) removed what they left in the database**:
the check-in table, `time_stop_days`, swap (fills, instruments, net P&L), the percentage-of-equity
tracker limits and the weekly loss rule, the `risk_pct` choice, the backtest account kind with the
TradingView replay import, and the `ftmo_*` columns. The book is Topstep only. What is still
measured on swing terms — a few insights — is listed item by item and split
into phases F1–F6 in [`FAZA_F_DAYTRADING_PLAN.md`](FAZA_F_DAYTRADING_PLAN.md). This README describes
the code as it is, swing leftovers included.

Built to cover what TradeZella does in metrics, notes and reports, minus the parts that only make
sense for multi-user SaaS. Where it differs, the difference is written down and argued — here or in
`ROADMAP.md`.

**On language**, counted rather than claimed, because this is the first thing a reader can check.
Identifiers and code comments in `src/` are English. This README and `CODE_REVIEW.md` are English;
`ROADMAP.md`, `PARITY.md` and `docs/` are largely Serbian. Migrations keep their Serbian comments on
purpose — an applied migration is never edited here, and the comment inside one is part of the
record of the day it was written.

**The interface is deliberately half-and-half, and the line is a clean one.** At least 185 of the
3,396 human-readable string literals in `src/` outside tests are Serbian, and every one of them sits
on a screen the trader writes into or reviews in their own words:

| Surface | Serbian strings |
|---|---|
| Daily (the "Pred sesiju" card included), weekly, tracker, focus goal | 128 |
| Mentor-export prompt | 33 |
| Weekly "Napredak" (progress) and experiment cards | 18 |
| Weekly insight sentence | 1 |
| Chart image helper (`tradingview-snapshot.ts`) | 2 |
| The seeded tag values Log Trade writes (`quick-log.ts`: no mistake, exit reasons — the tags are Serbian since K2) | 3 |
| Dashboard, `/reports`, journal grid, playbooks, **`/settings`**, `/trades/log`, Topstep banner | **0** |

Settings joined that last row on 20.09.2026. It had held the stage names of the daily checklist
(`Priprema` / `Trgovanje` / `Osvrt`, which the checklist itself rendered), a paragraph of Serbian
above the instrument catalog and two error messages from its server actions — a screen that measures,
reading half in one language and half in the other.

The half that **measures** is English; the half the trader **writes into** is Serbian. That is the
trader's own language for their own prose, and it stays.

That **0** was not always true, and it was not reached by rounding. Five strings sat on the English
side and were moved across: one reconcile-row message in `import-wizard.tsx`; the instrument-group
fallback in `trade-form.tsx`, which read `Ostalo` two lines under a comment calling it "Other"; the `derived` group label `Izvedeno` among
English ones in `reports/dimensions.ts`; and two insight sentences in `insights/day-rules.ts` and
`insights/trade-rules.ts` that opened in English and finished in Serbian. A sixth, the check-in tick
in `open-positions-card.tsx`, was miscounted rather than misplaced — that card rendered inside the
daily form, so it belonged to the Serbian half; it left with the card in H1.

How the count was taken, since the claim is only worth as much as its method: `npm run lang:count`
lexes every `.ts`/`.tsx` outside tests into comment / string / code regions, keeps the string regions
that read as prose rather than as machinery, and scores those for Serbian by diacritics and by a word
list. A single Serbian word carrying no diacritic can still slip past that, and JSX text between tags
is not a string literal (the "Bez pregleda" card on `/daily` is Serbian and not in the count), so
**165 is a floor, not a ceiling**. Three earlier versions of this paragraph said "about 46 of some 1,700", then "153 of
1,663", then "185 of 2,191" — each counted by hand, and each had to be replaced rather than quietly
corrected. That is why the method now ships as a script: a number nobody can re-run is a number
nobody can check. The figure moved again when the bot bridge was removed, and this time by re-running
it.

Deploy: Vercel · Database: Supabase Postgres (a separate project from the dashboard's)

---

## The one rule everything is built around

**A wrong number presented as fact is worse than a crash.**

A crash is visible and somebody fixes it. A win rate computed over half the trades, a "0 %" drawdown
on an account that only ever lost, a Sickre Score of 33 on an account with no trades at all — those
get shown as fact, believed, and they change how someone trades.

Every convention below exists because of that, and each one was a real defect at least once,
recorded in `CODE_REVIEW.md`:

- **Null is not zero.** A statistic with no data answers `null`, and the display shows `—`. All
  three round-3 findings around the score (`S1`, `S2`, `S3`) were a single `0` standing in for "no
  evidence".
- **Refuse rather than guess.** An ambiguous statement date (`02-03-2026`) or an ambiguous decimal
  (`1,234`) is refused, not interpreted. A refused cell is visible in the import; a guessed one is
  wrong by a factor of a hundred, and silent.
- **Sample size travels with the number.** A report row carries its own `n`; the composite score
  refuses to exist below five trades and is labelled provisional below thirty.
- **One answer per question.** Two parsers, two "last 90 days" windows or two filters for a rule's
  lifetime will drift apart, and one of them will be wrong. Round 3 found four such pairs.

---

## Where this sits

One repo of a trading desk. **No shared database.** The day-trading repo reads and writes the
journal through the same PostgREST API the app uses, signed in as the journal's user, so row-level
security applies to it exactly as to the browser.

| Repo | Answers | Data direction |
|------|---------|----------------|
| [`futures-trading`](https://github.com/0xsickre/futures-trading) | What is the day (news, red windows, expected NQ/ES range)? How many contracts today? | Reads Topstep accounts and trades; writes MAE/MFE (`excursion_source = 'r2'`) and the day's brief (`tj_session_briefs`) |
| **`Trading_Journal`** (this repo) | What did I trade, and with what discipline? | Write (you, after each trade) |
| [`trading-fundamental-vault`](https://github.com/0xsickre/trading-fundamental-vault) | Macro direction, COT filter — the swing cycle (F0–F5) | None; semantic only |
| [`trading-dashboard`](https://github.com/0xsickre/trading-dashboard) | Where did the vault's cycle stop? | None; read-only view of the vault |

What `futures-trading` does with the journal, each described in its own README:

- **The morning brief** reads every Topstep account (`tools/brief/racun.py`) and prints the contract
  table — room above the MLL, today's DLL, risk by the account's rule — with the same arithmetic as
  the trade form here (`topstep.ts`, `computeTopstepRisk`). Change one, change both. It then writes
  one `tj_session_briefs` row for the Topstep day — the red windows around the day's news as UTC
  instants, the Topstep close (15:10 CT, earlier on a holiday or an early close) and the expected
  NQ / ES range — which `/daily` shows and two tracker rules read (§ Process tracking). Not the
  contract count: the journal computes that itself, so there is one number, not two.
- **MAE/MFE** for closed futures trades comes from the traded contract's candles in Cloudflare R2
  (`tools/journal_mae.py`, daily and hourly in the evening) (§ MAE/MFE).
- **The evening reminder** at 15:20 CT, ten minutes after the Topstep close (22:20 Belgrade;
  `tools/journal_podsetnik.py`), lists the day's trades
  with no setup or grade, or not yet confirmed by the TopstepX export — the same rule, on the same
  Topstep day (17:00 → 17:00 CT), as the "Bez pregleda" card on `/daily` (`review-gaps.ts`).

The vault link is the swing-era one: HTF Bias records the vault's direction call **at the moment of
entry**, and the instrument watchlist used to follow its `instrument_registry`. (`macro_align` /
`cot_filter` are no longer seeded; add them back as your own categories under Settings if you want
them on the trade.)

The thesis: **P&L is the consequence, process is the cause.** So the daily rating measures progress
on the active process goal, never earnings, and the analytics decompose the result along dimensions
that are actually under your control.

### A trading day

The routine both repos are built around — the same five steps as "Dnevni tok journala" in the
`futures-trading` README:

| When | Where | What |
|---|---|---|
| Before the session | `/daily` → 1 · Pre sesije | The brief's red windows, the Topstep close, the expected range and, today, the DLL left; then two questions — how you are, and whether you trade today |
| Before and during the trade | TopstepX | Only a limit with an OCO bracket; contracts from the brief's "Ugovori danas". Nothing in the journal |
| Right after the close | `/trades/log` | Four numbers (entry, stop, exit, contracts), setup, A/B/C, the mistake if not an A; a sentence and a chart optional. About a minute |
| End of the day | `/import` | One TopstepX CSV: the trades logged by hand are recognised (entry ±0.05 %, ±10 min) and get the exact fills; the answers stay. MAE/MFE arrives on its own — provisional the same evening, exact the next morning |
| 15:20 CT (22:20 Belgrade) | Telegram | A reminder if one of today's trades has no setup or grade, or was not confirmed by the CSV. The setup-and-grade half is the same rule as "Bez pregleda" on `/daily`, on the same Topstep day |
| Weekend | `/weekly` → Napredak | Setups, the cost of each mistake, A against B/C, hour of entry, MAE/MFE, trade number in the day |

A limit placed well before price reaches it can still be written plan-first on `/trades/new`; the
export then finds the plan it filled (§ Recognising a trade you already typed).

---

## Running it

Needs Node 20.9+ (Next.js 16's own requirement) and a Supabase project.

```bash
npm install
cp .env.example .env.local   # then fill in the two values below
npm run dev
```

Two environment variables, both public by design — the anon key is safe in a browser because every
table is protected by a row-level security policy, not by the key being secret:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build — 18 routes (17 pages + `/_not-found`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run scan` | Bytes, not meaning: NUL bytes, invalid JSON, `.only`/`.skip`, `console.log`, conflict markers |
| `npm run schema:check` | The base-table record (`supabase/schema/`) against the generated types |
| `npm run lint` | ESLint. **Expects zero problems and zero warnings** |
| `npm test` | Vitest — 2,871 tests across 182 files, in two projects (`lib` on node, `components` on jsdom) |
| `npm test -- --coverage` | Coverage report |
| `npm run dead` | knip: dead files, exports and dependencies |

**The lint threshold is zero, and it did not used to be.** `journal-grid.tsx` reported *"Compilation
Skipped: Use of incompatible library"* — the React Compiler cannot memoize a component that uses
`useReactTable` from TanStack Table. The message is correct and permanent, so it is **silenced at
the site, with the reason written down**, rather than tolerated as "exactly 1" in a CI file nobody
reads until it breaks. The exception now sits next to the code it is about.

### CI

`.github/workflows/gate.yml` runs **seven** checks on every push to `main` and every pull request,
ordered cheapest to most expensive: `typecheck` → `scan` → `schema:check` → `test --coverage` →
`lint` → `build` → `dead`. Until round 4 the gate existed only as an agreement — it ran before
commits because that was the agreement — and an agreement cannot fail a pull request. The runner is
on Node 22.

One step needs more than a single command, because the tool by itself enforces nothing:

- **lint** — ESLint exits 0 even on warnings, so the output is MEASURED. The threshold is **zero
  problems**; the one known exception (React Compiler over TanStack Table) is silenced in the file
  itself.

`knip` is at **zero for all three finding types** — dead file, dead dependency and unused export. It
used to tolerate 22 exports (re-exports from `shadcn/ui` that nothing imports); they were deleted,
because a list that always has 22 entries is a list people stop reading — and that is how the 23rd
slipped through.

The build needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as **repo variables**
(Settings → Secrets and variables → Actions → Variables), not secrets — both are public by design,
since the anon key on its own grants access to no row behind RLS. When they are not set, the step
says so in a sentence instead of failing on an unreadable error out of Next.

### Stack

Next.js 16.2.9 (App Router, Server Components, Server Actions — **no REST route handlers**),
React 19.2.4, TypeScript 5, Tailwind 4, shadcn/ui, TanStack Table 8, Recharts 3, Zod 4, Supabase
(PostgREST + RLS), Vitest 4.

---

## Speed

A click has to feel instant. On 19.09.2026 it did not, and the cause was measured before anything
changed:

- **The server and the database were on two continents.** Supabase is in Frankfurt (eu-central-1).
  Vercel ran the server code in Ashburn, Virginia: every server request in the Supabase edge logs came
  from `cf.colo = IAD`. A round trip averaged ~200 ms, and a page makes 6–19 of them.
  **`vercel.json` pins the functions to `fra1`**, next to the database.
- **Nothing was kept between clicks.** Every page reads the session, so Next treats it as dynamic,
  and its default keeps a dynamic page for 0 s. **`next.config.ts` keeps it 30 s**
  (`staleTimes.dynamic`), so going back to a page is served from memory. A server action that
  revalidates clears it, so an edit never shows stale.
- **The page starts loading on hover.** The menu's links (`NavLink`) switch to a full prefetch when the
  pointer or focus arrives, so the server render runs between pointing and clicking.
- **One batch of reads per page.** Reads that waited on each other without needing to are started
  together:
  - the rule answers on `/journal`, `/reports` and `/playbooks`;
  - the accounts on the dashboard, `/daily` and `/weekly`, where only the day or week waits on them;
  - the accounts and their trade counts on `/settings`;
  - the notebook's purge of expired notes.
- **The shared reads are memoized per request** (React `cache`), so a page and its helpers asking for
  the same thing share one read: `getAccounts`, `getTradesWithStats`, `getFillCounts`, `getCashEvents`,
  `getListsWithItems` and `getPositionRules`. `tj_position_rules` is now drained once per render
  everywhere, including `/playbooks`, which read it twice.
- **No second render after an action.** Saving a trade and ticking a check-in rule no longer call
  `router.refresh()` on top of the action's own revalidation.
- **A scan that only one tab shows is not on the page.** The "Used" count beside every tag reads the
  tag columns of every trade. It used to run on each `/settings` load, so opening Accounts to rename
  one waited for a tally of the whole book; it is now a server action the Tags table calls when it is
  first opened (`getTagUsage`), and the rows paint before it answers.
- **Report filters and the Settings tab stay in the browser.** Both are written to the URL with
  `history.replaceState` instead of a server navigation that re-read the whole book.

## Data model

28 tables and 1 view, all prefixed `tj_`. **Row-level security is enabled on all 28 tables**, every
policy following the same ownership pattern:

```sql
CREATE POLICY ... FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()));
```

### A trade is not one row

The central decision. A position is a parent row plus its fills:

```
tj_positions  ──1:N──▶  tj_executions        entries and exits, each with its own price,
     │                                        quantity, time and commission
     └──────────────▶  tj_position_stats     VIEW deriving average entry/exit, gross,
                                              net, R, duration — never written twice
```

Scaling in, scaling out and partial closes become ordinary data instead of special cases, and no
derived number is ever written into a column where it could go stale.

`tj_position_stats` carries `security_invoker = on`, so it is filtered by the RLS of whoever asks,
not of whoever owns the view. It also has a **TypeScript twin**, `src/lib/journal/position-stats.ts`,
which has to compute the same thing — SQL is what the application reads, TypeScript is what the form
shows before saving. A test holds both to the same inputs.

### Tables

| Group | Tables |
|---|---|
| **Trades** | `tj_positions`, `tj_executions`, `tj_trade_images` |
| **Accounts and money** | `tj_accounts`, `tj_cash_events`, `tj_instruments` |
| **Configuration** | `tj_option_lists`, `tj_option_items`, `tj_field_defs`, `tj_user_prefs`, `tj_dashboard_templates` |
| **Daily process** | `tj_daily_reports`, `tj_focus_goals`, `tj_session_briefs` (the morning brief, F4) |
| **Weekly process** | `tj_weekly_reviews`, `tj_experiments` |
| **Tracker** | `tj_tracker_rules`, `tj_tracker_checkins` |
| **Playbooks** | `tj_playbooks`, `tj_playbook_sections`, `tj_playbook_rules`, `tj_playbook_rule_links`, `tj_position_rules` |
| **Notebook** | `tj_notes`, `tj_note_folders`, `tj_note_tags` |
| **Import** | `tj_import_batches`, `tj_import_rows` |

### User-defined fields

`tj_field_defs` allows adding a field without a migration. Values go into `tj_positions.custom`
(jsonb) instead of a new column, and every such field automatically becomes a dimension a report can
group by. Real columns stay real columns — `src/lib/journal/trade-fields.ts` splits the submission
between the two.

A jsonb write replaces the whole document, so an edit merges over the previous contents rather than
assigning them. Otherwise every field the form did not draw — including one deactivated last month —
would be erased by an unrelated save.

---

## Routes

On desktop the **menu hides off the left edge** and slides in over the page when the pointer reaches
that edge, or when keyboard focus lands in it. It slides away when the pointer leaves, so the page
keeps the full width. The pin in the menu's header keeps it open in the layout instead, remembered per
browser (`sidebar-prefs.ts`). On a phone the menu is the top bar's dropdown, as before.

| Route | What it is |
|---|---|
| `/` | Dashboard: a **Topstep banner** per Topstep account (room above the MLL, DLL left today, best day against the 55 % line, the target) then KPIs, equity curve, drawdown, heatmap calendars, breakdowns, the Process · Survival · Edge card, insights. Opens on **All** — the whole record first, narrowed on request; the scope last chosen is remembered per browser. Whenever the period leaves closed trades out, a notice above the figures says how many and how far back, with **Show all** (`default-period.ts`) |
| `/journal` | Trade table — sorting, filtering, column picking. The date column carries the **year**, so a trade from last season does not read as this spring |
| `/trades/new`, `/trades/[id]/edit` | Trade form: plan, fills, playbook checklist, psychology, images — each chart slot (and Log Trade's exit chart) takes an **uploaded screenshot, an image pasted from the clipboard or a TradingView link** (K6, `chart-image-input.tsx`): an image goes to the private `trade-images` bucket under the user's own folder and is stored as `storage:<uid>/<file>` in `tj_trade_images.image_url`, shown through a one-hour signed URL; the CHECK ties the folder to the row's user (`20260929220000`). In the **order of the decisions**: account, instrument, then the playbook and its checklist, and only then the prices and the risk. **There is no phase control**: planned or active is what the fills say — an entry fill means you are in the trade — so a select that could disagree with the record is gone, and so is "Move to active". The one lifecycle fact the fills cannot know, a MISSED plan, keeps its button. The instrument is **typed, not scrolled** — `instrument-select.tsx` filters the catalog on symbol, name and asset class. On a **Topstep account** the size is whole contracts: risk by the account's rule (§ Topstep), contracts rounded down with the round-turn commission counted and capped at the plan, stop and target in ticks for the TopstepX bracket — "2 MNQ · $202.44 at the stop incl. commission (stop 200 ticks)" — with the mini or micro alternative and a warning when the count is zero, capped, or three stops no longer fit today's DLL. This is the **plan-first** form, for a limit written well before price gets there; the everyday way in is `/trades/log` |
| `/trades/log` | **Log Trade**, the sidebar's primary action: a trade logged **after it is flat**. Four numbers off the platform — contracts, entry, stop, exit (target optional) — with "N min ago" chips for the entry time; then the setup (playbook), **A / B / C** on execution (stored as `execution_rating` 5 / 3 / 1), what went wrong only on B or C ("No mistake" recorded on an A), emotions, one sentence (`trade_journal_notes`) and the exit chart. The exit reason is read off the prices — stop, target, breakeven or closed early — and written only when the trader's own Exit Reason list has that item (`quick-log.ts`). The numbers may be rough: the day's TopstepX export matches the trade (entry within 0.05 %, entry time within ten minutes) and replaces the fills, and the answers stay |
| `/trades/[id]/review` | The same setup / A-B-C / mistake / sentence review for a trade that arrived only through the export. One UPDATE of the review columns (`saveTradeReview`), never `tj_save_trade`, which rewrites fills and rule answers on every save |
| `/daily` | **The day in the order it is lived**, in three numbered parts under the day's heading and its streak (`daily-report-form.tsx`). **1 · Pre sesije**: the morning brief ("Pred sesiju", `tj_session_briefs`, `session-brief-card.tsx` — the Topstep close on the account's clock, "berza zatvorena" when the brief says so, the red windows, the expected NQ / ES range and, on today's page only, the DLL left on the primary Topstep account; without a brief it says so and shows the ordinary 15:10 CT close, and a window it cannot read is dropped and counted, never guessed), the focus goal, then **"Pre nego što uđeš"** — two questions, numbered and about the day ahead: *1. Kako si danas?* (mental state, 5 stars, a warning under 3) and *2. Da li danas trguješ?* ("Danas ne trgujem", a decision taken before the session) — and the preparation rules. **2 · Tokom sesije**: the trading rules, scored from the trades and the brief. **3 · Posle sesije**: **Bez pregleda** (the day's closed trades still missing a setup or an A/B/C grade, each a link to its review, `review-gaps.ts`; the 15:20 CT Telegram reminder in `futures-trading` applies the same rule), the day's result, the review rules, then save and lock. Until 29.09.2026 the page opened with the day's money and asked "before you enter" only after the trading rules, with a no-trade box in the past tense that pointed at a position card H1 had removed. The rules are grouped as "Pravila pripreme / trgovanja / osvrta" here, in the page's language, and within each group **the rules to tick come first and the scored ones below** (K1) — a new rule lands in its own half whatever its order; Settings edits them under the English stage names. The day is complete once a focus goal is active |
| `/calendar` | Monthly P&L grid by day, weekly totals |
| `/weekly` | Weekly review: week rating, five questions, the week's figures split into money and process (`week-recap.ts`), last week's commitment with the answer to whether it held, and an account filter that refuses to sum two currencies. Unsaved answers are kept per week in the browser (`weekly-draft.ts`) and offered back; leaving a week with unsaved text asks first. **Napredak** (`progress.ts`) is the weekend review in six answers, each beside last week: R per setup, what each mistake cost, A against B/C, hour of entry, MAE of winners / MFE of losers / share of the move kept, and trade number in the day plus the trade after a loss |
| `/playbooks` | Every setup as one table: Trades / Net P&L / Win Rate / Missed / Expectancy per row |
| `/playbooks/[id]` | One playbook: identity, Stats, Rules (section and rule editor), Trades, Notes |
| `/reports` | How each group of trades did — by setup, instrument, day or any tag (§ Reports) |
| `/tracker` | Redirects to `/daily` (kept because the tracker used to live here) |
| `/notebook` | Notes, folders, tags, markdown |
| `/import` | CSV import wizard, batch history, undo |
| `/settings` | Five tabs: Categories (option lists + custom fields, one action creates both; the seeded tags are Serbian since K2, `20260929200000`, which rewrote the trades that carried them), Tracker, Instruments (the six futures, each with its contract spec AND what it costs — commission per contract per side, or as a share of notional; a future carries no swap), Accounts (a compact list; each account is created, edited, duplicated, archived or deleted from its own dialog — currency locked once it has trades, the **timezone** shown, not typed: every time is in Europe/Belgrade (`DEFAULT_TZ`, K5, `20260929210000`), a file with its own offset is converted on import, and a Topstep account still counts its days by 17:00 CT; the **breakeven range** shown, not typed (§ Metrics, K4), and **Topstep rules (futures)** — plan 50K / 100K / 150K, first payout, reset, the risk rule), Deposits / withdrawals (the starting balance shown as the read-only first entry, dates in the account's zone, net flow per currency, delete with a confirmation). An archived account keeps its trades and still appears in filters, marked "(archived)", but is no longer offered for new trades, imports or deposits. Account deletion and reset live under Accounts. **The open tab is in the URL** (`?tab=accounts`, and `&sub=tags` under Categories), written with `history.replaceState`, so a reload or a shared link lands where it left off |
| `/login` | Supabase auth |

---

## Reports

One page, one question: **how did each group of trades do?** Top to bottom:

1. **The book.**
   - All accounts or one (`scope.ts`), the dates, Net or Gross, `$` or `%`, and an eye that hides every
     amount. The Live / Backtest / All switch left with the backtest kind in H2.
   - Everything pooled across accounts (currency, % base, breakeven band) is taken over the accounts in
     scope only.
2. **The question.** Group by any dimension, the table's columns, the minimum trades a group needs to
   be ranked, and filters. A filter is built in the panel and added only once it constrains
   something, and number bounds accept `-1.5`.
3. **The book as a whole.** Six headline figures, then the risk and execution figures in a quieter
   row: total R, avg risk taken, risk dispersion, follow rate, target attainment, avg entry slip,
   avg hold. Sharpe, Sortino, Calmar and recovery factor **left that row in Phase E** — they are
   annualised ratios on what was then a swing book of forty to seventy trades a year, with `periodsPerYear`
   measured from the data, so they compare with nothing published anywhere. They stay in the
   registry as optional columns.
4. **Best, worst and most traded group**, ranked on the column the table is sorted by. It needs two
   groups at the threshold before it ranks anything.
5. **A bar chart of one metric.** It is formatted like the table, so Privacy and `%` apply to its axis
   too. A group with no value has no bar, and an infinite profit factor stays out of the axis range.
6. **The table.** Every group with its trade count; a header click sorts, and a second click reverses.
   A **Total** row appears whenever every trade sits in exactly one row. Thin groups are dimmed, not
   hidden, and that is explained once.

**"—" is not 0.** A win rate over breakeven scratches only, or R figures over trades without a stop,
read "—" in a report and sort last. They used to read 0, and that fake zero could be named the best
group. The dashboard keeps its own contract (a 0 with the count beside it).

The state lives in the URL, written with `history.replaceState`, so a report can be bookmarked and
no control goes back to the server.

### Compare mode

**Compare** runs the same report over a second filter set and states the gap. The two sets share the
grouping, the columns, the P&L basis, the unit and the sample threshold — two sets that differ in
their basis are not comparable, and a difference between a net figure and a gross one is not a
difference in trading. Only the filters and the dates are doubled, under their own URL keys (`f2`,
`from2`, `to2`), so a compared report is still one bookmarkable link and a link written before
compare mode existed still reads as set A.

The table shows three columns per metric — A, B and **B − A** — and the delta carries its own 95 %
interval: Newcombe's method for a difference of two rates (built from the same two Wilson intervals
the cells already show), a two-sample percentile bootstrap for expectancy and profit factor. **The
delta is dimmed whenever that interval still includes zero**, which on a small book is most of the
time, and is the honest answer. A day trader reaches the same sample in weeks rather than a year, so
the dimming lifts sooner; the rule itself does not change.

Two things it says out loud rather than leaving to the reader: how many trades the two sets have in
common — "Grade A" against "all trades" is not two independent samples, and every interval assumes
it is — and that a bucket only one set traded shows an em dash rather than a fall to zero. Leaving
compare mode deletes set B from the URL: a hidden filter that still constrains the report is one
nobody can read back.

An earlier compare mode was removed on 19.09.2026 because it lost trades from its totals. This one
joins the two reports on the bucket with a full outer join and sorts once, over the joined rows —
two lists sorted separately and zipped is how a bucket's A row ends up beside another bucket's B row.

**Removed on purpose (19.09.2026):**
- the R / Points / Ticks / Pips units, which a cross-instrument report can never show;
- the line chart over categories;
- the cross-analysis pivot.

## Metrics

37 metrics in a single registry (`src/lib/journal/reports/metrics.ts`), 21 built-in dimensions across
four groups (9 off the trade, 9 derived, 2 process, 1 insight) plus one per custom field. Any
metric runs against any dimension — which is why there is one report engine instead of ten report
pages. The tables below list all 37.

**Three of them carry a confidence interval, and the other thirty-four do not.**
A win rate, an expectancy and a profit factor are a rate, a mean and a ratio of sums — the figures a
reader mistakes for facts. The rest are counts and sums, which are exactly what they say. The
interval is **Wilson** for the rate (closed form, and it cannot produce a bound below 0 or above 100
on the small samples this book has) and a **percentile bootstrap** for the other two, seeded from the
data so the same row always yields the same bounds (`src/lib/journal/uncertainty.ts`).

Its sample is the statistic's own, not the row's: a win rate over forty trades can be decided by
twelve, because breakeven stays out of that denominator. When the two differ the cell says so on
hover. A figure whose interval still contains its **neutral** value — 0 for a mean, 50 for a rate,
**1** for a ratio — is dimmed: that sample cannot tell which side of neutral the truth is on.

**Ranking is sceptical.** Best and worst are chosen on the conservative end of the interval, so a
three-trade bucket at 100 % does not beat an eighty-trade one at 60 %. The cell still shows the point
estimate; only the ranking distrusts it. The minimum-sample control no longer hides or dims rows — it
sets the floor below which a group cannot be ranked at all.

**A registry is a registry, not a second implementation.** Every entry delegates to a function that
already exists and is already tested elsewhere. A metric that computed something inside itself would
drift from the module computing the same thing.

### Money and counting

| Metric | Formula | Note |
|---|---|---|
| Net P&L | `Σ (gross − commissions)` | Dated by the **close** day, in the account's timezone |
| Gross P&L | `Σ (exit − entry) × qty × point_value × direction` | |
| Trades | Closed trades in scope | |
| Win rate | `wins / (wins + losses) × 100` | **Breakeven trades are out of the denominator** |
| Avg win / Avg loss | Average winning and losing money, separately | |
| Avg win/loss | `avg win / \|avg loss\|` | A money ratio, not R. A report column only — it left the dashboard with the composite in Phase E |
| Profit factor | `gross profit / gross loss` | `Infinity` when there is no loss — a real maximum, not missing data. `null` only when there is nothing to divide |
| Expectancy | `winRate × avgWinR + (1 − winRate) × avgLossR` | Computed over the R population only — only a trade with a stop has an R |
| Best / worst | Largest and smallest single net result | |
| Breakeven | Trades inside the account's breakeven band | On a Topstep account the band is **fixed** (K4): ±0.1R of the plan's starting risk budget (12.5 % of the room above the MLL) — ±$25 on a 50K, ±$38 on a 100K, ±$56 on a 150K (`topstepBreakevenBand`). Settings shows it and offers nothing to type |
| **R (everywhere)** | `gross points / (risk in points × entry qty)` | **R is always GROSS**, and does not follow the net/gross toggle — that toggle moves money only |

**Why R is gross while money can be net.** They are deliberately two different questions. R measures
the **setup**: did price go where the plan said, relative to the risk taken. Commission is not a
property of the setup but the cost of trading it — hence the net/gross toggle over money. A future
carries no swap: the cost is the round-turn commission alone. The `Swap` metric, the
swap-per-holding-day figure and the `swap_ate_the_trade` insight left in H1, and swap itself — the
fill column, the instrument rates, the term in net P&L — in H2 (`20260929160000`).

A consequence worth knowing while reading the screen: **a trade can be a loss in money and positive
in R.** A one-tick scratch on two MNQ is positive in R and negative in money once the commission is
paid. That
is not an inconsistency but two correct answers to two questions: the setup did its job, the holding
did not pay. `tj_position_stats` also computes `realized_r_net` in case a net R is ever needed, but
no screen reads it on purpose — one R per book, so that two do not start to drift.

**The breakeven band** is per account (`breakeven_from`, `breakeven_to`, in currency or percent). A
±$20 scratch is neither a win nor a loss, and it is dropped from the win rate instead of being
counted as a loss — which would understate a book full of scratches by several points.

**"All accounts" does not add different currencies.** €500 and $300 are not $800. When the accounts
in scope have no common currency, the dashboard, `/reports` and "Export for Claude" refuse to
compute a pooled money figure — the whole money half of the screen is replaced by a warning instead
of quietly showing a number in the wrong unit. Accounts sharing a currency still add up normally.

### Risk

| Metric | Formula | Note |
|---|---|---|
| Max drawdown | Deepest peak-to-trough fall of cumulative P&L | In money, within the group |
| Avg daily DD | Average intraday fall from that day's high | A day with no fall enters as 0 |
| Recovery factor | `profit / max drawdown` | Both on the selected net or gross basis. `null` while the curve has never fallen |
| Sharpe | `mean daily P&L / σ × √periodsPerYear` | |
| Sortino | The same, but the numerator only looks at falls below zero — the denominator still counts **every** day, not just losing ones | `null` when no day was negative — growth is not risk |
| Calmar | `annualised return / max drawdown` | Recovery factor divided by the time it took |
| Consistency | `100 − cv × 20`, where `cv = σ / \|mean\|` | 0 for a losing book |
| Avg MAE in R | Average of how far trades went against the position | Averaged only over trades that *have* an MAE |
| Longest drawdown | Days from the peak that started the deepest-or-longest fall to the peak that ended it | Counted on calendar day keys in the account's zone, so it is days lived through, not 24-hour blocks |
| Under water now | Days since the last equity peak | 0 at a new peak; a fall that never recovered keeps counting |
| Avg risk taken | Mean of `riskPctTaken` over the group | The stop distance at the size filled, over the equity the entry day opened with. `null` for a trade with no stop, an unpriced instrument or an unknown entry-day equity — never 0 |
| Max risk taken | The largest of the same | The single biggest bet in the group |
| Risk dispersion | Population σ of `riskPctTaken` | The sizing-discipline number. `null` under two trades: one trade has no spread |

**Planned reward is WEIGHTED when the exit is scaled.** Entry-to-target is the whole plan only when
the entire position leaves at one price. Take 30 % at 1R, 30 % at 2R and the rest at 3R and the plan
is worth `0.3×1 + 0.3×2 + 0.4×3 = 2.1R`, not 3R. Since that number is the **denominator** of Target
attainment, overstating it arrives as a low result — the metric would punish you precisely for
scaling out. The nearest rung is the same error mirrored (1R, and an inflated result); no single
rung answers the question, only the weighted plan does. `blendedPlannedRewardR` is one function for
both shapes: with no rungs it IS entry-to-target. Nothing about this depends on where the ladder came
from — a hand-typed scale-out has the same arithmetic and the same wrong answer without weighting.

**The annualisation factor is measured, not assumed.** `periodsPerYear = (trading days × 365) /
calendar days spanned` — derived from the data instead of hardcoded at 252. A swing trader with 40
trading days over 300 calendar days gets their own factor; a hardcoded 252 would inflate every
ratio. All three ratios return `null` below `MIN_RATIO_DAYS` (5).

**Consistency measures against the mean, not the sum.** The first version divided σ by *total*
profit — and total profit grows with the number of trades while σ does not shrink, so the same
trading pattern read as more consistent after a year than after a month, with no actual change in
behaviour. `cv` (coefficient of variation, σ against the per-trade mean) does not depend on sample
size that way.

Two different drawdown denominators exist on purpose:

- **`maxPctOfEquity`** — against peak equity, including deposits and withdrawals. This is the number
  shown to a human, because a deposit genuinely changes what a given dollar of loss means.
- **`maxPctOfPeakPnl`** — against peak cumulative P&L, per TradeZella's formula, so the composite
  score stays comparable with theirs. **Never displayed.** It returns `null` — not `0` — when the
  curve fell from a peak that was never above zero, because a book that only lost has no profit peak
  to express the fall against.

### The plan is sealed at entry

Every figure in the next table compares a trade against its plan, and the plan used to be editable
forever with no history. It is now **sealed**: on the save that first gives a trade fills,
`tj_positions.plan_snapshot` captures `entry_price`, `stop_price`, `target_price`, `time_stop`,
`thesis`, `invalidation` and `scale_out_levels` as they stood, with
`plan_sealed_at`. Written once, never overwritten, cleared if the last fill is removed.

A snapshot rather than a lock, on purpose. A lock only moves the edit to "unlock, then change" while
blocking the honest correction of a typo; the snapshot makes the correction harmless instead. The
measurements read the seal — slippage, target attainment, R (its denominator is the planned stop
distance, via `tj_sealed_num` in the stats view), and the `thesis_written` / `stop_loss_set` tracker
rules — the live fields stay editable, and the first edit after the seal stamps `plan_amended_at`,
which the trade form and the journal grid both show.

Trades written before this migration have no seal, and readers fall back to their live columns:
history has no seal and must not pretend to one.

### Costs, plan and execution

| Metric | Formula |
|---|---|
| Total commissions | Sums over fills (a future carries no swap) |
| Cost % of gross | `costs / gross profit of winners × 100` |
| Avg planned R | Average planned reward, over trades that have one |
| Planned vs realized R | `avg realized R − avg planned R`, over the **same** trades |
| Target attainment | Realized R as a percentage of planned reward |
| Winner target attainment | The same, **winners only** — how much of the plan was taken before exiting early |
| Avg entry slip | Planned entry against average fill, in R against the planned stop. Negative means the fill was worse than planned |
| Total slip R | Every R given up to entry slippage in the period, added together |
| Setup score | Share of setup criteria met (§ The setup grade is derived) |
| Avg hold | Average holding time in seconds, shown as `44s` / `3m 44s` / `5h 20m`. The Hold duration dimension and the Hold-time card's "Average in minutes" use minute buckets: `<1m`, `1–5m`, `5–15m`, `15–60m`, `>60m` (F5.1, L2). The report filter is `Duration (minutes)` |
| Follow rate | Playbook rules kept / **answered** rules × 100 |

`follow_rate` is the only metric whose meaning depends on which bucket it is in: on a per-rule report
it counts answers to *that* rule. The engine passes the bucket to every metric so this stays generic
and no dimension key becomes a special case.

### Attributing to days

Get this wrong and nothing breaks — the numbers simply file themselves under days you did not live.

- **Money is dated by the CLOSE day.** A swing opened Monday and closed Friday belongs to Friday,
  because that is when the money arrived.
- **Decisions are dated by the OPEN day.** "Did every trade have a stop?" is a question about the
  moment of entry. Under close-dating, a still-open trade is invisible to that rule, so ten unlinked
  open trades would report a perfect day.
- **Days are the ACCOUNT's**, resolved on the server. A `new Date()` read in the browser shifts the
  whole calendar by one column for anyone not sitting in the account's zone.
- **A Topstep account counts Topstep's trading day, 17:00 → 17:00 Chicago**; any other account counts
  the calendar day of its own zone. The rule comes from `topstep_mode` (`accountDayZone` in
  `time.ts`), not from a separate setting: a fill at 18:30 CT on Monday is Tuesday's, and the Sunday
  open is Monday's. One resolver (`accountDayZoneResolver`, a `DayZone` per account) dates every
  trade for the calendar, `/daily` and "Bez pregleda", the tracker verdicts and the equity ladder,
  `/weekly`, the dashboard, the reports and the day-level insights — the same day `topstep.ts` charges
  its Daily Loss Limit to (`topstepTradingDay`) and the 15:20 CT reminder in `futures-trading` counts, so
  the calendar and the banner's "DLL today" no longer disagree about an evening. In "All accounts"
  **every trade keeps its own account's rule**: a day must not change with the filter on the screen.
  The week is the week of that day (Sunday evening opens the new one), and the hour of entry is still
  read on the account's clock. Computed in Chicago, whatever the account's zone: Belgrade matches it
  most of the year and drifts by an hour in the weeks the two change clocks on different dates.
- **"Today" is the primary account's day** (`todayFor`): on a Topstep primary, after 17:00 CT it is
  already tomorrow, so `/daily` opens the session that has just started. Locked days keep the verdicts
  they were frozen with, and `equity_at_entry` is still the
  opening balance of the calendar day — a Topstep account's size is graded against its risk budget
  instead (§ Topstep).
- **ISO weekdays, 1 = Monday … 7 = Sunday.** Never `Date#getDay`.
- **Dates are written day-first, clocks are 24-hour**: `18/09/2026 21:10`, or `18/09 21:10` in the
  import review, where every row is from one file. Three shapes, exported from
  `lib/journal/time.ts` (`DATE`, `DATE_TIME`, `DAY_TIME`), because "what does a date look like here"
  is one question — it used to have four answers, one of which was `MM/dd`. That one is not a style
  but a different date: `03/07` is 7 March to the reader and 3 July to the format that wrote it, and
  nothing on screen said which. `date-format-conformance.test.ts` fails the build on `MM/dd`, on a
  12-hour clock and on a month name, because one such call added later looks ordinary in a diff and
  the wrong date it prints looks ordinary on screen.
- **Machine-read dates stay ISO**: day keys (`yyyy-MM-dd`), `<input type="datetime-local">` values,
  and the CSV/XLSX export. An export that changes shape with a display preference breaks somebody's
  spreadsheet, and a sort in a spreadsheet needs `yyyy-MM-dd` to be a sort at all.
- **Native date pickers are the browser's**, not the journal's. `<input type="date">` and
  `datetime-local` render in the browser's or the operating system's locale, so on a machine set to
  US English those fields still show `MM/DD` and AM/PM while everything around them does not. Fixing
  that means replacing the inputs, which is a separate piece of work and is not done.

---

## Process · Survival · Edge

Three numbers that do not share a denominator, in place of one composite that did.

**What the Sickre Score was.** Seven weighted components — process adherence, max drawdown, profit
factor, consistency, prop-firm headroom, avg win/loss, recovery factor — blended into one 0–100
figure, with a radar, a coverage percentage and a folded component list under it. It was rebalanced
once and gated twice, and it still had the defect no reweighting can remove: **one number that moves
both when you trade differently and when the data behind it arrives is not a measurement.** A quiet
fortnight lowered it; answering more playbook rules raised it; the reader could not tell which. The
card's own structure — a headline that had to be unfolded before it could be read — was the
admission.

| Axis | Range | What it is |
|---|---|---|
| **Process** | 0–100 | 60 % tracker compliance + 40 % playbook follow rate. The only figure entirely yours to move, and the only one that means anything on a book with nothing closed |
| **Survival** | 0–100 | The mean of the parts that have data: `100 − max drawdown %` (over peak **equity**), `100 − days under water / 90`, and the room left against a prop-firm limit |
| **Edge** | R | Expectancy with its 95 % interval and its sample. **Not** a score |

**Edge is a measurement, deliberately.** Squeezing an interval onto a 0–100 band throws away exactly
what Phase B added. "0.32R, and the interval still includes zero" is the honest sentence, and on
a small book the card says it for a long time. It is dimmed while that holds, the
same rule the reports table applies to a cell.

**Consistency, avg win/loss and recovery factor left the screen entirely.** Each was a ratio whose
band table came from a spec written for an intraday book, and none answers a question the three axes
do not answer better. All three remain as `/reports` columns.

**The evidence gates survive, because the bug they prevent has not gone anywhere.** Three separate
fixes in round 3 were all the same error at different depths:

1. Drawdown answers `0` on an empty book — honest as a *statistic* — and `100 − 0 = 100` turned
   "never traded" into flawless risk management.
2. A single winning trade scored **100/100**: infinite profit factor, zero drawdown because there
   was nothing to fall from, zero variance over one sample. Maxima all the way down, every one an
   artifact of n=1.
3. A book of six consecutive losses scored **100 for risk management**, because the drawdown
   percentage had no positive peak to divide by and returned `0`.

So: below 5 closed trades the two trade-derived parts of Survival are withheld, and Edge is withheld
below 5 *decided* trades — its own denominator, because a book of breakeven scratches has a path to
measure and no decisions it could have won. Below 30 closed trades the numbers are shown **with**
the sample, labelled provisional: hiding them for weeks is dishonest in the other direction.
Prop-firm headroom ("Prop-firm room" on the card, `propHeadroomPct`) is ungated — `evaluateTopstep`
answers `null` for an account with nothing closed in its window, so the evidence rides with the
producer. It is the **smallest room ever left above the trailing MLL, as a share of the plan's MLL**,
after every close and every overnight trail — the closest the account came to ending. The worst
Topstep account counts.

**Phase E found the third bug still alive on the equity base.** `maxPctOfEquity` answered `0` when a
fall had no positive peak equity to divide by — an account with no starting balance that never got
above water — and the new Survival axis would have read that as a perfect 100. It answers `null` now,
exactly as `maxPctOfPeakPnl` already did, and `balance.test.ts` pins both halves of the distinction:
a fall with no denominator is not a book that never fell.

**Survival, the axis, and "Survival simulation", the card, are different questions** and no longer
share a title. One says where the account stands; the other resamples the book forward sixty trading
days (§ Survival).

---

## A section belongs to the PLAYBOOK, not to the account

`tj_playbook_rules.category` used to carry `CHECK IN ('context','entry','management','exit',
'no_trade')`, and the card drew all five sections whether or not the book used them. That was
somebody else's taxonomy: a trader whose method is "these are the conditions to enter, these to
exit, and one rule for risk" gets three headings they wrote and two they did not, permanently empty.
An empty section then stops being a reminder and becomes a form that does not fit.

The first fix turned a section into an option list (`rule_category`) per **account**. It fixed the
taxonomy and left three complaints, all three from one root — a section and a rule's link to it were
**global**:

- a new playbook drew every section the account had, empty or not;
- a section could not be deleted because a rule from **another** book sat under the same name;
- the same rule had to live in the same section in every book.

**A section is now a row in `tj_playbook_sections`, tied to one playbook** (migration
`20260824100000`). The link model was already right — a rule is a library entry with one `id`, the
link is its own row, `sort_order` lives on the link so the same rule can be third in one book and
first in another. It was missing two columns, and both moved onto `tj_playbook_rule_links`:

| What | Where it lives now | Why |
|---|---|---|
| link to the section | `tj_playbook_rule_links.section_id` (uuid) | a section is a property of the book |
| `is_setup_criterion` | `tj_playbook_rule_links` | which rule grades the setup is also a property of the book — `criteriaByPlaybook` in `rule-lookup.ts` already computed it per book, it was just deriving it from a global flag |
| `show_when` | **stays on the rule** | answers (`tj_position_rules`) hang off `rule_id`, and `show_when` decides the follow rate's denominator. Per book, the same rule would have two denominators over one set of answers |

**There is no stable `value` any more, and that is the point.** The link points at a `section_id`, so
renaming a section is free and touches no rule — previously a rename was allowed to change only
`label`, precisely because rewriting `value` would have been an UPDATE across every rule of every
playbook, and any row missed would have dropped out of its section.

**It is edited on the playbook's page, not in Settings.** A trader writing a playbook should not have
to leave it, find the right dropdown in settings, add a value and come back. The actions are
`addPlaybookSection`, `updatePlaybookSection`, `deletePlaybookSection`, `movePlaybookSection` and
`reorderPlaybookSections`, with `moveRuleToSection` and `setRuleCriterion` for the rules. A new book
**starts empty** — you get sections by writing them.

**Deleting a section never refuses.** `ON DELETE CASCADE` on `section_id` removes the **links**, not
the rules: every rule stays in the library with every answer it ever collected, and every other
playbook linking it is untouched. Deleting a section is an unlink of several rules at once, and
unlinking has never been destructive here. The caution belongs in the sentence the trader reads
before confirming — naming the rules the card is already showing — not in a refusal they cannot act
on.

**Two headings with the same name in one book are forbidden in the database**, by a unique index over
`(playbook_id, lower(btrim(label)))`: "Entry" and "entry " differ only to a machine, and would draw
two cards over one question.

---

## A playbook is a page, not a card in a scroll

Ten playbooks used to mean ten expanded cards on one screen — each with a full rule editor — so even
finding one name meant scrolling past nine others. The first fix collapsed the card into a table row
with expand/collapse controls. The second removed the question: **every setup now has its own page.**

- `/playbooks` is only the index — a table with "Trades / Net P&L / Win Rate / Missed / Expectancy"
  per row.
- `/playbooks/[id]` is one playbook, in tabs: **Stats**, **Rules** (the section and rule editor),
  **Trades** (the same `JournalGrid` as `/journal`, narrowed to that book) and **Notes**.

That is why `tj_user_prefs.playbooks_expanded` no longer exists — dropped by migration
`20260824110000`, since nobody read or wrote it once expansion stopped being a state of the screen.

**The Missed column cannot be read from the same `row` as the others.** `runReport` computes over
realized (closed) trades, and a missed trade never has a net P&L so it never enters that set. So it
is counted separately in `page.tsx`, over the raw rows before `toRealized`, grouped by `playbook_id`
(`stringFieldValue`) — and passed as a plain `Record<string, number>`, not a `Map`: that is the shape
every other prop across the server/client boundary in this application already uses (`OptionsMap`
among them).

**The list reads retired rules too** (`getPlaybooks({ includeDeleted: true })`). A rule taken off the
checklist still owns the observations it collected, and a page about evidence has to show them.

**`tj_position_rules` is drained once.** It is one row per rule per trade — the fastest-growing table
in the schema — so it is read once and handed to `getPlaybooks`, which derives the per-rule answer
counts from the same array. Reading it twice per render is the mistake `/reports` already had to fix.

**Creation goes through a dialog, not an inline input.** "+ Create Playbook" opens a `Dialog` with
Name + Description; there is no second step for rules the way TradeZella has one, because it would
duplicate the section editor the playbook's page already has. `addPlaybook` returns the new `id`, so
the dialog lands straight on that page.

---

## The setup grade is derived, not guessed

`setup_grade` used to be a typed letter (A+/A/B/C) — and **the one field that was wrong, not merely
slow**. It was filled in once the outcome was known, so a loser became a B and a winner an A+. It is
the dimension the dashboard decomposes by default, so the grade "explained" performance with a label
partly **derived from** performance. Circular, and invisible while it happens.

Everything needed to replace it already existed: the rule library, per-trade answers, `follow_rate`
and `ruleScorecard`. The only thing missing was a marker for **which rules define setup quality** —
`is_setup_criterion`, which since `20260824100000` lives on the **link**
(`tj_playbook_rule_links`), not on the rule: which rule grades the setup is a property of the book,
so the same rule may be a criterion in one and an ordinary reminder in another.

**The grade is the share of criteria met.** All → A+, ≥80 % → A, ≥60 % → B, below → C. A+ demands
all of them: the label means "this was the setup I was waiting for", and a setup missing one of its
own defining conditions is a different setup.

**"A criterion must be asked on every trade" is the substance, not decoration.** A criterion tied to
winners would be **hindsight by construction** — it would grade the setup with a question only asked
once the result is known. The database refuses that combination rather than trusting the UI not to
offer it.

While the flag sat on the rule, this was one `CHECK (is_setup_criterion = false OR show_when =
'always')`. Now that it sits on the link, the condition spans two tables and a `CHECK` cannot see it,
so **two triggers hold it, one from each side**: `tj_link_criterion_always` refuses to mark a link
whose rule is not `always`, and `tj_rule_show_when_vs_criterion` refuses to change `show_when` on a
rule that is a criterion somewhere. Same prohibition, same place — the database, not the UI.

**Nothing is graded until the checklist is fully answered**, and here it deliberately diverges from
`computeFollowRate`, which drops unanswered rules from both the numerator *and* the denominator.
That is correct for a *rate* and a hole for a *grade*: answer one criterion, meet it, and collect an
A+. So the count is against what the playbook **defines**, not against the answers that exist — an
unanswered rule has no row, so counting rows would read three of four criteria as three of three.

**What this does NOT solve:** it does not become objective. Ticking "MSS with displacement" is still
a judgement. What you get is decomposition (several small questions instead of one big one),
consistency, auditability — and the real prize, **testability**: `ruleScorecard` already measures win
rate when a rule was kept against when it was broken, so a criterion that predicts nothing can be
found and dropped. A letter can never do that, because it does not know *which* part of that "A+"
was doing the work.

**The `tj_positions.setup_grade` column is gone** (Phase E). It survived as a fallback under the
derived value, "carrying the history" of hand-graded trades — and once the book was emptied, the
fallback could only ever read NULL: a second source of truth with no rows in it. The three readers
that had it (`dimensions.ts`, `journal-grid.tsx`, `insights/process-rules.ts`) now derive or say
nothing, which is the honest pair of answers. A trade with no playbook, or an unfinished checklist,
has no grade — not a stale letter.

`conviction` went with it, for a blunter reason: it had no field in `form-config.ts`, so nothing in
the application could write it. No dimension read it, no rule read it, and `trade-input-schema` had
a test asserting it never reaches the database. A rating that cannot be given is not a rating.

---

## Ratings are clicked, in one unit

Four fields asked you to type what should be picked, across three different scales for the same kind
of question.

| Field | Was | Now |
|---|---|---|
| Time stop | free number, **no upper bound in the database** | five buttons 1–5 days; since F4 five chips **5m / 15m / 30m / 60m / Close** (`time_stop`, `CHECK` on the five) |
| Mental temperature | `Select` 1–10 | **5 stars** |
| Week rating | `A–F` | **5 stars** |
| Execution rating | 5 stars | unchanged |
| Conviction | 1–5, with no field to enter it | **dropped in Phase E** |

**Ten levels is a precision nobody has about their own head.** Asked every morning, it produces noise
that then feeds a report dimension and the `low_mental_temp_entry` rule as if it were signal. Five
stars is both faster and more honest, and it is now the only unit in which the journal asks for a
judgement at all — there used to be three.

**The existing value was TRANSLATED, not kept.** On a 1–10 scale a five is below average; on 1–5 the
same digit is the maximum. Keeping it would have inverted its meaning while leaving it looking
untouched. `ceil(old / 2)` preserves relative position — the middle of the old scale lands in the
middle of the new one. The first draft of that migration split the translation into three `UPDATE`s
by range and was wrong twice over: a nine would become 5 in the first pass and then be dropped to 3
by the second ("= 5"), while 2 and 3 were never touched by any pass. One `UPDATE` reads each row's
original value exactly once, so neither failure is even expressible.

**Time stop is not stars, and that is deliberate.** Stars are monotonic — three filled reads as "three
out of five of goodness". That is right for a rating and wrong for a quantity: "3 days" is neither
better nor worse than "5 days", it is a different number. So `NumberChoice` draws digits and colours
only the chosen one — and the day trade's time stop, `ChipChoice`, draws its five labels the same way.
It is stored as TEXT (`5`, `15`, `30`, `60`, `close`), not as an integer with a magic number for the
close: "held to the close" and "not recorded" are different answers, and NULL can only be one of them.
`time_stop_days`, the swing time stop, left the database in H2 (`20260929150000`).

**Clicking the selected value clears it.** With no path back to `null`, the first mis-click would
stay forever as a value nobody meant, and "not recorded" and "1" are different answers.

---

## Survival

**Portfolio heat** is the open risk of one account, as a percentage of that account's equity right
now (`portfolio-heat.ts`). Per account and never summed across them: 2 % of a €5,000 account plus 2 %
of a $100,000 one is not 4 % of anything. A half-closed position carries its REMAINING risk, and a
position with no stop is counted separately — "3 of 4 measured" — because treating an unmeasurable
position as zero would turn "I do not know" into "it is safe".

**The survival simulation** (`survival.ts`) is the only forward-looking figure in the application. It
replays the account's own daily results — as percentages of the equity each day opened with — a few
thousand times over the next sixty trading days, and counts how often the run hits a floor, breaks a
daily limit, reaches a target, or simply ends lower than it began.

Three things about it are deliberate. **Days, not trades**: a prop account's binding rule is a daily
loss limit, and a bad session is several trades rather than one. **Blocks, not single days**: drawing
one day at a time assumes today says nothing about tomorrow, and the run of losses that ends an
account is a correlated stretch; the trader chooses between single days and weeks, and the choice is
on the card because it changes the answer. **On an account without prop-firm rules the threshold is
the trader's own** — defaulting to the worst drawdown the book has already seen — so the card works
on any account. **A Topstep account is replayed in money**
(`simulateTopstepSurvival`): its own Topstep days, from its balance and floor as they stand now; the
floor trails every high close and locks at the starting balance, so a run that gives back what its
highs gained ends on it where a fixed percentage floor would not; a day that reaches the DLL is
counted and stops there, because Topstep liquidates at it; the floor ends the run; the target grows
with the best day (55 %). In "All accounts" the card simulates the primary account — one account's
floor, not a sum no floor applies to. It is seeded from the data, so the same book
always gets the same answer, and it states its assumptions beside the number: a probability with a
hidden assumption reads as a measurement.

**Held at the same time** (`co-exposure.ts`) answers whether three positions are really one. It gives
two numbers per pair, because the familiar one is the weaker: the OVERLAP is days both instruments
were open, which is a fact about exposure; the CORRELATION compares days on which both *closed*
something, which on a swing book is a much smaller set. The coefficient carries a Fisher-z interval
and is withheld entirely below five shared days. Both are counted in **days**, which suits positions
held for days and says little about NQ and ES held in the same ten minutes; the intraday version
(overlap in minutes, open contracts against the DLL) is `FAZA_F_DAYTRADING_PLAN.md` #17.

## Learning

Two things the journal used to record and never check.

### The weekly change gets an outcome

The weekly review asks for "one thing I am changing" and the next week asks whether it was kept. Both
answers are the trader's word about the trader's own behaviour; nothing asked the BOOK whether the
change did anything. **Experiment** (`tj_experiments`, `experiments.ts`) is that question: a Monday, a
sentence, and ONE metric that would move if the change worked.

The metric can only be win rate, profit factor or expectancy — the three that carry a confidence
interval. An experiment without one is an anecdote with a start date, and the table's CHECK enforces
that rather than leaving it to convention. "Before" is the four weeks before it started; "after" is
every week since, accumulating, keyed on the week a trade CLOSED in — a change to how trades are
managed shows up in how they end.

**The verdict is withheld while the interval of the difference still contains zero**, and on a small
book that is the usual answer. The card says "still don't know, n = …" rather than
naming a winner, and below five trades on either side it does not compare at all. What it does not
control is printed beside it every time: instrument, volatility, and the fact of being watched. The
self-reported "did I keep it" stays separate and labelled — one is a word about behaviour, the other
is a number out of the book.

### The missed setup gets a price

`status = 'missed'` and `miss_reason` have existed since the beginning and cost nothing, which made
hesitation the cheapest mistake to keep making. A price walk forward from the moment the plan was
written records what it would have met first: `missed_outcome`, `missed_r` (the planned reward, −1,
or 0) and `missed_source`. **It has no source today**: the walk ran over MT5 history
(`mt5_excursion.py --missed`), which went with MT5 (H1, 28.09.2026), and the futures walk over the R2
candles is still to be built (`FAZA_F_DAYTRADING_PLAN.md` #16). The panel says so.

The entry has to be reached first; a plan whose price never came reads as never triggered and cost
nothing. And **which came first is the whole question**, so a 1-minute bar holding both the target and
the stop is refused rather than guessed — a stopped-out plan written down as a winner would make the
figure worse than not having it. The database refuses the same pair independently: `stop` with a
positive `missed_r` violates a CHECK.

The `/reports` panel counts unmeasured misses separately instead of summing them as zero, and states
how many plans are still unresolved — until those are taken or marked missed, the figure measures how
tidily plans are filed rather than what hesitation cost.

Until then every miss is counted as unmeasured; the futures walk will run over the R2 candles in
`futures-trading`, to the end of the Topstep day rather than for days.

## Process tracking

**Tracker rules** are daily obligations, per weekday. **Eleven** are scored automatically from data —
max loss per trade and per day, every trade linked to a playbook, every trade has a stop, every
trade has a thesis written before entry, no entry risked more than the budget, every entry was the
contract count the budget gave, and the four day-trading rules below — and the rest are ticked by
hand. The money rules read the **Topstep plan only** (§ Topstep): a trade on any other account is not
graded by them (`no_topstep_trades`). The weekly loss rule and the percentage-of-equity limits left in
H2 (`20260929170000`) — Topstep has no weekly limit, and the book has no other account. The same
migration named the three rules still in English in Serbian.

**The day trader's four (F4, `20260929110000`).** Each is a decision taken at entry, so each is
charged to the Topstep day the trade was OPENED on:

| Rule | Fails when | Not scored (`na`) when |
|---|---|---|
| `max_trades_per_day` | an account has more than N entries that day; the entries past the N-th are named | no count set, or no entry |
| `stop_after_losses` | an entry follows N losses in a row on the same account that had CLOSED before it; a win or an exact scratch breaks the run | no count set, or a trade in the run has no price |
| `flat_by_close` | a Topstep position closed after that day's close, or is still open once the close has passed | the day had no Topstep trade, the brief says the exchange was closed, or a position is still open before the close |
| `no_entry_in_red_window` | an entry falls inside a red window of the day's brief, both edges included | the day has no brief |

**Counted per account**, as the Topstep limits are: two trades on each of two accounts is not four
trades. **N is a `count` config** (Settings → Tracker, a whole number from 1 to 20, the same bound as
the database CHECK); the migration set both at 2, the trader's own number. Until H2 the rule reader
kept only `pct` from a rule's config, so both counts read as unset and the two rules were never
scored; `parseConfig` in `tracker/queries.ts` now reads `count`. The close is the brief's
(`flat_by`: holiday, early close), else 15:10 CT — a default that can only be later than a holiday
close, so a missing brief can miss a breach but never invent one. The red windows are only the
brief's: there is no fixed fifteen minutes, and a day without a brief grades nothing rather than
guessing. The checklist says counts, a CT time and a window, never money.

The three manual rules these replaced — "at most two trades a day", "no entry fifteen minutes around
red news", "stop at the daily loss in USD" — were **retired, not deleted** (`deleted_at`), so every
past day they were live on keeps its score. "Walk Away Target" stays a manual rule.

**`thesis_written` grades only trades planned before their entry** — `created_at` no later than the
first fill (`plannedBeforeEntry` in `tracker/auto-rules.ts`): a plan-first trade, and a resting plan
the import later filled. A trade logged after the close (`/trades/log`) or created by the import had
no "before" in which a thesis could exist — its seal is stamped at the moment of writing — so it is
neither failed nor passed, and a day with only such trades is `na` with its own reason ("nijedan
trejd nije planiran pre ulaza"), not `pass`. The quick log's sentence goes to `trade_journal_notes`,
never to `thesis`: sealed as the reason before entry, a sentence written after the close would be
exactly the rationalisation the rule reads the seal to catch. Unlocked past days re-read under this
meaning (a CFD trade typed after its entry is now `na` there); locked days keep their frozen verdicts.
`risk_matched_intent` compares the contracts with the count the form would have given at entry
(§ Topstep).

**The two risk rules grade the SIZE, the loss rules grade the outcome**, and both are kept for that reason.
`max_loss_per_trade` reads the realized loss on the close day, so a trade sized at three times the
intended risk that ran to target is invisible to it and one closed early passes; `risk_per_trade`
reads the money at the stop against the budget the risk rule gave at entry, on the day the decision
was made. Rewriting the old rule instead of
adding a new one would have restated every locked day in the history under a meaning it was never
scored with.

Which rules applied on a given day is decided by comparing the day against the rule's `created_at`
and `deleted_at`; that is why those are timestamps and why the table has no `is_active` boolean. A
rule added today must not knock down a year of past days; a rule retired tomorrow must not lift
yesterday's score. The same holds for a rule's **configuration**: a day in May stays scored against
the limit that applied in May.

**A day with no trades is `na`, never `pass`.** "I did not exceed max loss" is vacuously true on a day
you did not trade, and scoring that as a pass would let a 200-day streak be farmed by not trading.
`na` drops out of both numerator and denominator, so a disciplined day with no trades still carries
100 % on the rules it *could* answer.

**Locking a day** freezes the automatic verdicts into rows and is irreversible — enforced by a trigger
that fires on any edit to a locked report, so there is no unlock action that would need writing.
Trades from a locked day stay editable: P&L is a fact that must remain correctable, and the frozen
verdicts are what stops compliance from following it.

**Playbooks** hold groups of rules; answering their checklist writes `tj_position_rules`, which feeds
the follow rate. An unanswered rule counts in neither the numerator nor the denominator.

**Insights** are 23 rules at four levels — trade (12), day (6), week (3), portfolio (2) — reading the
same enriched trades the reports do. Every rule declares a `minSample` and none fires at n=1. No
insight is stored in the database: thresholds change, and a stored insight would go stale against a
changed threshold while still looking authoritative.

There were 37 until Phase E **grouped them by cause**, and the regrouping found two rules that could
never have fired alone. (The review of that merge found two narrowings it had introduced, both now
pinned by tests: a merged branch must keep every case its rules caught, and `no_drawdown` needed no
R while `gave_back_profit` was never restricted to winners.) `weak_win` asked for under 0.3R out of a move of at least 1R — which IS a
capture below 30 %, always inside `maximize_your_profit`'s 40 % threshold — so every weak win was
already reported twice, under two headings, as two problems. `no_drawdown` and `clean_hold` were the
same observation at two degrees and could never both fire. Four merges:

| Now | Was |
|---|---|
| `gave_back_profit` | + `green_to_red`, `green_to_breakeven`, `maximize_your_profit`, `weak_win` |
| `acted_against_the_plan` | + `thesis_invalidated_but_held`, `touched_an_intact_thesis`, `micromanaged_a_setup` (removed in H1 with the check-ins it read) |
| `exceed_avg_hold_time` | + `loser_long_hold` |
| `clean_hold` | + `no_drawdown` |

Each merged rule fires **once per trade, at the worst cause that applies**, and names the cause in
its title. Rules were only merged **within one level**: a week-level finding and a trade-level one
have different subjects, so folding `tilt_week` into `revenge_trade` — or `sizing_problem_day` into
`unusual_size` — would put a week's id where a trade id belongs. They stay separate for that reason
rather than for a good story about causes.

**H1 removed six more** (28.09.2026): five swing rules that joined on the per-position check-in, the
time stop in days, the written thesis and the weekend: `acted_against_the_plan`, `past_time_stop`,
`unplanned_partial`, `entry_without_thesis` and `weekend_hold_record` — and then a sixth,
`swap_ate_the_trade`, since a future carries no swap. With them went four report
dimensions (`touched`, `thesis_state`, `weekend_hold`, `time_stop_breached`) and the weekly recap's
weekend, checked, touched and thesis-slipped counts. A book that is flat by the close has none of
those things to measure.

### Topstep

**Topstep mode** is per account. Its rules are
money per plan, not percentages, so they live in their own module (`topstep.ts`, read off
help.topstep.com on 28.09.2026):

| Plan | Maximum Loss Limit | Daily Loss Limit | Profit target | Max position |
|---|---|---|---|---|
| 50K | 2,000 | 1,000 | 3,000 | 5 mini / 50 micro |
| 100K | 3,000 | 2,000 | 6,000 | 10 mini / 100 micro |
| 150K | 4,500 | 3,000 | 9,000 | 15 mini / 150 micro |

- **The MLL trails the highest END-OF-DAY balance** and never comes down; it locks at the starting
  balance, and after the first payout (`topstep_payout_at`) it is the starting balance. Today's win
  does not raise it before the day ends — the afternoon would otherwise be sized from room Topstep
  has not taken yet.
- **The DLL ends the day, not the account.** The day is Topstep's, 17:00 → 17:00 CT, and it is the
  same day the calendar, `/daily` and the tracker file the account's trades under (§ Attributing to days).
- **Consistency**: the best day must stay at or below 55 % of the target; past that the target grows
  to best day ÷ 0.55.
- **Closed trades only**: Topstep watches both limits intraday with open P&L, so a
  position that went through the floor and came back reads here as a survived day. The platform's
  risk engine is the record.
- **Reaching the MLL blocks new exposure, never the record**: `/trades/new` refuses (`isTopstepAccountFailed` in `topstep-status.ts`), an edit that adds a
  position or size is refused, while `/trades/log` only warns above the form and logs the trade. The
  banner turns red and says on which day; **Reset account…** under the account's Topstep rules in
  Settings writes `topstep_reset_at`, from which the balance starts again and the MLL is cleared.

**Risk per trade is the trader's own rule** (`computeTopstepRisk`, from `futures-trading`'s
`Uputstvo_rizik.pdf`): **12.5 % of the room above the MLL**, held between the plan's bounds — 60–300 on
a 50K, 120–600 on a 100K, 180–900 on a 150K, so three stops fit in the DLL — and never past what
is left of today's DLL. `risk_rule_pct`, `risk_rule_min` and `risk_rule_max` on the account override
the three. The brief in `futures-trading` prints the same figure each morning.

**The tracker grades a Topstep account's trades by its plan**, each account on its own; a trade on
any other account is not graded by these rules (§ Process tracking), and the checklist names which
of the plan's numbers the limit came from:

| Rule | On a Topstep account |
|---|---|
| Max loss per day | The plan's DLL, per account and per Topstep day — two 50Ks each down 600 are two survived days |
| Max loss per trade | The risk budget at entry **+ 10 %** for slippage (`TOPSTEP_SLIPPAGE_TOLERANCE`) |
| Risk per trade | The risk at the stop against the budget at entry |
| Sized to intent | The contracts equal the count the form would have given from that budget (rounded down, commission counted, capped at the plan) |

**The budget at entry** is what `computeTopstepRisk` allowed at the moment of the first fill — the
room and today's DLL as `topstepStateAt` reads them from everything closed before that instant
(`riskBudgetAt`). It is **sealed** in `tj_positions.risk_budget_at_entry` by the manual write path on
the save that first gives a trade fills, never overwritten, 0 when there was no room (migration
`20260928160000`); a later correction or late import cannot move the measure a decision was graded
against. A trade with no seal — created by the import, or older than the column — reads the same
budget derived at its entry. There is no **Risk %** list on the plan form (removed in H2 with the
`risk_pct` column and the playbook's default risk): the size comes from the rule, and appears once
entry and stop are in. An account that is not in Topstep mode gets no size suggestion.

---

## Import

CSV in, with column mapping, a preview, and a create/merge/skip decision per row.

**A merge only changes objective fills.** Plan, psychology, grade and notes are untouched — the
import never owned them in the first place.

**Undo is the only import operation that deletes data.** It removes the positions the batch created,
restores the fills it displaced, then deletes the batch and its audit rows.
`tj_import_rows.prev_executions` is the only copy of what a merge displaced, and undo restores it
field by field, provenance included — proven against a live database inside a transaction that is
rolled back.

Two things the wizard refuses rather than guesses, both because guessing is silent:

- **Ambiguous dates.** `02-03-2026` is 2 March to a European broker and 3 February to an American
  one. Refused. A row whose time cannot be read is shown as unreadable and never stamped with the
  moment of import — which used to file a three-month-old trade into today's P&L, today's calendar
  cell and today's week.
- **Ambiguous decimals.** `1.234,56` and `1,234.56` are both read correctly, by taking the last
  separator as the decimal point. `1,234` is refused: it is 1234 to an American broker and 1.234 to a
  German one, and nothing in the cell decides which.

Every refused cell is named on its own row in the preview (`unreadable: qty, fee`). **A row whose
size, entry price or entry time could not be read is skipped and cannot be merged**, and it says so
(`cannot merge: unreadable entry time`). Merged, it would replace a trade's fills with a guess. It
may still be created by hand if at least one fill was read. A fill of zero size is never built.

### A merge that can always be undone

A merge replaces a trade's fills, so every step is ordered to keep the way back open:

1. **Read what is there first**: the fills and the trade itself. A failed read stops the row. It used
   to become an empty snapshot, and undo would later "restore" nothing.
2. **Write the audit row before anything changes.** It holds the only copy of the old fills, and the
   trade's previous status (`parsed.prev`), so a missed plan comes back missed.
3. **Replace the fills and update the trade.** If that fails, the old fills and fields are put back and
   the audit row is removed. If even that fails, the audit row stays and the error says to undo the
   import.

**What a merge refuses:**
- a row with no target;
- a row with no fill (it would delete every fill of the trade);
- **a second row into the same trade.**

The review enforces the same rules. It sends the first row in the file to the merge and names the rest
(`same trade as row 1`), and it will not let two rows point at one trade.

**An exact match that changes something is not a duplicate.** Size and time are compared on every
match, prices within a relative tolerance, and prices are shown as the file wrote them. The chart
zone the times are shown in heads the time column.

**Large files go in chunks** of 50 rows into one batch (`batch_id`, `row_offset`), with the progress
on the button. A chunk that fails stops the commit and says how many rows landed. The batch's summary
is the running total (`mergeImportSummary`).

**Undo goes newest first.** If a newer import merged into a trade this one created or changed, undo
refuses and names the newer file: its snapshot is this import's result. Audit rows are read in the
order they were written, and a trade is restored from its **earliest** snapshot. A skipped row names
no trade, so it can no longer stand in for a merge.

### Recognising a trade you already typed

`sameTrade` needs the entry time to agree within ten minutes, which is right for a statement arriving
the same day and useless for a trade typed by hand long after it happened: the row carries the
moment it was **typed**, the file carries the moment it was **traded**. Months
apart, same trade — two positions, and merging two positions afterwards is a separate operation
(§ Merging two trades).

So when the strict question finds nothing, a weaker one is asked, with the time left out of it
entirely: same account, same instrument, same direction, same entry price, same exit price, and then
**either** the same size **or** the same money. That row is marked `suggested`, names the trade it
believes it is (`same trade as #5 · 09/18 21:10 · 1327.45→1317.62 · −983.40`), and arrives with
**merge already chosen** — the review then says what the merge will change, starting with the time:
`opened 09/18 21:10→03/07 09:00`.

**Size OR money, not both**, because the two sources disagree about size more often than they
disagree about the trade: a statement can state the size in other units than the trader typed, so
1.00 and 1.73 can be one trade — and the P&L then agrees to the cent,
because both describe the same price move. Requiring both would refuse exactly the case this exists
for.

**More than one candidate is still `ambiguous` and still defaults to create**, but the row can now be
pointed at a specific trade from a list that names each one. A wrong guess and a deliberate choice
are different things; only the guess was ever the problem.

**A third question finds the plan a limit filled.** A limit written plan-first (`/trades/new`) has no
fills, so neither question above can see it — both read the entry off fills — and the day's export
used to create a second trade while the plan stayed behind with the playbook and the chart on it.
When no trade with fills matches, a plan does if it is the same account, instrument and direction,
the fill lies within the merge tolerance of the plan's own entry (a limit fills at its price or
better), and the fill came **after** the plan was written — how much later does not matter, a limit
can rest for minutes or days. It is `suggested`, never `match`; two plans at the same limit are
`ambiguous` and both are offered. The merge seals the plan as it was written.

### TopstepX trades export

The everyday end-of-day file. A TopstepX "Trades" CSV is recognised by its header and imported
without column mapping (`lib/journal/topstepx-export.ts`). Three things about it would each produce a
confidently wrong trade through the generic mapping, and each is handled:

- **The dates are month-first** (`09/28/2026 10:43:54 +02:00`), which `parseImportTime` rightly
  refuses as ambiguous. Here the layout is known, so they are rewritten as ISO with the offset the
  file carries, and a field that is not a valid month or day is refused rather than swapped.
- **The contract carries its month** (`MNQZ6`; TopstepX also writes `/MNQZ26`, TradingView `NQ1!`).
  The trade is the catalog's root, `MNQ`; which month was traded is read back off the exchange's
  prices when MAE/MFE is measured. A CFD index and the future never match each other.
- **Costs are two columns**, `Fees` (exchange and NFA) and `Commissions` (Topstep's); the trade's
  cost is their sum. `PnL` is gross and is checked against price move × multiplier × size, so a
  contract whose multiplier differs from the catalog's says so on its row instead of in the P&L.

Each row then goes through the same matching as any file: a trade logged by hand on `/trades/log`
that day is recognised (entry within 0.05 %, entry time within ten minutes) and its rough numbers
are replaced by the exact fills, while setup, grade, mistakes and the sentence stay.

### What the file may overwrite, and what it may not

A merge replaces the fills — entry, exit, size, times, commission — because those are the broker's
facts and the reason to import at all. Plan, grade, thesis, psychology and notes are never touched.

Two levels sit between those categories, and they are treated differently:

- **Target.** Mapped from a `T/P` column and written **only onto a trade that has none**. A target
  already on the trade is the trader's plan; a missing one is simply not recorded yet. Undo empties
  the ones this import wrote (`tj_import_rows.target_written`) and leaves the rest alone.
- **Stop.** Mapped from an `S/L` column and written **only onto a trade the import creates** — never in
  a merge. A statement states the levels as they stood **at the end**, and a stop pulled to breakeven
  mid-trade is the commonest thing a trader does — merging that number would overwrite the stop the
  risk was actually taken with.
- **Entry (K3).** A trade the import creates — one never written as a plan — takes its planned entry
  from the size-weighted entry fills, with the stop and target above when the file has them
  (`importedPlan` in `import-commit.ts`). Live columns only; the seal is unchanged. The TopstepX trades
  export carries no stop or target, so such a trade gets its entry and nothing else.

### TradingView backtests (removed)

The TradingView "List of trades" import — a Strategy Tester or Bar Replay export joined into positions,
its size rescaled to lots and its excursions written as MAE/MFE — left in H2 with the backtest account
kind (decision I5-A: the book is Topstep only). `tj_positions.excursion_source` still reads
`tradingview` on no trade; `tj_import_rows.excursion_written` and the `clear_excursion` branch of
`tj_undo_import_batch` stay for batches written before it.

---

## Merging two trades

Two rows that are the same trade become one: `/journal` → tick both → **Bulk actions → Merge 2
trades…**. It exists because the import's recognition (§ Recognising a trade you already typed) only
helps at import time — a trade typed by hand and the same trade imported before that matcher existed
sit in the journal as two rows, and every total counts the trade twice.

**The import corrects the typed trade, and nothing is asked.** The typed trade stays — its number,
grade, thesis and plan — and the imported one supplies the fills, then is deleted: an import carries
the broker's own numbers, a typed trade carries the judgement no import ever writes. With two of a
kind the newer is treated as the correction. The dialog says which row stays and which is used up,
and has one button. It used to let either side be clicked as the survivor, which turned a rule into
a question the trader had to answer by working out which row was which, every time.

| What | Where it comes from |
|---|---|
| Fills, status, `gross_pnl_override`, instrument snapshot | The trade the fills come from — **whole**, including a null override |
| Plan, stop, target, grade, thesis, notes, playbook, MAE/MFE | The survivor's, and only its **empty** fields are filled in from the other |
| Tags and mistakes | The union of both |
| Custom fields | Merged key by key; the survivor's answer wins |
| Images, rule answers, check-ins | Moved across where the survivor has no row for that key |

**The fills are taken whole, never combined.** The two rows describe the same trade, not two halves
of one; adding them together would double the size and invent a P&L nobody traded.

**There is no undo, and the dialog says so in those words.** A merge is reversible by re-importing
the file the fills came from, which is where they were read from in the first place — an undo would
mean snapshotting a whole position and its children into a table that exists for nothing else.

`tj_merge_positions` does it in one transaction; `merge-positions.ts` decides which side is which and
refuses two instruments, a long against a short, or two accounts — refused again inside the function,
because a client that skipped the dialog is not a reason to destroy a trade. A check-in on a **locked
day** cannot move, and its guard raises rather than skipping: the transaction stops instead of
half-merging.

---

## Deletion

Two operations outside import that delete data, both in `/settings` → Accounts, both without undo.

**Deleting an account** (`tj_delete_account`). An account with no trades, cash events or imports is
deleted on one confirmation; an account holding something asks for its name to be typed, and first
prints how many trades, cash events and batches will disappear. The last account cannot be deleted —
refused by both the action and the database, because `accounts[0]` is the source of the timezone and
currency every day is dated in.

Why a function rather than a `DELETE`: `tj_positions.account_id` is **ON DELETE SET NULL**, and so is
`tj_import_batches.account_id`. A plain delete through PostgREST would remove the account and **leave
the trades without one** — still in every total, with no currency to convert through
(`fx_rate_source = 'no_account'`), and no account left to explain it. The function deletes dependent
rows first, in one transaction. Proven against a live database inside a rolled-back transaction: an
account with 21 trades leaves **0 orphaned** positions, and 0 fills, rule answers and images.

**Reset everything** (`tj_reset_my_data`). Deletes all 28 tables for the caller, then calls
`tj_seed_my_defaults()` — the same seed the dashboard runs on an empty account, so "reset" and "first
load ever" end in the same state. It asks for `RESET EVERYTHING` to be typed.

The table list is maintained **by hand**, chosen over a catalog loop so that a table added later
shows up as a visible omission rather than a silent survivor. That mechanism worked as designed right
up to the point where nobody looked: `tj_dashboard_templates` (`20260818120000`) hangs off
`auth.users` rather than off anything the reset deleted, so saved dashboard layouts outlived "reset
everything" until `20260916100000` put it on the list. `tj_playbook_sections` was added in the same
migration — it already fell through the cascade from `tj_playbooks`, but the list is the record of
what "reset everything" means, and a reader should not have to trace foreign keys to believe it.

What actually comes back, counted from the seed functions rather than assumed from their names:
**1 Main Account (USD, `Europe/Belgrade`, asset class Futures), the six futures, 10 lists holding 54 options,
13 tracker rules, 7 custom fields, 3 note folders.** The lists are the day trader's since F4
(`20260929120000`), in Serbian since K2 (`20260929200000`): Entry TF 1m / 2m / 5m / 15m, "Bias dana
(brief)" Long / Short / Neutralno, Exit Reason with "Zatvoreno do kraja dana", and the day trader's
mistakes (Previše trejdova, Trejd posle DLL plana, Osvetnički ponovni ulaz, Trejd u crvenom prozoru).
The "Risk %" list left in H2. In an existing book the same migration added those items and switched
the swing ones off — `is_active = false`, not deleted, because trades keep tags as text.

**An instrument you delete stays deleted, since 20.09.2026.** `tj_seed_instruments_defaults` inserted
the 91 rows on every call with `on conflict do nothing`, and `ensureDefaults()` calls it from the home
page — so a symbol deleted in Settings was back on the next visit, and back with the CATALOG's
contract spec rather than the corrected one. It is the same shape of bug as the playbook seed below,
and it is now guarded the same way the account seed always was: the insert runs only when the user's
catalog is empty. A reset still restores the whole seed, because it deletes the catalog first — and
since `20260928140000` the seed is the six futures, not the 91-symbol CFD catalog it was then.

**What does NOT come back: playbooks.** `tj_seed_defaults` **does** call `tj_seed_playbooks`, but that
function has been a **deliberate no-op since `20260813200000`**: it used to guard itself with
`if exists (…) then return`, which cannot tell a new user from one who deleted every playbook on
purpose — both have zero rows — so deleting them appeared to work and then undid itself on the next
dashboard load. A reset therefore ends with zero playbooks and zero playbook rules no matter how many
were written. The same goes for anything added by hand — options, tracker rules, accounts. The panel
says so on screen, because listing what comes back while staying quiet about what does not is telling
the accurate half.

Both functions are **SECURITY INVOKER**, not DEFINER: every table carries
`FOR ALL TO authenticated USING (user_id = auth.uid())`, so RLS already scopes each statement to the
caller and there is nothing to elevate. `anon` is revoked **by name**, not only through `PUBLIC` —
Supabase's default privileges grant EXECUTE to every new function in `public`, and
`REVOKE ... FROM PUBLIC` does not remove an explicit grant to a role. Verified against the live
project.

---

## Migrations

138 files in `supabase/migrations/`, named `YYYYMMDDHHMMSS_description.sql`.

- **Additive.** An applied migration is never edited — a new delta is written instead.
- **A migration explains itself.** Each one opens with a comment saying what was wrong and what
  breaks without the change. Those files are the only record of why the schema looks the way it does.
- **Dropping a column a view depends on** means `DROP VIEW` → `DROP COLUMN` → `CREATE VIEW` →
  `ALTER VIEW ... SET (security_invoker = on)` → `GRANT SELECT`. Forgetting either of the last two
  silently changes who can read the view, or whose RLS filters it.
- **H2 (29.09.2026) is six deletions, each its own migration** (decision I1-B), applied as soon as
  its code was on `main`: `20260929140000` (check-ins), `20260929150000` (`time_stop_days`),
  `20260929160000` (swap), `20260929170000` (percentage limits, weekly rule), `20260929180000`
  (`risk_pct`), `20260929190000` (backtest kind, FTMO columns). The code stopped reading each column
  before the migration dropped it, so no deploy ran against a missing column.

### Security model

- **RLS on all 28 tables**, ownership pattern, verified against the live database.
- **`SECURITY DEFINER` plus a uuid argument is a hole**, because any signed-in user can call it with
  somebody else's id. All five seed functions of that shape — `tj_seed_defaults`,
  `tj_seed_instruments_defaults`, `tj_seed_playbooks`, `tj_seed_tracker_rules`,
  `tj_seed_note_folders` — have `EXECUTE` revoked from `authenticated`. The only one that stays
  callable is `tj_seed_my_defaults()`, which takes no argument and seeds only the caller's data.
  `tj_status_from_executions(uuid, text)` is a sixth function of that shape and is not the same kind
  of hole: it only reads `tj_executions`, returns `text`, and is revoked from `PUBLIC` and `anon`.
- **The database is the guard, not the action.** PostgREST with the user's JWT is a live write path,
  so a check living only in TypeScript is a lock you can walk around. Validation in a server action
  exists to make the message readable; the CHECK constraint or trigger behind it is what actually
  holds.

### Reading past 1000 rows

PostgREST truncates a response at `db-max-rows` (1000) and returns the shortened page with **HTTP 200
and no error**. Every read that grows with history goes through `selectAllPages`, and every `.in()`
filter through `selectAllByIds`, which splits the id list into chunks of 500 so the URL does not
break.

This is not a performance concern. A journal past a thousand trades would still display a win rate, a
net P&L and a drawdown computed over a partial set, with no visible symptom at all.

---

## Tests

2,871 tests across 182 files, split into **two vitest projects**: `lib` (environment `node`, files
`*.test.ts`, 2,256 tests in 121 files) and `components` (environment `jsdom`, files `*.test.tsx`, 615
tests in 61 files). The rule is the extension, so no file can land in both. The split exists so that
purely arithmetic tests do not pay for a DOM they never touch.

`vitest.config.ts` carries coverage **floors**, not targets — they sit at what the suite achieves
today, so the only thing they can do is fail when a change lowers coverage. Since Phase 10 there are
**two separate floors**, checked independently rather than blended into one average:

| Layer | Statements | Branch | Functions | Lines |
|---|---|---|---|---|
| `src/lib/**` | 95 % | 89 % | 96 % | 96 % |
| `src/components/**` | 64 % | 64 % | 61 % | 65 % |

Alongside them sits a **third, per file**: nineteen modules that compute or guard money
(`MONEY_MODULES` in `vitest.config.ts` — `analytics.ts`, `balance.ts`, `costs.ts`,
`position-stats.ts`, `risk-ratios.ts` and the rest) hold **100 % of statements and functions**
individually. A layer average is allowed to hide one such file; a per-file floor is not.

Why two floors and not one: `src/lib` is pure arithmetic and has stayed near 96 % since Phase 0.
`src/components` is Phase 10's render layer — 57 of 98 files have a **dedicated** render test, and
the rest are reached only incidentally, through whatever a tested component happens to import (many
`src/components/ui` primitives export sub-parts — `DropdownMenuRadioItem`, `PopoverTitle` — that
nothing in this app renders). A single blended number would either drag the library floor down to
component-layer reality or lie about how tested the render layer actually is; two floors say both
things honestly instead of averaging them into a number describing neither.

Four things the numbers deliberately do **not** claim:

1. **`src/components`'s floor is not "well tested".** 64/64/61/65 is the honest state of a layer that
   began this phase at zero and is not finished — Phase 10 covers the highest-risk components
   (Tier 1 and 2 in `ROADMAP.md`), not all 98. Reading this floor as "the UI is 64 % correct" repeats
   exactly the mistake the next point warns about, one layer up.
2. **Exclusion has to be `exclude`, not `include`.** The same mistake was made and recorded:
   `include: ["src/lib/**"]` switches v8 from "files a test imported" to "every file that matches",
   which pulls in server-only query modules no unit test can reach and scores them zero. The number
   drops from 95.5 to 86 — which looks like a regression and is not one: the metric started measuring
   something else under the same name.
3. **100 % would not mean correct, on either floor.** Coverage counts *execution*, not *assertion*.
   All three round-3 score defects lived in files at 100 % statements and functions — and all four
   Phase 10 findings (`W1`–`W4`) were found by a render test asserting that already-covered code
   produced the WRONG number, not by a line going unexecuted.
4. **`src/app` (17 pages across 33 files) has no number at all**, and "no number" is not "0 %" — it is
   "not measured". Routes are server components whose logic is `await getCurrentUser()` then
   `redirect()` then passing props along; the props are asserted on the other side, where a render
   test already reads them.

`src/lib/journal/book.fixture.test.ts` exists precisely because of the second point. It fixes one
book of ten trades, works every major figure out on paper in the comments — with the arithmetic
visible — and then asserts the code against the paper. A snapshot test locks in current behaviour
including its bugs; this one locks in the answer. The second half of the file walks the *shapes* a
book can take (empty, one trade, all winners, all losers, all breakeven, open only) — which is how
the third drawdown finding was caught. The same book, the same figures on paper, then become the
props of a rendered Dashboard in `dashboard.render.test.tsx`: paper → `lib/` → screen, one set of
numbers asserted at all three layers.

**The render layer has been executed since Phase 10.** Eight steps, each one commit + push + `tsc` +
`vitest` + `lint` + `build` + `knip`, documented in `CODE_REVIEW.md`. Dashboard (the largest file,
50 `useMemo`), `journal-grid`, three forms (`trade-form`, `daily-report-form`, `tracker-checklist`),
`import-wizard`, and 14 pure presentational components including `markdown-view` — the only renderer
in the application with security significance (an href allowlist on screen, not just in the parser).
Four defects found and fixed: `W1` (the Win rate tile read "0.0%" instead of "—" at zero decided
trades), `W2` (the same finding elsewhere, `PeriodPerformanceCard`), `W3` (privacy mode masked three
of four fields in one panel — the fourth leaked the real percentage), `W4` (Target attainment in the
trade form computed without a floor and with the wrong precedence between the saved and the
live-computed plan). `S1`, `S2`, `S3` and `P1` from round 3 — all found by reading, not by testing —
each now have a render test that would have caught them had they recurred.

**What is still not established**, said plainly so nothing here claims more than it may: the `lib/`
chain from realized trades to the score is proven, and so is the render layer for the highest-risk
components. 17 routes in `src/app` are still executed by no test — the logic living there is thin
(fetch + `redirect()`), and Playwright would need a running application and Supabase credentials this
container does not have. It stays a later option, not an oversight.

---

## Deliberately left out

| Not built | Why |
|---|---|
| Backtesting and trade replay | Done directly in TradingView. An embed does not help: Bar Replay lives in their application, and the widget is a black box the code cannot step through. The journal no longer imports its results (H2: Topstep only) |
| Broker sync that fills in a whole trade | Manual entry is a choice and an advantage — it forces the trade to be read once more. A statement import corrects the objective numbers afterwards; everything that is a judgement is still typed |
| Spaces, mentor, leaderboard | Single-user system |
| AI chat and agents | The mentor-pack export and the insight rules give the same thing without the API cost |
| Options (DTE, strike, expiry) | Not traded |
| Intraday dimensions (session window, minutes since the open, trade number in the day) | **Not built yet, and no longer left out on purpose** — they were called a day-trading artifact while the book was swing. Today there is `Entry hour` (on the account's clock) and `Entry weekday` in `/reports`, and the weekly "Napredak" card groups by hour, by trade number in the day and by the trade after a loss. Moving those into report dimensions is `FAZA_F_DAYTRADING_PLAN.md` #11 |
| Economic calendar | Lives in `futures-trading`: the morning brief carries the day's releases with their red windows |
| Running P&L curve per trade | Needs a price feed inside the journal. The R2 minute and second candles in `futures-trading` now exist, so the intraday insights left out — `most_time_in_drawdown` and `deep_in_drawdown_day` for want of a feed, `patience_paid_off` as "an intraday notion" — can come back (`FAZA_F_DAYTRADING_PLAN.md` #13) |

## MAE/MFE

**MAE/MFE comes from the exchange.** Every trade in the book is a future, and its two prices are
written from the traded contract's own candles:

| Trade | MAE/MFE source |
|---|---|
| **Future** (NQ, MNQ, ES, MES, 6E, M6E) — TopstepX import or `/trades/log` | The traded contract's own candles in Cloudflare R2, written by `futures-trading/tools/journal_mae.py`: exact from Databento every morning at 06:15 UTC, and provisional from Yahoo's 1-minute bars of the same contract hourly on weekday afternoons and evenings, so the evening review has them (`excursion_note` says `… · 1m privremeno` until the exact value replaces it). 1-second candles. The contract is the one in the name (`MNQZ6`) or the CME roll rule's, and it is the right one only if **every fill lies inside its own candle** (±1 tick) — otherwise the trade is refused with the reason |

`tj_positions.excursion_source` records who wrote the two prices: `manual` or `r2` (`mt5` and
`tradingview` on history written before H1 / H2), and `excursion_note` says what they were measured
on (`MNQZ6 · 1s`).

**R2 wins — even over a typed value.** That is the trader's decision of 28.09.2026: the exchange's
own prices are the record, and a number typed from a chart is a reading of them.

The CFD backtest sources — Dukascopy's 1-minute candles (removed 19.09.2026, `20260919140000`) and
the TradingView export's own excursions (removed with the import in H2) — are gone.
`excursion-scan.ts`, the older scanner, is unchanged and still takes candles from anywhere.

---

## Documentation

| Source | For what |
|---|---|
| **This README** | What exists and how it works |
| [`ROADMAP.md`](ROADMAP.md) | Phases, decisions and their reasoning, what is left (Serbian) |
| [`CODE_REVIEW.md`](CODE_REVIEW.md) | Rounds 2b, 3 and 4 plus the render-layer execution (Phase 10), every finding with its outcome |
| [`docs/formulas-audit.md`](docs/formulas-audit.md) | Every formula checked against outside practice, with a verdict each (Serbian) |
| [`PARITY.md`](PARITY.md) | A comparison against TradeZella, item by item (Serbian) |
| [`FAZA_F_DAYTRADING_PLAN.md`](FAZA_F_DAYTRADING_PLAN.md) | The move from swing to day trading: six phases F1–F6, a detailed plan for the next one, and every place the code still measures swing (Serbian) |
| [`FAZA_8B_PLAN.md`](FAZA_8B_PLAN.md) | Automatic MAE/MFE: MT5 for CFDs, R2 for futures, and why the cTrader plan was withdrawn (Serbian) |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) | AI entry point (Cursor / Claude Code) |
| [futures-trading](https://github.com/0xsickre/futures-trading/blob/main/README.md) | Morning brief, contracts per day, MAE/MFE from R2, the evening journal reminder, the daily journal routine |
| [trading-fundamental-vault](https://github.com/0xsickre/trading-fundamental-vault/blob/master/README.md) | The F0–F5 cycle, macro bias, COT filter (swing era) |
| [vault `workflow.md`](https://github.com/0xsickre/trading-fundamental-vault/blob/master/workflow.md) | The weekly runbook (13 steps) |
| [trading-dashboard](https://github.com/0xsickre/trading-dashboard/blob/master/README.md) | Read-only view of the weekly analysis |

---

## Note

Private repo — personal use. The journal's Supabase project is **separate** from the dashboard's; do
not run the dashboard's migrations here or the other way round. The contents are a personal trading
record, not investment advice.
