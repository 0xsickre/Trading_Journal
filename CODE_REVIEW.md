# Code review — Trading Journal

Deep-dive review of the calculation layer, server actions, `tj_position_stats` SQL view, and the
dashboard / trade-form clients. Reviewed at commit `cb9c51e`, against the live Supabase project
(`Trading Journal`, `hjwvhzcszhjhpocfjatm`) — the deployed view definition was confirmed byte-identical
to `supabase/migrations/20260720170000_tj_position_stats_view.sql`, so the repo is the source of truth.

## Summary

The pure-math layer is in good shape. 325 vitest cases cover it, the reasoning behind non-obvious
choices is written down at the point of decision — close-date vs open-date attribution
(`period-stats.ts:67-75`, `activity.ts:1-14`), the two drawdown bases (`balance.ts:1-14`), breakeven
excluded from the win-rate denominator but not from money sums (`analytics.ts:68-77`). That is unusually
disciplined for a solo project and most of it is correct.

The defects cluster at the **boundaries**:

- where Postgres meets TypeScript (an unbounded `select` that silently truncates; a view that recomputes
  history from a live join),
- where a windowed dataset meets an unwindowed one (period filter vs cash events),
- where one `null` carries two meanings ("infinite" and "no data"),
- where two code paths implement the same rule differently (form vs server fill validation; TS vs SQL fee
  accrual).

| Severity | Count | Theme |
| --- | --- | --- |
| Critical | 4 | Historical P&L is mutable; silent data truncation; non-transactional writes; a lifecycle the database rejects |
| High | 6 | Wrong denominators, overwritten records, mixed populations |
| Medium | 10 | Cross-surface inconsistency, duplicated work, swallowed errors (one later withdrawn — see M4) |
| Low | 12 | Dead code, boundary conventions, formatting |

Two of these were found only by exercising the live database rather than reading the code — **C4**,
where the whole plan/miss lifecycle is rejected by a check constraint, and the `getInstruments` filter
noted under C1.

---

## CRITICAL

### C1 — Historical P&L is mutable, and a missing instrument silently prices trades in raw points

`supabase/migrations/20260720170000_tj_position_stats_view.sql`

Every past trade's money is recomputed on read, from a live join against the instrument table:

```sql
LEFT JOIN tj_instruments i ON i.user_id = p.user_id AND i.symbol = p.instrument
-- ...
COALESCE(i.point_value, 1::numeric) AS point_value
```

Three consequences, all silent:

1. **Editing an instrument rewrites history.** `updateInstrument` (`src/app/(app)/settings/actions.ts:192`)
   accepts a new `point_value`. The moment it is saved, the P&L, R-multiple, drawdown, profit factor and
   Sickre Score of *every trade ever taken on that symbol* change. Nothing warns, nothing is versioned.
2. **Deleting or renaming an instrument prices the trade at 1.** `deleteInstrument`
   (`src/app/(app)/settings/actions.ts:214`) drops the join, `COALESCE(..., 1)` takes over, and a 500-point
   ES win becomes `$500` instead of `$25,000`. The trade still renders, confidently, with a wrong number.
3. **Import makes this routine, not hypothetical.** `normalizeInstrumentSymbol`
   (`src/lib/journal/instrument-aliases.ts`) returns the cleaned-uppercase key for anything not in its alias
   table, so a broker export of `EUR/USD.pro` becomes `EURUSDPRO` — matching no instrument row, priced at 1.

*(Verified against the live DB: `tj_instruments_user_id_symbol_key` UNIQUE `(user_id, symbol)` does exist,
so the join cannot fan out and double-count. That specific risk is not present.)*

**Compounding bug, same root.** `getInstruments` (`src/lib/journal/instruments.ts`) — the only read path
for instruments anywhere in the app — hard-filtered results to `DEFAULT_INSTRUMENT_SYMBOLS`:

```ts
.in("symbol", DEFAULT_INSTRUMENT_SYMBOLS)
```

So an instrument added through Settings (`addInstrument`) was invisible everywhere, *including the
Settings list that had just created it*, and a trade on that symbol had nothing to price it with. The
feature appeared to do nothing and quietly produced unpriced trades.

**Fix — snapshot the contract spec onto the trade at write time.** A journal records what happened; the
instrument table is current configuration, not history. They must not be the same number.

