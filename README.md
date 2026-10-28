# Trading Journal

[![gate](https://github.com/0xsickre/Trading_Journal/actions/workflows/gate.yml/badge.svg)](https://github.com/0xsickre/Trading_Journal/actions/workflows/gate.yml)

A day-trading journal for a single trader: intraday CME futures — NQ / MNQ, ES / MES and
gold GC / MGC, with 6E / M6E in the catalog. It knows no prop firm (phase X, 26.10.2026): the
trader keeps each firm's rules on its own platform. No AI chat — a disciplined record of what was traded and
how well the process was followed, plus honest arithmetic over that record. **A trade comes in only
through the import** (phase O, 08.10.2026): the TopstepX trades and orders exports (or a broker CSV),
then the details filled in from the session's recording; a setup not taken has its own small page.
The one thing written from outside is MAE/MFE on a future, from the exchange's own candles
(§ MAE/MFE).

**It was built as a swing journal** (FTMO CFDs on MT5, positions held for days), and the move to
day trading is under way. **FTMO mode and the MT5 statement import went in H1** (28.09.2026: no
FTMO or CFD trade was in the book), with the per-position check-ins on `/daily` and the five swing
insights (thesis, time stop, weekend). **H2 (29.09.2026) removed what they left in the database**:
the check-in table, `time_stop_days`, swap (fills, instruments, net P&L), the percentage-of-equity
tracker limits and the weekly loss rule, the `risk_pct` choice, the backtest account kind with the
TradingView replay import, and the `ftmo_*` columns. The book is CME futures only. **F5 (29.09.2026)
moved the analytics to the trading day**: hold time in minutes, session windows, intraday insights,
time underwater, overlap in minutes, open risk against the DLL (gone in phase X), a day trader's mentor pack. **F6
closed the move**: the missed-setup price from R2, the vault-era insights retired, a plan stale after
its trading day, and the parity documents rewritten. The whole move, phase by phase with every
decision the trader took, is [`FAZA_F_DAYTRADING_PLAN.md`](FAZA_F_DAYTRADING_PLAN.md).

Built to cover what TradeZella does in metrics, notes and reports, minus the parts that only make
sense for multi-user SaaS. Where it differs, the difference is written down and argued — here or in
`ROADMAP.md`.

**On language**, counted rather than claimed, because this is the first thing a reader can check.
Identifiers and code comments in `src/` are English. This README and `CODE_REVIEW.md` are English;
`ROADMAP.md`, `PARITY.md` and `docs/` are largely Serbian. Migrations keep their Serbian comments on
purpose — an applied migration is never edited here, and the comment inside one is part of the
record of the day it was written.

**The interface is deliberately half-and-half, and the line is a clean one.** At least 299 of the
3,359 human-readable string literals in `src/` outside tests are Serbian, and every one of them sits
on a screen the trader writes into or reviews in their own words:

| Surface | Serbian strings |
|---|---|
| Daily (the "Zatvaranje dana" card included; the state before the session, "sutra menjam" and the day's opportunities since phase G, with the messages of their schema `daily-report-schema.ts`) and tracker (the lock warning of `review-gaps.ts` too) | 83 |
| Mentor pack ("Export for Claude": the prompt, the legend and the day trader's sections) | 150 |
| Day insight sentence (`low_efficiency_day`) | 1 |
| A new playbook's three starting sections (`playbook-types.ts`) | 3 |
| The seeded tag values the review and the import write (`quick-log.ts`: no mistake, exit reasons — the tags are Serbian since K2; "Ispoštovao rizik", which `honest_tags` in `tracker/auto-rules.ts` reads) | 7 |
| The trade page `/trades/[id]` (phase P) — off the recording, setup, review, and why it asks for the original stop (`trade-page.tsx`, its route, `stop-moved.ts`) | 25 |
| The journal's own mistakes on a trade, marked "auto" (`auto-mistakes.ts`, phase B4) | 6 |
| Category names — the trader's own list and field names (Smer, Ocena setupa, Razlog izlaza, Greške, Tehnički tagovi, Psihologija, Emocije, Disciplina) as `/reports` groupings, journal-grid filters and bulk tags, and the mentor pack's category tables (phase J); the "Sa detetom" / "Bez deteta" groups of the state written on `/daily` (phase G); the test fixture of the same field definitions (`field-defs.fixture.ts`) | 14 |
| Session names on the chart and in the pack (`session-window.ts`: Azija, Pre Londona, Ručak, Posle zatvaranja, Pre otvaranja) | 6 |
| The NinjaTrader sync's answers to the PC script, which logs them in Serbian (`api/import/ninjatrader/route.ts`, `ninjatrader-sync.ts`, phase I3) | 4 |
| Dashboard, `/reports`, journal grid, playbooks, **`/settings`**, `/import` — everything around those names | **0** |

Settings joined that last row on 20.09.2026. It had held the stage names of the daily checklist
(`Priprema` / `Trgovanje` / `Osvrt`, which the checklist itself rendered), a paragraph of Serbian
above the instrument catalog and two error messages from its server actions — a screen that measures,
reading half in one language and half in the other.

The half that **measures** is English; the half the trader **writes into** is Serbian. That is the
trader's own language for their own prose, and it stays. A category is his own word too: he names his
lists in Settings, so since phase J (15.10.2026) the built-in groupings carry the same Serbian names as
his lists wherever they appear, and a report reads "By Ocena setupa" — the name is not lowercased,
because it is a name.

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
**299 is a floor, not a ceiling**. A listed word before a hyphen is not scored — "Pre-open", a session
name, read as the Serbian "pre" until F5.4. Three earlier versions of this paragraph said "about 46 of some 1,700", then "153 of
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
| [`futures-trading`](https://github.com/0xsickre/futures-trading) | What is the market doing today (news, red windows, expected NQ/ES range, levels)? | Since X-10 (26.10.2026) its brief and evening message neither read nor write the journal; it writes MAE/MFE and time underwater (`excursion_source = 'r2'`), the price of a missed setup (`missed_source = 'r2'`), "šta bi bilo" (its bias grade left in phase E) |
| **`Trading_Journal`** (this repo) | What did I trade, and with what discipline? | Write (you, after each trade) |
| [`trading-fundamental-vault`](https://github.com/0xsickre/trading-fundamental-vault) | Macro direction, COT filter — the swing cycle (F0–F5) | None; semantic only |
| [`trading-dashboard`](https://github.com/0xsickre/trading-dashboard) | Where did the vault's cycle stop? | None; read-only view of the vault |

What `futures-trading` does with the journal, each described in its own README:

- **The morning brief and the evening message** are about the market only since X-10 (26.10.2026;
  trader: „brief treba da bude brief za tržište, ne za journal“): they read no account and no trade
  and write nothing here. Until then the brief printed a contract table from the prop-firm accounts and
  wrote one `tj_session_briefs` row a day (red windows, an early close, the expected range), which
  `/daily` showed and two tracker rules read; that table and its rows stay as history, and nothing
  reads them since phase X9. The evening message no longer lists trades without a review — "Bez
  pregleda" on `/daily` does.
- **MAE/MFE** and time underwater for closed futures trades come from the traded contract's candles
  in Cloudflare R2 (`tools/journal_mae.py`, hourly) (§ MAE/MFE), and so does the price of a missed
  setup once its trading day is over (§ The missed setup gets a price).
- **The nightly backup** at 04:10 Belgrade (`tools/journal_backup.py`) reads all 25 tables and the
  chart images kept in Storage, as the journal's user, into Cloudflare R2
  (`futures-trading/backup/journal/{date}/`). Every file is read back and compared before the day's
  manifest is written; 35 days are kept, plus the first snapshot of each month for good.
  `journal_backup.py sql DATE [--korisnik UUID]` writes the restore: one transaction, triggers off
  (`session_replication_role = replica`), the user's rows deleted in all 25 tables, then the snapshot
  inserted parents first — tested 30.09.2026 on a database built from all 149 migrations, row for row,
  into the same user and into a new one. **A new `tj_` table must be added to its `TABELE`**; the
  backup warns when PostgREST shows one it does not know.
The vault link is the swing-era one. **The journal holds no forecast of direction** (phase E,
27.10.2026, § Bias dana — retired): the close is the account's flat-by time. The vault's `macro_align` / `cot_filter` are no longer seeded or asked for, and
the two insights that read them (`against_macro_bias`, `cot_chase`) left in F6 (decision M2-A); the
values stay on the older trades that carry them.

The thesis: **P&L is the consequence, process is the cause.** So the daily rating measures progress
on the active process goal, never earnings, and the analytics decompose the result along dimensions
that are actually under your control.

### A trading day

The routine both repos are built around — the same steps as "Dnevni tok journala" in the
`futures-trading` README:

| When | Where | What |
|---|---|---|
| Before the session | Telegram, then `/daily` → 1 · Pre sesije | The market brief from `futures-trading` (news, red windows, expected range, levels) on Telegram; on `/daily` two questions — how you are, and whether you trade today |
| Before and during the trade | The platform + OBS | The order with its bracket; the size is the trader's, on the platform. The session is recorded, and the setup, stop, target and reason are said out loud before the click ("Teza naglas"). Nothing in the journal |
| End of the day | `/import`, then `/trades/[id]` | The TopstepX **trades and orders** exports together: the fills, the target, the stop's last price, how each trade ended. Then **the trade page** per trade (phase P) — the original stop where it was moved, what was said before the click, setup and its checklist, the categories, A/B/C, mistakes. A setup seen and not taken is no longer written per trade since phase G: it is one of the day's up to three "prilike" on `/daily`. MAE/MFE arrives on its own — provisional the same evening, exact the next morning |
| 16:10 CT (23:10 Belgrade), after the CME day ends at 16:00 CT | Telegram | How the day went on NQ / ES and what price did with the brief's lines — the market only since X-10 (26.10.2026); a trade still missing its review is on "Bez pregleda" on `/daily` |
| Closing the day / the week | Dashboard → Export for Claude, then the private `trading-mentor` repo | The mentor pack for the day (or the week) goes to Claude, who asks the closing questions and keeps the record of rules and observations. The journal has no written review of its own |

### Bias dana — retired (phase E, 27.10.2026)

Phase D (17.10.2026) had the trader set a daily direction per NQ / ES / GC on `/daily`, graded from
the exchange's candles against "always long". Phase E took it out of the whole flow (trader: "the
market can't be predicted, it is traded with, by reacting"): no card, no grade, no `/reports`
panel, no mentor-pack section, no `htf_bias_set` rule and no "Bez biasa dana pre ulaza" mistake.
History stays: `tj_daily_bias` and its rows are kept and nothing reads them; the trade's old
`htf_bias` field is retired (`is_active = false`) and shows read-only, as plain text under
"Kontekst", only on a trade that has a value.

The plan-first form (`/trades/new`) and the after-the-close log (`/trades/log`) left in phase O
(08.10.2026): the import is the only way a trade comes in, and the full form edits what is there.

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
| `npm test` | Vitest — 2,795 tests across 179 files, in two projects (`lib` on node, `components` on jsdom) |
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
  - the accounts on the dashboard and `/daily`, where only the day waits on them;
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

25 tables and 1 view, all prefixed `tj_`. **Row-level security is enabled on all 25 tables**, every
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
| **Daily process** | `tj_daily_reports`, `tj_session_briefs` (the morning brief, F4 — history since phase X9, nothing reads it), `tj_daily_bias` (the day's bias forecasts and their grade, phase D — history since phase E, nothing reads it) |
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
| `/` | Dashboard: no prop firm's banner since phase X; KPIs, equity curve, drawdown, heatmap calendars, breakdowns, the Process · Survival · Edge card, the **Time stop** card (see § MAE/MFE), insights. Opens on **All** — the whole record first, narrowed on request; the scope last chosen is remembered per browser. Whenever the period leaves closed trades out, a notice above the figures says how many and how far back, with **Show all** (`default-period.ts`). The amounts read in **`$` · `%` · Points · Ticks · Privacy**. Points and ticks (U, 01.10.2026) are the money divided by one contract's point (or tick) value, trade by trade, so they count every contract — two MNQ over ten points is 20 points — and a sum of them still follows the money (`futures-units.ts`). They hold within one instrument family only (MNQ with NQ, MES with ES, M6E with 6E): an **instrument picker** appears when the account has more than one, and until one is picked the two buttons are off. They change the same figures `%` does — Net, Gross, Best, Worst, Max drawdown, Total costs, Avg daily DD, the recent trades and the tag table; the charts stay in money. The picker narrows the trades shown, never the account's equity (percentage) |
| `/journal` | Trade table — sorting, filtering, column picking. The date column carries the **year**, so a trade from last season does not read as this spring |
| `/trades/[id]` | **The trade page** (phase P, 14.10.2026) — one page per trade, in the order the recording is watched. (1) The trade as the import brought it, read only: account, direction, contracts, entry → exit (Belgrade time), duration, net P/L, R, MAE/MFE, costs, risk to the stop (phase X; the risk budget before) — **fills are never typed** (decision P-1); the stop order's last price and, when the orders file shows the stop was moved, the request for the original. (2) **Off the recording:** the original stop (the one value typed by hand — a stop moved to breakeven leaves only its last price in the export), the target, the planned R:R against the actual fill, and what was said before the click (`thesis`). (3) **Setup:** the playbook and its checklist (`PlaybookChecklist`) with the computed setup grade — since phase B (26.10.2026) only the setup criteria („Zašto ulazim“, `isAskedRule` in `offered-rule-answers.ts`) are asked; an older trade's answers to the other rules are listed read-only ("Ranije upisano — više se ne traži") and saved untouched. TF ulaza, when the trade has none, is pre-filled from the playbook's `default_entry_tf` and marked "auto — iz playbook-a". (4) **Context:** the trader's own categories of phase `always` from `tj_field_defs`, in the order of Settings — a new category appears without code; the retired "Bias dana" (`htf_bias`, phase E) is a read-only line, only on a trade that has it. (5) **Review:** A/B/C for execution everywhere (decision P-2; A writes "Bez greške"), the categories of phase `active` (exit reason pre-filled from the prices, psychology; mistakes asked only for a B or a C, or when the trade already has one — phase B), one sentence, and **"Greške koje journal nalazi sam"** (phase B4, `auto-mistakes.ts`), each marked "auto" with its reason: entry outside the trading window, entry after two stop losses, an entry in the first 10 minutes after the open (phase G), no playbook, a target under 2R, a moved stop (from the orders export), a win turned into a loss (MFE ≥ 1R, net < 0). They are computed on read and never written into "Greške"; with the data missing (no window, no brief, no orders export, no MFE, no target, no stop) nothing is guessed. (6) Charts — a list grown with "+ Add chart" (up to 20, `tj_trade_images.sort_order`; an uploaded screenshot, a pasted image or a TradingView link, private bucket `trade-images`, K6), (7) "Šta bi bilo". A **missed setup** opens the same page with its levels editable (`updateMissedSetup`) and no grade. One save, `saveTradeReview`: the columns and `custom` in one UPDATE, then the checklist through `ruleAnswerWrites` — it writes the offered answers and removes only answers to rules of the chosen playbook it no longer offers, or, when the playbook changed, the previous playbook's (P-3); never `tj_save_trade`, which deletes every answer first and would have erased trade #1's answers to retired rules. The plan-before-entry fields left with the old two-tab form: Planned Entry as input, Position Size, Scale-out, Invalidation, Time stop and Slippage (0 of 3 trades had them; columns stay). `/trades/[id]/edit` and `/trades/[id]/review` redirect here, so old links still land |
| `/daily` | **The day in the order it is lived**, in three numbered parts under the day's heading (`daily-report-form.tsx`), opened — when an earlier day has one — by **"Danas menjam"**: the last "sutra menjam" written before this day, with its date (Monday opens with Friday's; `getLastTomorrowChange`, phase G). **1 · Pre sesije**: **"Pre nego što uđeš"** (the morning brief's "Pred sesiju" card left in phase X9, X-10; the Bias dana card in phase E) — two questions, numbered and about the day ahead: *1. U kakvom si stanju?* (phase G, G-2: sleep quality 0–100 %, hours slept, the shift — prva / druga / slobodan — and whether the child is with me, `tj_daily_reports.sleep_quality_pct` / `sleep_hours` / `work_shift` / `with_child`; under 80 % sleep quality or under 7 hours an alert, from what is typed, asks for a smaller risk — "Kratka noć: …", `lowSleepReasons`, `LOW_SLEEP`, trader 27.10.2026 — and the same night marks each entry of that day with the `low_sleep_entry` insight, "Entry after a short night"; a state saved after the day's first entry reads
"Stanje upisano DD.MM. HH:MM, posle prvog ulaza (HH:MM)" — `state_at`, stamped by a trigger like
`mental_temp_at` in phase Y; a mark only, no rule reads it. The 1–5 star rating it replaced, `mental_temp`, is no longer asked; a day that has one and no state shows it read-only, "Stara mentalna ocena ovog dana", and its gate keeps the "Ocena upisano …" mark) and *2. Da li danas trguješ?* ("Danas ne trgujem", a decision taken before the session; with it set and no trade taken the checklist disappears and the day is a rest day) — and the preparation rules. **2 · Tokom sesije**: the trading rules, scored from the trades. **3 · Posle sesije**: **Bez pregleda** (the day's closed trades still missing a setup or an A/B/C grade, or — phase Q — an imported trade the orders file never reached, with no last stop and no entry order type; each a link to its review, `review-gaps.ts`; the 15:20 CT Telegram reminder in `futures-trading` applies the same rule), the review rules, the **Zatvaranje dana** card (phase B7: the day's psychology — the Emocije list, `tj_daily_reports.psychology_tags`, asked once a day instead of on every trade — then the best and the worst closed trade with whether each has a chart, and every mistake of the day, the trader's and the journal's "auto" ones together, with what it cost in $ and R, `day-close.ts`; since phase G also **"Sutra menjam"** — what I learned and change tomorrow, with the fix, `tomorrow_change` — and **"Prilike dana"**, up to three: a sentence each, "U playbook-u", "Mogao sam da uzmem" and one "Najlakša danas" (marking one clears the others), `opportunities` jsonb; a row left without a description is dropped on save), then save and lock. The focus goal, the day's result card and the streak strip left in phase M (08.10.2026): the page measures, and closing the day is the conversation with the mentor over the day's mentor pack. Until 29.09.2026 the page opened with the day's money and asked "before you enter" only after the trading rules, with a no-trade box in the past tense that pointed at a position card H1 had removed. The rules are grouped as "Pravila pripreme / trgovanja / osvrta" here, in the page's language, and within each group **the rules to tick come first and the scored ones below** (K1) — a new rule lands in its own half whatever its order; Settings edits them under the English stage names |
| `/calendar` | Monthly P&L grid by day, weekly totals |
| `/playbooks` | Every setup as one table: Trades / Net P&L / Win Rate / Missed / Expectancy per row |
| `/playbooks/[id]` | One playbook: identity, Stats, Rules (section and rule editor), Trades, Notes |
| `/reports` | How each group of trades did — by setup, instrument, day or any tag (§ Reports) |
| `/tracker` | Redirects to `/daily` (kept because the tracker used to live here) |
| `/notebook` | Notes, folders, tags, markdown |
| `/import` | CSV import wizard, batch history, undo |
| `/api/import/ninjatrader` | `POST`, the NinjaTrader sync (phase I3, § NinjaTrader sync): fills and orders of one platform account, `Authorization: Bearer` with the user's Supabase access token — the only route outside the cookie session |
| `/settings` | Five tabs: Categories (option lists + custom fields, one action creates both; the seeded tags are Serbian since K2, `20260929200000`, which rewrote the trades that carried them), Tracker, Instruments (the eight futures, each with its contract spec AND what it costs — commission per contract per side, or as a share of notional, typed by the trader: a new book's catalog starts at 0 since phase X5, `20261026180000`, X-8 A; a future carries no swap), Accounts (a compact list; each account is created, edited, duplicated, archived or deleted from its own dialog — currency locked once it has trades, the **timezone** shown, not typed: every time is in Europe/Belgrade (`DEFAULT_TZ`, K5, `20260929210000`), a file with its own offset is converted on import, and every account counts its days by the CME's 17:00 CT; the **breakeven range** shown, not typed (§ Metrics, K4), **Flat by (Chicago time)** — `tj_accounts.flat_by`, 16:00 unless set, what `flat_by_close` grades against (phase X4) — and **Practice / demo account** — a flag, `tj_accounts.practice`. **Backtest goes there** (phase G, G-7): an account named "Backtest" with the flag on, its trades imported like any other (TradingView replay through the CSV mapping). Practice stays out of "All accounts" everywhere, so a backtest never moves the real book, the `/daily` tracker or `/playbooks`; it is read by picking the account on the dashboard, `/journal`, `/calendar` and `/reports` (by setup there — `/playbooks` has no account picker), and `futures-trading` measures its MAE/MFE and "šta bi bilo" from the real contract's candles like any trade. No such account exists on 27.10.2026 — it is created here when the first backtest is imported; since phase X2 (26.10.2026) no prop firm's rules are set here, and since X6 (`20261027090000`) the account has none of a prop firm's columns), Deposits / withdrawals (the starting balance shown as the read-only first entry, dates in the account's zone, net flow per currency, delete with a confirmation). An archived account keeps its trades and still appears in filters, marked "(archived)", but is no longer offered for new trades, imports or deposits. Account deletion lives under Accounts. **The open tab is in the URL** (`?tab=accounts`, and `&sub=tags` under Categories), written with `history.replaceState`, so a reload or a shared link lands where it left off |
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
   something, and number bounds accept `-1.5`. The process group holds the state before the session
   from `/daily` (phase G): **Sleep quality** (< 60 % / 60–79 % / 80 %+), **Hours slept** (< 6 h /
   6–6.9 h / 7 h +), **Work shift** and **Day with the child**, each read from the day of the entry —
   a trade whose day has no state is left out — and the retired **Mental temperature (retired)** for
   the days that have one.
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
7. **Under the table**: the scenario panel and co-exposure (the Missed setups panel left in phase G, the Bias dana panel in
   phase E).

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

36 metrics in a single registry (`src/lib/journal/reports/metrics.ts`), 25 built-in dimensions across
four groups (10 off the trade, 13 derived, 1 process, 1 insight) plus one per custom field. Among the trade's ten is **Sve greške (ručne + auto)** (`mistake_all`,
phase B4): the trader's mistakes and the journal's automatic ones per trade, once each, "Bez greške"
when neither — the cost of each mistake whoever named it. Any
metric runs against any dimension — which is why there is one report engine instead of ten report
pages. The tables below cover all 36 (a pair such as Avg win / Avg loss shares a row, Avg R and Total R
sit under R), plus the two drawdown durations the dashboard shows beside them.

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
| Breakeven | Trades inside the account's breakeven band | The band is **fixed** (K4) and **per trade** (30.09.2026; every account since phase X): net P&L within ±0.1R of **the trade's own risk to the stop** (`BREAKEVEN_R`, `riskMoneyAtEntry`; `tradeOutcome` in `breakeven.ts`). A trade with no stop, and a day or a week, fall back to the account's own band (`breakeven_from` / `breakeven_to`, 0 to 0 unless set), no longer to a prop-firm plan's fixed ±$16 / 24 / 36. The tracker reads the same band per account (`breakevenRangeResolver`). Settings shows it and offers nothing to type |
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

**A trade is judged against its own risk** (decided 30.09.2026 for the prop-firm account, on every
account since phase X). The dollar band was then a tenth of the plan's nominal risk, and a micro trade risks a fraction of that: in the mock
book one MES contract stopped out for −$22.25, which is −1.13R, sat inside the band of the time (±$25) and was filed as a
scratch — left out of the win rate and of the expectancy, which read +1.27R where the book averaged
+0.91R. Every per-trade classification (statistics, reports, insights, journal grid, the playbook
checklist in the form) now asks `tradeOutcome`, which compares the P&L with 0.1 × the trade's risk
to the stop, and uses the money band only when there is no stop. Days and weeks on the calendar have
no single risk and keep the money band.

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
calendar days spanned` — derived from the data instead of hardcoded at 252. A trader with 40
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

**A market order has no planned entry** (the trader, 29.09.2026: most entries are market orders). A
trade written into the journal **after its first fill** — the former `/trades/log` after the close, or a
statement import; `created_at` later than the first entry fill — is measured from the **average
fill**, not from the price typed: the day's TopstepX export replaces the fills with the exact ones
while the typed number stays, and a price typed 2.5 points off on a 20-point stop moved R, risk and
target attainment by 12 %. So for such a trade the stats view's `risk_pts` (the denominator of every
R, `20260930020000`), the risk taken, the planned reward and MAE/MFE in R all start at the fill, and
**entry slippage is not stated** — the typed price against the fill measures the typing, and a
market order's real slippage (the price when the button was pressed) is not in any export the
journal reads. The stop and target stay as typed. A trade planned before its entry — a limit that
waited — keeps its sealed plan, slippage included (`plannedEntryOf`, `loggedAfterEntry` in
`plan-snapshot.ts`). Nothing is rewritten in the table, so undoing an import restores exactly what
was.

### Costs, plan and execution

| Metric | Formula |
|---|---|
| Total commissions | Sums over fills (a future carries no swap) |
| Cost % of gross | `costs / gross profit of winners × 100` |
| Avg planned R | Average planned reward, over trades that have one |
| Planned vs realized R | `avg realized R − avg planned R`, over the **same** trades |
| Target attainment | Realized R as a percentage of planned reward |
| Winner target attainment | The same, **winners only** — how much of the plan was taken before exiting early |
| Avg entry slip | Planned entry against average fill, in R against the planned stop. Negative means the fill was worse than planned. Only trades planned before their entry: a market order logged afterwards has no planned price (§ The plan is sealed at entry) |
| Total slip R | Every R given up to entry slippage in the period, added together |
| Setup score | Share of setup criteria met (§ The setup grade is derived) |
| Avg hold | Average holding time in seconds, shown as `44s` / `3m 44s` / `5h 20m`. The Hold duration dimension and the Hold-time card's "Average in minutes" use minute buckets: `<1m`, `1–5m`, `5–15m`, `15–60m`, `>60m` (F5.1, L2). The report filter is `Duration (minutes)` |
| Follow rate | Playbook rules kept / **answered** rules × 100 |

`follow_rate` is the only metric whose meaning depends on which bucket it is in: on a per-rule report
it counts answers to *that* rule. The engine passes the bucket to every metric so this stays generic
and no dimension key becomes a special case.

### Attributing to days

Get this wrong and nothing breaks — the numbers simply file themselves under days you did not live.

- **Money is dated by the CLOSE day.** A position opened on one trading day and closed on the next
  belongs to the next, because that is when the money arrived.
- **Decisions are dated by the OPEN day.** "Did every trade have a stop?" is a question about the
  moment of entry. Under close-dating, a still-open trade is invisible to that rule, so ten unlinked
  open trades would report a perfect day.
- **Days are the ACCOUNT's**, resolved on the server. A `new Date()` read in the browser shifts the
  whole calendar by one column for anyone not sitting in the account's zone.
- **Every account counts the CME trading day, 17:00 → 17:00 Chicago** (phase X4, X-3 A, 26.10.2026:
  the exchange's day, not a prop firm's — until then only an account in a prop firm's mode had it, and any
  other counted the calendar day of its own zone). `accountDayZone` / `cmeTradingDay` in `time.ts`,
  no setting: the book holds CME futures only. A fill at 18:30 CT on Monday is Tuesday's, and the Sunday
  open is Monday's. One resolver (`accountDayZoneResolver`, a `DayZone` per account) dates every
  trade for the calendar, `/daily` and "Bez pregleda", the tracker verdicts, the dashboard, the
  reports and the day-level insights — the same day `cmeTradingDay` computes, so the calendar and `/daily` do not disagree about an evening. In "All accounts"
  **every trade keeps its own account's rule**: a day must not change with the filter on the screen.
  The week is the week of that day (Sunday evening opens the new one), and the hour of entry is still
  read on the account's clock. Computed in Chicago, whatever the account's zone: Belgrade matches it
  most of the year and drifts by an hour in the weeks the two change clocks on different dates.
- **"Today" is the primary account's day** (`todayFor`): after 17:00 CT it is
  already tomorrow, so `/daily` opens the session that has just started. Locked days keep the verdicts
  they were frozen with, and `equity_at_entry` is still the
  opening balance of the calendar day — the denominator of Risk % on every account since phase X.
- **ISO weekdays, 1 = Monday … 7 = Sunday.** Never `Date#getDay`.
- **Dates are written day-first, clocks are 24-hour**: `18/09/2026 21:10`, or `18/09 21:10` in the
  import review, where every row is from one file. Three shapes, exported from
  `lib/journal/time.ts` (`DATE`, `DATE_TIME`, `DAY_TIME`), because "what does a date look like here"
  is one question — it used to have four answers, one of which was `MM/dd`. That one is not a style
  but a different date: `03/07` is 7 March to the reader and 3 July to the format that wrote it, and
  nothing on screen said which. `date-format-conformance.test.ts` fails the build on `MM/dd`, on a
  12-hour clock and on a month name, because one such call added later looks ordinary in a diff and
  the wrong date it prints looks ordinary on screen.
- **Machine-read dates stay ISO**: day keys (`yyyy-MM-dd`), the `yyyy-MM-ddTHH:mm` value behind an execution's time,
  and the CSV/XLSX export. An export that changes shape with a display preference breaks somebody's
  spreadsheet, and a sort in a spreadsheet needs `yyyy-MM-dd` to be a sort at all.
- **Date fields are the journal's, not the browser's** (trader, 01.10.2026). `<input type="date">`,
  `"month"`, `"week"` and `"datetime-local"` draw their text in the browser's language — on a Serbian
  system that was `дд.мм.гггг.` and Cyrillic months in an English journal. `DateField` and
  `MonthField` (`components/ui/date-field.tsx`) replace all of them: the closed field reads `dd/MM/yyyy`
  (`dayKeyLabel`) or "October 2026", the popup is a Monday-first month (or a year of months) in
  English, with Today and, on an optional date, Clear. The values did not change shape (`yyyy-MM-dd`,
  `yyyy-MM`), so no caller did. The dashboard's week picks any day and stores its Monday ("Week of …").
  An execution's time is a `DateField` plus a native `type="time"`, which has no words to translate —
  on a US-English system it still shows AM/PM.

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
| **Survival** | 0–100 | The mean of the parts that have data: `100 − max drawdown %` (over peak **equity**) and `100 − days under water / 90`. The room left against a prop-firm limit was a third part until phase X (26.10.2026) |
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

**Phase E found the third bug still alive on the equity base.** `maxPctOfEquity` answered `0` when a
fall had no positive peak equity to divide by — an account with no starting balance that never got
above water — and the new Survival axis would have read that as a perfect 100. It answers `null` now,
exactly as `maxPctOfPeakPnl` already did, and `balance.test.ts` pins both halves of the distinction:
a fall with no denominator is not a book that never fell.

**Survival, the axis, is the only Survival left.** The "Survival simulation" card, which resampled
the book forward sixty days against a prop firm's MLL or the book's own worst drawdown, left the
dashboard in phase X (X-2 A, 26.10.2026) with `survival.ts` and `tracker/equity-ladder.ts`.

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
**starts with three empty sections** (30.09.2026, `NEW_PLAYBOOK_SECTIONS`): *Zašto ulazim?*, *Gde
ulazim?*, *Gde izlazim?* — the questions every day-trading setup answers. They are the book's own rows,
renamed or deleted like any other, and no rule comes with them: the rules are the trader's to write. If
the sections cannot be written the new book is deleted again, so a book never exists half made.

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
| Time stop | free number, **no upper bound in the database** | five buttons 1–5 days; since F4 five chips **5m / 15m / 30m / 60m / Close** (`time_stop`, `CHECK` on the five); **no longer asked since phase P** — the column stays |
| Mental temperature | `Select` 1–10 | **5 stars**; **no longer asked since phase G** — the state before the session (sleep, shift, child) took its place, the column stays and the days that have it still group by it |
| Week rating | `A–F` | **5 stars**; the weekly review itself left in phase M |
| Execution rating | 5 stars | unchanged |
| Conviction | 1–5, with no field to enter it | **dropped in Phase E** |

**Ten levels is a precision nobody has about their own head.** Asked every morning, it produces noise
that then feeds a report dimension and the `low_mental_temp_entry` rule as if it were signal. Five
stars was both faster and more honest. Phase G (G-2) went one step further and stopped asking for a
judgement of the head at all: sleep quality and hours, the shift and the child are facts that can be
checked and grouped later, and the stars component left with the rating.

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
only the chosen one — and the day trade's time stop, `ChipChoice`, drew its five labels the same way
(both left with the trade form in phase P).
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
position as zero would turn "I do not know" into "it is safe". (On a prop-firm account it was also read
against the DLL left today until phase X.)

**There is no survival simulation since phase X** (X-2 A, 26.10.2026). `survival.ts` replayed the
book's days forward sixty trading days against a prop firm's MLL, or the book's own worst drawdown, and
left with the prop-firm rules it was built around.

**Held at the same time** (`co-exposure.ts`, `/reports`) answers whether two positions are really one.
It gives two numbers per pair, because the familiar one is the weaker. The OVERLAP is the **time**
both instruments had a position open, from the fills' own instants (F5.5 — it was counted in days,
and on a day trader's book every position shares its day with every other); an instrument's own
overlapping positions count once, and each instrument's total time held is beside it. The
CORRELATION compares realized P&L over trading days on which both *closed* something — whether their
days went the same way, a narrower question. It carries a Fisher-z interval and is withheld entirely
below five shared days.

## Learning

One thing the journal used to record and never check.

### The missed setup — retired (phase G, 27.10.2026)

From phase O (08.10.2026) a setup seen on the recording and not taken was written on `/trades/missed/new`
with its entry, stop and target, and `futures-trading` priced it from the contract's candles
(F6.1, `missed_outcome` / `missed_r`). Phase G (decision G-1) took that out: the form, its server
action, the R2 walk, the `/reports` Missed panel and the mentor pack's section are gone; the day's
"prilike" on `/daily` took their place (step G4, migration `20261027140000`) (Lance and Shark, transcript 027: the day's best opportunities,
in the playbook or not, and whether you could have taken them; one marked the easiest, transcript 032) —
a sentence each, no levels, so nothing is priced in R. No missed setup had been written (0
rows on 27.10.2026). The columns stay, and a `missed` row, should one exist, still opens on the trade
page, where its levels can be corrected (`updateMissedSetup`).

### The mentor pack reads a day trader's day

**Export for Claude** on the dashboard writes one Markdown file for the chosen period and account
scope (`mentor-export.ts`), to be uploaded into a chat: every number is computed here, so the model
interprets and never calculates. Since F5.6 (29.09.2026) it carries what decides an intraday futures
book, from values the screens already derive (`mentor-intraday.ts`):

- **Size po oceni setupa i po nedeljama** (phase G, 27.10.2026, `sizeSection`). Per setup grade (A+ / A / B / C,
  or "bez ocene"): trades, average contracts in minis (a micro is a tenth), average risk to the planned stop in
  the account currency and in % of the day's balance; then one row per week (from Monday) with the same averages
  and the change in % against the week before. Measured only — the transcripts' "more on A than on C" and "grow
  about 10 % a step" are for the mentor to read, not a rule.

- **Category tables in Serbian** (phase J, 15.10.2026). "Performanse po kategorijama" names each
  table by the trader's own field name when the field exists in Settings (Tehnički tagovi, Greške,
  Psihologija), otherwise Ocena setupa, Instrument, Smer; a missed setup's reason is "Razlog
  propuštanja". Packs archived before J carry the English headings.

- **The instructions depend on the period** (phase M, 08.10.2026). A **Day** pack is the close of
  the day: the model is told not to review but to question the trader — up to fifteen numbered
  questions at once, from the result, the preparation, the risk and the contracts, the stop and the
  exit to situational ones the data raises (a loss, a broken rule, MAE ≥ 0.7R, an add against the
  position, a moved stop, a day not logged) — then a verdict and one thing for tomorrow. A **Week**
  pack is the review, opening with "0. Domaći" (last week's rules, yes or no with evidence) and ending
  with two or three rules the tracker can check. Any other period keeps the review without the
  homework. All of them name the private `trading-mentor` repo (follow its CLAUDE.md when working
  there) and still work in a plain chat. The intraday instructions read the day first, then the
  timing, then each trade; a group marked ⚠ (under 10 trades) is a hypothesis; trades are cited by
  number; the "Rizik" part of a review is the risk per trade in money and % of balance and its spread.
  The legend explains the trading day (17:00–17:00 CT), the session windows, "after losses"
  (analytics only — money limits are kept on each account's platform, not in the journal), time
  underwater and the phase Y marks of a playbook, checklist or gate written after the
  fact. **No prop firm's state or rules** since phase X (26.10.2026): the pack's prop-firm account section
  (balance, MLL, DLL, consistency, target, risk rule) and the "DLL dostignut" day note are gone.
- **The trader's rules**: every live tracker rule (manual or automatic, with its key), the
  period's mean compliance and the rules broken most often.
- **Day shape** in the statistics: trading days green and red, trades per day (mean and most),
  the average green and red day, the median hold, the average size (the contracts FILLED, `entry_qty`
  — it read the planned `position_size`, empty on a trade logged after its entry and on every import,
  so a 3-lot printed "—" until phase M), and the commissions in total.
- **Daily review**: one row per **weekday of the period** and per day a trade closed on — a day
  without a trade has its row too (phase M) — with trades, W/L/BE, net, R, first entry in ET, the
  longest losing run, most contracts, **Stanje pre sesije** (phase G: "san 80 % · 6.5 h · prva smena ·
  sa detetom"; on an older day "mentalno 4/5" — with "upisano DD.MM. HH:MM, posle prvog ulaza (HH:MM)"
  when `state_at`, or on such a day `mental_temp_at`, is later than the day's first entry, phase Y), "ne trgujem" and "zaključan",
  rules kept (and which were missed, by their short name — the text before the colon — marked
  "ukinuto" when deleted since; "bez prijave" for a day nobody opened, "u toku" for today), and notes:
  the brief's news windows and day note left in phase X9 (X-10). The rules section averages judged
  days only and names the days "bez prijave" and the one still open.
- **Zatvaranje dana (sutra menjam, prilike)** (phase G): for each day that has either, its "sutra
  menjam" and its opportunities, each with "u playbook-u / van playbook-a", "mogao sam / nisam mogao"
  and "najlakša"; the Day prompt asks whether yesterday's change was done and why the easiest
  opportunity was not taken, if it was not.
- **Tracker po danu** (phase M): for each of those days, every live rule as ✓ kept, ✗ broken,
  ? unanswered or — not judgeable (n/a) — so a mentor can question a day with no trade in it. A day
  with no live rule and no mark (before the first rule existed) is left out.
- **When and how** tables by session window, minutes after the open, trade number in the day, state
  before the entry, hold time, entry hour and weekday — each group with its size and the ⚠ mark. Then
  **Stanje pre sesije i rezultat** (phase G): the same tables by sleep quality, hours slept, shift and
  child, by the day of the entry — left out when no day of the period has a state.
- **Every trade oldest first**, headed with its close time on the trader's clock, then: entry and
  exit in the trader's zone and in ET, session window, minutes after the open, the account (when
  the scope holds several), trade number in the day, losses in a row before it, hold time,
  contracts, risk to the stop, time underwater, and the insights
  that fired on it — before every field the trader typed. Since phase M also: **Izvršenje** (contracts
  and average price in and out, a partial close, gross, commissions, net, number of entry and exit
  fills), **Fill-ovi** (every fill in ET, loaded from `tj_executions` at export by
  `getMentorExecutions` rather than with the dashboard; an entry priced against the position after the
  first is marked "dodato protiv pozicije"), **Plan → kraj** (the sealed stop and target against the
  ones the trade ended with — only the keys the seal holds; an import seals nothing, so a trade typed in after its entry reads "upisan posle ulaza — plana pre ulaza nije bilo" and any other unsealed one "plan nije zapečaćen"), **Rizik na ulazu** (the money at the stop
  and its share of the balance the entry day opened with) and the **Playbook** by name — with "napravljen DD.MM. HH:MM, posle ulaza" when the playbook
  was created after the first fill, and a **Checklist** line ("upisan …, posle zatvaranja") when its
  answers (`tj_position_rules.created_at`, the latest) came after the close (phase Y, 14.10.2026; times
  in Belgrade). The context says whether the plan was
  sealed before the entry or typed in after a market order, whose R and risk come from the fill.
- **Category tables** print once per field (a custom field sharing a fixed one's key is not
  repeated), a field nobody filled in is left out, and a group of breakeven trades only shows "—"
  for its win rate rather than 0 %.

Without a day rule (`tzOf`) the pack is the earlier, account-agnostic document; its tests cover
those parts on their own.

## Process tracking

**Tracker rules** are daily obligations, per weekday. Twelve are scored automatically from data —
every trade linked to a playbook that existed when it was entered (phase Y, 14.10.2026: a playbook
created after the first fill fails the day like a missing one, and /daily says "playbook napravljen
posle ulaza"; trades carry `playbook_created_at` from `getTradesWithStats`; days locked before that
keep their frozen verdict, Y-4), every trade has a stop, every trade has a thesis written before
entry, the day-trading rules and the review rules in the table below — and the rest are ticked by hand.

**The tracker measures process only** (phase X, X-1 B, 26.10.2026, `20261026120000`). The trader:
"Brišu se, tracker meri samo proces … jer ako bude više naloga na prop firma biće konflikta." The
five money rules — `max_loss_per_day`, `max_loss_per_trade`, `risk_per_trade`, `risk_matched_intent`,
`no_entry_after_daily_target` — left the code; money limits are kept on each account's own platform.
Their rows are **retired, not deleted** (`deleted_at`), and the DB CHECK on `auto_key` still admits
their keys: a locked day's frozen verdicts point at those rows and stay what they were. With no
evaluator left for them, an unlocked past day simply leaves them out (no verdict = not applicable).
The factory list (`tj_seed_tracker_rules`) has no money rule and no manual "Walk Away Target".

**No rule counts trades** (30.09.2026, `20260930070000`): `max_trades_per_day` and
`stop_after_losses` were deleted with the count setting in Settings › Tracker (neither had a single
answer), and so was the tilt insight that priced the same run. On 08.10.2026 the trader brought back
one run, not a count: **two stop losses in a row end the day** (`stop_after_two_losses`, fixed at
two, no setting). The weekly loss rule and the percentage-of-equity limits left in H2
(`20260929170000`).

**The day trader's rules (F4 `20260929110000`, 08.10.2026 `20261008140000`) and the review rules (phases Q, Y).** Each
day-trading rule is a decision taken at entry, so each is charged to the trading day the trade was OPENED on:

| Rule | Fails when | Not scored (`na`) when |
|---|---|---|
| `flat_by_close` | a position closed after its account's flat-by time that day, or is still open once that time has passed — on every account since phase X4 (`tj_accounts.flat_by`, `HH:MM` Chicago, 16:00 unless set, migration `20261026140000`; it was a prop firm's 15:10 CT on its accounts only) | no trade opened that day, or a position is still open before the close |
| `stop_after_two_losses` (08.10.2026, `20261008140000`) | an entry on an account follows two stop losses IN A ROW, closed before it that trading day — a loss is below the breakeven band (a tenth of the trade's risk), so a win or a scratch in between breaks the run | the day had no entry, or a close before the entry has no price |
| `thesis_recorded` (phase Q) | a trade has no `thesis` ("šta sam rekao pre klika"), read live; WHEN it was said is the recording's, so the mentor's | as above |
| `review_complete` (phase Q; phase B6, `20261026170000`) | a trade lacks a grade, an exit reason, or a mistake when the grade is not A; a C also needs one sentence (`trade_journal_notes`). TF ulaza and the psychology tag left it in phase B, the bias of the day in phase E | as above |
| `screenshot_per_trade` (phase Q; phase B6) | a trade graded C, or the day's best or worst closed trade by net, has no chart (`tj_trade_images`) | as above; also no trade of the day closed yet (`not_yet`) |
| `daily_psychology` (phase B5, `20261026170000`) | a day with a trade has no psychology on /daily ("Zatvaranje dana", `tj_daily_reports.psychology_tags`) | no trade opened that day |
| `honest_tags` (phase Q) | on the same trade: "Ispoštovao rizik" beside a failed `stop_loss_set` (phase X: the risk rules it was also read against are gone), or an A ("Bez greške") beside any failed trading rule, or (phase Y5, 15.10.2026) "Vodio po planu" on a trade without a playbook or with one created after the entry; the review rules do not count as trading errors. Evaluated last, from the other verdicts | as above |
| `trading_window` (phase Y4, 15.10.2026, `20261015090000`) | an entry before `from` or from `to` on, or a position still open once the minute of `to` has passed — an exit within that minute is the time exit, not a breach. Times are Belgrade; the window is `config.windows[]` of `{ since, from, to }`, the latest `since` on or before the day applies (London weeks 09:00–12:00, NY weeks 14:30–17:30 — to lunch since phase G, written for the book from 28.10.2026 by `20261027140000`; it was 14:30–18:00), set in Settings › Tracker (the "London 09:00–12:00" / "NY 14:30–17:30" presets fill the hours, then "Save window", `setTradingWindow`), so a change next Monday leaves this week as it was. Reverses Q-2's retired "Vreme trgovanja" | no trade opened that day, or no window for the day (`unconfigured`) |
| `no_entry_first_minutes` (phase G, 27.10.2026, `20261027140000`) | an entry in the first 10 minutes (`FIRST_MINUTES`) after the open of its session — London 08:00 London time, New York 09:30 New York time, each on its own clock (`afterSessionOpen`, `session-window.ts`), so 09:00–09:10 / 15:30–15:40 Belgrade in a normal week and the shifted hours in the weeks the US and Europe change clocks apart; an entry outside both sessions is not judged. The same entries are the automatic mistake "Ulaz u prvih 10 min" | no trade opened that day |

The close is the account's flat-by time (Settings › Accounts, "Flat by (Chicago time)", `flatByFor`
in `flat-by.ts`). **No rule reads the morning brief since phase X9** (X-10, 26.10.2026,
`20261026190000`): the brief is about the market and writes nothing into the journal, so
`no_entry_in_red_window` was **retired** (`deleted_at`, its key kept in the CHECK for the locked days
that froze it, like the money rules of X1), and a holiday or an early close is no longer known here —
the trader keeps it on the platform. The checklist says a close time, a window, or the run of stops.
`htf_bias_set` ("HTF nivoi i bias", phase Q; the /daily card from 19.10.2026, phase D) was retired the
same way in phase E (27.10.2026, `20261027120000`): the journal holds no forecast of direction, and
`review_complete` and `honest_tags` no longer read one.

The three manual rules these replaced — "at most two trades a day", "no entry fifteen minutes around
red news", "stop at the daily loss in USD" — were **retired, not deleted** (`deleted_at`), so every
past day they were live on keeps its score.

**`thesis_written` grades only trades planned before their entry** — `created_at` no later than the
first fill (`plannedBeforeEntry` in `tracker/auto-rules.ts`): a plan-first trade, and a resting plan
the import later filled. A trade logged after the close (the former `/trades/log`) or created by the import had
no "before" in which a thesis could exist — its seal is stamped at the moment of writing — so it is
neither failed nor passed, and a day with only such trades is `na` with its own reason ("nijedan
trejd nije planiran pre ulaza"), not `pass`. The quick log's sentence goes to `trade_journal_notes`,
never to `thesis`: sealed as the reason before entry, a sentence written after the close would be
exactly the rationalisation the rule reads the seal to catch. Unlocked past days re-read under this
meaning (a CFD trade typed after its entry is now `na` there); locked days keep their frozen verdicts.

Which rules applied on a given day is decided by comparing the day against the rule's `created_at`
and `deleted_at`; that is why those are timestamps and why the table has no `is_active` boolean. A
rule added today must not knock down a year of past days; a rule retired tomorrow must not lift
yesterday's score. The same holds for a rule's **configuration**: a day in May stays scored against
the limit that applied in May.

**A day with no trades is `na`, never `pass`.** "I did not exceed max loss" is vacuously true on a day
you did not trade, and scoring that as a pass would let a 200-day streak be farmed by not trading.
`na` drops out of both numerator and denominator, so a disciplined day with no trades still carries
100 % on the rules it *could* answer.

**A weekday nobody opened is "bez prijave", not 0 %** (phase M, 08.10.2026). A past day with no trade
verdict, no check-in row and no saved report has status `unlogged`: no percentage, out of the mean and
the streak, and named as such in the mentor pack — it used to score every manual rule as missed, so a
week with one trading day read "29 % over 3 days". Any trace of the day (a ticked box, a saved report, a
trade) makes it a judged day again, unticked rules included. **"Danas ne trgujem"**, once saved and with
no trade taken, makes the day a **rest day** (`rest`, trader 08.10.2026): every rule is n/a, the
checklist disappears from `/daily`, the badge reads the day as kept, and the day is out of the mean and
the streak (counting it as 100 % would inflate the mean with days off). A trade taken anyway voids the
flag and the day is scored like any other.
**Today, while still pending**, is shown but not averaged.

**Locking a day** freezes the automatic verdicts into rows and is irreversible — enforced by a trigger
that fires on any edit to a locked report, so there is no unlock action that would need writing.
Trades from a locked day stay editable: P&L is a fact that must remain correctable, and the frozen
verdicts are what stops compliance from following it. **A day is not locked while one of its trades has
no stop, or a moved stop with no original** (`lockRefusal`, 09.10.2026): the risk rules are computed
from the stop, and the lock would freeze them against the wrong one for good. Setup and grade do not
hold the lock.

**Playbooks** hold groups of rules; answering their checklist writes `tj_position_rules`, which feeds
the follow rate. Since phase B the trade page asks only the setup criteria, and the rule editor warns
when a group is empty ("Prazne grupe"). A playbook may carry a **Default entry TF**
(`tj_playbooks.default_entry_tf`, `20261026160000`, set in its details dialog; "3 candle 5min BOS" →
5m), which a trade without TF ulaza gets pre-filled, marked "auto". The quick-entry lists
(`20261026150000`) leave Tehnički tagovi with Sweep likvidnosti, SMT divergencija and FVG and the
manual Greške with Rani ulaz, Jurio cenu, Teza posle klika, Osvetnički ponovni ulaz, Rano zatvorio
dobitak and Stop postavio bracket, ne ja (plus "Bez greške"); the others are `is_active = false`,
so older trades keep and show them. An unanswered rule counts in neither the numerator nor the denominator.

**Insights** are 24 rules at three levels — trade (12), day (10), portfolio (2) — reading the
same enriched trades the reports do. Every rule declares a `minSample` and none fires at n=1. No
insight is stored in the database: thresholds change, and a stored insight would go stale against a
changed threshold while still looking authoritative. The panel and the mentor pack show one row per
rule **branch** (rule, severity and title): `exceed_avg_hold_time` is a critical "Loser held too
long" and an info "Longer than usual", and one row for both counted a winner held long as a critical
loser.

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
have different subjects, so folding `sizing_problem_day` into `unusual_size` would put a day's key
where a trade id belongs. They stay separate for that reason rather than for a good story about
causes.

**F5.3 moved them to the trading day** (29.09.2026). The three week rules were swing translations of
TradeZella's day rules; for a day trader the day is the unit again, so `overtrading_week` and
`low_efficiency_week` became `overtrading_day` (more than 2× your daily average) and
`low_efficiency_day` (4+ trades, green, under a quarter of your average green day), both waiting for
ten trading days of history. `revenge_trade` looks for a losing entry within **5 minutes** of a loss
on the **same account**, not within a day. `tilt_week` (a losing week of short holds) left, and so did
its successor `tilt_after_losses` (30.09.2026): the trader stops the day on money, never on a count of
losses, and "After losses" stays a dimension in `/reports`, a measure rather than a rule.
`patience_paid_off` came back from the omitted list: a green day whose first entry came 30+ minutes
after the open of its session — London's 08:00 (London time) or New York's 09:30, i.e. 09:00 / 15:30 Belgrade
since phase N (14.10.2026); an entry before either open does not count.

**F5.3b brought back the time-underwater pair.** `futures-trading`'s `journal_mae.py` now writes
`tj_positions.time_underwater_pct` in the same write as the R2 MAE/MFE: the share of the trade's time,
first entry to last exit, in which the running P&L — realized on the exits so far plus the open
contracts at the price, fees left out — was below zero, from the same candles (a quiet second carries
the last price). The journal only reads it. `most_time_in_drawdown` fires from **75 %** (a warning on
a loss; on a winner an observation that the entry came early); `deep_in_drawdown_day` weights each
trade of a day by its length and fires from 75 % too, and only when every trade of the day was
measured. `maximize_your_profit_day` stays out: it needs the peak of the day's cumulative P&L, and
`gave_back_profit` covers the behaviour from MFE.

**F6 (29.09.2026)** removed the two vault-era rules (`against_macro_bias`, `cot_chase`; decision
M2-A) and moved `stale_plan` to the trading day (decision M3-A): a plan is stale once its trading day
is over — 16:00 CT, the CME day's end (15:10 CT, a prop firm's flat, until 27.10.2026), on the day it was
written, or on the next trading day when it was written after that — with no fill and not marked
missed (`planTradingDay` in `flat-by.ts`, the same rule `futures-trading` ends "Šta bi bilo" by,
`prozor_plana`).

**H1 removed six more** (28.09.2026): five swing rules that joined on the per-position check-in, the
time stop in days, the written thesis and the weekend: `acted_against_the_plan`, `past_time_stop`,
`unplanned_partial`, `entry_without_thesis` and `weekend_hold_record` — and then a sixth,
`swap_ate_the_trade`, since a future carries no swap. With them went four report
dimensions (`touched`, `thesis_state`, `weekend_hold`, `time_stop_breached`) and the weekly recap's
weekend, checked, touched and thesis-slipped counts. A book that is flat by the close has none of
those things to measure.

### No prop firm's rules (phase X, 26.10.2026)

The journal is **neutral about prop firms**. The trader (X-1 B): "tracker meri samo proces … jer ako
bude više naloga na prop firma biće konflikta" — money limits (MLL, DLL, daily target, risk per
trade) are kept by the trader on each account's own platform, not computed here. Until phase X the
book ran a prop firm's rules (F3, R, T: its rules module, status, banner and parity file); they left with:

- the **prop-firm banner** and its status widget, the **DLL / daily target** line of the
  "Pred sesiju" card and of the open positions' heat, and the **Survival simulation** (§ Survival);
- the **risk budget** and the contract count sized from it (the firm-risk function and
  `computeFuturesContracts`), the **Scaling Plan**, consistency and both XFA payout paths, the
  reset and the "MLL reached blocks new exposure" guard;
- the **room above the MLL as the Risk % denominator**: Risk % is the risk to the stop over the
  equity the entry day opened with on every account (`riskPctTaken`), and the `/reports` buckets sit
  around a day trader's fraction of a percent (< 0.25 %, 0.25–0.5 %, 0.5–0.75 %, 0.75–1 %, 1–2 %,
  ≥ 2 %);
- the prop-firm section of the mentor pack, and the parity test with `futures-trading`'s brief
  (gone from both repos with X-10: the brief computes no account any more).

**Phase X4** made the 17:00 → 17:00 CT day the CME day of every account (§ Attributing to days) and
gave `flat_by_close` the account's own flat-by time (§ Process tracking). **Phase X6**
(`20261027090000`, 27.10.2026) dropped the prop-firm mode columns of `tj_accounts` (with `risk_rule_*`) and
`tj_positions.risk_budget_at_entry` / `room_at_entry`: nothing wrote or read them since X4, and since
X8 (`futures-trading`) the brief and the evening message no longer read `tj_accounts` either; the
values of the one prop-firm account are in the nightly backup. **Phase X9** (`20261026190000`) stopped the journal reading the brief: the
"Pred sesiju" card, `no_entry_in_red_window` (retired), the "red window" auto mistake and the brief's
windows in the mentor pack are gone; `tj_session_briefs` stays as history. **Phase X5** (`20261026180000`) made the factory data neutral: catalog commission 0
for a new book, no prop-firm or DLL item in the factory lists, and the trader's day-end item
renamed "Kraj dana (ravno)". **What stayed:** the 15:10 CT horizon of "Šta bi bilo" — until 27.10.2026, when it moved to the CME day's end, 16:00 CT (scenario v3, below);
and the TopstepX import formats, which are a platform's files, not a firm's rules (X-7).

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
match, prices within a relative tolerance, and prices are shown as the file wrote them. So is what only the TopstepX orders file brings (14.10.2026): a trade imported before without its orders, with no last stop or entry order type, is a match (`last stop —→…`, `entry order —→…`), so the second import fills them instead of being skipped. The chart
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

**A third question finds the plan a limit filled** (kept for the history; since phase O no plan is
written in the journal). A limit written plan-first (the former `/trades/new`) has no
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
- **Costs are two columns**, `Fees` (exchange and NFA) and `Commissions` (the platform's); the trade's
  cost is their sum. `PnL` is gross and is checked against price move × multiplier × size, so a
  contract whose multiplier differs from the catalog's says so on its row instead of in the P&L.

**One position, one trade** (`groupTopstepXTrades`, 09.10.2026). TopstepX exports a position built in
several entries as one row per entry lot, each with the same exit — the trader's test of four 1-lot buys
closed together came out as four rows. Rows of the same contract and side whose holding overlaps (the
book never went flat between them) are joined into one trade: every entry as its own fill, the exits
with the same instant and price joined into one fill, costs and result summed. The orders export
confirms the shape — one bracket for the whole position, its size grown with each entry — so the
stop, the target and how it ended come from it unchanged.

Each row then goes through the same matching as any file: a trade already in the journal for
that day is recognised (entry within 0.05 %, entry time within ten minutes) and its rough numbers
are replaced by the exact fills, while setup, grade, mistakes and the sentence stay.

### TopstepX orders export, chosen with the trades (phase O, 08.10.2026)

The trades export has no stop and no target, so an imported trade had no R. TopstepX's **orders**
export has the bracket, and the wizard takes both files at once (`multiple`; each is recognised by
its header — the orders file alone is refused, `lib/journal/topstepx-orders.ts`). For each trade
`bracketFor` finds the filled opening order of the same contract and side within two seconds of the
entry, and the stop-loss and take-profit orders on the other side created between the entry and the
exit (the filled one wins, else the latest). It gives the **target**, the stop's **last** price, the
**entry order type** (market / limit / stop) and **how the trade ended** (stop, target, by hand). The trades export names no account, so the orders file's
TopstepX account name is checked against the journal account picked (`orderAccountWarning`, 09.10.2026):
a "PRAC-…" file going into a real account, a real one into Practice, or a file holding more than one
account is named above the button — a warning, not a refusal.

**A stop keeps only its last price.** Shown by the trader's test on 08.10.2026: a stop placed lower
and moved to breakeven leaves one row, at the entry. So the last price is written as the trade's stop
only where it cannot have been moved; a last stop at the entry or in profit (breakeven, trailing) is
named on the row — "stop moved … take the original from the recording" — and the stop stays empty.
The last price is kept in `tj_positions.final_stop_price` either way, with `entry_order_type`
(`20261009090000`). The exit reason comes from the orders (`exitReasonFromBracket`): the stop filled
is "Pogođen stop", or "Prateći stop" when it had been moved; the target filled is "Pogođen target"; a
hand close is named off the prices.

A merge writes the stop, the last stop and the entry type only where the trade has none, and records
it (`stop_written`, `orders_written` in `tj_import_rows.parsed.prev`) so undo empties them again
(`clear_stop`, `clear_orders` in `tj_undo_import_batch`).

**Was the stop moved?** (`stop-moved.ts`, read on every screen, not stored.) Sure when the last stop
sits at the entry or in profit (`moved_be`), or when the price went further against the trade than the
last stop and the trade was not stopped out (`moved_mae`: MAE arrives from the exchange's candles the
evening of the trade and exactly the next morning). Trade #1 of 07.10.2026 is the case: last stop
31227.5, MAE 31206.5, closed at the target. A moved stop whose trade carries no original — none, or
the last price standing in for it — is a gap on `/daily` ("Bez pregleda": *originalni stop (pomeren —
sa snimka)*), as is a closed trade with no stop at all (no R). The trade page `/trades/[id]` (phase P; it replaced "Dopuna iz
snimka") asks for the original stop and the target as they stood at the entry, and what was said before the
click (`thesis`), beside setup, grade, mistakes and charts; a stop sealed empty at entry is written into
the seal too, or every R would keep reading the empty one. The mentor pack prints **Stop:** — original,
last in the platform, moved or not — and how the entry was placed.

### NinjaTrader sync — no export (phase I3, 27.10.2026)

The trader's decision (I-4 … I-8): the journal reads NinjaTrader's own database instead of a file. A script on the
trader's PC, `futures-trading/tools/nt_sync.py`, runs every five minutes while he is logged in (Windows Task
Scheduler), copies `Documents\NinjaTrader 8\db\NinjaTrader.sqlite`, reads the fills and the orders of the accounts
set up for it (only the real Tradeify account) for the last 14 days — counted from 17:00 CT, when no day trade is
open, so the window's edge never falls inside a trade and leaves its exit looking like a new position — and posts them to `/api/import/ninjatrader`
as the journal user (the password sits in Windows Credential Manager).

- **Which account.** Settings › Accounts › "Account in the platform" (`tj_accounts.platform_account`) names the
  NinjaTrader account a journal account receives; unknown → the route answers 404 and writes nothing.
- **What a trade is** (`ninjatrader-sync.ts`, `ntTrades`): per contract, flat → in a position → flat; a fill through
  flat ends one trade and opens the next. The stop is the stop order's FIRST price from NinjaTrader's order history
  (`OrderUpdates`), so a stop moved to breakeven still shows the risk the trade was taken with; the last stop and
  the target come from the bracket, how the entry was placed from the entry order, how the trade ended from the
  exit order (stop, target, anything else manual). NinjaTrader stores no commission, so each fill's fee is the
  instrument's commission per lot (Settings › Instruments) × size.
- **Sent again, written once** (`ntImportItems`). Every fill carries NinjaTrader's id (`tj_executions.external_id`,
  unique per user). All fills known → nothing; a trade that was open last run and has since closed → its new fills
  are merged into the same trade; fills of one trade spread over two journal trades → skipped and reported. A new
  trade goes through the same match as `/import` (decision I-8): one existing trade of the same contract, side,
  size and time within ten minutes is merged into; anything less certain is created.
- **Same write path.** The route builds `ImportItem`s and calls `commitImport`, so batches, audit rows and undo work
  as for a file; the batch is named `NinjaTrader <account>`. A merge never overwrites what the trader typed (the
  stop from the recording, the thesis, the grade, the categories). Undo restores the displaced fills without their
  NinjaTrader ids, so the next run merges into the restored trade by the match above.
- **Auth.** `createClient()` honours `Authorization: Bearer` (no cookies), and the session middleware lets this one
  path through; the route checks the token itself (`getClaims`; a missing, refused or malformed token is a 401,
  before anything is read — `route.test.ts`). RLS applies exactly as in the app.

### What the file may overwrite, and what it may not

A merge replaces the fills — entry, exit, size, times, commission — because those are the broker's
facts and the reason to import at all. Plan, grade, thesis, psychology and notes are never touched.

Two levels sit between those categories, and they are treated differently:

- **Target.** Mapped from a `T/P` column and written **only onto a trade that has none**. A target
  already on the trade is the trader's plan; a missing one is simply not recorded yet. Undo empties
  the ones this import wrote (`tj_import_rows.target_written`) and leaves the rest alone.
- **Stop.** Mapped from an `S/L` column and written **only onto a trade the import creates** — never in
  a merge (the TopstepX orders export is the exception: onto an empty stop only, see above). A statement states the levels as they stood **at the end**, and a stop pulled to breakeven
  mid-trade is the commonest thing a trader does — merging that number would overwrite the stop the
  risk was actually taken with.
- **Entry (K3).** A trade the import creates — one never written as a plan — takes its planned entry
  from the size-weighted entry fills, with the stop and target above when the file has them
  (`importedPlan` in `import-commit.ts`). Live columns only; the seal is unchanged. The TopstepX trades
  export carries no stop or target; with the orders export beside it the trade gets both (above).

### TradingView backtests (removed)

The TradingView "List of trades" import — a Strategy Tester or Bar Replay export joined into positions,
its size rescaled to lots and its excursions written as MAE/MFE — left in H2 with the backtest account
kind (decision I5-A: the book was futures only). `tj_positions.excursion_source` still reads
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
| Images | All moved across, after the survivor's own (a list since 30.09.2026) |
| Rule answers, check-ins | Moved across where the survivor has no row for that key |

**Two kinds of merge (30.09.2026), chosen in the dialog.** *The same trade, recorded twice* (typed,
then imported): the fills are taken whole, never combined — adding them together would double the size
and invent a P&L nobody traded. *Two positions, one trade* (two orders opened together, two rows of the
TopstepX export): both sets of fills stay and the trade is their sum — status from all the fills, the
planned size and a typed-in result added (`p_combine`, `20260930060000`). Replacing there left 2 contracts
of a 4-contract trade. The dialog proposes *combine* when every fill on both sides came from an import
(`defaultMergeMode`) — the export lists each position once, so two of its rows are never the same trade —
and *replace* otherwise.

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

**Reset everything** (`tj_reset_my_data`). Deletes all 25 tables for the caller, then calls
`tj_seed_my_defaults()` — the same seed the dashboard runs on an empty account, so "reset" and "first
load ever" end in the same state. It asks for `RESET EVERYTHING` to be typed. **The chart image
files go too** (30.09.2026): the SQL deletes the `tj_trade_images` rows, Supabase refuses a direct
DELETE on `storage.objects`, so `resetAllData` then empties the user's folder in the `trade-images`
bucket through the Storage API, 100 files a page. Files after rows, never before: a reset that fails
leaves every picture its trades point at, and a file removal that fails says so rather than leaving
orphans silently. **A reset is not the end of the record**: the nightly backup in `futures-trading`
(§ Where this sits) keeps the book and its images for 35 days and a snapshot a month after that, and
its restore SQL deletes what the reset seeded before putting the book back.

The table list is maintained **by hand**, chosen over a catalog loop so that a table added later
shows up as a visible omission rather than a silent survivor. That mechanism worked as designed right
up to the point where nobody looked: `tj_dashboard_templates` (`20260818120000`) hangs off
`auth.users` rather than off anything the reset deleted, so saved dashboard layouts outlived "reset
everything" until `20260916100000` put it on the list. `tj_playbook_sections` was added in the same
migration — it already fell through the cascade from `tj_playbooks`, but the list is the record of
what "reset everything" means, and a reader should not have to trace foreign keys to believe it.

What actually comes back, counted from the seed functions rather than assumed from their names:
**1 Main Account (USD, `Europe/Belgrade`, asset class Futures; the balance is chosen in Settings),
the eight futures (commission 0, phase X5), 10 lists holding 74 options, 12 tracker rules,
7 custom fields, 4 note folders.** Since `20260930030000` the factory set is the day trader's own;
since phases X1 and X9 (`20261026120000`, `20261026190000`) it is six manual rules (before the
session: calendar and HTF levels, mental check-in; while trading: trading hours, risk control; after
it: journal and tags, screenshots) around six automatic ones (playbook, stop, thesis, flat by the
close, two SL in a row, and since `20261027100000` the day's psychology) — no money rule, no walk-away target and no red window of the brief — and
the note folders Plan sesije, Osvrt na sesiju, Trade Notes (the system
folder a trade's note opens in) and Nedeljni osvrt, each with an intraday template. The lists are the
day trader's since F4 (`20260929120000`), in Serbian since K2 (`20260929200000`), and since phase J
(`20261015120000`) they are **the trader's own book of 15.10.2026**, read from the database that day:
the mentor had merged the duplicates, fixed the typos and added the mistakes he actually makes, so a
reset no longer brings back the list of 30.09. Phase X5 (`20261026180000`) renames the day-end
item to "Kraj dana (ravno)" and leaves out "Ulaz posle dnevnog cilja" and "Ulaz posle DLL-a", which
read a firm's money limit. Phase E (`20261027120000`) leaves out the "Bias dana" list and field and
the "Bez biasa dana pre ulaza" mistake. Lists and fields are named Smer, TF ulaza,
Tehnički tagovi, Ocena setupa, Razlog izlaza, Razlog propuštanja, Emocije, Disciplina, Greške (the
field over Emocije and Disciplina is Psihologija); TF ulaza 30s / 1m / 2m / 5m / 15m / 1h; seventeen
mistakes, from Bez greške and Ulaz bez setupa iz playbook-a to Ulaz posle 2 SL, Stop postavio bracket,
ne ja and Dobitak pretvorio u gubitak. Every value the code reads by name is in it (Bez greške,
Ispoštovao rizik, Vodio po planu, the five exit reasons `autoExitReason` writes), and `seed-categories.test.ts`
checks the function row by row. The list categories (Context, ICT Setup, Risk, Psychology) are kept
as the database has them. The "Risk %" list left in H2. In an existing book the same migration added those items and switched
the swing ones off — `is_active = false`, not deleted, because trades keep tags as text.

**An instrument you delete stays deleted, since 20.09.2026.** `tj_seed_instruments_defaults` inserted
the 91 rows on every call with `on conflict do nothing`, and `ensureDefaults()` calls it from the home
page — so a symbol deleted in Settings was back on the next visit, and back with the CATALOG's
contract spec rather than the corrected one. It is the same shape of bug as the playbook seed below,
and it is now guarded the same way the account seed always was: the insert runs only when the user's
catalog is empty. A reset still restores the whole seed, because it deletes the catalog first — and
since `20260928140000` the seed is the futures, not the 91-symbol CFD catalog it was then — eight of
them since `20261017120000` (phase D), which added gold GC / MGC to the seed and, once, to every
existing book (they had never been in the catalog, so nothing deleted came back).

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

159 files in `supabase/migrations/`, named `YYYYMMDDHHMMSS_description.sql`.

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
- **M3 (08.10.2026) drops `tj_weekly_reviews`, `tj_experiments` and `tj_focus_goals`**
  (`20261008120000`, all three empty on the day) after M1 and M2 had taken every reader off `main` and
  deployed; `tj_reset_my_data` is restated without them. The empty tables can be rebuilt with
  `supabase/rollback/20261008120000_drop_weekly_experiments_focus.down.sql`.

### Security model

- **RLS on all 25 tables**, ownership pattern, verified against the live database.
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

2,795 tests across 179 files, split into **two vitest projects**: `lib` (environment `node`, files
`*.test.ts`, 2,249 tests in 126 files) and `components` (environment `jsdom`, files `*.test.tsx`, 546
tests in 53 files). The rule is the extension, so no file can land in both. The split exists so that
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
`src/components` is Phase 10's render layer — 61 of 102 files have a **dedicated** render test, and
the rest are reached only incidentally, through whatever a tested component happens to import (many
`src/components/ui` primitives export sub-parts — `DropdownMenuRadioItem`, `PopoverTitle` — that
nothing in this app renders). A single blended number would either drag the library floor down to
component-layer reality or lie about how tested the render layer actually is; two floors say both
things honestly instead of averaging them into a number describing neither.

Four things the numbers deliberately do **not** claim:

1. **`src/components`'s floor is not "well tested".** 64/64/61/65 is the honest state of a layer that
   began this phase at zero and is not finished — Phase 10 covers the highest-risk components
   (Tier 1 and 2 in `ROADMAP.md`), not all 102. Reading this floor as "the UI is 64 % correct" repeats
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
4. **`src/app` (17 pages across 35 files) has no number at all**, and "no number" is not "0 %" — it is
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
| Backtesting and trade replay | Done directly in TradingView. An embed does not help: Bar Replay lives in their application, and the widget is a black box the code cannot step through. The journal no longer imports its results (H2; a backtest is a Practice account, G-7) |
| Broker sync that fills in a whole trade | Manual entry is a choice and an advantage — it forces the trade to be read once more. A statement import corrects the objective numbers afterwards; everything that is a judgement is still typed |
| Spaces, mentor, leaderboard | Single-user system |
| AI chat and agents | The mentor-pack export and the insight rules give the same thing without the API cost |
| Options (DTE, strike, expiry) | Not traded |
| Intraday dimensions | **Built in F5.2 (29.09.2026), sessions redrawn in phase N.** `/reports` groups by **Session window** — since phase N (14.10.2026) the trader's chart lines (`trading-mentor/GRAFIK.md`), each on its own exchange's clock and labelled in Belgrade time: Azija 00:00–06:00 (18:00 New York reopen to New York midnight), Pre Londona 06:00–09:00, London 09:00–14:00 (08:00 London to New York's 08:00 pre-open), NY pre otvaranja 14:00–15:30, NY AM 15:30–17:30, Ručak 17:30–19:30, NY PM 19:30–22:00, Posle zatvaranja 22:00–00:00; in the week the clocks disagree the New York ones come an hour earlier (`session-window.ts`; until then one "Globex night 18:00–08:00" held every London trade) — **Minutes after the open** of the entry's own session, London's or New York's (Pre otvaranja, 0–15, 15–30, 30–60 min, 1–2 h, 2 h +), **Trade number in the day** (per account; the 4th on is one bucket) and **After losses** (first trade of the day, after a win or scratch, after 1 loss, after 2+ — the losses that had already closed when the entry was taken; a measure, not a rule). |
| Economic calendar | Lives in `futures-trading`: the morning brief carries the day's releases with their red windows (on Telegram; nothing of it in the journal since X-10) |
| Running P&L curve per trade in the journal | The journal still holds no prices. `futures-trading` walks the curve over the R2 candles and writes the one number the insights need, `time_underwater_pct` (F5.3b); the peak of a day's cumulative P&L, which `maximize_your_profit_day` would need, is measured by no one |

## MAE/MFE

**MAE/MFE comes from the exchange.** Every trade in the book is a future, and its two prices are
written from the traded contract's own candles:

| Trade | MAE/MFE source |
|---|---|
| **Future** (NQ, MNQ, ES, MES, 6E, M6E, GC, MGC) — TopstepX import | The traded contract's own candles in Cloudflare R2, written by `futures-trading/tools/journal_mae.py`: exact from Databento every morning at 06:15 UTC, and provisional from Yahoo's 1-minute bars of the same contract hourly on weekday afternoons and evenings, so the evening review has them (`excursion_note` says `… · 1m privremeno` until the exact value replaces it). 1-second candles. The contract is the one in the name (`MNQZ6`) or the CME roll rule's, and it is the right one only if **every fill lies inside its own candle** (±1 tick) — otherwise the trade is refused with the reason |

`tj_positions.excursion_source` records who wrote the two prices: `manual` or `r2` (`mt5` and
`tradingview` on history written before H1 / H2), and `excursion_note` says what they were measured
on (`MNQZ6 · 1s`). `time_underwater_pct` comes with the R2 prices (F5.3b), and so does
`last_underwater_seconds` (phase W); a trade R2 measured before either column existed gets it once, on
the next run.

**Time stop (phase W, 09.10.2026).** `last_underwater_seconds` is the seconds from the first entry to the
end of the last moment the running P&L was below zero, walked over the same candles as
`time_underwater_pct`. On a winner it is the moment the trade went green for good — in profit and never
back below the entry (decision W1-A); a trade never in the red reads 0. The dashboard card **Time stop**
(`time-stop.ts`) reads it for winners only — median, 75th and 90th percentile, and how many never went red —
and for losers it reads `time_underwater_pct` × duration: how long they sat in the red before they were
closed. Its ladder (1, 2, 3, 5, 10, 15, 30, 60 min) puts the winners already green at N beside the losers
still open at N. The second column is an upper bound — the most a cut at N could have closed before the
stop — because whether a loser was in the red at that exact minute is not stored. Breakeven trades sit on
neither side.

**R2 wins — even over a typed value.** That is the trader's decision of 28.09.2026: the exchange's
own prices are the record, and a number typed from a chart is a reading of them.

The CFD backtest sources — Dukascopy's 1-minute candles (removed 19.09.2026, `20260919140000`) and
the TradingView export's own excursions (removed with the import in H2) — are gone.
`excursion-scan.ts`, the older scanner, is unchanged and still takes candles from anywhere.


### What would have happened — SL × TP, after the exit, after the stop (phase L)

MAE/MFE stops at the exit, so it cannot say whether a target was left too early or whether a stop was
followed by the target. **Phase L (30.09.2026, decisions L1–L4)** replays every closed futures trade
with a stop on the same R2 candles, once its trading day is over and the exact data is out, and
writes the result into `tj_positions.scenario` (jsonb, v2 since phase S; v1 from `20260930080000`) from
`futures-trading/tools/scenario.py` (called by `journal_mae.py`):

- **The grid (L1–L3).** From the trade's average entry, at its first entry fill, with the stop at
  0.5 / 0.75 / 1 / 1.25 / 1.5 / 2 × the real one (the sealed stop) and targets of 1 / 1.5 / 2 / 2.5 /
  3 / 4 / 5 R of that stop: target first (+t), stop first (−1 and a tick), or neither by the CME day's end,
  16:00 CT (the price then). Every cell is in R of its own stop — the same money at risk, so a wider stop is fewer
  contracts. The journal shows it net of the trade's own round-turn commission per contract, which in
  R is larger for a tighter stop; partial exits are not modeled.
- **Fills as an exchange makes them (phase S, scenario v2, 30.09.2026).** The target is a limit: it
  counts only once price trades **a tick through** it — a touch is not a fill, since a limit at the
  touch often sits unfilled in the queue. The stop is a stop-market: the touch triggers it and it costs
  **a tick of slippage**, so a stopped cell is −(1 + tick ÷ that variant's R). Until v2 both leaned the
  grid's way (far targets and tight stops looked better than they fill); a v1 document is re-measured
  on the next hourly run, and the journal reads v1 and v2 alike.
- **The CME day (scenario v3, 27.10.2026).** The horizon is the end of the trade's CME day, 16:00 CT
  (trader: „neka šta bi bilo prati CME dan“); until then it was a prop firm's 15:10 CT flat. A v2 document
  is re-measured on the next hourly run; the journal reads v1–v3 alike, and `horizon_end` holds the end
  each one was measured to — so a v2 row still on screen before that run reaches 15:10 CT, under a
  "16:00 CT" label.
- **After the exit (L4).** Furthest with the trade and against it at 15, 30 and 60 minutes and to
  16:00 CT, from the exit price. After a stop: did the planned target come, and when. After a hand
  exit: held, would the target or the old stop have come first.
- **The stop that would have lived to the target** — the largest move against the trade before the
  planned target's first fill (a tick through), plus a tick — and **the furthest it went before the real stop** (MFE
  before stop).

Which came first is walked on 1-minute bars; the rest of the entry and exit minute and any minute
that holds both a stop and a target are walked on 1-second bars, and a second that still holds both
is a **stop** (never a guessed win). A trigger clears the scenario whenever the trade's fills, its
sealed plan or its live entry, stop or target change (the trade page, merge, import, undo),
and the next run measures it again. The live columns joined on 09.10.2026 (`20261009150000`): an
imported trade has an empty seal, so its stop is the live one, and the original stop written from the
recording left a scenario measured on the moved stop in place.

**Where it shows.** The trade page gets a *What would have happened* card (verdict, after-exit table,
the stop needed for the target, the trade's grid with its planned target column marked). `/reports`
gets an **SL × TP** panel over the filtered book: the mean grid with each cell's hit rate, the best
cell, the best target on the real stop, the result as managed beside them, the after-exit medians
and the after-stop / after-target / hand-exit counts — and the same figures **per bucket of the
report's current grouping**, so setup, TF ulaza, session window or instrument is the same click as
any other report. A group under 30 trades is marked ⚠. The mentor pack gets a summary section and a
*Šta bi bilo* line per trade.
Since 14.10.2026 it also gets a **Reakcija** line per measured trade (a winner: when it left the red for good, from `last_underwater_seconds`; a loser: how long it sat in the red) and a **Vremenski stop** section (`timeStopSection`, the dashboard's Time stop card: medians and the 1–60 min ladder), and the instructions ask the mentor to judge each exit from them. A stop moved **closer** that was then hit gets a **Pomeren stop** line: `sl_for_target_r` is in R of the ORIGINAL stop, so ≤ 1R means the original would have survived to the target (**⚠ Pomeren stop je koštao**), and the mentor is told to count those.

---

## Documentation

| Source | For what |
|---|---|
| **This README** | What exists and how it works |
| [`ROADMAP.md`](ROADMAP.md) | Phases, decisions and their reasoning, what is left (Serbian) |
| [`CODE_REVIEW.md`](CODE_REVIEW.md) | Rounds 2b, 3 and 4 plus the render-layer execution (Phase 10), every finding with its outcome |
| [`docs/formulas-audit.md`](docs/formulas-audit.md) | Every formula checked against outside practice, with a verdict each (Serbian) |
| [`PARITY.md`](PARITY.md) | A comparison against TradeZella, item by item (Serbian) |
| [`FAZA_F_DAYTRADING_PLAN.md`](FAZA_F_DAYTRADING_PLAN.md) | The move from swing to day trading (completed 29.09.2026): phases F1–F6, H1, H2, K, each with its plan, decisions and commits (Serbian) |
| [`FAZA_8B_PLAN.md`](FAZA_8B_PLAN.md) | Automatic MAE/MFE: MT5 for CFDs, R2 for futures, and why the cTrader plan was withdrawn (Serbian) |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) | AI entry point (Cursor / Claude Code) |
| [futures-trading](https://github.com/0xsickre/futures-trading/blob/main/README.md) | Market brief and evening message (no journal since X-10), MAE/MFE and "šta bi bilo" from R2, the nightly backup |
| [trading-fundamental-vault](https://github.com/0xsickre/trading-fundamental-vault/blob/master/README.md) | The F0–F5 cycle, macro bias, COT filter (swing era) |
| [vault `workflow.md`](https://github.com/0xsickre/trading-fundamental-vault/blob/master/workflow.md) | The weekly runbook (13 steps) |
| [trading-dashboard](https://github.com/0xsickre/trading-dashboard/blob/master/README.md) | Read-only view of the weekly analysis |

---

## Note

Private repo — personal use. The journal's Supabase project is **separate** from the dashboard's; do
not run the dashboard's migrations here or the other way round. The contents are a personal trading
record, not investment advice.
