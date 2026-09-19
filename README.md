# Trading Journal

[![gate](https://github.com/0xsickre/Trading_Journal/actions/workflows/gate.yml/badge.svg)](https://github.com/0xsickre/Trading_Journal/actions/workflows/gate.yml)

A swing/ICT trading journal for a single trader. Manual entry, no AI chat — a disciplined record of
what was traded and how well the process was followed, plus honest arithmetic over that record.
Every trade is typed by hand or imported from a file the broker or TradingView produced; nothing
writes into the journal on its own.

Built to cover what TradeZella does in metrics, notes and reports, minus the parts that only make
sense for multi-user SaaS. Where it differs, the difference is written down and argued — here or in
`ROADMAP.md`.

**On language**, counted rather than claimed, because this is the first thing a reader can check.
Identifiers and code comments in `src/` are English. This README and `CODE_REVIEW.md` are English;
`ROADMAP.md`, `PARITY.md` and `docs/` are largely Serbian. Migrations keep their Serbian comments on
purpose — an applied migration is never edited here, and the comment inside one is part of the
record of the day it was written.

**The interface is deliberately half-and-half, and the line is a clean one.** At least 126 of the
3,059 human-readable string literals in `src/` outside tests are Serbian, and every one of them sits
on a screen the trader writes into:

| Surface | Serbian strings |
|---|---|
| Daily, weekly, tracker, focus goal | 90 |
| Mentor-export prompt | 33 |
| TradingView snapshot helper, trade images | 3 |
| Dashboard, `/reports`, journal grid, playbooks | **0** |

The half that **measures** is English; the half the trader **writes into** is Serbian. That is the
trader's own language for their own prose, and it stays.

That **0** was not always true, and it was not reached by rounding. Five strings sat on the English
side and were moved across: one reconcile-row message in `import-wizard.tsx`; the instrument-group
fallback in `trade-form.tsx`, which read `Ostalo` two lines under a comment calling it "Other"; the `derived` group label `Izvedeno` among
English ones in `reports/dimensions.ts`; and two insight sentences in `insights/day-rules.ts` and
`insights/trade-rules.ts` that opened in English and finished in Serbian. A sixth, the check-in tick
in `open-positions-card.tsx`, was miscounted rather than misplaced — that card renders inside the daily
form, so it belongs to the Serbian half and stayed.

How the count was taken, since the claim is only worth as much as its method: `npm run lang:count`
lexes every `.ts`/`.tsx` outside tests into comment / string / code regions, keeps the string regions
that read as prose rather than as machinery, and scores those for Serbian by diacritics and by a word
list. A single Serbian word carrying no diacritic can still slip past that, so **126 is a floor, not a
ceiling**. Three earlier versions of this paragraph said "about 46 of some 1,700", then "153 of
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

The third repo of a trading desk. **They are not integrated in code** — no shared database, no API
calls between them. The link is semantic.

| Repo | Answers | Data direction |
|------|---------|----------------|
| [`trading-fundamental-vault`](https://github.com/0xsickre/trading-fundamental-vault) | Which direction? Is the entry any good? | Write (agent, F1–F4) |
| [`trading-dashboard`](https://github.com/0xsickre/trading-dashboard) | Where did the cycle stop? What is ready? | Read-only view |
| **`Trading_Journal`** (this repo) | What did I trade, and with what discipline? | Write (you, after F5) |

The instrument watchlist is kept in step with the vault's `instrument_registry`, and the
`macro_align` / `cot_filter` fields record the vault's verdict **at the moment of entry** — a record
of the decision, not a reconstruction of it. The TA plan for F5 (entry trigger, timeframe,
execution) lives in Notion, outside this repo.

The thesis: **P&L is the consequence, process is the cause.** So the daily rating measures progress
on the active process goal, never earnings, and the analytics decompose the result along dimensions
that are actually under your control.

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
| `npm run build` | Production build — 16 routes (15 pages + `/_not-found`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run scan` | Bytes, not meaning: NUL bytes, invalid JSON, `.only`/`.skip`, `console.log`, conflict markers |
| `npm run schema:check` | The base-table record (`supabase/schema/`) against the generated types |
| `npm run lint` | ESLint. **Expects zero problems and zero warnings** |
| `npm test` | Vitest — 2,381 tests across 143 files, in two projects (`lib` on node, `components` on jsdom) |
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

## Data model

30 tables and 1 view, all prefixed `tj_`. **Row-level security is enabled on all 30 tables**, every
policy following the same ownership pattern:

```sql
CREATE POLICY ... FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()));
```

### A trade is not one row

The central decision. A position is a parent row plus its fills:

```
tj_positions  ──1:N──▶  tj_executions        entries and exits, each with its own price,
     │                                        quantity, time, commission and swap
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
| **Daily process** | `tj_daily_reports`, `tj_focus_goals`, `tj_position_checkins` |
| **Weekly process** | `tj_weekly_reviews` |
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

| Route | What it is |
|---|---|
| `/` | Dashboard: KPIs, equity curve, drawdown, heatmap calendars, breakdowns, Sickre Score, insights. Opens on **90 days when anything closed within them, and on All when nothing did** — a 2018 backtest otherwise opens on a page of zeros. Whenever the period leaves closed trades out, a notice above the figures says how many and how far back, with **Show all** (`default-period.ts`) |
| `/journal` | Trade table — sorting, filtering, column picking. The date column carries the **year**, because a backtest's trades are years old and `07/03` without one reads as this spring |
| `/trades/new`, `/trades/[id]/edit` | Trade form: plan, fills, playbook checklist, psychology, images. In the **order of the decisions**: account, instrument, then the playbook and its checklist, and only then the prices and the risk. **There is no phase control**: planned or active is what the fills say — an entry fill means you are in the trade — so a select that could disagree with the record is gone, and so is "Move to active". The one lifecycle fact the fills cannot know, a MISSED plan, keeps its button. The instrument is **typed, not scrolled** — `instrument-select.tsx` filters the 91-symbol catalog on symbol, name and asset class, so "gold" finds both XAUUSD and GC; a grouped `Select` could only jump to the start of a label |
| `/daily` | Daily report + tracker checklist for one day; locking the day |
| `/calendar` | Monthly P&L grid by day, weekly totals |
| `/weekly` | Weekly review: week rating, five questions, the week's figures (`week-recap.ts`) |
| `/playbooks` | Every setup as one table: Trades / Net P&L / Win Rate / Missed / Expectancy per row |
| `/playbooks/[id]` | One playbook: identity, Stats, Rules (section and rule editor), Trades, Notes |
| `/reports` | Report workbench — any metric against any dimension, plus a pivot |
| `/tracker` | Redirects to `/daily` (kept because the tracker used to live here) |
| `/notebook` | Notes, folders, tags, markdown |
| `/import` | CSV import wizard, batch history, undo |
| `/settings` | Five tabs: Categories (option lists + custom fields, one action creates both), Tracker, Instruments, Accounts (incl. FTMO), Deposits / withdrawals. Account deletion and reset live under Accounts |
| `/login` | Supabase auth |

---

## Metrics

34 metrics in a single registry (`src/lib/journal/reports/metrics.ts`), 25 built-in dimensions across
four groups (11 off the trade, 9 derived, 4 process, 1 insight) plus one per custom field. Any
metric runs against any dimension — which is why there is one report engine instead of ten report
pages. The tables below list all 34.

**A registry is a registry, not a second implementation.** Every entry delegates to a function that
already exists and is already tested elsewhere. A metric that computed something inside itself would
drift from the module computing the same thing.

### Money and counting

| Metric | Formula | Note |
|---|---|---|
| Net P&L | `Σ (gross − commissions − swap)` | Dated by the **close** day, in the account's timezone |
| Gross P&L | `Σ (exit − entry) × qty × point_value × direction` | |
| Trades | Closed trades in scope | |
| Win rate | `wins / (wins + losses) × 100` | **Breakeven trades are out of the denominator** |
| Avg win / Avg loss | Average winning and losing money, separately | |
| Avg win/loss | `avg win / \|avg loss\|` | A money ratio, not R — a Sickre Score component |
| Profit factor | `gross profit / gross loss` | `Infinity` when there is no loss — a real maximum, not missing data. `null` only when there is nothing to divide |
| Expectancy | `winRate × avgWinR + (1 − winRate) × avgLossR` | Computed over the R population only — only a trade with a stop has an R |
| Best / worst | Largest and smallest single net result | |
| Breakeven | Trades inside the account's breakeven band | |
| **R (everywhere)** | `gross points / (risk in points × entry qty)` | **R is always GROSS**, and does not follow the net/gross toggle — that toggle moves money only |

**Why R is gross while money can be net.** They are deliberately two different questions. R measures
the **setup**: did price go where the plan said, relative to the risk taken. Commission and swap are
not a property of the setup but the cost of holding, and for a swing book they are a separate line
worth seeing on its own — hence their own tile (`Swap`) on `/reports`, and hence the net/gross
toggle over money.

A consequence worth knowing while reading the screen: **a trade can be a loss in money and positive
in R.** Held three days, price went your way by +0.03R, and carry ate even that — net negative. That
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
| Recovery factor | `net profit / max drawdown` | `null` while the curve has never fallen |
| Sharpe | `mean daily P&L / σ × √periodsPerYear` | |
| Sortino | The same, but the numerator only looks at falls below zero — the denominator still counts **every** day, not just losing ones | `null` when no day was negative — growth is not risk |
| Calmar | `annualised return / max drawdown` | Recovery factor divided by the time it took |
| Consistency | `100 − cv × 20`, where `cv = σ / \|mean\|` | 0 for a losing book |
| Avg MAE in R | Average of how far trades went against the position | Averaged only over trades that *have* an MAE |

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

### Costs, plan and execution

| Metric | Formula |
|---|---|
| Total commissions / swap | Sums over fills |
| Cost % of gross | `costs / gross profit of winners × 100` |
| Avg planned R | Average planned reward, over trades that have one |
| Planned vs realized R | `avg realized R − avg planned R`, over the **same** trades |
| Target attainment | Realized R as a percentage of planned reward |
| Winner target attainment | The same, **winners only** — how much of the plan was taken before exiting early |
| Avg entry slip | Planned entry against average fill, in R against the planned stop. Negative means the fill was worse than planned |
| Total slip R | Every R given up to entry slippage in the period, added together |
| Setup score | Share of setup criteria met (§ The setup grade is derived) |
| Avg hold | Average holding time in seconds |
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
- **Days are always in the ACCOUNT's timezone**, resolved on the server. A `new Date()` read in the
  browser shifts the whole calendar by one column for anyone not sitting in the account's zone.
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

## Sickre Score

One composite, 0–100, over seven components. The **band tables** are transcribed from the TradeZella
spec. The **weights are not, any more** — that spec calibrates an intraday scalp book, and what is
kept here is a swing book on a prop account: 40–70 trades a year, a fixed target near 3× the stop.

| Component | Weight | Scored by |
|---|---|---|
| **Process adherence** | **30** | 60 % tracker compliance + 40 % playbook follow rate |
| Max drawdown | 25 | `100 − maxPctOfPeakPnl` |
| Profit factor | 20 | Band table, 1.8 → 2.6 maps to 20 → 100 |
| Consistency | 15 | Passed through as-is |
| **FTMO headroom** | 10 | `100 − closest approach to a limit`, in % |
| Avg win/loss | 5 | The same table as profit factor, in money |
| Recovery factor | 5 | Its own table, 1.0 → 3.5 |

The trade-derived components total **70**; with process it is 100, with both optional ones 110. The
card divides by the real total, never by a hardcoded hundred.

### Why these weights, and not the transcribed ones

**Win % is out of the score entirely, not merely reweighted.** Its scale (`win% / 60 × 100`) encodes
"higher is better". At a 3R target the mathematically expected win rate is 35–45 %, so a book
trading exactly to plan scored about 67 on that component — punished for its own design.
Qullamaggie runs 25–35 % on purpose. Win rate stays as a KPI tile on the dashboard and as a
`/reports` metric, where it is a fact rather than a verdict.

**Avg win/loss fell from 20 to 5.** With a fixed target the ratio is settled by design, not by
execution — it will sit near 3 whatever happens. Twenty points were measuring a constant, and
half-duplicating profit factor besides.

**Process adherence is the heaviest component, at 30.** It is the only one that does not depend on
variance. Over 40–70 trades a year every other component measures an outcome on a sample too thin to
trust, while follow rate and tracker compliance measure behaviour, where n=40 already means
something. This README's thesis is "P&L is the consequence, process is the cause"; the old weights
gave the cause 15 of 115 and the consequence 100 of 115.

**FTMO headroom is new.** It measures how close the account came to the daily or the overall limit —
and specifically the **closest approach across the whole challenge**, not how much room is left
today. An account that finishes +8 % but touched 4.5 % against a 5 % floor was one bad day from the
end, and no other component could see that. It is therefore the one component that deliberately
ignores the period filter: a challenge window is defined by `ftmo_reset_at` and a fixed starting
balance, not by what the reader happens to be looking at. When no account runs FTMO mode the
component is absent — not 100.

When a challenge window holds no closed trade at all, `evaluateFtmo` returns `null` rather than 100.
A fresh account that has never risked anything must not score a maximum for risk management — that is
the same defect as finding 1 below, one module earlier.

**A component with no data is dropped and the remaining weights renormalize**, so a young track
record is not punished for arithmetic with nothing to divide. Getting that right took three separate
fixes in round 3, all three the same error at different depths:

1. Drawdown and consistency answer `0` on an empty book — honest as *statistics* — and `100 − 0 =
   100` turned "never traded" into flawless risk management.
2. A single winning trade scored **100/100**: infinite profit factor, zero drawdown because there
   was nothing to fall from, and zero variance over one sample. Maxima all the way down, every one
   an artifact of n=1.
3. A book of six consecutive losses scored **100 for risk management**, because the drawdown
   percentage had no positive peak to divide by and returned `0`.

So the score now carries an evidence gate:

- **Below 5 closed trades there is no score.** The card counts down to it.
- **Below 30 it is shown WITH its sample**, labelled provisional. A profit factor over five
  decisions can jump across the whole band table on one trade, but hiding the score for weeks is
  dishonest in the other direction.
- **Below 50 % of weights covered there is no score** — one component under the heading of a
  seven-component composite is not a composite. An empty account with tracker history covers
  process 30 + FTMO headroom 10 = 40 of 110, still under the gate.

Each gate reads its own denominator: `trades` for the path-dependent statistics (drawdown walks the
sequence, consistency is its dispersion), `decided` (wins + losses) for the ones built from wins
against losses. A book of nothing but breakeven scratches has a path to measure and no decisions it
could have won.

**The rebalance weakened the coverage gate in one place, and that is written down rather than
swallowed.** While win % was in the score, the components gated on `decided` carried 60 of 100
weights; without it they carry 25 of 70. A book of nothing but breakeven trades therefore now clears
the threshold on drawdown and consistency alone (40 of 70) and gets a score instead of silence —
provisional, with the sample beside it and "2 of 5 components" on the card. Pinned by a test in
`book.fixture.test.ts`; if it matters that this stays silent, the knob is `MIN_COVERAGE_SHARE`, and
it moves every score in the journal.

The calibration constants are pinned by value in `sickre-score.test.ts`. Changing any one of them
moves every score ever displayed, so it now has to change a test too.

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

The `tj_positions.setup_grade` column stays and **carries the history** of hand-graded trades — the
derived value wins, the column is the fallback. The same precedence pattern `plannedRewardFromTrade`
already documents, in reverse order, because here the derived value is the better one and the column
is the legacy.

---

## Ratings are clicked, in one unit

Four fields asked you to type what should be picked, across three different scales for the same kind
of question.

| Field | Was | Now |
|---|---|---|
| Time stop | free number, **no upper bound in the database** | five buttons 1–5, `CHECK` up to 5 |
| Mental temperature | `Select` 1–10 | **5 stars** |
| Week rating | `A–F` | **5 stars** |
| Execution rating, conviction | 5 stars / 1–5 | unchanged |

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
only the chosen one.

**Clicking the selected value clears it.** With no path back to `null`, the first mis-click would
stay forever as a value nobody meant, and "not recorded" and "1" are different answers.

---

## Process tracking

**Tracker rules** are daily obligations, per weekday. **Six** are scored automatically from data —
max loss per trade, per day and per week, every trade linked to a playbook, every trade has a stop,
every trade has a written thesis — and the rest are ticked by hand.

The three limits are a **percentage of the day's opening equity, not an amount of money** (migration
`20260822190000`). A fixed €200 is a different rule on a 5,000 account than on a 50,000 one, so a
limit set once stops describing the trader's risk the moment the account grows — and the number that
has to be re-typed to stay honest is the number nobody re-types.

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

**Insights** are 37 rules at four levels — trade (24), day (6), week (3), portfolio (4) — reading the
same enriched trades the reports do. Every rule declares a `minSample` and none fires at n=1. No
insight is stored in the database: thresholds change, and a stored insight would go stale against a
changed threshold while still looking authoritative.

**FTMO mode** is per account: daily loss, overall loss, profit target and minimum trading days.
Breaching a rule freezes the account — a new trade can neither be created nor activated until the
challenge is reset in Settings.

The daily limit has a **configurable basis**, because real FTMO accounts differ on it: fixed (a
percentage of the starting balance, for the whole challenge) for the 2-Step type, or rolling (a
percentage of the previous trading day's closing balance) for the 1-Step type. The overall loss
(drawdown floor) is always fixed to the starting balance — that part is common to both.

Alongside the verdict, `evaluateFtmo` returns `headroomPct` — how much room is left from the
**closest approach** to any enabled limit across the whole challenge. It is a Sickre Score component
(§ Sickre Score), and the only number in the application that tells an account that passed apart
from one that passed by a hair.

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

Every refused cell is named on its own row in the preview (`unreadable: qty, fee`).

### Recognising a trade you already typed

`sameTrade` needs the entry time to agree within ten minutes, which is right for a statement arriving
the same day and useless for the way this journal is used: a trade typed by hand while reading a
backtest carries the moment it was **typed**, the file carries the moment it was **traded**. Months
apart, same trade — two positions, and merging two positions afterwards is a separate operation
(§ Merging two trades).

So when the strict question finds nothing, a weaker one is asked, with the time left out of it
entirely: same account, same instrument, same direction, same entry price, same exit price, and then
**either** the same size **or** the same money. That row is marked `suggested`, names the trade it
believes it is (`same trade as #5 · 09/18 21:10 · 1327.45→1317.62 · −983.40`), and arrives with
**merge already chosen** — the review then says what the merge will change, starting with the time:
`opened 09/18 21:10→03/07 09:00`.

**Size OR money, not both**, because the two sources disagree about size more often than they
disagree about the trade: TradingView sizes a backtest off its own risk model while the trader types
the lots they meant, so 1.00 and 1.73 lots can be one trade — and the P&L then agrees to the cent,
because both describe the same price move. Requiring both would refuse exactly the case this exists
for.

**More than one candidate is still `ambiguous` and still defaults to create**, but the row can now be
pointed at a specific trade from a list that names each one. A wrong guess and a deliberate choice
are different things; only the guess was ever the problem.

### What the file may overwrite, and what it may not

A merge replaces the fills — entry, exit, size, times, commission — because those are the broker's
facts and the reason to import at all. Plan, grade, thesis, psychology and notes are never touched.

Two levels sit between those categories, and they are treated differently:

- **Target.** Mapped from a `T/P` column and written **only onto a trade that has none**. A target
  already on the trade is the trader's plan; a missing one is simply not recorded yet. Undo empties
  the ones this import wrote (`tj_import_rows.target_written`) and leaves the rest alone.
- **Stop.** Not imported at all, and there is no column for it. A statement states the levels as they
  stood **at the end**, and a stop pulled to breakeven mid-trade is the commonest thing a swing
  trader does — importing that number would overwrite the stop the risk was actually taken with, and
  every R on the trade would be recomputed against a stop nobody ever risked.

### TradingView backtests

A Strategy Tester or Bar Replay export ("List of trades" → Excel) is recognised by its header and
imported without column mapping (`lib/journal/tradingview-export.ts`). Import it into a separate
account, so backtest numbers never mix with live ones. Four things about the export would each
produce a confidently wrong trade through the generic mapping, and each is handled:

- **A trade is two rows**, "Entry long" and "Exit long" under one trade number. They are joined into
  one trade. A trade that does not pair cleanly is shown, named and skipped by default, never
  dropped. An exit signalled `Open` is a mark at the last bar, so it is not imported as a fill.
- **A partial exit is a separate trade.** A long closed in two parts is exported as two trade numbers,
  each with its own entry row at the same time, price and order. They are joined into one position:
  one entry for the whole size and one exit per part, each with its own time, size and commission.
  A trade with a problem is never joined, so its problem stays on its own row.
- **The trades are on the second sheet.** The first one, "Performance", is a summary.
- **Size is in TradingView's units**: pounds of copper, ounces of gold, contracts for futures. A fill
  here is counted in lots. The scale is read from the export's own money: gross result ÷ (move ×
  size) is 1 when TradingView counts units, and the point value when it counts contracts. Every
  trade is then held to that scale. An instrument missing from the catalog, an account in a
  different currency from the export's, or a scale that is neither of the two is refused with the
  figure found.

The symbol exists only in the file name (`…_OANDA_XCUUSD_2026-09-18_….xlsx`), so a renamed file is
refused. Times are the chart's wall clock and are read in the account's zone.

TradingView's favorable/adverse excursion is **not** imported. It is money net of the entry
commission and floored at zero, so no price can be recovered from it, and MAE/MFE are stored as
prices. The values stay in the import row's `raw`.

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

**Reset everything** (`tj_reset_my_data`). Deletes all 27 tables for the caller, then calls
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
**1 Main Account, 91 instruments, 13 lists holding 66 options, 8 tracker rules, 9 custom fields,
3 note folders.**

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

101 files in `supabase/migrations/`, named `YYYYMMDDHHMMSS_description.sql`.

- **Additive.** An applied migration is never edited — a new delta is written instead.
- **A migration explains itself.** Each one opens with a comment saying what was wrong and what
  breaks without the change. Those files are the only record of why the schema looks the way it does.
- **Dropping a column a view depends on** means `DROP VIEW` → `DROP COLUMN` → `CREATE VIEW` →
  `ALTER VIEW ... SET (security_invoker = on)`. Forgetting that last line silently changes whose RLS
  filters the view.

### Security model

- **RLS on all 30 tables**, ownership pattern, verified against the live database.
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

2,344 tests across 140 files, split into **two vitest projects**: `lib` (environment `node`, files
`*.test.ts`, 1,884 tests in 93 files) and `components` (environment `jsdom`, files `*.test.tsx`, 460
tests in 47 files). The rule is the extension, so no file can land in both. The split exists so that
purely arithmetic tests do not pay for a DOM they never touch.

`vitest.config.ts` carries coverage **floors**, not targets — they sit at what the suite achieves
today, so the only thing they can do is fail when a change lowers coverage. Since Phase 10 there are
**two separate floors**, checked independently rather than blended into one average:

| Layer | Statements | Branch | Functions | Lines |
|---|---|---|---|---|
| `src/lib/**` | 95 % | 89 % | 96 % | 96 % |
| `src/components/**` | 64 % | 64 % | 61 % | 65 % |

Alongside them sits a **third, per file**: fourteen modules that compute or guard money
(`MONEY_MODULES` in `vitest.config.ts` — `analytics.ts`, `balance.ts`, `costs.ts`,
`position-stats.ts`, `risk-ratios.ts` and the rest) hold **100 % of statements and functions**
individually. A layer average is allowed to hide one such file; a per-file floor is not.

Why two floors and not one: `src/lib` is pure arithmetic and has stayed near 96 % since Phase 0.
`src/components` is Phase 10's render layer — 46 of 87 files have a **dedicated** render test, and
the rest are reached only incidentally, through whatever a tested component happens to import (many
`src/components/ui` primitives export sub-parts — `DropdownMenuRadioItem`, `PopoverTitle` — that
nothing in this app renders). A single blended number would either drag the library floor down to
component-layer reality or lie about how tested the render layer actually is; two floors say both
things honestly instead of averaging them into a number describing neither.

Four things the numbers deliberately do **not** claim:

1. **`src/components`'s floor is not "well tested".** 64/64/61/65 is the honest state of a layer that
   began this phase at zero and is not finished — Phase 10 covers the highest-risk components
   (Tier 1 and 2 in `ROADMAP.md`), not all 87. Reading this floor as "the UI is 64 % correct" repeats
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
4. **`src/app` (15 pages across 33 files) has no number at all**, and "no number" is not "0 %" — it is
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
components. 15 routes in `src/app` are still executed by no test — the logic living there is thin
(fetch + `redirect()`), and Playwright would need a running application and Supabase credentials this
container does not have. It stays a later option, not an oversight.

---

## Deliberately left out

| Not built | Why |
|---|---|
| Backtesting and trade replay | Done directly in TradingView. An embed does not help: Bar Replay lives in their application, and the widget is a black box the code cannot step through. Its results come back through import (§ Import → TradingView backtests) |
| Broker sync that fills in a whole trade | Manual entry is a choice and an advantage — it forces the trade to be read once more. A statement import corrects the objective numbers afterwards; everything that is a judgement is still typed |
| Spaces, mentor, leaderboard | Single-user system |
| AI chat and agents | The mentor-pack export and the insight rules give the same thing without the API cost |
| Options (DTE, strike, expiry) | Not traded |
| Intraday dimensions (entry time 5–30 min) | A day-trading artifact |
| Economic calendar | Lives in the vault repo |
| Running P&L curve per trade | Needs a price feed. Consequence: "most time in drawdown" is off the table |

**Blocked, not rejected:** MAE/MFE **from historical candles** (Phase 8B). Today every MAE/MFE in the
journal is typed by hand, on any trade that has one, and the fields carry nothing else.

The scanning logic and the interval choice are written and tested — `excursion-scan.ts` picks 1m
through 1h by holding time, and a candle only counts if it fits entirely inside the trade's window.
It takes candles and never cared which broker they came from. **What is missing is the feed, and
which feed it will be is now an open question.** The cTrader Open API was the answer while a cTrader
bridge existed; with the move to MT4/MT5 that answer is gone, and nothing has replaced it yet. The
candidates worth investigating, none of them chosen: an MT5 terminal export of the minutes around each
trade, an Expert Advisor that records the extremes while a position is open, or any third-party candle
API for the handful of instruments actually traded. Recorded here rather than left implicit, because
`max_drawdown_price` and `max_profit_price` will otherwise look like fields somebody forgot to fill.

---

## Documentation

| Source | For what |
|---|---|
| **This README** | What exists and how it works |
| [`ROADMAP.md`](ROADMAP.md) | Phases, decisions and their reasoning, what is left (Serbian) |
| [`CODE_REVIEW.md`](CODE_REVIEW.md) | Rounds 2b, 3 and 4 plus the render-layer execution (Phase 10), every finding with its outcome |
| [`docs/formulas-audit.md`](docs/formulas-audit.md) | Every formula checked against outside practice, with a verdict each (Serbian) |
| [`PARITY.md`](PARITY.md) | A comparison against TradeZella, item by item (Serbian) |
| [`FAZA_8B_PLAN.md`](FAZA_8B_PLAN.md) | Automatic MAE/MFE: why the cTrader plan was withdrawn and what the open question is (Serbian) |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) | AI entry point (Cursor / Claude Code) |
| [trading-fundamental-vault](https://github.com/0xsickre/trading-fundamental-vault/blob/master/README.md) | The F0–F5 cycle, macro bias, COT filter |
| [vault `workflow.md`](https://github.com/0xsickre/trading-fundamental-vault/blob/master/workflow.md) | The weekly runbook (13 steps) |
| [trading-dashboard](https://github.com/0xsickre/trading-dashboard/blob/master/README.md) | Read-only view of the weekly analysis |

---

## Note

Private repo — personal use. The journal's Supabase project is **separate** from the dashboard's; do
not run the dashboard's migrations here or the other way round. The contents are a personal trading
record, not investment advice.