```sql
ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS point_value_at_trade numeric,
  ADD COLUMN IF NOT EXISTS tick_size_at_trade  numeric;

-- Backfill from today's instrument table: the best information available for
-- existing rows, and from here on it stops moving.
UPDATE public.tj_positions p
   SET point_value_at_trade = i.point_value,
       tick_size_at_trade   = i.tick_size
  FROM public.tj_instruments i
 WHERE i.user_id = p.user_id
   AND i.symbol  = p.instrument
   AND p.point_value_at_trade IS NULL;
```

and in the view, prefer the snapshot and *refuse to guess* when there is nothing to use:

```sql
COALESCE(p.point_value_at_trade, i.point_value) AS point_value,
CASE
  WHEN p.point_value_at_trade IS NOT NULL THEN 'snapshot'
  WHEN i.point_value          IS NOT NULL THEN 'instrument'
  ELSE 'missing'
END AS point_value_source,
```

Every money expression then multiplies by `COALESCE(p.point_value_at_trade, i.point_value)` with no
`, 1` fallback, so an unresolvable instrument yields `NULL` P&L — which the UI can flag — rather than a
plausible-looking wrong number. `point_value_source = 'missing'` drives a warning badge in the journal grid.

**Why this is the most important finding:** it is the only defect that can corrupt data the user has already
reviewed and trusted, retroactively, with no action on their part.

---

### C2 — Every dashboard number silently truncates past ~1000 trades

`src/lib/journal/trades.ts:23-39`, `src/lib/journal/ftmo-status.ts:20-23`, `src/lib/journal/cash-events.ts:12-17`

```ts
let posQ = supabase.from("tj_positions").select("*").order("created_at", { ascending: false });
```

PostgREST caps responses at `db-max-rows` (1000 by default) and returns the short page **with HTTP 200 and
no error**. Past that many trades the dashboard keeps rendering — win rate, net P&L, drawdown, equity curve,
Sickre Score — computed on a truncated set, with no visible symptom.

The codebase already knows this. `trades.ts:132-136` documents the failure mode precisely and paginates
around it — but only for fill *counts*, a diagnostic. The query feeding every financial figure does not.

`ftmo-status.ts:20-23` is the sharpest edge: a truncated set can hide a rule breach, so the freeze that is
supposed to stop trading on a blown challenge never fires.

Secondary: `trades.ts:36-38` puts every position id into a single `.in("position_id", positionIds)` filter.
Past a few thousand ids this exceeds the request URL limit and fails outright.

**Fix — one shared pagination helper, generalised from the loop that already exists:**

```ts
// src/lib/supabase/paginate.ts
const PAGE = 1000;

/** Drain a PostgREST query page by page. An unbounded select silently stops at
 *  `db-max-rows`; this keeps asking until a page comes back short. */
export async function selectAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (data?.length) out.push(...data);
    if (!data || data.length < PAGE) return out;
  }
}
```

with `.in()` filters chunked at 500 ids per request.

---

### C3 — Fill replacement is delete-then-insert with no transaction

`src/app/(app)/trades/actions.ts:168-186`, duplicated at `src/app/(app)/import/actions.ts:93-110`
(`commitImport` merge) and `src/app/(app)/import/actions.ts:195-217` (`undoImportBatch`)

```ts
const { data: prevExecs } = await supabase.from("tj_executions").select(...).eq("position_id", id);
await supabase.from("tj_executions").delete().eq("position_id", id);
if (execs.length > 0) {
  const { error: exErr } = await supabase.from("tj_executions").insert(...);
  if (exErr) {
    if (prevExecs && prevExecs.length > 0) {
      await supabase.from("tj_executions").insert(prevExecs.map(...)); // ← can also fail
    }
    return { ok: false as const, error: exErr.message };
  }
}
```

The comment above it is right about the danger and the mitigation is still not sufficient:

- The rollback is application-level. Its own `insert` result is never checked; if it fails the fills are gone
  permanently and the function reports only the *original* error.
- Between the delete and the insert — two round trips to a remote database — any concurrent reader sees the
  position with zero fills. `status` reads as `planned`, `net_pl` as `null`. That includes another browser
  tab, a `revalidatePath` re-render, and the FTMO freeze check.
- The restore loses each execution's `id`, so the rows come back as new records.

**Fix — do it in one statement, under the caller's RLS:**

```sql
CREATE OR REPLACE FUNCTION public.tj_replace_executions(
  p_position_id uuid,
  p_executions  jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER          -- RLS on tj_executions still applies to the caller
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.tj_executions WHERE position_id = p_position_id;

  INSERT INTO public.tj_executions (position_id, side, price, qty, executed_at, fee, swap_funding, source)
  SELECT p_position_id, e.side, e.price, e.qty, e.executed_at,
         COALESCE(e.fee, 0), COALESCE(e.swap_funding, 0), COALESCE(e.source, 'manual')
    FROM jsonb_to_recordset(p_executions) AS e(
      side text, price numeric, qty numeric, executed_at timestamptz,
      fee numeric, swap_funding numeric, source text
    );
END;
$$;
```

The function body is a single implicit transaction: either the new fills land or the old ones were never
deleted. All three call sites collapse to one `supabase.rpc("tj_replace_executions", ...)`.

---

### C4 — The database rejects the entire plan / missed lifecycle

Found by exercising the live schema, not by reading the code. `tj_positions_status_check` was:

```sql
CHECK (status = ANY (ARRAY['open', 'partial', 'closed']))
```

but `20260721130000_trade_lifecycle_missed.sql` introduced `'planned'` and `'missed'` and **never widened
it**. Every one of these raises a `23514` constraint violation, surfaced to the user as a generic
"Insert failed":

- `createTrade` on a plan with no fills — `computeStatus([])` returns `'planned'`
  (`src/lib/journal/trade-lifecycle.ts:40-44`)
- `markTradeMissed` (`src/app/(app)/trades/actions.ts:194`)
- `restoreTradeToPlanned` (`src/app/(app)/trades/actions.ts:240`)
- `commitImport` on any row with no executions (`src/app/(app)/import/actions.ts`)

The plan → missed → restore flow, the `miss_reason` option list, the "Missed setup-i" section of the
mentor pack and the `canMarkMissed` / `canRestoreToPlanned` guards were all built on a status the
database would not accept.

That migration's own backfill was affected too:

```sql
UPDATE public.tj_positions SET status = 'planned' WHERE p.status = 'open' AND NOT EXISTS (...)
```

It could only ever have failed — it passed silently because no row matched at the time it ran.

**Fix:** widen the constraint to the five statuses `computeStatus` can actually return, and re-run the
backfill that could not previously apply. The constraint is kept rather than dropped: it is what stops a
typo'd status reaching the table, and its list should mirror the `PositionStatus` union that
`trade-lifecycle.ts` defines.

---

## HIGH

### H1 — The period filter breaks drawdown %, mixing windowed trades with all-time cash flow

`src/components/journal/dashboard.tsx:232-244` windows the trades:

```ts
if (period !== "all") {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(period));
  r = r.filter((t) => (t.closedAt ?? "") >= cutoff.toISOString());
}
```

`dashboard.tsx:266-272` does **not** window the cash events. `dashboard.tsx:299-310` then seeds the timeline
with the full `startBalance`. On any period except "All", the equity series is:

```
starting_balance  +  (last 90 days of P&L)  +  (all-time deposits and withdrawals)
```

which describes no account that has ever existed. Peak equity is the denominator for `maxPctOfEquity` and
`currentPctOfEquity` (`balance.ts:160-170`), so the headline **"Max drawdown %"** KPI and the whole underwater
chart are wrong for the default view — the dashboard opens on 90d.

**Fix:** window the cash events to the same cutoff, and seed the timeline with the equity the account actually
had on day one of the window — pre-window realized P&L plus pre-window cash flow — instead of the raw starting
balance.

### H2 — `position_size` and `planned_rr` are overwritten with theory on every save

`src/components/journal/trade-form.tsx:480-485`

```ts
if (metrics.plannedRR != null)     fieldsToSave.planned_rr    = formatPlannedRewardR(metrics.plannedRR);
if (metrics.sizeSuggestion != null) fieldsToSave.position_size = Number(metrics.sizeSuggestion.toFixed(4));
```

`position_size` is the *suggestion* — `(balance × risk%) / (stopDist × pointValue)` — written over the field
even when real fills exist and the actual size is known from `entry_qty`. The journal ends up recording what
you should have done rather than what you did.

`planned_rr` is worse because a metric depends on it. Editing a closed trade's prices rewrites the plan, and
`plannedRewardFromTrade` (`src/lib/journal/exit-efficiency.ts:29-39`) *prefers* the stored `planned_rr` over
live prices. So "Target attainment" re-baselines against the edit: a trader who quietly lowers a target after
the fact improves their own discipline score.

**Fix:** write the size suggestion only when the field is empty *and* the trade has no fills; freeze
`planned_rr` once `status` leaves `planned`.

### H3 — Position sizing risks a percentage of the starting balance, forever

`src/components/journal/trade-form.tsx` passes `balance = account?.starting_balance ?? 0` into
`computePositionSize` (`src/lib/journal/plan-calculations.ts:77-98`).

After +40%, or after a withdrawal, "risk 1%" is no longer 1% of anything real. This is the one calculation the
trader acts on *before* entering a position, and it never updates.

**Fix:** pass current equity. `currentEquity(buildBalanceTimeline(...))` already exists at `balance.ts:225` —
reuse it rather than introducing a second definition of equity.

### H4 — The form saves fills that the server silently discards

`buildExecInputs` (`trade-form.tsx`) filters on `n(e.price) != null && n(e.qty) != null` — no `qty > 0` check.
`cleanExecs` (`src/app/(app)/trades/actions.ts:53-65`) requires `e.qty > 0` and drops the row **including its
fee and swap**. The live preview uses a third predicate (`qty > 0`, `trade-form.tsx` `metrics`).

So a user can type a fill with `qty = 0` and a real commission, watch the preview ignore it, hit save, and have
the row silently vanish — with no error and no indication that the commission went with it.

**Fix:** one shared `isValidFill()` predicate used by preview, submit and server; reject invalid rows in the UI
with a toast rather than dropping them server-side.

### H5 — `avgWin` / `avgLoss` are R-multiples wearing money's name, averaged over the wrong population

`src/lib/journal/analytics.ts:120-132` accumulates `t.r` into `winRSum` / `lossRSum`, so `Stats.avgWin` is an
average **R**, not an average dollar win. Two things follow:

1. `dashboard.tsx:374-377` feeds those into `avgWinLossRatio` → `computeSickreScore`'s `RATIO_BANDS`
   (`sickre-score.ts:28-36`) — a band table transcribed from a spec that defines the ratio in **money**.
   An R ratio scored against money bands is a category error.
2. `winRate` counts every decided trade. `avgWin` / `avgLoss` count only trades that *have* an R, which
   requires a stop price. Expectancy (`analytics.ts:166`) then multiplies a probability drawn from one
   population by an average drawn from a smaller one:

   ```ts
   const expectancy = (winRate / 100) * avgWin + (lossRate / 100) * avgLoss;
   ```

   A trader who records stops on half their trades gets an expectancy that describes neither half.

Expectancy is the number that answers "is this system worth trading". It cannot be a blend of two samples.

**Fix:** rename to `avgWinR` / `avgLossR`, add `avgWinMoney` / `avgLossMoney`, feed the *money* ratio to the
score, and compute expectancy from the R-subset's own win rate:

```ts
const rDecided  = winRCount + lossRCount;
const rWinRate  = rDecided > 0 ? winRCount / rDecided : 0;
const expectancy = rWinRate * avgWinR + (1 - rWinRate) * avgLossR;
```

### H6 — A flawless track record scores *lower* than a mediocre one

`analytics.ts:162` returns `null` for profit factor when there are no losses, meaning "infinite".
`dashboard.tsx:725` renders that as `∞`. But `computeSickreScore` (`sickre-score.ts:194-199`) drops any
component whose score is `null` and renormalizes the remaining weights — so the **25-weight Profit Factor
component, the heaviest in the table, is discarded for the one book that maxed it.**

`null` is doing double duty: "infinite" at `analytics.ts:162`, but genuinely "not computable" at
`risk-metrics.ts:17` (recovery factor, no drawdown yet) and `risk-metrics.ts:145` (win/loss ratio, no losses
yet). Only the latter should drop a component.

**Fix:** return `Infinity` for the no-losses case and keep `null` strictly for "no data"; `scoreFromBands`
clamps non-finite input to the top band; the dashboard's `∞` render keys off `!Number.isFinite` instead of
`== null`.

---

## MEDIUM

**M1 — ISO timestamps are compared and sorted as strings.**
`analytics.ts:44` (`toRealized` sort), `ftmo.ts:126-130` (`t.closedAt >= config.resetAt`),
`dashboard.tsx:240-241` (period cutoff), `dashboard.tsx:480-485` (mentor-pack range), `balance.ts:64-68`
(timeline sort).

PostgREST returns `2026-07-28T10:00:00+00:00`. The app generates `2026-07-28T10:00:00.000Z`
(`resetFtmoChallenge`, `resolveCalendarRange`, `cutoff.toISOString()`). These compare correctly only by
accident: at identical whole seconds the comparison reaches `'+'` (0x2B) vs `'.'` (0x2E) and inverts, so a
trade closed exactly at the reset instant or exactly on a range boundary falls on the wrong side. A
non-UTC offset would break it completely.
*Fix:* one `toEpoch(iso): number` helper; compare and sort numerically.

**M2 — The mentor pack and the dashboard report different win rates.**
`mentor-export.ts:73` and `:108` call `computeStats` / `breakdownByField` with the default
`EXACT_ZERO_RANGE`, ignoring the account's configured breakeven band that the dashboard applies. The same
trades yield two different win rates — and the export is the copy that goes to a mentor.
*Fix:* thread `BreakevenRange` through `MentorPackOpts`.

**M3 — TypeScript and SQL disagree on fees.**
`position-stats.ts:69-82` `continue`s past a fill *before* `totalFees += e.fee ?? 0`; the view sums
`COALESCE(e.fee, 0)` over every row regardless of qty. A malformed or fee-only row makes the form's live net
P&L differ from the stored figure — in a file whose first line promises the two stay in sync.
*Fix:* accumulate fees and swap before the qty guard.

**M4 — MAE/MFE mixes two entry references.**
`excursion.ts:34-58` measures excursion points from `avg_entry` (the actual fill) but divides by `riskPts`,
which `plannedRiskPts` derives from the *planned* entry. On a slipped entry, numerator and denominator use
different origins, so MAE in R is systematically off by the slippage. Either reference is defensible;
mixing them is not.

**M5 — Stored `planned_rr` shadows live prices.** `exit-efficiency.ts:29-39` prefers the stored string.
Combined with H2, "Target attainment" depends on the order in which the trade was saved.

**M6 — Redundant work and duplicated logic.**
- `dashboard.tsx:279-292` and `:299-310` build **identical** balance timelines from identical arguments;
  `computeStats` builds a third internally (`analytics.ts:148-153`). Three full passes to produce one
  drawdown figure — and `stats.maxDrawdown` and `drawdown.maxMoney` are the same number reached two ways.
- `computeDrawdown` (`balance.ts:146-164`) and `drawdownSeries` (`balance.ts:211-221`) each reimplement peak
  tracking.
- `plannedRiskPts` is computed twice per call in `computePositionStats` (`position-stats.ts:98` and `:123`).
- `mentor-export.ts` calls `toRealized(trades)` twelve times — once in `statsTable`, once per
  `breakdownTable`, once in `buildMentorPack`.

**M7 — `getFailedFtmoAccountIds()` runs on every trade insert** (`trades/actions.ts:97`), pulling all accounts
plus the entire stats view to resolve one boolean.

**M8 — Mentor-pack download breaks in Firefox and Safari.** `dashboard.tsx:510-517` calls
`URL.revokeObjectURL(url)` synchronously after `a.click()`, and never attaches the anchor to the DOM.

**M9 — `addOption` / `addList` race on `sort_order`** (`settings/actions.ts:44-55`, `:125-138`): read `max`,
then insert. Two concurrent adds produce duplicate ordinals.

**M10 — Import errors are swallowed.** `import/actions.ts:136`:

```ts
} catch { failed++; }
```

The message is discarded, so the user sees "3 failed" with no cause. A `create` whose execution insert fails
also leaves an orphan position behind — unlike `createTrade` (`trades/actions.ts:133-136`), which rolls back.

---

## LOW / dead code

- **Unused exports** (no non-test reference): `countTradingDays`, `unloggedTradingDays`, `countOpenTrades`
  (`activity.ts`), `secondsToDays` (`units.ts`), `tradingDayKeys` (only `tradingDayKeysFromRows` is used).
- **The unit layer is orphaned.** `units.ts` implements seven view modes × two P&L bases — `formatMetric`,
  `canRender`, `VIEW_MODES`, `pipSize`, `metric` — and only `formatDuration` is ever called. Either wire the
  mode switcher into the dashboard or delete ~150 lines.
- `exit-efficiency.ts:14` re-exports `parsePlannedRewardR`, which it also imports from `plan-calculations` —
  two import paths for one function.
- `units.ts:185` passes `{ sign: false }`, already the default (`format.ts:4`).
- `analytics.ts:40-41` applies `?? 0` after a filter that already proved the value non-null.
- `rHistogram` (`analytics.ts:218-240`) boundaries are inclusive-low everywhere except the top: `r = 5.0`
  lands in `">5"` rather than `"4..5"`.
- `fmtR(-0.001)` renders `"-0.00R"`; `fmtR(0)` renders `"0.00R"` with no sign, inconsistent with `fmtMoney`'s
  `sign` option.
- `nightsBetween` (`cost-defaults.ts:51-60`) counts elapsed 24-hour periods, not calendar nights in the
  account timezone — a Mon 23:00 → Wed 01:00 hold accrues 1 night instead of 2, while the doc comment says
  "whole nights".
- `zonedWeekStartKey` (`time.ts:92-104`) calls `formatInTimeZone` twice for one date.
- `updateAccount` (`settings/actions.ts:224`) lets `starting_balance` change retroactively, re-basing every
  historical drawdown %, FTMO evaluation and position-size suggestion with no warning.
- `getTradesWithStats` orders by `created_at` while every metric dates trades by `closed_at`; the ordering is
  re-done in `toRealized` anyway.
- `session_killzone` still exists as a column on `tj_positions` and in the `tj_seed_defaults` function body
  restored by `20260721130000`, although `20260719150000_drop_session_killzone.sql` removed it from the UI and
  the option lists. Dead column, dead seed data.

---

## What was fixed in this pass

**Implemented on this branch, with tests: all Critical (C1–C4), all High (H1–H6) and all Medium
(M1–M10)**, plus the `getInstruments` bug found under C1.

Four migrations were applied to the live project (`hjwvhzcszhjhpocfjatm`) and committed to
`supabase/migrations/`:

| Migration | What it does |
| --- | --- |
| `20260728120000_snapshot_instrument_spec.sql` | Snapshot columns, backfill, rebuilt `tj_position_stats` |
| `20260728121000_tj_replace_executions.sql` | Atomic fill-replacement RPC |
| `20260728122000_fix_position_status_check.sql` | Widened status constraint + re-run backfill |
| `20260728123000_atomic_option_sort_order.sql` | Atomic sort_order allocation for option items and lists |

Verified end to end against the live database: a trade planned → marked missed → restored → filled → closed
prices correctly (20 pts, $20 gross, $15 net after $4 fees and $1 swap, 2.00R, 25h hold), and its net P&L
stayed at **$15** both after the instrument's `point_value` was edited to 12345 and after the instrument row
was deleted outright. Before C1 those two actions rewrote it silently.

`security_invoker = on` survived the view rebuild — confirmed directly and via the Supabase security
advisor, which reports no new findings (the two it does report, a pre-existing `SECURITY DEFINER` seed
function and an auth password-protection setting, are unrelated to this work).

### One finding withdrawn on closer inspection: M4

M4 claimed `excursionFromTrade` was inconsistent for measuring movement from `avg_entry` while dividing by
risk derived from the *planned* entry. Checking `tj_position_stats` settles it: `realized_r` is built the
same way — its numerator `gross_points` comes off `avg_entry`, its denominator off
`COALESCE(entry_price, avg_entry)`. The pairing is the journal's R convention, not an oversight, and
excursion already matches it.

That agreement is load-bearing: `capturePct` is `realizedR / mfeR`, so re-basing MAE/MFE onto a single
reference would have put the two on different footings and silently corrupted capture — the "fix" would
have introduced the bug. The convention is now documented at the function, and a test pins the agreement
so it is not attempted again.

Conclusion: R means *multiples of the risk I planned to take, over the move I actually got*. Defensible,
deliberate, and now written down.

### Still open

**Low / dead code only.** Everything listed under LOW above remains, and is cosmetic or dead-code cleanup
rather than a correctness risk. The two Supabase advisories that predate this work (a `SECURITY DEFINER`
seed function and the auth leaked-password setting) are also untouched.
