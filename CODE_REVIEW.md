# Code review — Trading Journal

Deep-dive review of the calculation layer, the report engine, the playbook layer, the
server actions and the `tj_position_stats` view. Reviewed at commit `f5270b2`.

This is the **second** review round. The first (at commit `cb9c51e`) covered the Phase
1–2 calculation core and closed with nothing open; its findings and their fixes are in
git history, and are visible in the tree as the explanatory comments now sitting at each
decision point. This document does not repeat them.

Since that round, four phases landed: the report engine (3a), the `/reports` route with
compare mode (3b/3c), user-defined trade fields (4a), and the playbook as an entity with
per-rule statistics (4b). That new code — plus the boundaries where the previous round's
fixes did not propagate into it — is where this round concentrates.

Baseline before any change: `npm test` → **488 tests / 37 files, all passing**;
`npx tsc --noEmit` clean. After the fixes below: **503 passing**, typecheck clean,
`npm run build` clean.

## Summary

The pure-math layer remains in good shape, and the discipline of writing the reasoning
down at the point of decision has held — the breakeven-band split in `analytics.ts:93-102`,
the two drawdown bases in `balance.ts:1-14`, close-date attribution in
`period-stats.ts:67-75`, the plan-vs-fill R convention in `excursion.ts:30-46`. Those
comments made this review much faster, and several are the reason a finding below is an
*inconsistency* rather than a *mistake*.

This round's defects cluster around **one principle that was established and then not
propagated.** Migration `20260728120000` deliberately removed `COALESCE(point_value, 1)`
from the stats view, so a trade whose instrument cannot be resolved returns
`point_value_source = 'missing'` and null money — the honest answer — instead of a
500-point ES win rendered as `$500`. Two TypeScript call sites still did exactly what the
SQL stopped doing. One of them is the **position-size calculator**, whose output is
written into the trade on save.

The rest divide into: a transactional guarantee granted to fills but never extended to
the data Phase 4b added; two places where the report engine reads a value without the
qualifier that gives it meaning (a metric's direction; a trade's timezone); and a set of
unvalidated URL parameters on `/reports`, one of which silently disables the entire
small-sample guard the engine was built around.

| Severity | Count | Theme | Status |
| --- | --- | --- | --- |
| Critical | 1 | Position sizing suggests a size wrong by a factor of the point value | **Fixed** |
| High | 5 | An unpriced trade quoted in dollars; a non-atomic write that destroys data; a summary that inverts; a filter on the wrong clock; two populations behind one figure | **Fixed** |
| Medium | 8 | Unvalidated URL input, missing guards, swallowed errors, duplicated reads | Documented |
| Low | 6 | Dead exports, an unwired component, three copies of one accessor | Documented |

Critical and High are fixed in this commit, each with a regression test confirmed to fail
before the change. Medium and Low are documented with corrected snippets and left for
triage.

---

## CRITICAL

### C1 — Position sizing silently suggests a size wrong by a factor of `point_value`

`src/components/journal/trade-form.tsx:328`

```ts
const instrument = instruments.find((i) => i.symbol === fields.instrument);
const pointValue = instrument?.point_value ?? 1;
```

The symbol resolves to nothing more often than it looks. `normalizeInstrumentSymbol`
passes any unrecognised broker symbol straight through (`EUR/USD.pro` → `EURUSDPRO`), so
every imported trade on an unmapped symbol lands here; so does a deactivated instrument,
and so does a symbol typed before it was added in Settings. In all three cases
`pointValue` became `1`, feeding three consumers:

**1. The position-size calculator.** `computePositionSize` is
`riskAmount / (stopDist × pointValue)`. At `1` instead of `50` (ES), the suggestion is
**fifty times too large**. Nothing flags it, because `1` passes every `> 0` guard in the
function — it returns a plausible number rather than nothing.

**2. That suggestion is then persisted** (`trade-form.tsx:605`):

```ts
fieldsToSave.position_size = Number(metrics.sizeSuggestion.toFixed(4));
```

So the wrong number does not merely render — it becomes the trade's recorded size, and
from there feeds `size_bucket` reports and the `size` filter.

**3. The form's live P&L preview.** `computePositionStats({ point_value: pointValue })`
priced the trade in raw points while `tj_position_stats`, correctly, returned `NULL` for
the same trade. The form and the database disagreed, and the form was the one that looked
confident.

**Root cause worth naming.** `computePositionSize` declared `pointValue: number`,
non-nullable. A caller with no point value had no way to *say* so, and `?? 1` is what that
pressure produces. The runtime guard was in fact already correct for an explicit null
(`null <= 0` coerces to `true` in JS) — it was the *type* that made the honest call
impossible. Widening it is the fix; the fallback was the symptom.

**Fix — applied.** Carry "unpriceable" as `null` all the way through, and let each
consumer decline.

```ts
// src/lib/journal/plan-calculations.ts
export function computePositionSize(params: {
  balance: number;
  riskPct: number | null;
  entry: number | null;
  stop: number | null;
  pointValue: number | null;   // was: number
}): number | null {
  const { balance, riskPct, entry, stop, pointValue } = params;
  if (
    riskPct == null || entry == null || stop == null ||
    balance <= 0 || pointValue == null || pointValue <= 0
  ) {
    return null;
  }
  // …
}
```

```ts
// src/lib/journal/position-stats.ts — money is null without a spec; points and R, which
// live in price space, survive one. Exactly as the SQL view has it.
const pointValue = input.point_value ?? null;
// …
grossPoints = (exitNotional - avgEntry * exitQty) * dir;
if (pointValue != null) {
  grossPl = grossPoints * pointValue;
  netPl = grossPl - totalFees - totalSwap;
}
if (riskPts != null && entryQty > 0) {
  const riskDenom = riskPts * entryQty;
  realizedR = grossPoints / riskDenom;          // unaffected
  if (pointValue != null) {
    const riskMoney = riskDenom * pointValue;
    if (riskMoney > 0 && netPl != null) realizedRNet = netPl / riskMoney;
  }
}
```

```ts
// src/components/journal/trade-form.tsx
const pointValue = instrument?.point_value ?? null;
```

Both render sites already fall back to `"—"` when `sizeSuggestion` is null, so the number
simply disappears. A blank field is not self-explanatory, though, so the risk-plan group
now carries a hint naming the instrument that has no point value and where to fix it,
rather than leaving the user to interpret a dash.

*Regression test:* `position-stats.test.ts` — "an unpriceable trade yields no money,
matching the view" (fails before the change). `plan-calculations.test.ts` pins the
nullable contract so the fallback cannot return.

---

## HIGH

### H1 — The same `?? 1` in the aggregate slippage path

`src/lib/journal/entry-slippage.ts:190`

```ts
const pointValue = row.stats?.point_value ?? 1;
```

`slippageMoney = adversePts × pointValue × entryQty` then quotes a currency figure for a
trade whose P&L the database itself declined to state. Same class as C1, in the path
feeding `computeSlippageStats` and the mentor export.

**Fix — applied.** `slippageMoney` is null without a spec; `slippageR` is a ratio in price
space, is unaffected, and is the more useful half anyway.

```ts
const pointValue = row.stats?.point_value ?? null;
// …
let slippageMoney: number | null = null;
if (entryQty != null && entryQty > 0 && pointValue != null) {
  slippageMoney = adversePts * pointValue * entryQty;
}
```

`computeEntrySlippage`'s `pointValue` default also moved from `1` to `null`, so an omitted
spec and an unknown spec now mean the same thing.

*Regression test:* `entry-slippage.test.ts` — "slippage money needs a contract spec".

---

### H2 — A failed rule-answer write permanently destroys the trade's recorded answers

`src/app/(app)/trades/actions.ts:62-87`

```ts
const { error: delErr } = await supabase
  .from("tj_position_rules").delete().eq("position_id", positionId);
if (delErr) return delErr.message;
// … separate round trip …
const { error } = await supabase.from("tj_position_rules").insert(/* … */);
```

Delete-then-insert as two round trips, with no rollback of any kind. If the insert fails —
a retired rule id, a transient network error, an RLS refusal — the delete has already
committed and **every recorded answer for that trade is gone**. In `updateTrade` the
position write has committed too, so returning the error undoes nothing.

This is precisely the failure `tj_replace_executions` (migration `20260728121000`) was
written to eliminate for fills; its header says so at length. Rule answers arrived in
Phase 4b and never got the same treatment, though they carry the follow rate that feeds
every process report.

**Fix — applied.** A new `tj_replace_position_rules(uuid, jsonb)`, modelled directly on
its sibling — same `SECURITY INVOKER`, same `SET search_path = ''`, same
ownership-from-parent-position rule, same revoke/grant shape. A function body is one
implicit transaction, so either the new answers land or the old ones were never removed.

```sql
-- supabase/migrations/20260730120000_tj_replace_position_rules.sql
CREATE OR REPLACE FUNCTION public.tj_replace_position_rules(
  p_position_id uuid,
  p_rules       jsonb DEFAULT '[]'::jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_user_id uuid; v_inserted integer;
BEGIN
  SELECT user_id INTO v_user_id FROM public.tj_positions WHERE id = p_position_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Position % not found', p_position_id USING ERRCODE = 'no_data_found';
  END IF;

  DELETE FROM public.tj_position_rules WHERE position_id = p_position_id;

  INSERT INTO public.tj_position_rules (user_id, position_id, rule_id, followed)
  SELECT v_user_id, p_position_id, r.rule_id, r.followed
  FROM jsonb_to_recordset(COALESCE(p_rules, '[]'::jsonb))
    AS r(rule_id uuid, followed boolean)
  WHERE r.rule_id IS NOT NULL AND r.followed IS NOT NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END; $$;
```

Delete-then-insert is kept rather than switched to an upsert, deliberately and for the
reason the original comment gives: a rule the trader *un*-answered has no key in the
payload at all, and an upsert would leave the withdrawn judgement standing.

The `WHERE r.followed IS NOT NULL` guard enforces at the boundary what the payload already
implies — the three-state `followed` column uses `NULL` for "not answered", and a
malformed submission must not be able to write that state as though it were an answer.

`saveRuleAnswers` collapses to the RPC call, and `getCurrentUser` is no longer needed there
(the function takes ownership from the parent position, which is stricter than `auth.uid()`
and works outside a request context).

> **Not applied to the live database.** The migration ships as a file. Running it is your
> call — `saveRuleAnswers` will fail until it exists.

---

### H3 — "Best" and "worst" are inverted for every lower-is-better metric

`src/lib/journal/reports/engine.ts:196-199`

```ts
const byMetric = [...withValue].sort(
  (a, b) => (b.values[metricKey] as number) - (a.values[metricKey] as number),
);
// best: byMetric[0]   worst: byMetric[byMetric.length - 1]
```

Always descending, ignoring `ReportMetric.higherIsBetter`. `summarizeReport(result,
metricKey)` is called with whichever metric the user selected
(`reports-workbench.tsx:477`), and six catalogue entries declare `higherIsBetter: false`
— `avg_hold`, `total_fees`, `total_swap`, `cost_pct_of_gross`, `avg_mae_r`,
`breakeven_count`.

Group by instrument, select "Komisije", and the performance panel names the
**highest-fee** instrument as your best. Select "Avg MAE u R" and it celebrates the setup
that went furthest offside. `sortRows`, thirty lines above in the same file, already reads
the flag correctly — the summary was the one place that did not.

**Fix — applied.**

```ts
const eligible = result.rows.filter((r) => !r.belowSample);
// The result's own metric list first — a pivot or a caller-built metric may not be in the
// global catalogue — then the catalogue as a fallback.
const metric =
  result.metrics.find((m) => m.key === metricKey) ?? getMetric(metricKey);
const dir = metric?.higherIsBetter === false ? 1 : -1;
// …
const byMetric = [...withValue].sort(
  (a, b) =>
    ((a.values[metricKey] as number) - (b.values[metricKey] as number)) * dir,
);
```

*Regression test:* `engine.test.ts` — "summarizeReport respects the metric's direction",
three cases including the catalogue-fallback path. Two of the three failed before the
change.

---

### H4 — The report date filter runs on a different clock from every bucket

`src/lib/journal/reports/filters.ts:102-104`

```ts
const closed = t.closedAt ?? "";
if (filters.dateFrom && closed.slice(0, 10) < filters.dateFrom) return false;
if (filters.dateTo   && closed.slice(0, 10) > filters.dateTo)   return false;
```

Slicing the ISO string reads the **UTC** date. Every bucket in this engine is keyed on
`EnrichedTrade.closeDay`, which `enrichTrades` resolves through `zonedDateKey` in the
account's timezone — the month dimension, the exit-weekday dimension, the calendar
heatmap, the weekly period rows.

A trade closed `2026-01-06T02:00:00Z` has `closeDay = 2026-01-05` in New York. It appears
in the January-5 row of the table, and a `to=2026-01-05` filter excludes it. At a month
boundary the same instant sits in January by one clock and February by the other, so a
"January" filter drops a trade the January bucket contains.

A second, quieter bug lived in the same three lines: a trade with no close instant became
`""`, which is unconditionally `< dateFrom` (excluded) but never `> dateTo` (kept). The
same trade was in or out depending on which end of the range you specified.

**Fix — applied.** One clock for the whole engine, one answer for the missing case.

```ts
const closeDay = t.closeDay;
if (filters.dateFrom && (!closeDay || closeDay < filters.dateFrom)) return false;
if (filters.dateTo   && (!closeDay || closeDay > filters.dateTo))   return false;
```

A trade with no close instant has no close *day* either, so a date-bounded question cannot
be answered for it — it drops out of either bound rather than being kept by one and cut by
the other.

*Regression test:* `filters.test.ts` — "date bounds use the account timezone, not UTC",
three cases including one asserting the filter and the month dimension agree. All three
failed before the change. `test-helpers.ts`'s `enrich()` gained an optional `tz` argument
(defaulting to `"UTC"`, so no existing fixture moved).

---

### H5 — Drawdown was computed over a smaller population than the money sums

`src/lib/journal/analytics.ts:177-182`

```ts
const maxDd = computeDrawdown(
  buildBalanceTimeline(0, trades.map((t) => ({ at: t.closedAt ?? "", pnl: pnl(t) }))),
).maxMoney;
```

`buildBalanceTimeline` filters `!!t.at` (`balance.ts:58`). A realized trade with a null
`closed_at` — which happens whenever the exit fills carry no `executed_at`, and
`toRealized` admits such trades because it keys on `net_pl`, not on the timestamp —
contributed to `netSum`, `winRate`, `profitFactor`, `best` and `worst`, but was invisible
to `maxDrawdown`.

The parts stopped adding up, in the one direction that flatters the book: a large loss
with a missing close timestamp raised nothing and deepened no drawdown. It propagated into
the score too, since `maxPctOfPeakPnl` is the heaviest-weighted component after profit
factor.

**Fix — applied.** `toRealized` has already sorted these chronologically and puts a
null-instant trade first; carrying the sequence position as the timeline key keeps one
population behind every figure, and the timeline only uses `at` for ordering and
labelling.

```ts
const maxDd = computeDrawdown(
  buildBalanceTimeline(
    0,
    trades.map((t, i) => ({ at: t.closedAt || `#${i}`, pnl: pnl(t) })),
  ),
).maxMoney;
```

`toEpoch("#3")` is `NaN` → `-Infinity`, so these sort first and, because `Array.sort` is
stable, keep the order `toRealized` gave them. Only `.maxMoney` is read here, so the
synthetic key never reaches a display.

*Regression test:* `analytics.test.ts` — "drawdown covers the same trades as the money
sums". Failed before the change.

---

## MEDIUM — documented, not applied

### M1 — Unvalidated URL parameters, one of which disables the small-sample guard

`src/components/journal/reports/reports-workbench.tsx:139-146`

```ts
const viewMode  = (params.get("view")  as ViewMode) ?? "dollars";
const pnlBasis  = (params.get("basis") as PnlMode)  ?? "net";
const minSample = Number(params.get("min") ?? DEFAULT_MIN_SAMPLE);
```

`?min=abc` yields `NaN`. `trades.length < NaN` is `false`, so **no row is ever flagged
`belowSample`**, and `summarizeReport`'s eligibility filter — the entire mechanism that
stops a three-trade bucket being named "best" — passes everything through. The engine's own
header calls that "exactly the mistake this whole engine is built to avoid", and a typo in
a bookmarked URL turns it off silently.

`basis` is cast unchecked and anything that is not `"net"` means gross, so `?basis=Net`
quietly reports gross P&L under a UI toggle still reading "Net". `view` is cast to
`ViewMode` with no membership check.

```ts
const VIEW_SET = new Set<ViewMode>(VIEW_MODES.map((m) => m.value));
const asViewMode = (v: string | null): ViewMode =>
  v && VIEW_SET.has(v as ViewMode) ? (v as ViewMode) : "dollars";

const viewMode = asViewMode(params.get("view"));
const pnlBasis: PnlMode = params.get("basis") === "gross" ? "gross" : "net";

const rawMin = Number(params.get("min"));
const minSample = Number.isFinite(rawMin)
  ? Math.max(1, Math.floor(rawMin))
  : DEFAULT_MIN_SAMPLE;
```

Note the `basis` inversion: defaulting to `"net"` unless the param explicitly says
`"gross"` is the safe direction, since net is what the UI shows by default.

### M2 — Percentage view mode divides by a base that is not equity

`src/components/journal/reports/reports-workbench.tsx:217-227`

`equityBase` is `Σ starting_balance + Σ cash flow`. `units.ts:58` documents the field as
*"Denominator for percentage mode — account equity, not starting balance"*, and
`balance.ts` defines equity as `starting balance + realized P&L + cash flow`. The realized
P&L term is missing, so on a book that has doubled, every "% of equity" figure is roughly
twice what it should be. Add the realized sum over the same account scope, reusing
`currentEquity(buildBalanceTimeline(...))` rather than a fourth hand-rolled total.

### M3 — `updateTrade` has no FTMO freeze check

`src/app/(app)/trades/actions.ts:211`

`createTrade` refuses on a frozen account (`:146`); `updateTrade` does not. Editing a
planned trade into an active one is a new position by any measure the freeze cares about,
so the same guard belongs on the update path — scoped, as `createTrade` does it, to the one
account being written.

### M4 — `updateTrade` reports success for a trade that does not exist

`src/app/(app)/trades/actions.ts:227-253`

When `prevPos` is null the code proceeds: `symbolChanged` is `false`,
`prevPos?.point_value_at_trade == null` is `true` so it re-snapshots, the `UPDATE` matches
zero rows, PostgREST returns no error, and the action returns `{ ok: true }`. Return
`{ ok: false, error: "Trade not found" }` when `prevPos` is null, as the sibling actions
already do.

### M5 — Check-then-update races in the lifecycle actions

`src/app/(app)/trades/actions.ts:275-391`

`markTradeMissed`, `restoreTradeToPlanned` and `activateTrade` each read the status and the
fill count, then update in a separate round trip. Two tabs, or a concurrent import merge,
can insert fills between the two — producing a trade with fills and status `missed`, which
is the state `20260728122000_fix_position_status_check.sql` exists to prevent. Fold the
predicate into the write and check the affected-row count:

```ts
const { data, error } = await supabase
  .from("tj_positions")
  .update({ status: "missed", missed_at: new Date().toISOString(), /* … */ })
  .eq("id", id)
  .eq("status", "planned")
  .select("id");
if (!error && data?.length === 0) {
  return { ok: false as const, error: "Trade changed — refresh the page" };
}
```

The fill-count half needs a `NOT EXISTS` and is cleanest as a small SQL function, in the
same shape as the two `tj_replace_*` functions.

### M6 — `commitImport` discards two error results, one of which makes undo impossible

`src/app/(app)/import/actions.ts:123-146`

The merge-path `tj_positions` status update and the `tj_import_rows` insert are both
awaited without checking `error`. The audit-row insert is the serious one: it carries
`prev_executions`, the only record of the fills the merge displaced. If it fails, the fills
are already replaced and `undoImportBatch` can never restore them — it reports the row
under `unrestorableMerges`, with no indication the cause was a swallowed write rather than
an old batch. Both should `throw` into the surrounding `try`, which already collects a
per-row reason and rolls back a created position.

A smaller point in the same block: the comment at `:110-112` says "The snapshot is still
taken, but for undo" on the merge path, and no snapshot is taken there. Merging into a
position that predates the snapshot column leaves it unpriced.

### M7 — `tj_position_rules` is drained twice per `/reports` load

`getPlaybooks` calls `ruleAnswerCounts()` internally (`playbooks.ts:64`), and
`reports/page.tsx:34` separately calls `getPositionRules()`. Both `selectAllPages` the whole
table — one row per rule per trade, the fastest-growing table in the schema — and both run
on every render of the route. One read, two projections: `getPositionRules` already returns
every row `ruleAnswerCounts` needs.

### M8 — Partial exits report a diluted R with no marker

`src/lib/journal/position-stats.ts:107-113`, and the same expression in the view
(`20260728120000_…:151`)

`realized_r = gross_points / (risk_pts × entry_qty)`, while `gross_points` covers only
`exit_qty`. For a fully closed trade the two quantities are equal and this is exact. For a
partially closed one the numerator is the realized half and the denominator is the whole
planned risk, so a position half-closed at +2R reports +1R.

That is a defensible convention — R against the risk actually taken — and the TS and SQL
implementations agree, so nothing is inconsistent. But it is undocumented, and the same
`realized_r` flows into `rHistogram`, `expectancy` and the R filter alongside closed-trade
values on the other convention. It should be a written decision at the point of
calculation, in the style of the other convention notes in this codebase, and the
partial-exit R arguably needs a marker in the UI.

---

## LOW — documented, not applied

### L1 — Dead exports

Exported, and referenced from nowhere outside their own module or its test:

| Symbol | File |
| --- | --- |
| `secondsToDays` | `units.ts:208` |
| `canRender` | `units.ts:97` |
| `pipSize` | `units.ts:87` — used internally by `formatMetric`; the export is unused |
| `durationBucketOfTrade` | `hold-time.ts:112` — dimensions use `durationBucket(t.durationSeconds)` |
| `getDimension` | `dimensions.ts:373` — superseded by `resolveDimension` |
| `isEmptyFilterSet` | `filters.ts:201` |
| `matchesFilterSet` | `filters.ts:97` — used internally by `applyFilters` |
| `chunkIds` | `paginate.ts:48` — used internally by `selectAllByIds` |
| `EMPTY_RULE_LOOKUP` | `playbook-dimensions.ts:168` |

The last group (`pipSize`, `matchesFilterSet`, `chunkIds`) are live code with a dead
`export` keyword — drop the keyword, not the function.

### L2 — The Sickre Score's seventh component is wired to nothing

`sickre-score.ts:99`, `:193-202`

`processAdherencePct` is supplied by **no caller** — the only reference outside the module
is `sickre-score.test.ts:103`. The dashboard's `computeSickreScore` call omits it, so
`PROCESS_ADHERENCE_WEIGHT` never applies, and the component the module header advertises
as "a seventh component TradeZella has no equivalent for" does not exist in the product.

Phase 4b shipped `computeFollowRate`, which is exactly its input. Either wire it —

```ts
computeSickreScore({
  // …
  processAdherencePct: computeFollowRate(enrichedInScope, playbookLookup.rules),
});
```

— or delete the branch. Leaving it is the worse option: a reader of `sickre-score.ts`
reasonably concludes the score already includes process adherence.

### L3 — `canRender` is dead, and its absence is visible

`units.ts:96-121` computes whether a view mode can actually be rendered, and the module
header says it exists "so a UI can grey out a mode instead of silently showing something
else". `reports-workbench.tsx:~395` renders all seven `VIEW_MODES` unconditionally. Select
"Pips" on a futures book and `formatMetric` falls through to `fmtMoney` — the button
appears active and the numbers do not change. Wiring this removes L1's `canRender` entry.

### L4 — Three private copies of one accessor

`enriched-trade.ts:63` (`numField`), `excursion.ts:25` (`num`) and `exit-efficiency.ts:25`
(`numField`) each do `row[key]` with a typeof check, duplicating `numberFieldValue` from
`field-values.ts:56`. That module's header (`field-values.ts:9-14`) names this exact
pattern as the thing that must not happen, because a field that moves into the `custom`
jsonb bag returns `undefined` with no error. Harmless today — `entry_price`, `stop_price`
and `position_size` are still real columns — and a silent blank the day one is not.

### L5 — `formatMetric`'s money fallbacks disagree on the sign

`units.ts:163,167` call `fmtMoney(v.base, currency)` while the direct dollars path at
`:188` uses `fmtMoney(v.base, currency, { sign: false })`. A percentage- or R-mode value
that falls back to money therefore renders `+$250.00` where dollars mode renders
`$250.00`, for the same number in the same column.

### L6 — `getInstrumentSpecs` does not chunk its `.in()` filter

`instruments.ts:414`. `paginate.ts` defines `IN_FILTER_CHUNK = 500` for exactly this — a
PostgREST `.in()` filter goes into the URL and the URL has a length cap. `commitImport`
passes one symbol per imported row, so a wide multi-symbol import is the case that reaches
it. Use `selectAllByIds`, which already chunks and drains.

---

## What was verified, and how

- `npm test` — 488 → **503 passing**, 37 files. Every Critical/High fix landed with a
  regression test, and each was run against the unfixed module first to confirm it failed
  for the stated reason. One did not: the `computePositionSize` null case already passed,
  because `null <= 0` coerces to `true`. That is recorded in C1 above rather than presented
  as a caught bug, and the test remains as a contract pin.
- `npx tsc --noEmit` — clean. This is the real check on C1, which widened a shared
  signature used by the form, the stats module and the slippage module.
- `npm run build` — clean, all 11 routes generated.
- `npm run lint` — clean apart from one pre-existing TanStack Table warning at
  `journal-grid.tsx:392`, untouched by this work.
- **Not verified against the live database.** This round was read-only with respect to
  Supabase: no query was run against the deployed project, and the H2 migration has not
  been applied. The previous round found two defects only by exercising the live DB, so
  treat the SQL-adjacent findings here as reviewed but not executed.

---

## Round 2b — audit of the live database

The findings above were read from the repo. This section is what turned up by inspecting
the deployed project (`hjwvhzcszhjhpocfjatm`) directly, while applying the H2 migration.
All four are **fixed and applied**; the guards were exercised against real rows and the
test data cleaned up afterwards.

### D1 (High) — a fill could be attached to another user's position

RLS on `tj_executions` is `user_id = auth.uid()` and nothing more. Nothing tied the fill to
the owner of the position it points at, and the foreign key only requires that the position
*exists*. A direct PostgREST insert could therefore attach a fill to someone else's
position while passing RLS with the attacker's own `user_id` — and `tj_position_stats`
aggregates executions by `position_id`, so the row would land in the victim's average
entry, P&L, R and drawdown.

The application never does this — `tj_replace_executions` takes `user_id` from the parent
position — which is exactly why nothing caught it. Closed by a `BEFORE INSERT OR UPDATE`
trigger on `tj_executions` that compares `new.user_id` against the parent's owner.

### D2 (Medium) — M5's race, closed at the database instead of narrowed

M5 above notes that `markTradeMissed` / `activateTrade` / `restoreTradeToPlanned` check the
fill count and then update, non-atomically. This cannot be a `CHECK` constraint because it
spans two tables, so it is now a pair of triggers — one refusing `status = 'missed'` on a
position that has fills, one refusing a fill on a position that is missed.

The `SELECT … FOR UPDATE` in the execution guard is what closes the race rather than
narrowing it: it takes the same row lock the position `UPDATE` already holds, so the two
statements serialise on the position row and whichever commits second sees the other's
work. Without it, both could pass their checks against a pre-change snapshot under READ
COMMITTED.

M5's application-level fix is still worth doing for the error message, but the corruption
is no longer reachable.

### D3 (Medium) — four foreign keys with no covering index

`tj_position_rules.user_id`, `tj_playbook_rules.user_id`, `tj_playbook_groups.user_id`,
`tj_cash_events.account_id`. Worse than "unindexed FK" suggests: every RLS policy in this
schema is `user_id = auth.uid()`, so `user_id` is in the `WHERE` clause of *every* query
against these tables, and `tj_position_rules` is the fastest-growing table in the schema.
`tj_position_rules` got a composite `(user_id, position_id)` that also serves the ordering
`getPositionRules()` uses. The performance advisor's four warnings are gone.

### D4 (Low) — no floor on `starting_balance`

`updateAccount` refuses a negative value in application code only. It is the denominator of
every drawdown percentage, every FTMO threshold and the percentage breakeven band, so the
rule now lives in a `CHECK` where it cannot be bypassed.

### Checked and deliberately left alone

- **`trade-images` storage bucket has zero policies.** Harmless: the app does not use
  Supabase Storage at all. Trade images are TradingView snapshot URLs
  (`tradingview.com/x/…`) stored as `tj_trade_images.image_url` and rendered from
  TradingView's own S3. The bucket is a vestige of the initial migration.
- **`tj_seed_my_defaults` flagged as a `SECURITY DEFINER` function callable by signed-in
  users.** A false positive for this design: the body raises unless `auth.uid()` is
  present and passes `auth.uid()` — not a caller-supplied argument — into the seed
  functions, so a user can only ever seed themselves.
- **Nine "unused index" advisories.** Noise on a database with no trades yet. Revisit once
  there is real query traffic; the four indexes added in D3 join the same list for now.

### Requires the Supabase dashboard — cannot be done over MCP

- **Leaked-password protection is disabled** (HaveIBeenPwned check). Security advisor WARN.
- **Backups**: free tier is daily snapshots with no point-in-time recovery.
- **MFA** on the Supabase account itself.
- **Redirect URLs** for the production domain when the app is deployed.

### Still open

Everything under Medium and Low in round 2, minus M5's corruption path (closed by D2).
Nothing under Critical or High. Plus the four dashboard items listed above.

> **Superseded.** All fourteen were resolved in round 3, step 1 below — eleven fixed, one
> already closed by phase 5, and two corrections to this document's own findings. The four
> Supabase-dashboard items are unchanged and still require the dashboard.

---

# Round 3 — full-project audit

Rounds 1 and 2 closed at commit `f5270b2`. Since then **32 commits, 101 files,
+12 567 / −866 lines** have landed and never been reviewed: phases 5 (Progress Tracker),
6 (Notebook), 7 (calendar, daily block, grid columns), 8A (candle-derived MAE/MFE), and the
parity cleanup that dropped four dead columns. That delta is where this round concentrates;
earlier code gets a re-check rather than a fresh read.

**Process change, decided by the owner before this round started: the
"documented, not applied" bucket is abolished.** Round 2 left fourteen findings in it and
all fourteen are still sitting there — which is the whole argument. Every finding in round 3
carries an outcome in its own step: `FIXED` or `REJECTED — reason`. Nothing is parked.

Scope decisions for this round, also the owner's: no large refactors (correctness, dead code
and small duplications only — `dashboard.tsx` and the other large working components are not
taken apart), and `knip` joins the repo as a permanent devDependency.

The audit runs in ten steps, each ending in its own commit, with a stop for approval between
every pair. This section grows one step at a time.

## Step 0 — inventory (no fixes)

Nothing was changed in `src/` in this step. The point was to stand up the machines that find
things mechanically, record what they say, and decide nothing.

### Baseline

| | |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **700 tests / 46 files**, all passing |
| `npm run lint` | 0 errors, **1 warning** (`journal-grid.tsx:538`, React Compiler × TanStack Table — knowingly kept) |
| `npm run build` | passes, 12 routes |
| Source | 222 files, ~41 000 lines |
| Migrations | 41 |
| Supabase advisors | 2 WARN, both known and accepted |

These are control values for the rest of the round. The lint warning count in particular must
stay at exactly **1**; any other number means a later step introduced something.

### Tooling

`knip` (devDependency) with `knip.json`: Next.js and Vitest plugins on, the generated
`src/lib/supabase/types.ts` excluded. `@vitest/coverage-v8` was already installed and is now
actually used.

Two knip results were investigated and dismissed before recording anything, so they do not
pollute the list:

- **`server-only`, reported as an unlisted dependency in 17 files — false positive.** It
  does not resolve through node (`require.resolve` throws `MODULE_NOT_FOUND`) and it is not
  in any `package.json`, yet every build passes. Next ships it as
  `next/dist/compiled/server-only` and aliases the bare specifier in
  `next/dist/build/create-compiler-aliases.js`. Adding it to `package.json` would install a
  redundant second copy. Silenced in `knip.json`.
- **`tw-animate-css`, reported as used.** It is — `src/app/globals.css:2` imports it, which
  knip reads. An initial guess that it was dead was wrong and the ignore entry was removed.

### P1 — Seven unused files

All in `src/components/ui/`, none imported anywhere:
`calendar.tsx`, `filter-select.tsx`, `form.tsx`, `input-group.tsx`, `scroll-area.tsx`,
`separator.tsx`, `tooltip.tsx`.

Confirmed twice — by knip and independently by grep for `components/ui/<name>"`.

### P2 — Four unused dependencies

`@base-ui/react`, `@hookform/resolvers`, `react-day-picker`, `react-hook-form`.

Two of the four are held up only by P1 files: `react-day-picker` by `ui/calendar.tsx`,
`react-hook-form` by `ui/form.tsx`. `@base-ui/react` and `@hookform/resolvers` have zero
references anywhere in `src/`. Deleting P1 and P2 together is one move, in step 8.

Note for that step: `ui/calendar.tsx` is the react-day-picker wrapper deliberately **not**
used by `/calendar` — it resolves real `Date` objects in the browser's zone, while every day
key in this app is a day in the **account's** zone. That reasoning is already recorded in the
phase 7 plan; deleting the file removes the temptation along with the code.

### P3 — 67 unused exports and 22 unused exported types

Raw count from knip. This is a triage list, not a defect list: an export used only inside its
own module is a missing `export` keyword removal, not dead code, and the `ui/` re-exports are
a component library shipping its complete API on purpose. Three groups worth separating in
step 8:

1. **`ui/` re-exports** (~30 of the 67) — `AlertTitle`, `CardFooter`, `DropdownMenuSub…`,
   `SelectGroup`, `TableCaption` and so on. Almost certainly keep: they are the shadcn
   surface, and pruning them means editing vendored components that get re-generated.
2. **Genuinely unreferenced application code** — `renameList` and `deleteList`
   (`settings/actions.ts:147,159`), `getNotesForPosition` (`notes/queries.ts:58`),
   `getLockedDays` (`tracker/queries.ts:130`), `getFtmoStatuses` (`ftmo-status.ts:22`),
   `durationBucketOfTrade` (`hold-time.ts:112`), `matchesFilterSet` (`filters.ts:97`),
   `isTradingViewChartLayoutUrl` (`tradingview-snapshot.ts:25`). Each needs a decision: wire
   it up, or delete it.
3. **Constants and types exported for readability but never imported** — `EMPTY_COSTS`,
   `EMPTY_PREFS`, `EMPTY_PERIOD_SUMMARY`, `EMPTY_RULE_LOOKUP`, `SEVERITY_ORDER`,
   `CONSISTENCY_SCALE`, `MIN_VISIBLE_COLUMNS`, `TAG_SPLITS`, `SIZE_EDGES`,
   `AUTO_RULE_KEYS`… Cheapest resolution is usually to drop the `export`, and several are
   deliberately exported so a test or a future caller can reach them.

### P4 — Coverage: where no test reaches

`vitest run --coverage`: **88.42% statements, 82.1% branches, 87.25% functions** across the
2 799 statements that any test imports.

The number is not the finding. These are:

| Module | Stmts | Funcs | What is dark |
|---|--:|--:|---|
| `reports/metrics.ts` | 44.7% | **39.0%** | Most `compute` callbacks never run — including all four risk ratios added in phase 7 |
| `trade-lifecycle.ts` | 53.8% | 69.2% | Lines 29–57 and 109–138: the guards this session's button-gating work depends on |
| `analytics.ts` | 61.1% | **44.0%** | Lines 397–415, 460–478 — slippage and exit-efficiency aggregates |
| `time.ts` | 62.2% | 75.0% | Lines 11–77: `fmtInTz`, `zonedInputToUtc`, `utcToZonedInput`, `parseImportTime` — every timezone conversion in the app |
| `format.ts` | 63.2% | 83.3% | |
| `mentor-export.ts` | 74.6% | 80.8% | 59.5% branch |
| `units.ts` | 77.5% | 100% | 68.7% branch |
| `reports/dimensions.ts` | 77.3% | 81.6% | Lines 418–432, 503–507 |
| `field-def-types.ts` | 60.0% | 0% | `slugifyFieldKey` has no test at all |

`metrics.ts` and `time.ts` are the two that matter most: the first is the registry every
report column reads through, the second is the module where a mistake shifts every date in
the app by a day, silently.

**What this table does NOT cover, and must not be read as covered:** any module no test
imports never appears in it at all. That is every server query module, every server action
and every component — roughly half the codebase. Those are steps 5 through 8, and coverage
tooling will not help there.

### P5 — `eslint.config.mjs` replaces the default ignore list instead of extending it

Found by the baseline itself, which is the argument for having one: the first
`vitest run --coverage` took the lint warning count from 1 to 2. The second warning was
`coverage/block-navigation.js:1 — Unused eslint-disable directive`, in istanbul's own
vendored reporter JS.

`.gitignore:14` already carries `/coverage`, so nothing was ever going to be committed — but
`globalIgnores` in `eslint.config.mjs` is a hand-copied replacement for
`eslint-config-next`'s defaults, not an addition to them. Anything not named in that array
gets linted, including generated output. `coverage/**` added, with the reason written at the
point of decision so the next person adding a tool knows the list must grow with it.

Fixed here rather than deferred: the tool installed in this step caused it, and leaving it
would have poisoned the control value for all nine remaining steps.

### Outcome

`FIXED` — P5 only (lint config; no `src/` change).
`RECORDED` — P1, P2, P3, P4, to be decided in steps 8 and 3.
Two knip false positives dismissed before recording (`server-only`, `tw-animate-css`).
Baseline holds: 700 tests, **1** lint warning, `tsc` clean, build green, 12 routes.

## Step 1 — closing round 2's fourteen

Round 2 left M1–M8 and L1–L6 in a bucket called "documented, not applied", and there they
stayed. Each was re-checked against today's code before anything was touched, because a
finding list nobody re-verified is not a work list — and two of the fourteen turned out not
to need work at all, in opposite directions.

**Two corrections to round 2, stated plainly:**

- **L5 was wrong.** It claimed `formatMetric`'s money fallbacks rendered `+$250.00` where
  dollars mode rendered `$250.00`. They never did: `fmtMoney(n, currency, opts)` defaults
  `opts` to `{}`, so `opts.sign && v > 0` is falsy and the two spellings have always been
  identical. `REJECTED`. A test now pins the equivalence across all five fallback paths, so
  the claim is settled by execution rather than re-argued; the six call sites were also
  folded into one local `money()` — not a fix, just one fewer place for a future
  `sign: true` to land in isolation.
- **L1 over-counted by five.** It listed eight symbols as "referenced from nowhere outside
  their own module or its test". Treating a test as a non-consumer is the wrong test: these
  are pure functions whose tests are their specification. knip, which counts test imports,
  finds only three genuinely unreferenced — and `getDimension` has since been wired into the
  journal grid's outcome filter, so the list is down to three.

### Outcomes

| # | Outcome | What changed |
|---|---|---|
| M1 | `FIXED` | URL parsing extracted to `reports/url-params.ts` with tests |
| M2 | `FIXED` | `equityBase` now includes realized P&L |
| M3 | `FIXED` | FTMO freeze guard added to `updateTrade` |
| M4 | `FIXED` | Missing trade returns "Trade not found", not `{ ok: true }` |
| M5 | `FIXED` | Guard predicate folded into all three lifecycle writes |
| M6 | `FIXED` | Both swallowed errors now throw; counters made consistent |
| M7 | `FIXED` | `tj_position_rules` drained once per route, not twice |
| M8 | `FIXED (documented)` | Partial-exit R convention written at the point of calculation |
| L1 | `FIXED (3)` / `REJECTED (5)` | See correction above |
| L2 | `ALREADY CLOSED` | Phase 5 wired `processAdherencePct`; round 2's text was stale |
| L3 | `FIXED` | `canRender` wired; unusable view modes are disabled |
| L4 | `FIXED` | Three private accessors replaced by `numberFieldValue` |
| L5 | `REJECTED` | The finding was wrong; equivalence pinned by test |
| L6 | `FIXED` | `getInstrumentSpecs` chunks and pages both of its paths |

### The three that were more than mechanical

**M1 — `?min=abc` silently disabled the small-sample guard.** `Number("abc")` is `NaN`,
`trades.length < NaN` is `false`, so no bucket was ever flagged `belowSample` and
`summarizeReport` let everything through — the entire mechanism stopping a three-trade
bucket from being crowned "best". Parsing moved out of the component into
`reports/url-params.ts`, where it can be imported and tested; a component-local helper is
untestable by construction, which is part of why this survived. `basis` was also inverted to
"gross only when the URL says gross", since the cast treated `?basis=Net` — one capital
letter — as gross under a toggle still highlighting Net.

**L3 — four of seven view modes were lying.** `units.ts` has computed `canRender` since it
was written, with a header saying it exists "so a UI can grey out a mode instead of silently
showing something else", and nothing ever called it. A report groups trades across many
instruments, so the format context carries a currency and an equity base and no instrument
and no per-trade risk: R, points, ticks and pips cannot render there at all. Selecting Pips
lit the button up and changed nothing. They are now disabled with a tooltip explaining why,
and a mode arriving from the URL that cannot render falls back for display — the same lie
was reachable from both directions.

**M6 — and the regression the fix would have introduced.** Making the audit insert throw is
right: `prev_executions` is the only record of the fills a merge displaced, and swallowing
its error made undo permanently impossible for that row while reporting it as merely
`unrestorableMerges`. But `merged++` sat BEFORE that insert, so a throw would have counted
the same row as merged *and* as failed, and the four totals would no longer have summed to
the batch. The counters now record an outcome and are applied once the audit row has landed.
Worth noting as its own small lesson: a fix that turns a silent path into a throwing one has
to re-check everything downstream of it that assumed no throw.

### Verified

`tsc` clean · **711 tests / 47 files** (700 → 711; the eleven are M1's URL parsing and L5's
equivalence pin) · lint back to exactly **1** warning · build green · knip unused exports
67 → 62.

Not exercised against the live database: M3–M7 are server actions and this container has no
Supabase credentials. M5's atomicity rests on the DB triggers from round 2b (D2), which were
exercised then; what changed here is the error the user sees, not the guarantee.

### Outcome

`FIXED` — M1, M2, M3, M4, M5, M6, M7, M8, L3, L4, L6, and three of L1.
`REJECTED` — L5 (finding incorrect), five of L1 (test imports are consumers).
`ALREADY CLOSED` — L2.
The "documented, not applied" bucket no longer exists.

## Step 2 — schema, migrations, seed

The step that justified the whole round: it found a **critical, live, user-facing break** that
nothing in the test suite, the type checker, the linter or the build could have caught, because
it lives entirely in SQL that only runs for a user who does not exist yet.

### C1 (Critical) — `tj_seed_defaults` threw for every new user

`tj_option_items.label` is `NOT NULL` with no default. Since phase 6 the seed has inserted
only `(user_id, list_id, value, sort_order)`, so every call ended in

```
null value in column "label" of relation "tj_option_items" violates not-null constraint
```

**No new account could be initialised.** Not through the `tj_on_auth_user_created` trigger at
signup, not through `tj_seed_my_defaults()` which `ensureDefaults()` calls on every page load.
A new user would land in an app with no account, no option lists, no instruments, no playbooks,
no tracker rules and no note folders — the trade form would open empty and stay empty.

Traced exactly: `20260801140000_notebook.sql` rewrote the whole function body to add
`perform public.tj_seed_note_folders(target)` and dropped `label` from the column list while
doing it. Every version through `20260729150000_tracker.sql` has
`(user_id, list_id, value, label, sort_order)` with `select target, l.id, v.value, v.value,
v.ord` — the value doubles as the label, because the label is the part the user may rename
without touching the value already written into trades. **Two later migrations, both mine,
copied the broken body forward** (`20260801170000`, `20260801190000`).

Why nobody noticed: the only user in the database was seeded before the break, and
`ensureDefaults` merely `console.error`s the failure and carries on — so the one code path
that would have shown it was also the one path that swallows it. That swallowing is its own
finding and belongs to step 6.

The lesson generalises and is written into the migration: `CREATE OR REPLACE FUNCTION` with a
hand-copied body inherits the original's mistakes, and nothing verifies it until the function
is actually called.

Fixed in `20260802120000_fix_seed_option_item_label.sql`, applied, and **proved by execution**:
a synthetic user was inserted into `auth.users` inside a rolled-back transaction, seeded, and
compared column by column against the live account.

| | fresh user | live user | |
|---|---|---|---|
| option lists | 13 keys | 13 keys | identical |
| option items | 66 | 71 | **expected** — see below |
| labels ≠ values | 0 | — | every label seeded |
| field defs | 4, same groups | same | identical |
| instruments | 10 symbols | same | identical |
| tracker rules | 10 | 10 | identical |
| note folders | 3 names | same | identical |
| accounts | 1 | 1 | identical |

The five extra items on the live account are **user customisations**, verified per list:
`risk_pct` 6 vs 4, `technical_tag` 12 vs 8, `entry_tf` 5 vs 6. That is the seed giving
defaults and the owner editing them, which is the design.

### Checked and deliberately NOT changed

- **`tj_seed_playbooks` seeds 6 playbooks and 18 groups with ZERO rules.** This reads like the
  same class of bug and is not: `20260729130000_playbook.sql:203` states the intent — *"Rules
  are left empty on purpose: a seeded rule you did not write is a rule you will check without
  reading."* Left alone.
- **`tj_column_mappings` (whole table) and `tj_import_batches.broker_preset`** have no reader
  anywhere in `src/`. Kept: they are scaffolding for broker presets (J5), which ROADMAP tracks
  as an outstanding phase 7 block and which names this table and the seam in
  `import-wizard.tsx`. A named plan is the difference between scaffolding and debt.

### C2 (Low) — `tj_executions.import_row_id` dropped

A bare `uuid` with **no foreign key and no index**, never written and never read — so it did
not even do the job its name implies. The shipped model runs the link the other way
(`tj_import_rows.matched_position_id` plus `prev_executions`, which is what `undoImportBatch`
actually uses). Dropped from the table with the most rows per trade, in
`20260802121000_drop_execution_import_row_id.sql`.

### C3 — the SQL view and its TypeScript twin, finally pinned

`position-stats.ts` opens with *"must stay in sync with `tj_position_stats` SQL view"* and
nothing enforced it. The same position and fills were inserted into the deployed database in a
rolled-back transaction, the view's own output read off, and pasted into
`position-stats.test.ts` as a golden vector. The case exercises everything that separates
naive from correct: a short (sign flip), a partial exit (2 of 3, so `entry_qty ≠ exit_qty`),
fees and swap on both legs, and a planned entry of 100 against an average fill of 101 — so the
R denominator uses the PLAN while the numerator uses the FILL.

The twin agrees with the view to eight decimals on all eleven values.

### Swept clean

- **RLS**: all 24 tables, `authenticated`, `FOR ALL`, `user_id = (SELECT auth.uid())` in both
  `USING` and `WITH CHECK`. No exceptions.
- **`SECURITY DEFINER` grants**: all five functions taking a `uuid` have `EXECUTE` revoked from
  everyone but `postgres` and `service_role`; every function in the schema sets
  `search_path = ''`. The one `authenticated`-callable definer is `tj_seed_my_defaults()`,
  which takes no argument and can only seed its caller.
- **Foreign keys**: zero without a covering index (round 2b's D3 has held).
- **CHECK constraints**: the phase-5 `COALESCE(array_length(…), 0)` guard is intact on
  `tj_tracker_rules.active_days`; `tj_user_prefs` handles a null length explicitly. Every
  `= ANY(ARRAY[…])` enum check sits on a `NOT NULL` column — all 13 verified — so the usual
  "NULL passes a CHECK" hole is closed by construction.
- **Column ↔ code, both directions**: every distinctive column has a reader outside the
  generated types, after the two removals above.
- **Advisors**: security unchanged at the two known WARNs. Performance reports 14 `unused_index`
  at INFO — every one is on a table with **zero rows**, which is what "never used" means on an
  empty database. Not actionable; re-check once there is history.

### Outcome

`FIXED` — C1 (critical), C2. `PINNED` — C3.
`REJECTED` — empty playbook rules (documented intent), `tj_column_mappings` /
`broker_preset` (named roadmap scaffolding), unused-index advisors (empty tables).
715 tests / 47 files, lint 1 warning, build green, `tsc` clean.

## Step 3 — the pure math layer

Twenty-two modules, weighted toward what landed after `f5270b2` and toward the branches
coverage marked dark. Three defects, all in the same module, all in the same family: **a
timestamp read wrongly and then trusted.**

`time.ts` was the right place to look. It had 46% branch coverage and 62% statements — the
lowest of any module that decides *which day* something belongs to — and the whole app joins
on the day keys it produces.

### T1 (High) — `parseImportTime` silently read a European date as American

The function ended in a bare `new Date(s)` fallback. `"02/03/2026 10:00"` came back as
`2026-02-03T10:00:00.000Z`, wrong in two independent ways at once:

- **Wrong month.** V8 reads slashed numerics as US month-first, so an export meaning 2 March
  became 3 February. Above day 12 the same string is `Invalid Date` and fails loudly — so the
  ambiguous half of the calendar failed *silently* while the unambiguous half failed *safely*.
  Exactly backwards.
- **Wrong zone.** The fallback never received `tz`. Every other branch routes wall-clock
  through `fromZonedTime`; this one took the system zone, which on a server is UTC. For a New
  York account that is five hours — enough to carry a close over midnight into the wrong day's
  P&L, the wrong calendar cell and the wrong week.

Now it refuses. An all-numeric date that does not start with the year returns `null`, because
nothing in the string says which number is the month. Month-name forms are still accepted and
are now re-applied through the account's zone rather than the server's.

**A second bug surfaced while fixing it, and it was already live:** the `hasOffset` test was
`/([zZ]|[+-]\d{2}:?\d{2})$/`, and `"02-03-2026"` ends in `-2026`, a syntactically valid ±HHMM
offset. That date took the absolute-instant branch. The check now requires a time before the
offset, which is what an offset means. Caught by the new test failing on input I had expected
the refusal to cover.

### T2 (High) — the import wizard invented a timestamp

`import-wizard.tsx:192`, the worst line in the import path:

```ts
executed_at: exitTime ?? entryTime ?? new Date().toISOString()
```

A row whose timestamps could not be read got stamped with **the moment of import**. A trade
from three months ago closed *today* — landing in today's P&L, today's calendar cell and
today's week, with nothing on screen saying the date was invented rather than read.

This had to be fixed in the same step as T1, not deferred to step 5: making `parseImportTime`
stricter sends *more* rows down this path, so fixing one without the other would have been net
harmful. The entry-time fallback is kept — a same-row entry timestamp is a real observation
about this trade, just a coarser one. `new Date()` is an observation about nothing.

### T3 (Medium) — one bad timezone string was a lock-out, not a wrong clock

`Intl` throws `RangeError: Invalid time zone specified` on a name it does not know, and
`formatInTimeZone` passes it straight up. `tj_accounts.timezone` is plain `text` with no
constraint. One bad value — a direct PostgREST write, a future code path — and every Server
Component that renders a date throws: a 500 on the dashboard, the journal, the calendar, and
**on Settings, which is the only place the value could be corrected.**

Every zone use in the module now goes through a memoized `safeTz` that falls back to the
default, and every instant-taking function returns a placeholder rather than throwing on
unparseable input. Degrading beats locking the user out of the fix.

The other half — refusing to *store* a bad zone — belongs to `updateAccount` and is listed as
open for step 6.

### Reviewed, no defect found

`analytics`, `balance`, `breakeven`, `costs`, `equity`, `entry-slippage`, `excursion`,
`excursion-scan`, `exit-efficiency`, `ftmo`, `hold-time`, `period-stats`, `plan-calculations`,
`position-stats`, `risk-metrics`, `risk-ratios`, `sickre-score`, `units`, `column-prefs`,
`trade-fields`, `field-values` — read for the failure modes this codebase is prone to: division
producing `Infinity` instead of `null`, `NaN` propagating, `null` treated as `0`, money dated by
open instead of close, `Date#getDay` instead of ISO weekday, browser zone instead of account
zone. None found.

`slugifyFieldKey` had **0% coverage and generates a database identifier from free text**, which
is a bad combination even when the code turns out to be right — and it is: every label tried,
including diacritics, symbols-only and 60 characters, satisfies
`CHECK (key ~ '^[a-z][a-z0-9_]{0,48}$')`. One thing recorded rather than fixed: `"!!!"`,
`"___"`, `"-"` and whitespace all slug to `"f"`, so a second such field collides on the unique
index. The right place to refuse that is `addFieldDef` — step 6.

### Tests added

| Module | Was | Now |
|---|--:|--:|
| `time.ts` statements | 62.2% | **93.4%** |
| `time.ts` branches | 46.3% | **84.0%** |
| `time.ts` functions | 75% | **100%** |
| `analytics.ts` statements | 61.1% | **78.9%** |
| `analytics.ts` functions | 44% | **76%** |
| whole suite | 88.4 / 82.1 / 87.3 | **91.4 / 85.0 / 90.3** |

New files: `time.test.ts` (19), `field-def-types.test.ts` (8). Extended:
`trade-lifecycle.test.ts` (+13, including a check that every status in the DB `CHECK` has a
label and a hint), `analytics.test.ts` (+5, the two weekly aggregators that had no coverage at
all and do timezone-dependent bucketing).

### Coverage left open, with reasons

- **`analytics.ts:250–314`** — `buildEquity` and `rHistogram`. Both are chart feeds whose
  output is read visually on the dashboard, and both are simple accumulators over data that
  `computeStats` already covers. Recorded, not tested.
- **`format.ts:51–52`** — `pnlClass` returning a Tailwind class string. A test would assert a
  colour name against itself.
- **`units.ts:132–134, 148–156`** — the `points`-unit branch of `formatMetric`. Unreachable
  from the app today: no caller constructs a `points`-unit metric, which is itself worth a
  note. Left for step 4, which owns the metric registry.

### Outcome

`FIXED` — T1, T2, T3.
`RECORDED, owner named` — bad-zone rejection in `updateAccount` (step 6), degenerate-label
rejection in `addFieldDef` (step 6), `points`-unit metric with no producer (step 4).
756 tests / 49 files, lint 1 warning, build green, `tsc` clean.

## Step 3b — coverage as a floor, not a target

Done at the owner's request after step 3, in answer to "can't coverage just be 100%
everywhere?". The short answer is that it can, on a quarter of the codebase, and would not
mean what it looks like it means. All three of the proposals from that exchange landed.

### What the number actually describes

Coverage only sees files a test imports: **46 of 177 source files.** Components (~16k lines),
routes and the server-only query layer produce no number at all — and "no number" is not
"0%", it is "not measured". So `93.9%` is 93.9% of roughly a quarter of the code, and reading
it as "the app is 93.9% tested" is the mistake worth guarding against.

Nor would 100% mean correct: coverage counts EXECUTION, not assertion. The clearest proof is
in this round — **C1, the critical seed defect, lives in SQL.** No TypeScript percentage would
ever have moved for it, at any target.

### 1. A floor in `vitest.config.ts`

Global thresholds set at what the suite achieves (93 / 88 / 91 / 95), plus a **100% statement
and function floor on thirteen named money modules** — the ones where a wrong number reaches
the screen as a fact. The floor's only job is to fail when a change lowers coverage; raising
it is deliberate, drifting down is not. The reasoning above is written into the config so the
next reader does not have to re-derive it.

The threshold earned its keep immediately: it failed on five modules that were *not* at 100%,
which is how the rest of this section came to exist.

### 2. The money modules taken to 100%

`analytics`, `balance`, `breakeven`, `costs`, `entry-slippage`, `excursion`, `excursion-scan`,
`exit-efficiency`, `hold-time`, `plan-calculations`, `position-stats`, `risk-metrics`,
`risk-ratios` — all at 100% statements and functions.

What was missing turned out not to be arithmetic but **guard clauses whose entire job is to
refuse to produce a number**: `plannedRiskPts` with no reference price, `computePositionSize`
with a zero stop distance, `computePlannedRewardR` on a short whose stop sits below the entry,
`toRealized` on a row with no stats, `dailyPnl` on a trade with no close, both weekly
aggregators on a reference the zone cannot resolve. Those are exactly the lines that decide
whether the app shows a blank or an invented figure, and none of them had a test.

Two branches are marked unreachable rather than contorted into coverage:

- `analytics.ts` — `runReport`'s null result. It answers null only for a dimension NAME it
  cannot resolve, and this call site passes a built `Dimension` object. Marked with a
  `v8 ignore` carrying that reason; the guard stays because the parameter type still permits a
  string.
- `risk-ratios.ts` — `spanDays > 0 ? … : null`, where `spanDays` is `daysBetween + 1` after a
  guard that already rejects a backwards window. Left uncovered, which is why the branch floor
  sits below the statement floor.

One assertion was corrected rather than the code: `fmtNum` sets `minimumFractionDigits: 0`
explicitly, so `12.5 pts` and `10 ticks` drop trailing zeros. Deliberate, not a slip — the test
now pins the real behaviour.

### 3. One trade, all the way through

`pipeline.integration.test.ts`. Every other test checks a module against its own contract,
which catches a module that is wrong and misses **two modules that are each right and
disagree** — which is where this codebase's defects have actually come from: the form and the
server with two fill predicates, the grid and the picker with two column lists, the SQL view
and its TypeScript twin drifting apart.

This walks one trade from the shape the form produces to the number a report prints —
`buildPositionPatch → computeStatus → computePositionStats → toRealized → enrichTrades →
runReport` — and asserts the same facts at every stage they are visible: the money, the R
against the PLANNED risk, the day in the ACCOUNT's zone, the outcome against the account's
breakeven band, the excursion in R, and finally the report row.

**It found something on the first run.** `buildPositionPatch` trims tag arrays but **not text
fields**. Harmless for a note — but `customFieldDimensions` registers every user-defined `text`
field as a groupable dimension, so a stray space splits `"A"` and `" A"` into two report
buckets that look identical on screen. Asserted as-is and recorded for step 6, which owns the
save path.

**Browser end-to-end is not built here, deliberately.** It would need Supabase credentials and
a running server, and this container has neither; a suite that cannot be executed is worse
than an honest gap. Playwright and Chromium are available for it to be added on a machine that
can run the app.

### Outcome

`FIXED` — thirteen money modules to 100% statements/functions; coverage floor added.
`RECORDED, owner named` — untrimmed text fields in `buildPositionPatch` (step 6).
`REJECTED` — 100% branch coverage as a goal, with the two unreachable guards named.

830 tests / 51 files (756 → 830). Coverage 93.3 → **93.9 / 89.05 / 91.59 / 95.22**, thresholds
enforced. Lint 1 warning, build green, `tsc` clean.

## Step 4 — the two registries

`reports/` and `insights/` share one contract: *adding an entry is one entry and nothing
else*. That only holds if every entry actually works, and one of the two registries had never
been executed by a test at all.

### R1 (High) — `metrics.ts` had no test file, and 25 of 26 `compute` callbacks never ran

353 lines. Every column of every report, every pivot cell and every "best performing" headline
reads through this file. Statement coverage 44.7%, **function coverage 39.0%** — the lowest in
the codebase — and no `metrics.test.ts` existed.

Now tested **as a registry**, which is a different shape from testing a function: the
properties every entry must hold, swept across all of them, and then the handful of values
worth pinning by hand.

- no duplicate keys; every metric has a label, a legal unit and a direction
- every default column resolves, so a fresh report cannot render blank
- **every metric computes without throwing** — over a normal group, a single trade, and an
  empty group. A report renders one column per metric, so one throw takes the page down rather
  than blanking a cell
- **no metric ever answers NaN**, on any group. NaN renders as "NaN", compares false against
  itself, and poisons any comparator that reaches it
- the arithmetic a reader would check by hand: net and gross sums, win rate on the account's
  band, profit factor, R totals, costs, drawdown inside the group, hold time in seconds,
  planned-vs-realized R over the *same* trades, MAE averaged only over trades that carry one
- `follow_rate` scoped and unscoped, the one metric whose answer depends on which bucket it
  is in

Result: **100% statements and 100% functions.**

### R2 (Medium) — `summarizeReport` could return an arbitrary best and worst

Found by the sweep above, and it is a genuine defect rather than a coverage artefact.

`profit_factor` answers `Infinity` for a bucket with no losing trade. That is **deliberate**
and documented — `engine.test.ts` pins it, and the rule it encodes is a real distinction:
`Infinity` means "best possible", `null` (as `target_attainment` uses) means "no denominator
exists at all", and the two must not rank the same way.

What the design did not consider is that `Infinity - Infinity` is `NaN`. The row sort in
`engine.ts` has always guarded equality first; **`summarizeReport`'s comparator did not**. With
two flawless buckets it returned NaN, which leaves a sort in an unspecified order — so `best`
and `worst` were both whatever the engine happened to produce, and the headline could disagree
with the table it was summarising.

Fixed by giving the summary the same equality guard the row sort has, with a deterministic
tie-break on the bucket name. Two tests pin it: that the tie resolves, and that the summary
agrees with the row order.

**A correction to my own first move.** I initially "fixed" this by collapsing the Infinity to
null in the metric, which broke `engine.test.ts` — a test that exists precisely to state that
Infinity is intended. That was me treating documented intent as a bug. Reverted; what stayed
is the corrected **hint**, which had claimed the cell would be "prazno kad nema nijednog
gubitka" while it in fact shows ∞. The behaviour was right and the documentation was wrong,
which is the opposite of what the failing test first suggested.

### R3 (Low) — `labelsByList` deleted

`DimensionContext.labelsByList` — declared, typed, documented as "option value → human label,
per option-list key", and **never written by anyone and never read by anyone**. A context field
that is always `undefined` invites a reader to build a feature around it. Removed.

### R4 — the dimension registry swept the same way

Nine `valueOf` callbacks had never executed. The same shape of test now covers all of them,
plus the custom-field dimensions: buckets a fully populated trade and a completely bare one
without throwing, always returns an **array of non-empty strings** (an `undefined` inside it
becomes the literal bucket label "undefined"), keeps a non-`multiValue` dimension to at most
one bucket so rows still sum to the portfolio total, declares no duplicate `order` entries,
and files every dimension under a group label the picker can show.

`dimensions.ts` 77.3% → 83.3% statements, 81.6% → 89.8% functions.
`playbook-dimensions.ts` 81.5% → 98.1%.

### Checked and found sound

**The insight registry needs nothing.** `registry.test.ts` already pins duplicate ids, the
implemented/omitted split, a stated reason on every omission, a description and a non-negative
sample floor on every rule, disjointness of TradeZella-derived and own rules, lookup by id, the
sample-floor skip, zero-sample rules on a single trade, severity ordering and grouping. 31
rules across four files, all reachable. Nothing to add.

The `points` unit is pinned as having **no producer**: it is a legal `MetricUnit` with a whole
branch in `formatMetric`, and no metric emits it. If one is ever added, the test fails and
sends the author to check that the report table passes an instrument context — without which
that branch silently renders as money.

### Outcome

`FIXED` — R1 (registry now fully exercised), R2 (`summarizeReport` comparator), R3
(`labelsByList` deleted), R4 (dimension sweep).
`REJECTED` — collapsing `profit_factor`'s Infinity to null; the design is deliberate and
tested. Its hint was corrected instead.

861 tests / 52 files (830 → 861). Coverage **95.43 / 89.44 / 96.70 / 96.74** (from
93.9 / 89.05 / 91.59 / 95.22); `metrics.ts` from 44.7 / 39.0 to **100 / 100**. Floor raised to
95 / 89 / 96 / 96. Lint 1 warning, build green, `tsc` clean.

---

## Step 5 — tracker, notebook, import

The three subsystems that carry the most state, and the one operation in the whole application
that **deletes** data. The step's own bar was set in the plan: *undo demonstrably gives back
exactly what it imported; the parser lets through no scheme outside the allowlist.*

### U1 (High) — undo truncated at 1000 rows and called it success

`src/app/(app)/import/actions.ts:233-244` (before), `undoImportBatch`

Both reads that the undo plan is built from were unbounded `.select()`s. PostgREST caps a
response at `db-max-rows` — 1000 — and returns the short page with **HTTP 200 and no error**.
A CSV past a thousand rows is an ordinary year of trading.

Two distinct failures, both silent, both permanent:

- a short `tj_positions` page leaves every position past the thousandth **undeleted**. They
  still carry the `import_batch_id` of a batch this function deletes four statements later.
  There is no foreign key on `tj_positions.import_batch_id` (verified against the live schema)
  — nothing cascades and nothing refuses — so those trades survive as rows no undo can ever
  reach again, polluting every stat forever.
- a short `tj_import_rows` page leaves those merges unrestored, and the delete further down
  removes **every** audit row for the batch, not just the thousand that were read. Those rows
  held `prev_executions`, the only copy of the fills the import displaced. Gone.

Either way the user reads `ok` and a restored count that understates what was actually left
behind.

`FIXED` — both reads go through `selectAllPages`, run in parallel, with the thrown page error
surfaced as `{ ok: false }` instead of a rejected promise.

### U2 (High) — the deletes put an unbounded id list in the URL

Same function, the three `.in()` deletes. `IN_FILTER_CHUNK` exists in `paginate.ts` precisely
because PostgREST takes the id list as a query parameter and a URL has a length limit. Once U1
was fixed, `plan.deleteIds` could genuinely hold thousands of uuids — roughly 37 bytes each —
and the delete would fail on URL length **after** the audit rows had already been removed.
Un-fixing U1 alone would have converted a silent partial undo into a loud broken one.

`FIXED` — all three deletes iterate `chunkIds(plan.deleteIds)`.

### U3 (Medium) — undo relabelled every fill it restored as hand-entered

`commitImport` snapshots the displaced fills with `select("side,price,qty,executed_at,fee,swap_funding,source")`
— provenance included. The restore then rebuilt each fill by listing six fields **by name**,
dropping `source`, and `tj_replace_executions` coalesces a missing one to `'manual'`
(confirmed from the live function definition).

So fills that an earlier import had put on a position came back as if the trader had typed
them. Nothing in the application reads `tj_executions.source` today, which is why it went
unnoticed — but "undo gives back what it displaced" is the step's stated bar, and it did not.

`FIXED` — `source` is carried through. A `SnapshotExec` type now names the shape actually
stored in `prev_executions` (the wizard's `ImportExec` plus provenance), instead of the two
being conflated.

**Proved on the live database**, in a transaction rolled back by a raised exception: a position
seeded with mixed-provenance fills at non-round prices, snapshotted the way `commitImport`
snapshots, overwritten the way an import overwrites, then replayed the way undo replays. The
`jsonb` before and after compared `IS NOT DISTINCT FROM` — identical, `source` included. A
leftover check afterwards confirmed the rollback took.

### U4 (Medium) — the import history undercounted restorable merges

`src/lib/journal/import-batches.ts` — the same unbounded-`.select()` class, over the last 20
batches at once. Not destructive: it drives the two numbers the history screen shows for
whether an undo can put your fills back. Wrong low, silently.

`FIXED` — both reads go through `selectAllByIds`, which chunks the `.in()` and drains each
chunk page by page.

### I1 (High) — the wizard read `2345,67` as `234567`

`src/components/journal/import-wizard.tsx` — `num()` was one line: strip everything that is not
a digit, a dot or a minus, then `Number()`. On a European locale — which is how MT5 exports and
every Serbian broker statement write a decimal — that is a **hundredfold error on a price**,
applied silently, with the wrong number then flowing into P&L, R, and every metric downstream.

The same class of defect as T1 in step 3, and it gets the same answer: parse what is
unambiguous, refuse what is not.

`FIXED` — extracted to `src/lib/journal/import-number.ts` as `parseImportNumber`, out of the
client component and under test. It reads `1.234,56` and `1,234.56` by taking whichever
separator comes **last** as the decimal point, reads a lone comma as a decimal point when its
tail is not three digits, reads repeated separators as grouping only when every group is
well-formed, and handles accounting parentheses, trailing minus, currency noise and NBSP
grouping.

It **refuses `1,234`** — 1234 to a US broker, 1.234 to a German one, with nothing in the cell
to decide it. Both readings are plausible prices, so a guess is wrong a thousandfold half the
time. A refused cell surfaces in the wizard preview; a guessed one never does.

### I2 (Medium) — a refused cell was invisible unless it was a price

A refused price already shows as `—` in the preview, because no execution row gets built. A
refused **qty** does not: it falls back to `0`, looks like a real zero, and
`tj_replace_executions` then drops a qty-0 fill outright — so the row imports as an empty
position with nothing on screen naming the cell that caused it. A refused fee or swap falls
back to `0` the same way, which is this project's cardinal sin: a null read as a zero.

`FIXED` — every refused cell is collected by name and shown on the row in the existing
warnings column (`nečitljivo: qty, fee`). Deliberately appended **after** the duplicate check,
so an unreadable cell never changes how a row is matched — it only makes sure the reader is
told.

### N1 (Medium) — the notebook had two markdown parsers

`plainText` was a second, independent implementation: five regexes over the **raw source**,
where `parseMarkdown` walks a tree. It feeds note search (`notebook-workbench.tsx:227`) and the
list preview (`:432`), and the search call site's own comment states the contract — *"search
the rendered text, not the source"*. A regex pass over the source is an approximation of the
rendered text, and the places it approximated badly are places where text the reader can see
could not be found:

- a code span was unwrapped and *then* stripped of `*` and `_`, so a note showing `` `a**b` ``
  was searchable only as `ab`;
- the line-start strip listed `#>-*+` and no digits, so every numbered list item kept its
  `1.` in the preview;
- a refused `javascript:` link was torn into `x` plus a stray bracket, while the note renders
  it literally.

`FIXED` — `plainText` now walks the same tree the renderer walks. Fenced code stays excluded;
that was a deliberate decision (`markdown.test.ts`: *"drops fenced code entirely — it is not
prose"*) and it is preserved rather than quietly reversed, now expressed as one `case` in
`blockText` instead of a regex.

`deriveTitle` was the same duplication in miniature and carried a live bug: its block-mark
strip `^[>\-*+]\s*` has no `\s+` after the bullet, so a note opening with `**Nedelja 31**` was
titled `Nedelja 31*` — one asterisk eaten by a rule meant for bullet lists. It now strips block
marks with the **same regexes the block parser uses** and runs the rest through `parseInline`.
It stays line-based on purpose: a paragraph joins its lines, and a title of three joined
sentences cut at 80 characters is worse at finding the note than its first line.

### N2 — the parser itself: attacked, and it holds

`markdown.ts` is the one file here where a bug is a security bug. The design closes injection by
construction — it returns a tree, `markdown-view.tsx` walks it into React elements, there is no
`dangerouslySetInnerHTML` anywhere and no image node, so the only sink left is a link `href`.

`markdown-security.test.ts` (new) is the evasion battery a **blocklist** would have had to
anticipate and an allowlist does not: `javascript:` with leading whitespace, mixed case and full
upper case, `vbscript:`, `data:text/html;base64`, `blob:`, `filesystem:`, `jar:`,
`view-source:`, `chrome://`, `about:blank`, `ws://`, and percent- and entity-encoded forms —
which must stay refused precisely *because* the parser does not decode them. Plus the two
deliberate allowances pinned as decisions on record: protocol-relative `//host` (navigates,
does not execute, and gets neither `target` nor `rel`, so it cannot reverse-tabnab) and bare
relative paths.

And DoS, since injection is closed: 20 000 unmatched markers of each kind, 5 000 complete
tokens on one line, a large document, and bounded recursion. Every alternative in `INLINE_RE`
needs at least two characters, so a match always shortens the input and there is no zero-width
match to spin on; `**` cannot nest because its inner class excludes `*`.

Nothing got through. `REVIEWED — clean`, and now pinned.

### K1 (Medium) — a retired rule's dead limit governed today

`configsFromRules` keys by `auto_key` and lets the last rule win. The unique index on
`auto_key` is **partial** — `WHERE auto_key IS NOT NULL AND deleted_at IS NULL`, verified on
the live schema — so a retired rule and its replacement legally coexist under one key. All
three call sites (`dashboard.tsx`, `daily/page.tsx`, `lockDay`) passed the full rule set,
retired included, and built the configs **once for the whole span**.

Rules come back ordered by `sort_order`, which the user reorders by dragging. A retired "max
loss 400" sitting at ordinal 9 therefore overrode its live replacement at ordinal 1, and every
day the evaluator scored — today included — was judged against a limit that no longer existed.

`FIXED` — new `rulesLiveOn(rules, day)` in `compliance.ts`, and the configs are resolved **per
day** at all three sites. Not merely "prefer the live rule": a day in May stays scored against
the limit that was in force in May, which is the same principle the module's header already
states for whether a rule counts at all.

### K2 (Medium) — the lock ran two different retirement filters

`lockDay` filtered with `ruleIsLiveOn(rule, day)`; `freezeAutoCheckins` then dropped anything
with a `deleted_at` **at all**. Those agree on today and disagree on the past.

Retire a rule, then lock an older day it was live on — allowed, the only bar is that the day is
not in the future. `ruleAppliesOn` counts the rule on that day (it was live), `freezeAutoCheckins`
skips it, so it sits in the denominator with no frozen verdict and **re-derives itself every
time a trade from that day is corrected** — which is the exact thing the lock exists to prevent,
on the exact rule the user just decided to retire.

`FIXED` — `freezeAutoCheckins` takes the day and answers the question itself with
`ruleIsLiveOn`. One filter, in one place; `lockDay` no longer pre-filters. Four cases pinned:
retired-before (skipped), retired-after (frozen — the regression), wrong weekday, created-later.

### Reviewed, no defect found

**`auto-rules.ts`.** The day-attribution split is right and argued in place: money on the CLOSE
day, decisions on the OPEN day, with the counter-case written down (on close-day attribution a
still-open trade is invisible, so ten unlinked open trades would report a perfect day). The two
loss rules diverge on unpriced trades **deliberately** and correctly — the daily rule refuses to
answer because an unknown trade could be a winner that brings the sum back over the limit, the
per-trade rule does not because a priced breach is a breach regardless. A no-trade day is `na`
and never `pass`, which is what stops a 200-day streak being farmed by not trading.

**`resolveAutoResults` and the shared-`auto_key` collision.** It overlays by `auto_key` while
looking up by `rule.id`, so two rules sharing a key could in principle overwrite each other.
They cannot: frozen rows only exist for days a rule was live on, the partial unique index
forbids two live rules under one key, and a replacement's `created_at` is therefore after its
predecessor's `deleted_at` — the two rules' live spans are disjoint. Checked because it looks
dangerous; it is not.

**`compliance.ts` streak semantics.** `skipped` and `pending` neither break nor extend.
Breaking on a deliberately excluded Saturday would cap every weekday trader at 5; extending on
it would let the streak be inflated by narrowing `active_days` to Mondays.

**`tracker/queries.ts` and `notes/queries.ts`.** Every read that grows with history already
goes through `selectAllPages` — check-ins, locked days, notes. The three that do not
(`getTrackerRules`, `getNoteFolders`, `getNoteTags`) are hand-managed vocabularies of tens of
rows; a user would have to create a thousand rules by hand to reach the cap. Left as they are,
recorded here rather than left unexamined.

**`instrument-aliases.ts`, `cost-defaults.ts`.** Sound and already tested. `nightsBetween`
counts calendar rollovers rather than elapsed 24-hour blocks, which is how swap is actually
charged; `round2` normalizes `-0`.

### Checked and deliberately NOT changed

**`lockDay` calls `getTradesWithStats()` — the whole book — to evaluate one day.** Paged, so
correct; wasteful, so noted. Locking a day is a deliberate once-a-day action and the query is
the same one the journal page already runs. Out of scope under "no large refactors"; recorded
so the next reader does not have to rediscover it.

**`undoImportBatch` restores one position per round trip.** A thousand merges is a thousand
RPCs. Correct and atomic per position; a bulk RPC would be a new database function, which is a
larger change than this step is scoped for.

**`tj_executions.source` is written and never read.** A candidate for the dead-column sweep of
step 2, kept on purpose: it is provenance on a fills table, it is what U3's fix restores, and
dropping it would re-open exactly the fidelity hole just closed.

### Outcome

`FIXED` — U1, U2, U3, U4 (import undo and history), I1, I2 (wizard number parsing), N1
(one markdown parser, plus the `deriveTitle` asterisk bug), K1, K2 (tracker rule lifetime).
`REVIEWED — clean` — the markdown security model, `auto-rules` day attribution, the
shared-`auto_key` collision, streak semantics, the notes and tracker query layer.

895 tests / 54 files (861 → 895). New: `import-number.test.ts` (15),
`markdown-security.test.ts`, and the tracker and markdown cases above. Coverage
**95.47 / 89.75 / 96.74 / 96.82**. Lint 1 warning (the known one), build green, `tsc` clean.

### S1 (High, reported from the running app) — the score rewarded an empty account

Reported against a live account with **zero trades entered**: the card read 33/100 with
**Max drawdown: 100**, 52 % of weights covered.

The arithmetic was exactly right and the answer was exactly wrong.
`(100×20 + 0×15 + 0×10 + 0×15) / 60 = 33.33`, and `60/115 = 52 %` — both numbers on the
screenshot, both reproduced in a test before touching anything.

`computeSickreScore` already had the mechanism for this: a component whose input is null is
dropped and the remaining weights renormalized. `profitFactor`, `avgWinLossRatio` and
`recoveryFactor` all answer null on an empty book, and all three correctly showed `—`. The
other three cannot:

| input | empty book | why it is not null |
|---|---|---|
| `maxPctOfPeakPnl` | `0` | `EMPTY_DRAWDOWN` — a book with no trades has drawn down no money |
| `winRate` | `0` | `analytics.ts:195` — `wins + losses > 0 ? … : 0` |
| `consistencyScore().score` | `0` | `risk-metrics.ts:66` — count 0 returns score 0, though `mean`, `stdev` and `raw` are null |

Each of those zeros is the honest value of its **statistic**. The defect is that the score read
them as **measurements**: `100 − 0 = 100` turned "has never traded" into "flawless risk
management", worth a fifth of the composite and the only thing holding the number above zero.
Zero evidence is not zero performance — this project's cardinal sin, in the one place that
aggregates every other number.

The card's own header comment had promised the correct behaviour all along — *"Components that
could not be computed are shown as dropped, not as zero — a book with no drawdown yet should
not be scored as if it had a terrible one."* Only the input path never delivered a null for it
to act on.

`FIXED` — `ScoreInputs` takes a required `sample: { trades, decided }`, and the three
components are gated on it before scoring, so their `value` reads `—` too rather than a
misleading 0 or 100. Required rather than optional on purpose: a new call site must answer the
question instead of inheriting a default that reintroduces the bug.

Two denominators, not one, because the two statistics have two: `trades` gates drawdown and
consistency, `decided` (wins + losses, breakeven excluded) gates win % — which is win rate's
own denominator. A book of nothing but breakeven scratches has trades to be consistent about
and no decisions to have won.

The empty account now scores what it can actually defend: process adherence alone, at 15 of 115
weights. With **no** process data either, coverage is 0 and the card says so in words instead
of showing seven dashes that look like a failure.

Pinned by five tests, including a reproduction of the reported 33.33 / 52 % — the same values
with a non-empty sample still produce it, so the counts are demonstrably the only thing that
changed, and a genuine zero drawdown over 8 real trades still scores 100.

### S2 (High) — the same bug one trade later: n=1 scored 100/100

Closing "no evidence" left "almost no evidence" wide open. Measured immediately after S1, on a
single winning trade:

```
SCORE: 100 / 100        coverage: 70 / 100
  profitFactor    100  counted   ← no loss to divide by → Infinity → top band
  avgWinLoss      null dropped
  maxDrawdown     100  counted   ← nothing to fall from
  winPct          100  counted   ← 1 of 1
  recovery        null dropped
  consistency     100  counted   ← stdev of one sample is 0
```

Four components at their maximum, every one an artifact of n=1 rather than a measurement.

This was an inconsistency inside the codebase, not a matter of taste. Every other module here
carries a sample floor and argues for it in place — `DEFAULT_MIN_SAMPLE = 5` in the report
engine (*"a category with three trades and a 100 % win rate is not a finding"*),
`MIN_RATIO_DAYS = 5` in `risk-ratios`, a floor on all 31 insight rules, `belowSample` carried
on every report row. The score aggregates all of them and demanded nothing.

`FIXED` — two tiers, because the two failure modes differ:

- **Below `MIN_SAMPLE` (5) the number is noise, so there is no number.** Every trade-derived
  component is gated, each on **its own denominator**: `trades` for the path-dependent
  statistics (drawdown walks the sequence, consistency is its dispersion), `decided` for the
  ones built from wins against losses. A book of nothing but breakeven scratches has a path to
  measure and no decisions to have won; one count would answer one of them wrongly.
- **Below `RELIABLE_SAMPLE` (30) the number is real but unstable, so it is shown WITH its
  sample.** A win rate over five decided trades carries a confidence interval about forty
  points wide. Withholding until it narrows would leave a new account staring at a blank card
  for weeks — dishonest in the other direction. The report engine settled this argument for
  rows long ago (*sample size is carried on every row and never hidden*); the score now answers
  it the same way, with an `n` badge beside the number and a line saying it will move.

`MIN_SAMPLE` is deliberately the same 5 the rest of the codebase uses, pinned by a test so
lowering it fails loudly.

Plus a third gate that S1 exposed and could not close: **`MIN_COVERAGE_SHARE = 0.5`.** With no
trades but a tracker history, exactly one of seven components had data, and the card put the
words "Sickre Score" above a single metric at 15 of 115 weights. That is not a composite. It is
reported as a distinct `withheld` reason from the sample case, because the trader cannot fix it
by trading more — there is nothing to count down.

`confidence` rides on the result rather than being re-derived by the card from a trade count it
would have to fetch separately. The tier describes the evidence and never the arithmetic: the
same inputs at 29 and at 30 trades produce the identical score, pinned by a test, because a
number that moved with its own confidence label would be two scores sharing a name.

907 tests / 54 files.

---

## Step 8b — the book, computed by hand

Prompted by a question the review could not honestly answer: *are the numbers I actually read
correct?*

The honest answer was no — not established. Every test in this suite checked a function against
its own contract, which catches a wrong formula and misses a right formula fed the wrong thing.
That gap is not theoretical: `sickre-score.ts` stood at 96 % statements and **100 % functions**
with thirteen green tests while it displayed 33/100 on an empty account, and `balance.ts` stands
at **100 % statements, 100 % functions** and shipped S3 below.

So `book.fixture.test.ts` inverts the question. One book of ten trades, every headline figure
derived on paper in the comments — arithmetic visible — and the code asserted against the paper.
A snapshot test pins current behaviour including its bugs; this pins the answer.

The book is built so the aggregates land where an off-by-one would show: profit factor comes to
exactly **2.2** and recovery factor to exactly **3.0**, both of which are band floors in the
score's own tables.

| derived on paper | value |
|---|---|
| net P&L | 600 |
| wins / losses / breakeven | 5 / 4 / 1 |
| win rate | 5 ÷ 9 = 55.56 % — breakeven out of the denominator |
| profit factor | 1100 ÷ 500 = 2.2 |
| avg win / avg loss (money) | 220 / −125 → ratio 1.76 |
| max drawdown | −200, from a running peak of 500 → 40 % |
| recovery factor | 600 ÷ 200 = 3.0 |
| consistency | σ = √35 400 ≈ 188.15; 100 − 188.15/600 × 100 ≈ 68.64 |
| **Sickre Score** | (80×25 + 20×20 + 60×20 + 92.59×15 + 70×10 + 68.64×10) ÷ 100 = **63.75** |

Also pinned: a trade opened Monday and closed Tuesday files its **money on the close day** and
its **decision on the open day**; every day key resolves in New York rather than UTC; and the
book straddles the 8 March 2026 DST change without a trade moving.

### S3 (High) — six straight losses scored 100 for risk management

Found by the second half of the file, which sweeps the SHAPES a book can take rather than its
values — empty, one trade, all winners, all losers, all breakeven, open-only. The empty-account
defect was one member of that family; nobody had looked at the other five.

`maxPctOfPeakPnl` divides the fall by the peak cumulative P&L that preceded it. A book that
never rose above zero has no such peak, and the guard read:

```ts
maxPctOfPeakPnl = w.peakPnl > 0 ? (Math.abs(w.dropMoney) / w.peakPnl) * 100 : 0;
```

That `0` is the same null-as-zero conflation as S1, in the same statistic, one layer further
down — and it is the worst of the three, because it needs **neither an empty account nor a thin
one**. A trader whose first six trades all lost was told, by the only composite number in the
application, that their risk management was flawless. `100 − 0 = 100`, weight 20, on a book down
700.

`FIXED` — `maxPctOfPeakPnl` is `number | null`. The two meanings are now separable: `0` is
*never fell*, `null` is *fell, with no peak profit to express it against*. The initial value
stays `0`, so a book that genuinely rises the whole way still earns its 100 — pinned by its own
test, because trading one lie for the opposite one would be no improvement. The score's existing
drop-and-renormalize handles the null, and the only consumer is the score.

`maxPctOfEquity` carries the identical `peakEquity > 0 ? … : 0` guard and is left alone: it is
display-only, and reaching it requires peak equity at or below zero across the entire window,
which cannot happen with a positive starting balance. Recorded rather than changed.

### What this says about the coverage numbers

`balance.ts` is on the `MONEY_MODULES` list with a 100 % statement and function floor. It was at
100 / 100 with S3 live. `balance.test.ts` did assert `maxPctOfPeakPnl` — at line 118, for the
profitable case, expecting 50. The losing arm was **executed and never asserted**, and branch
coverage sat at 81.6 %.

This is the config's own warning arriving in practice: *coverage counts EXECUTION, not
assertion.* The three defects S1, S2 and S3 were all in fully covered files. The branch number
is the one that would have hinted, and even that only hints — what actually found all three was
asking what the number MEANS on a book shaped differently from the fixtures.

### Outcome

`FIXED` — S3. `ADDED` — `book.fixture.test.ts`: 26 tests, one hand-derived book plus a
six-shape sweep.

933 tests / 55 files (907 → 933). Coverage **95.56 / 89.92 / 96.74 / 96.84**. Lint 1 warning,
build green, `tsc` clean.

**Still not established**, and stated plainly so the README cannot overclaim it: this proves the
`lib/` pipeline from realized trades to the score. It does not touch the 16 250 lines of
components or the 25 routes, which have no tests at all and are where S1 actually lived. Steps
6–8 read that code; they do not execute it.

---

## Step 6 — the server layer

Every `"use server"` action (10 files, 63 actions) and every `server-only` query module (17
files). This step also carried three findings owed from earlier steps.

### Mechanical invariants — all clean

- **`"use server"` files export only async functions.** Swept; nothing else is exported.
  A non-async export from one of these files is a build-time footgun and there are none.
- **Every `update` and `delete` is filtered by `id`**, under RLS policies that are uniformly the
  owner pattern. There is no unqualified mutation anywhere in the codebase.
- **Pagination**: every read that grows with history already drains through `selectAllPages`
  or `selectAllByIds`. The unpaginated reads left are `getAccounts`, `getFieldDefs`,
  `getOptionLists` / `getOptionItems`, `getTrackerRules`, `getNoteFolders` and `getNoteTags` —
  hand-managed vocabularies bounded by what a person types into Settings, tens of rows each. A
  user would have to define a thousand custom fields by hand to reach the cap. Recorded rather
  than left unexamined; the same decision as step 5 and now consistent across both.

### V1 (Medium) — `reorderOptions` reported success it never checked

`settings/actions.ts` — it dispatched one update per option with `await Promise.all(...)`,
**discarded the array**, and returned `{ ok: true }` unconditionally. A reorder that half
applied reported success, the list snapped back on the next load, and nothing said why.

The tell is that the same operation exists three times in this codebase and the other two —
`moveFieldDef` in the same file, and the tracker's — both inspect every error and return
`{ ok: false }`. This was the odd one out.

`FIXED` — results are inspected, still dispatched in parallel (the ordinals are independent and
one round trip per option would make a long list crawl).

### V2 (Medium) — undo swallowed the write its own sibling throws on

`import/actions.ts`. In `undoImportBatch`, after the displaced fills are put back, the position's
status is recomputed and written — and the error was dropped on the floor.

Three hundred lines up, `commitImport` performs the *identical* statement and throws, under a
comment explaining exactly why: *"the fills have already been replaced by the line above, so a
swallowed failure here leaves the position carrying new fills under its old status — closed
fills on a row still reading `open`, which every stat then reads as an unfinished trade."*

Every word of that applies to the undo path. One of the two paths acted on it.

`FIXED` — the error is returned. Both halves of the import/undo pair now behave the same way on
the same statement.

### V3 (High) — a point value of zero silently made every trade worth nothing

`tj_instruments` carried **no CHECK constraints at all**, and neither `addInstrument` nor
`updateInstrument` validated anything but the symbol.

`point_value` is the multiplier in `computePositionStats`:

```ts
grossPl = grossPoints * pointValue;
netPl   = grossPl - totalFees - totalSwap;
```

Set it to 0 — one cleared number input away — and every trade on that instrument is worth
exactly nothing: gross 0, net minus the fees. Set it negative and every P&L on it inverts.
Neither raises anything; the journal renders wrong money as fact.

And it is worse than a live-lookup bug, because `instrumentSnapshot` **freezes** the value onto
each position as `point_value_at_trade` at creation — deliberately, so later edits cannot
rewrite finished history. A bad point value is therefore copied into every trade booked while it
stood, and correcting the instrument afterwards does **not** correct those trades.

`FIXED`, in both places that matter:

- migration `20260802140000_instrument_positive_contract_specs` — CHECK constraints on
  `point_value`, `tick_size` and `tick_value`. This is the guard that holds: PostgREST with the
  user's JWT is a live write path, so a check living only in TypeScript is a lock you walk
  around.
- `addInstrument` / `updateInstrument` — the same rule in Serbian, so the user reads a sentence
  instead of a constraint name.

Verified against the live table before applying (10 rows, none violating) and proved afterwards
in a rolled-back transaction: `point_value` 0, `point_value` −5 and `tick_size` 0 all refused,
3 of 3. `tick_size` and `tick_value` keep their null arm — null means "not specified", which
`units.ts` already tests for with `(tick_size ?? 0) > 0` before dividing. `point_value` is
NOT NULL already, so its null arm is unreachable and kept only so the three read identically.

### The three findings carried in from earlier steps

**(a) `updateAccount` accepted any timezone string.** `FIXED`, and `addAccount` with it — the
note only named one of the two doors. The account's zone decides which calendar DAY every trade,
compliance verdict and daily total belongs to. The read path uses `safeTz`, which degrades an
unknown zone to the default rather than throwing — correct for rendering, and it makes a typo
invisible: save `Europe/Belgrad` and the whole journal quietly re-dates itself to New York with
nothing on screen that looks wrong. `isValidTimeZone` is now exported from `time.ts` so a WRITE
can refuse what the read path papers over, with a test pinning that the memo cache cannot start
answering `true` for a bad zone on the second call.

**(b) `addFieldDef` and a label that slugs to nothing.** `FIXED`, at **lower severity than the
note claimed** — checking the code first was worth it. The collision the note worried about is
already handled: the insert returns `23505` and the action turns that into "Polje sa tim ključem
već postoji." What was actually wrong is narrower — `!!!`, `___` and `---` are three visibly
different labels that all slug to the same bare `f`, so the second one gets a
key-already-exists message next to a label the user can see is new. Now refused at the source,
where the reason can be stated: a label needs at least one letter or digit.

**(c) `buildPositionPatch` did not trim text.** `FIXED`. The array branch had always trimmed its
members; the scalar branch did not, so the same value behaved differently depending on the
field's type. `dimensions.ts` groups on the stored value, so `"XAUUSD"` and `"XAUUSD "` are two
instruments — each holding half the trades, each below the sample threshold, with nothing on
screen to say they are the same symbol. A trailing space is invisible in an input box and
survives every paste from a broker statement. Whitespace-only now collapses to null for the same
reason: `"   "` is not a value anyone chose, and stored as-is it becomes its own report bucket
labelled with nothing at all.

The assertion in `pipeline.integration.test.ts` that RECORDED this behaviour — with a note saying
the fix belonged in step 6 — flipped with the fix, which is the deferral closing itself.

### Checked and deliberately NOT changed

**A zero-row `update` returns no error from PostgREST**, so an action can answer `{ ok: true }`
for a write that hit nothing. The lifecycle family already handles this properly and is the
model: `markTradeMissed`, `restoreTradeToPlanned` and `activateTrade` all carry their predicate
into the statement and add `.select("id")`, so zero rows means "Trade changed — refresh the
page" rather than false success. `updateTrade` covers it with its `if (!prevPos)` read guard.
The remainder are Settings CRUD on a row the user is looking at, where zero rows can only mean
it was deleted in another tab. Recorded rather than mass-edited into twenty call sites.

**`rememberTags` discards its upsert error.** Genuinely best-effort: a tag that fails to be
remembered just will not autocomplete next time, and the note itself has already saved.

**zod covers 4 of 10 action files.** M1 from round 2 was specifically about URL parameters and
was closed in step 1 by extracting `reports/url-params.ts`; the broader "zod everywhere"
ambition is not what that finding said, and retrofitting schemas onto 63 actions is a refactor
the owner ruled out. What matters is whether an unvalidated value can write a wrong number, and
that was answered by asking the database what it already refuses: breakeven ordering, non-negative
starting balance, cash-event sign against type, `qty > 0`, and the enum CHECKs on side, source,
status and conviction are all enforced in Postgres. `tj_instruments` was the one table with
nothing — V3 above.

### Outcome

`FIXED` — V1, V2, V3, plus carried findings (a), (b) and (c).
`REVIEWED — clean` — `"use server"` export discipline, mutation filtering, pagination coverage,
the lifecycle actions' stale-predicate handling.

941 tests / 55 files (933 → 941). Coverage **95.54 / 89.89 / 96.75 / 96.80**. Migrations 42.
`get_advisors` — the same 2 known WARNs as the baseline, none new. Lint 1 warning, build green,
`tsc` clean.

---

## Step 7 — routes and pages

Twelve routes plus two layouts. The step's own bar: *every page fetches in parallel, and no date
is resolved in the browser's timezone.*

The first half was already true. The second was not, in the one component that decides every
number on the home page.

### P1 (High) — the browser's clock decided which trades counted

`dashboard.tsx`, `cutoffMs`:

```ts
const d = new Date();
d.setDate(d.getDate() - Number(period));
return d.getTime();
```

That value filters `realizedAll` and feeds `resolvePeriodWindow`, so it decides which trades are
inside "last 90 days" for **net P&L, win rate, profit factor, drawdown, the equity curve and the
Sickre Score**. Two things were wrong with it:

1. **It read the BROWSER's clock.** Trading a New York account from Belgrade, the browser has
   already rolled into tomorrow while the account has not — so the money window and the tracker
   window covered different days.
2. **It kept the current time of day**, which makes the window slide continuously. A trade
   closed at 10:00 ninety days ago was inside the period at 09:00 and outside it at 11:00. The
   same page, the same data, two different net P&Ls depending on when it was opened. This half
   has nothing to do with timezones and is the one a user would actually notice.

The component argues against exactly this eighty lines further up, where the `todayKey` prop is
documented: *"Not `new Date()` here: every tracker day key is an account-timezone day, and a
browser in another zone would anchor the calendar one column off."* The rule was written down,
and then the money window did the opposite of it.

Worse, `processAdherencePct` — the seventh component of the same score — has always computed its
window as `addDaysToDayKey(todayKey, -(period - 1))`, an account-zone day boundary. So **the two
halves of the Sickre Score were measuring windows a day apart**, by two different definitions of
"last 90 days", in one component.

`FIXED` — the cutoff is now the instant the window's first day begins in the account's zone,
using the same `-(period - 1)` the tracker half uses. New `dayKeyStartUtc(day, tz)` in `time.ts`
names the concept ("the instant a day key begins in a zone", the inverse of `zonedDateKey`) and
returns null rather than NaN for an unreadable key — NaN would compare false against every
timestamp and silently empty the window, showing an account with trades as having none.

A `timezone` prop now rides next to `todayKey`, passed from the same account on the same server
render, so the two cannot disagree; deriving it inside the component from `accounts` would have
been a second answer to one question.

### P2 (Low) — the Year picker could omit the year you are in

Same file: `yearOptions` used `new Date().getUTCFullYear()`. On 31 December in Tokyo, UTC is
still in the old year and the picker would not offer the year the trader is actually trading in;
on 1 January in New York, the reverse. One day a year, in both directions.

`FIXED` — taken from `todayKey`, which is already the account's day.

### P3 (Low) — three routes validated URL dates with a shape regex

`/daily?date=`, `/calendar?month=` and `/tracker?date=` each tested `/^\d{4}-\d{2}-\d{2}$/` and
treated a match as a date. It is a shape check, not a calendar check. `2026-00-00` passes it and
then rolls silently backwards: `addDaysToDayKey("2026-00-00", 1)` is `2025-12-01`, and
`monthGridDays("2026-00")` returns December 2025's grid — so `/calendar?month=2026-00` rendered
one month's data under another month's heading, and `/daily?date=2026-00-00` opened a day that
does not exist. Nothing threw, which is what made it worth catching. Same class as M1 from round
2 (`?min=abc` silently disabling the sample guard), in three routes M1 did not cover.

`FIXED` — `isValidDayKey` / `isValidMonthKey` in `time.ts`, built on `dayKeyStartUtc` because
that conversion is already strict where a regex cannot be. Verified by probe before writing the
validator: it refuses 30 February, 29 February in a non-leap year, 31 April, month 13 and day 00,
while accepting 29 February 2028.

### Reviewed, no defect found

**Parallel fetching.** Every page issues its reads in one `Promise.all`. The two exceptions are
both deliberate and both already carry their reasoning: `/` awaits `getPositionRules()` before
the batch because putting it inside meant draining the fastest-growing table in the schema twice
per render (M7, round 2), and `/daily` has a second batch because it genuinely depends on
`reportDate`, which depends on the account's timezone, which comes from the first. No N+1
anywhere — no `await` inside a `map`, `forEach` or loop in any route.

**`useSearchParams` and Suspense.** Two files use it, and `reports/page.tsx` wraps its consumer
in a `Suspense` boundary with a comment saying why. The other is the workbench inside that
boundary.

**Prop consistency.** `Dashboard` declares eight optional props with `= []` defaults — the kind
that hides a page forgetting to pass one. It has exactly one caller and that caller passes all
of them. Checked because a silent empty default in this component would blank the tracker or the
playbook half of the score with no error.

### Outcome

`FIXED` — P1, P2, P3.
`REVIEWED — clean` — parallel fetching, absence of N+1, Suspense boundaries, prop completeness.

951 tests / 55 files (941 → 951). Coverage **95.55 / 89.92 / 96.76 / 96.81**. Lint 1 warning,
build green with the same 12 routes, `tsc` clean.

---

## Step 8 — components, dead UI and dependencies

The step's bar: *`knip` reports zero unused files, exports and dependencies, or each survivor has
a recorded reason; `package.json` has no dependency without a consumer.*

### Deleted outright

**Seven `ui/` components**, imported from nowhere: `calendar`, `filter-select`, `form`,
`input-group`, `scroll-area`, `separator`, `tooltip`. Verified by import count before removal,
not on knip's word alone.

**Four dependencies**, which those files were the last consumers of: `@base-ui/react`,
`@hookform/resolvers`, `react-day-picker`, `react-hook-form`. The form library pair is the
telling one — this app builds its forms from field definitions, so `react-hook-form` was never
going to be used; it arrived with a scaffold and stayed.

**Five dead functions.** `getNotesForPosition`, `getLockedDays`, `renameList`, `deleteList`,
`fmtScoreValue` — zero references each. Two deserve a note rather than a silent delete:

- `getNotesForPosition` was a server-side query for notes on one trade. The notebook already
  does that filtering client-side over `getNotes()`, so this was a *second path to the same
  answer* rather than a missing feature — the duplication class this review keeps finding.
- `renameList` / `deleteList` were server actions, i.e. HTTP endpoints, with no caller and no
  button anywhere that should have called them (checked). A dead endpoint is live attack
  surface for a feature that does not exist.

### D1 (Low) — a compatibility shim for a problem nobody had

`insights/context.ts` re-exported `percentile` and `median` under the comment *"Re-exported so
existing importers keep working"*. There were no existing importers: every caller takes them
from `enriched-trade.ts` directly. Deleted; the type re-exports beside it are used and stayed.

### D2 (Low) — a second source of truth for four labels

`AUTO_RULE_LABELS` mapped the four auto-rule keys to Serbian text and was read by nothing. The
text the checklist actually shows comes from `tj_tracker_rules.text`, seeded in the database.
Two places holding the same label is two places that drift, and this one had already stopped
being the real one. Deleted.

### D3 — `AUTO_RULE_KEYS` had no consumer, and its promise was unenforced

Unexporting it turned up something better. Its own header states a contract — *"The set is
closed and mirrors the DB CHECK. Adding one means writing an evaluator, so a key with no
evaluator must never be storable"* — and nothing checked either half. `auto_key` is never chosen
in the UI, only seeded, so the constant genuinely had **no runtime consumer at all**: it existed
to derive its own union type.

`FIXED` by making the promise executable rather than hiding the constant: three tests assert that
`evaluateAutoRulesForDay` answers for exactly these four keys and no others, that each verdict
carries the key it answers for (the result is indexed by key downstream, so a mislabelled verdict
would answer for the wrong rule), and that the two money rules are exactly the ones that ask for
a limit.

### D4 (Medium) — the step-6 fix was invisible to the user

`reorderOptions` was changed in step 6 to report a partial write instead of always answering
`{ ok: true }`. Its only caller, `list-manager.tsx`, threw the result away — so the fix changed
nothing anyone could see: the list still snapped back on refresh with no message, which reads as
the drag simply not working. `notebook-workbench.tsx` did the same with `moveFolder`, twice.

`FIXED` — all three read the result and surface the error. Recorded as a finding against my own
previous step, because a server-side fix whose caller discards it is not a fix.

### Constants: pinned rather than hidden

Sixteen module-internal constants lost their `export` — they had no reader outside their own
file. Four did not, deliberately:

`WIN_PCT_TOP_THRESHOLD`, `MIN_COVERAGE_SHARE`, `PROCESS_ADHERENCE_WEIGHT` and
`CONSISTENCY_SCALE` **are the score**. Nothing else reads them, so they were exported-but-unused
— and changing any one of them silently moves every score the user has ever seen with no test
going red. They are now asserted by value. Pinning is the more useful of the two options: a
deliberate recalibration has to edit the test too, which is exactly the moment to think about
whether past numbers stay comparable.

### The 26 that remain, and why

Every one is a shadcn re-export in `src/components/ui/` — `CardFooter`, `DialogClose`,
`SelectGroup`, the dropdown sub-menu family, and so on. **Own code is at zero.**

Kept, for a reason that is about the next change rather than this one: these files are vendored
from an upstream generator. Trimming their export surface makes every future `shadcn add` a
manual merge, and the components are wanted — a `SelectGroup` will be needed the first time a
dropdown gets categories. The alternative was excluding `src/components/ui/**` from knip's
project, which was tried and **reverted**: it stopped knip seeing those files as consumers and
falsely reported `radix-ui`, `cmdk`, `class-variance-authority`, `next-themes` and `tailwindcss`
as unused. A configuration that produces five false positives to silence 26 true ones is worse
than the 26.

`ignoreExportsUsedInFile: true` was added instead, which is not a suppression: it stops knip
reporting an export that its own file consumes, which was never dead code. That alone took the
list from 55 to 26.

### Reviewed, no defect found

**Effects that sync state.** Two exist and both are correct. `note-editor.tsx` documents in place
that there is *deliberately* no effect syncing from props — the workbench keys the component by
note id, so selecting another note remounts it, and a sync effect would additionally fire on the
`router.refresh()` after each autosave and overwrite what was typed during the round trip. That
is the bug found and fixed in an earlier phase, still fixed. `trade-form.tsx` hydrates from
`localStorage`, a client-only external store that cannot be read during SSR render, with a
scoped eslint-disable saying so.

**Buttons that do not work.** Swept the action call sites in components; the only failures were
D4's discarded results. `trade-form.tsx`'s submit handler reads its result correctly (a grep
false positive, checked rather than assumed).

**`dashboard.tsx` was not taken apart**, per the owner's standing instruction. Its two real
defects were fixed in place in step 7.

### Outcome

`FIXED` — D1, D2, D3, D4. `DELETED` — 7 files, 4 dependencies, 5 functions, 16 stray exports.
`ACCEPTED WITH REASON` — 26 vendored shadcn re-exports.

958 tests / 55 files (951 → 958). Coverage **95.54 / 89.92 / 96.76 / 96.81**. Source is now
171 files / 33 259 lines; 22 dependencies and 12 devDependencies, none without a consumer. Lint
back to exactly **1** warning — it briefly went to 3 from this step's own edits, which is the
baseline invariant doing its job. Build green, `tsc` clean.

---

## Round 3 — conclusion

Nine steps, one commit each, over 32 commits and 101 files that rounds 1 and 2 never saw.

### The verification the plan asked for

| Gate | Baseline (2026-08-02) | Now |
|---|---|---|
| `npx tsc --noEmit` | clean | clean |
| `npx vitest run` | 700 tests / 46 files | **958 / 55**, all passing |
| `npm run lint` | 0 errors, **1** warning | 0 errors, **1** warning |
| `npm run build` | passes, 12 routes | passes, 12 routes |
| `npx knip` | 7 dead files, 4 dead deps, 62 unused exports | **0 / 0 / 26**, all 26 vendored shadcn with a written reason |
| Supabase advisors | 2 WARN, both known | 2 WARN, the same two |
| Migrations | 41 | 44 |
| Source | 222 files, ~41 000 lines | 171 files, 33 259 lines |
| Coverage | 93.9 / 89.05 / 91.59 / 95.22 | **95.54 / 89.92 / 96.76 / 96.81** |

The bucket called *"documented, not applied"* no longer exists. Every finding from rounds 1 and 2
carries an outcome, and so does every finding from this round.

### What was actually wrong

31 findings. Stripped of their particulars, nearly all of them are one of four mistakes:

**A `0` standing in for "no data" — 8 findings.** The most expensive class by a distance, and the
one that produced the only defect the owner found himself. `100 − 0 = 100` scored an empty
account, a one-trade account and a six-loss account as flawless risk management. `winRate = 0`
over no decisions. `consistencyScore = 0` over an empty set. A refused `qty` falling back to `0`
and looking like a real zero.

**Two answers to one question — 7 findings.** Two markdown parsers. Two definitions of "last 90
days" inside one component, feeding two halves of one score. Two retirement filters that agree on
today and disagree on the past. Three reorder implementations, one of which never checked its
errors. An import path that throws and an undo path that swallows, on identical statements.

**A silent truncation — 5 findings.** PostgREST returning 1000 rows with HTTP 200. In `undo` it
was not a wrong number but permanent data loss: positions left undeleted with no foreign key to
catch them, and `prev_executions` snapshots destroyed.

**Input taken on faith — 6 findings.** A European date read as American. `2345,67` read as
`234567`. A timezone typo silently re-dating the whole journal. `2026-00-00` rolling into December
2025. A point value of zero making every trade on an instrument worth nothing — and freezing that
onto every trade booked while it stood.

The remaining five are ordinary dead code and one genuine logic error in a comparator.

### What this round is honest about

**Coverage did not find these.** `sickre-score.ts` was at 96 % statements and 100 % functions with
`S1` live. `balance.ts` was at 100 / 100 with `S3` live. Coverage counts execution, not assertion;
`vitest.config.ts` said so in a comment before this round proved it three times.

**Tests of formulas did not find these either.** Every one of `S1`, `S2` and `S3` was a correct
formula fed the wrong thing, or fed a shape no fixture had. What found them was `book.fixture.test.ts`
— one book with every figure derived on paper, plus a sweep of the six *shapes* a book can take.

**The owner found the first one by opening the application.** That is the finding behind the
finding: 16 250 lines of components and 25 routes have no test at all, and the defect lived
there. Steps 6, 7 and 8 read that code; they do not execute it.

**One finding was against this round's own work.** `D4` — a server fix from step 6 whose only
caller discarded the result, so nothing visible changed until step 8 caught it.

**One earlier finding was over-claimed and got corrected on inspection.** The carried note about
`addFieldDef` described a collision that was already handled; the real defect was narrower. Reading
the code first was worth more than trusting the note.

### What is still not established

Stated plainly, because the README must not overclaim it:

- **The component and route layer is unverified by execution.** Reviewed by reading, not by
  running. This is where the reported defect lived.
- **Nothing has been seen in a browser with real trades.** The container has no Supabase
  credentials and the account has no trades. Manual verification remains the owner's.
- **Phase 8B is blocked**, not finished — the OANDA adapter waits on a practice token.

The honest summary is narrower than "everything is correct": **the `lib/` pipeline from a realized
trade to a displayed number is proved, by hand-derived fixtures and by 958 tests. The layer between
that pipeline and the screen is reviewed but not executed.** Closing that gap needs either a
component test runner or a browser suite, and is the obvious next piece of work.

---

# Phase 10 — executing the render layer

Round 3 closed by naming its own gap: 16 250 lines of components and 25 routes reviewed by
reading, never by running — and the one defect the owner found himself lived there. This phase
closes it.

## Step 0 — the harness, and nothing else

No behaviour is asserted here beyond one smoke test. The point is to prove a component can be
mounted at all, because four separate things in this stack say no by default.

### What was in the way

**`server-only` is not installed.** Not a version mismatch — the package is absent from
`package.json` and from `node_modules` entirely. Next aliases it at build time to a module that
throws if it ever reaches a client bundle. Outside Next the import is unresolvable, and 20 of 43
journal components reach it transitively through the `"use server"` action modules they import, so
the module graph dies before a single component renders.

Fixed with a vitest alias to `test/server-only-stub.ts`, an empty module. Its production job is to
fail a client build, which is a bundler concern; under vitest there is no client bundle to protect.

A side effect worth recording: `knip.json` had carried `ignoreDependencies: ["server-only"]` to
paper over the phantom import. With the alias in place knip resolves it, and knip itself flagged
the entry as stale. Removed.

**jsdom has no layout engine.** `ResizeObserver` (Radix and recharts), `DOMRect`, pointer capture
(Radix drag handling) and `Element.prototype.scrollIntoView` (Radix Select) are all missing, and
`URL.createObjectURL` — used by the CSV and XLSX exports in `dashboard.tsx:790` and
`journal-grid.tsx:847` — is not implemented either. `vitest.setup.ts` shims each one **with its
consumer named in the comment**. A shim with no stated reason is a shim nobody can ever delete: the
day a library is dropped, the next reader cannot tell whether the polyfill went with it.

**One environment cannot serve both suites.** The 958 library tests run in `node` in about twelve
seconds; putting them behind jsdom taxes every pure-arithmetic test for a DOM none of them touch.
Split into two vitest `projects` — `lib` (node, `*.test.ts`) and `components` (jsdom, `*.test.tsx`).
The rule is the file extension, so no file can land in both.

`@vitejs/plugin-react` turned out to be unnecessary and was dropped after its install hit a
`@babel/core` peer conflict: `tsconfig.json` already sets `jsx: "react-jsx"`, so esbuild transforms
TSX on its own. One fewer dependency and one fewer conflict to carry.

### C1 (caught during this step) — the coverage scope trap, and the wrong fix for it

The plan predicted that component tests would drag 16 250 unmeasured lines into the coverage
denominator and blow the floors. It did. **The first fix was wrong and is worth recording**, because
it failed in a way that looks like a regression and is not one.

Scoping with `include: ["src/lib/**/*.ts"]` switches v8 from *"files a test imported"* to *"every
file that matches"*. That pulls in the `server-only` query modules no unit test can reach — they
need a database — and scores them 0. Coverage read **86.01 / 82.13 / 84.15 / 86.74** and four
thresholds failed. Nothing had got worse; the metric had quietly started measuring something else
under the same name.

`FIXED` with `exclude: ["src/components/**", "src/app/**", ...]` instead, which keeps the original
meaning. Coverage returned to **95.55 / 89.92 / 96.77 / 96.81** — the pre-step baseline, moved only
by the render test importing `sickre-score.ts`.

The component layer gets its own measured floors once there is enough of it to measure. Until then
"not counted here" is said in the config rather than hidden behind a percentage that changed
meaning.

### The smoke test

`sickre-score-card.test.tsx` — the first test in this repository that renders anything. Chosen
because the card is pure presentation: no `next/navigation`, no server action, no chart, no Radix.
A failure there means the harness is wrong, not the component.

Four assertions, and one of them is `S1` re-asserted at the layer where it was actually seen: with
an empty book the card must show `—` and *"treba još 5 zatvorenih trejdova"*, where before the
round-3 fix it read **33** with *"Max drawdown: 100"*.

Writing it also produced two small lessons the later steps inherit. `getByText("—")` fails on an
empty book because every component row reads `—`, so the headline has to be found by position —
`screen.getByText("/ 100").previousElementSibling`. And the dash count is six components plus the
headline, not seven: the card omits the process row entirely when no process data is supplied,
rather than showing it empty.

`@testing-library/user-event` was installed and then **uninstalled** in the same step — nothing
clicks anything yet, and this project does not keep a dependency it does not use. It comes back in
step 2, where the period and account controls need it.

### Outcome

962 tests / 56 files (958 → 962), of which 4 render. Coverage **95.55 / 89.92 / 96.77 / 96.81**,
unchanged in meaning and in value. Lint 1 warning, build green, `tsc` clean, `knip` zero in own
code.

---

## Step 1 — the book, on screen

`book.fixture.test.ts`'s ten-trade book, extracted to a shared `book.fixture.ts`, is now also the
input to a rendered `<Dashboard>`. `dashboard.render.test.tsx` asserts the same hand-derived
figures — net 600, win rate 55.6 %, profit factor 2.2, total R 6.00, best +400, worst −200, Sickre
Score 64 — appear in the DOM, by the label a reader would actually read. Papir → `lib/` → ekran,
one set of numbers checked at all three layers.

`ResponsiveContainer` is mocked to a fixed size — jsdom has no layout engine, so an unmocked one
measures 0×0 and there is nothing to assert on. The chart pixels are not the point; the chart data
already comes from the same `stats`/`drawdown` objects the KPI tiles read, and those are asserted
directly.

The six shapes swept in `book.fixture.test.ts` (empty, one trade, all winners, all losers, all
breakeven, open-only) are re-swept here at the render layer through a shared `shapedBook` helper,
also moved into `book.fixture.ts`. The empty-book case is `S1` itself, re-asserted at the exact
layer it was seen on: before the round-3 fix this screen read **33** with *"Max drawdown: 100"* on
zero trades; it now reads `—` and *"treba još 5 zatvorenih trejdova"*.

### W1 (Medium) — the Win rate tile answered "0.0 %" for zero decided trades

Found by the render test itself, not by reading — this is what step 1 exists to catch. The
ALL-BREAKEVEN sweep asserted `statValue("Win rate")` should read `—`, and the rendered Dashboard
read `"0.0%"` instead.

`computeStats.winRate` is `wins + losses > 0 ? (wins/(wins+losses))*100 : 0` — `0`, not `null`,
when nothing was decided. That is the right answer for the *statistic*: with breakeven excluded
from both sides of the ratio, there is nothing to divide. Read as a *measurement* it says something
false — a book of six breakeven trades and a book that decided nine trades and lost every one both
render `"0.0%"`, indistinguishable on screen.

The guard already exists, twice: `day-stats-card.tsx` (`stats.wins + stats.losses === 0 ? "—" :
…`) and `month-calendar.tsx` (`decided === 0 ? "—" : …`), each with a comment naming the same
reasoning. `dashboard.tsx`'s main KPI tile — the highest-traffic screen in the app — was the one
place it had been missed.

`FIXED`, at the tile the render test caught and its one exact sibling in the same file — "Week win
%" (`weekly.winPct`, same `0`-not-`null` contract in `period-stats.ts`, same missing guard). Both
now read `stats.wins + stats.losses === 0` / `weekly.winning + weekly.losing === 0` before
formatting, matching the established pattern.

**Deliberately not fixed in this step:** the "Performance by tag" breakdown table's `winRate`
column (`dashboard.tsx`, fed by `breakdownByField` in `analytics.ts`). Same defect, same class —
but `BreakdownRow` carries only the already-collapsed `winRate: number`, not `wins`/`losses`, so a
correct fix means widening a `MONEY_MODULE` type (100 % coverage floor) rather than adding a guard
at a call site with data already in hand. That is a wider, separate change and gets its own
attention rather than being folded into this step's render-test pass. Recorded here so the next
reader does not have to rediscover it. The registry's own `win_rate` metric (`reports/metrics.ts`,
feeding `/reports`) is not touched either — it already has a working, different mitigation via the
report engine's per-row `n`/`belowSample`, reviewed and confirmed in step 4 of this round.

### Outcome

`FIXED` — W1, at its two clean sites. **Recorded, not fixed** — the same defect in the breakdown
table, pending a `BreakdownRow` shape change.

969 tests / 57 files (962 → 969). Coverage **95.44 / 90.18 / 96.33 / 96.50** — `book.fixture.ts`
is now a measured file in its own right, shared by both the paper proof and the render proof; all
four floors still clear. Lint 1 warning, build green (12 routes), `tsc` clean, `knip` zero in own
code.

---

## Step 2 — the controls, not just the numbers

`P1` did not live in a formula — it lived in what the period BUTTON did when clicked: `cutoffMs`
read `new Date()`, so "last 90 days" depended on the browser's timezone and the second the page
happened to load, not the account's day. Step 1 proved one fixed render matches paper; step 2
proves the state a reader actually touches — period, account, net/gross — keeps producing the
right number as it changes. `dashboard.controls.render.test.tsx`, 8 tests, three groups.

**Period vs. the clock.** A ten-trade book placed so the 30-day account-zone cutoff falls mid-book
(`todayKey = 2026-04-05`, cutoff `2026-03-07`, splitting 5/5). Default 90d covers the whole book;
clicking 30d leaves exactly trades 6–10 (`net −200+400−150+0+50 = 100`); and, the direct regression
test for `P1`, rendering the same book at `2026-04-05T00:05:00Z` and at `2026-04-05T23:55:00Z` —
same `todayKey` prop, wildly different wall-clock instants — gives the *identical* 30d Net P/L both
times. If anything in the tree still read `Date.now()` for the money window, one of those two
numbers would move.

**Net vs. gross.** One trade built so a fee flips its sign — `net: −10, gross: 50` — so the two
modes classify it on opposite sides of the breakeven band. Net mode: win rate 50.0 %, Best +$40,
Worst −$10. Click `gross`: win rate 100.0 %, Best +$50, Worst +$40. `Net P/L` and `Gross P/L`
themselves never move (`+$30.00` / `+$90.00` in both modes) — they are always the raw sums,
confirming the `analytics.ts` contract read in the round-3 review holds on screen: mode changes
*classification*, not the two summary tiles.

**Account filter.** Two accounts, three trades (2 on one, 1 on the other). Default view pools all
three (`Trades = 3`, `+$650.00`). Selecting one account narrows to exactly its trades and total;
selecting the other *replaces* the scope rather than adding to it.

### Two test-infrastructure bugs, not application bugs

Both diagnosed by isolating the failure down to a bare `<button>` with no Dashboard, no Radix, no
recharts involved — worth recording since they will recur the moment a later step needs a click
under a mocked clock.

- **`userEvent.click()` deadlocks under `vi.useFakeTimers()`, even with `advanceTimers` wired to
  `vi.advanceTimersByTime`.** Reproduced on a bare `<button>`: `userEvent.setup({ delay: null,
  advanceTimers: vi.advanceTimersByTime })` still times out at 5000 ms on a single click. The fix
  actually used: don't install fake timers at all. `vi.setSystemTime()` mocks `Date` on its own —
  it does not require `vi.useFakeTimers()` — so real timers keep flowing (userEvent's internal
  waits resolve normally) while `new Date()` inside the component still reads the mocked instant.
  This is what the `P1` regression test needed anyway: two different *wall-clock* instants with the
  *same* mocked `Date`.
- **`getByRole("combobox", { name })` cannot disambiguate Radix `Select` triggers by their visible
  text.** The Dashboard renders three (account filter, granularity, "Performance by tag" breakdown
  field), and every one of them computes to an accessible **name** of `""` — confirmed empirically
  by dumping the accessible-roles tree. Per the ARIA accname spec a combobox's visible text is its
  *value*, not its *name*; Radix's trigger has no `aria-label`, so `{ name: "All accounts" }` finds
  nothing at all, not even ambiguously. Fixed in the test by scoping to DOM proximity instead —
  `screen.getByText("All accounts").closest('[role="combobox"]')` — rather than by adding an
  `aria-label` to the component for a test's convenience.

### Investigated, left alone: `todayYMD()`

`dashboard.tsx:170` (`new Date().toISOString().slice(0, 10)`) is a genuine remaining wall-clock
read, structurally identical to the shape `P1` had. Traced every call site: it seeds the initial
`anchor`/`customFrom`/`customTo` state for the calendar-style date pickers (a default the reader
can see and change before doing anything), and it stamps the exported mentor-pack filename when
`granularity === "all"` (`mentor-pack-all-2026-08-10.md`) — cosmetic, and the export's own date
range is computed from `todayKey`/`timezone`, not from this stamp, and is shown live on screen
(`Izvoz: {exportRange.rangeText}`) before the reader clicks. No KPI, chart, or score reads it.
Different defect class from `P1`: that one silently mislabeled a number the reader trusted; this
one only names a downloaded file. Left as-is; recorded so it isn't rediscovered as a false `P1`
repeat.

### Outcome

No production defect found this step — `P1`'s fix (round 3, step 7) holds under a real click, a
real render, and a mocked clock. Two test-harness bugs found and fixed (fake timers vs. userEvent;
combobox accessible-name). One wall-clock read investigated and deliberately left alone, with
reasoning recorded above.

977 tests / 58 files (969 → 977). Coverage **95.44 / 90.26 / 96.33 / 96.50** — branches ticked up
fractionally (90.18 → 90.26): the net/gross controls test exercises `analytics.ts` branches no
earlier test reached with `mode: "gross"` on a mixed-sign book. All four floors still clear. Lint 1
warning, build green (12 routes), `tsc` clean, `knip` zero in own code.

---

## Step 3 — fourteen presentational components, real lib output on screen

The plan's Tier 3: components that render props they did not compute, named cheap because they
were expected to just format a value. Twelve new render-test files, one per component or tight
cluster (`heatmap-grid.tsx` + its two callers share one file, `metrics-panel.tsx`'s four cards
share another). Wherever a real library function exists to produce the prop — `runReport`,
`runPivot`, `summarizeReport`, `summarizePeriods`, `computeStats`, `computeCostStats`,
`computeStreak`, `meanCompliance`, `daysOnActiveGoal` — the test calls it, continuing step 1's
"papir → lib → ekran" bridge instead of hand-typing a plausible-looking prop object. Two of the
fourteen turned up real, previously undiscovered defects.

### W2 (Medium) — `PeriodPerformanceCard`'s Win % repeated W1 at a second call site

`dashboard.tsx` renders `PeriodPerformanceCard` twice — "Nedeljni učinak" and "Mesečni učinak" —
fed by the exact same `weekly`/`monthly` `PeriodSummary` objects step 1's `W1` fix already guards
at the KPI tile. `metrics-panel.tsx`'s card reads `summary.winPct` directly, without that guard: an
all-flat book (every week breakeven) rendered `"0.0%"` here even after `W1` fixed the tile sitting
right above it on the same page. Same root cause as `W1` — `winPct` is `0`, not `null`, when
`winning + losing === 0` — same fix, applied where it was still missing:
`summary.winning + summary.losing === 0 ? "—" : fmtPct(summary.winPct)`. Proven with a real
`summarizePeriods([...])` call on an all-flat input, not a hand-built summary object, so the test
fails if the library's own contract ever changes shape.

### W3 (Medium, privacy) — `PerformanceSummaryPanel`'s win-rate tile ignored `viewMode` entirely

Flagged as a suspicion in the phase plan (`reports/performance-summary.tsx:75`) and confirmed here.
Three of the panel's four tiles — Najbolji, Najgori, Najaktivniji — are formatted through
`formatMetric(metric(...), viewMode)`, the same path every other number in Reports uses, which masks
under `viewMode: "privacy"`. The fourth, "Najviši win rate", used a raw `` `${...toFixed(1)}%` `` that
never looked at `viewMode` at all. In privacy mode the other three tiles correctly showed `•••`
while this one kept printing the real percentage — a privacy setting that silently exempted one
number from itself. `FIXED`: routed through the same `formatMetric(metric(v, "pct", {currency,
equityBase}), viewMode)` call the rest of the panel uses. Proven by rendering the SAME
`summarizeReport()` output in `"dollars"` mode (real percentage shows) and `"privacy"` mode (no `%`
anywhere on the card, not even masked-but-present) — the regression this closes is specifically a
number surviving where masking should have applied.

### Security-relevant: `markdown-view.tsx`'s href allowlist, re-proven at the DOM

`notes/markdown.ts`'s scheme allowlist is already proven in isolation; this step proves the one
thing a lib test cannot — that a rejected scheme (`javascript:`, `data:`) never reaches the DOM as
a clickable `<a>`. Confirmed: the rejected link's raw markdown source renders as plain text (not
just the label — the parser keeps the whole `[text](href)` token, so the reader sees exactly what
they typed rather than a silently truncated sentence), and literal `<img onerror=...>` typed into a
note renders as escaped text, never as a live element — there is no `dangerouslySetInnerHTML`
anywhere in the renderer and this step is the regression guard for that fact staying true.

### Two more of the fourteen, without their own findings

- `heatmap-grid.tsx` — re-proves the class of bug the file's own doc comment names (the grid used
  to end at a BROWSER-local `new Date()` instead of the account-zone `endDay` prop). The render test
  anchors two windows a week apart on identical weekdays and confirms only `endDay` moves the grid.
- `day-stats-card.tsx` — already carried the `W1`-class guard (`stats.wins + stats.losses === 0`)
  before this round; the render test exists to hold that guard in place, not to fix anything.

### Outcome

`FIXED` — `W2` (`metrics-panel.tsx`), `W3` (`reports/performance-summary.tsx`, privacy leak).
Fourteen components now have render tests: `heatmap-grid.tsx`, `calendar-heatmap.tsx`,
`compliance-heatmap.tsx`, `markdown-view.tsx`, `insights-panel.tsx`, `metrics-panel.tsx` (four
cards), `day-stats-card.tsx`, `ftmo-banner.tsx`, `reports/report-table.tsx`,
`reports/cross-analysis.tsx`, `reports/performance-summary.tsx`, `chart-shell.tsx`,
`tracker-streak-card.tsx`, `focus-goal-card.tsx`.

`next/navigation`'s `useRouter()` throws without an `AppRouterContext` in jsdom — hit on
`ftmo-banner.tsx` and `focus-goal-card.tsx`, both of which call it only inside a click handler this
step does not exercise. Mocked per-file (`vi.mock("next/navigation", ...)`) rather than in the
shared harness, so a later step that DOES need to assert on a router call is free to mock it
differently.

1029 tests / 70 files (977 → 1029). Coverage **95.50 / 90.39 / 96.49 / 96.58** — every floor moved
up, not just held: the new tests reach `reports/engine.ts`, `reports/pivot.ts`, `period-stats.ts`
and `ftmo.ts` through paths no earlier test exercised (privacy-mode formatting, all-flat period
summaries, a full FTMO breach/pass/active render cycle). Lint 1 warning, build green (12 routes),
`tsc` clean, `knip` zero in own code.

---

## Step 4 — journal-grid

The plan's #3 Tier 1 risk: a row computation living in BOTH `accessorFn` (what TanStack sorts on)
and the cell renderer (what the reader sees) — two places the same number has to agree, with
nothing in the type system forcing them to. `journal-grid.render.test.tsx`, 13 tests.

**Breakeven classification, per account.** The plan's own stated goal for this step —
"breakeven klasifikacija u redu" — proven directly: the same −$30 net renders as a **loss** on an
account with no breakeven band and as **breakeven** on an account whose band reaches −$50, filtered
through the "Ishod" (outcome) dropdown. `outcomeOf()` reads each row's OWN account's
`resolveBreakevenRange`, not a single global band; collapsing the two would have put both trades on
the same side of the filter, and the render test is what would have caught it.

**Sorting** — clicking the "Net" header sorts ascending on `stats.net_pl`, the exact value TanStack
reads from `accessorFn`, matching the value the cell itself renders.

**Search** — matches instrument case-insensitively, confirmed against the exact three fields the
component searches (`instrument`, notes, tags) and not, e.g., the trade id or status.

**The column picker never empties the grid.** `MIN_VISIBLE_COLUMNS = 1` is already proven in
isolation in `column-prefs.test.ts`; this step proves the render layer HOLDS that rule live: with
every hideable column but one already off, that last column's checkbox renders `aria-disabled`, and
clicking it anyway calls neither `setJournalHiddenColumns` nor changes the DOM — the "Net" header
is still there afterward. Also covered: the optimistic hide (column disappears before the save
resolves) and the revert-on-failure path (`setJournalHiddenColumns` rejects → the column reappears
and an error toast fires).

**Export** — both dynamic-import branches, `import("papaparse")` and `import("xlsx")`, exercised
with mocked modules so the test asserts on the actual row shape reaching each library (`Net P/L`
present and correct) rather than on file-download side effects jsdom can't observe anyway. The
empty-filtered-set guard (`toast.error("Nothing to export")`) is confirmed as a real early return,
not just a message that happens to exist in the source.

**Row actions and navigation** — clicking a row pushes to `/trades/{id}/edit`; clicking inside the
row's action menu does not also trigger that navigation (`stopPropagation` on the actions cell,
confirmed by asserting `router.push` was NOT called after opening the menu). `deleteTrade` /
`activateTrade` are mocked at the module boundary (they are real Server Actions, correctly out of
scope for a render test) and asserted as called with the right id, with `router.refresh()` following
a successful delete. "Move to active" is confirmed absent for anything but a `planned` trade.

**Toast assertions needed their own fix.** `<Toaster/>` lives in the root layout, which none of
these render tests mount — a real `toast.error(...)` call has literally nowhere to paint text into,
so `screen.findByText(...)` on a toast message can never pass here regardless of whether the call
happened. Fixed by mocking `sonner` at the module boundary and asserting on the call
(`toastErrorMock`) instead of DOM output — the same category of harness fix as step 2's
`userEvent`/fake-timers issue, recorded here so a later step doesn't waste time chasing the same
dead end.

### Outcome

No production defect found — the grid's dual-path computation (`accessorFn` vs. cell), its
per-account breakeven classification, and `MIN_VISIBLE_COLUMNS` all hold under a real render, a
real click, and a real (mocked) export. One test-harness lesson recorded (`sonner` needs mocking,
not `findByText`, in any component test that fires a toast).

1042 tests / 71 files (1029 → 1042). Coverage **95.54 / 90.39 / 96.49 / 96.62** — statements and
lines ticked up on the export and outcome-filter paths. Lint 1 warning, build green (12 routes),
`tsc` clean, `knip` zero in own code.

---

## Step 5 — forms

`trade-form.tsx` (1605 lines — the largest file in the app after `dashboard.tsx`),
`daily-report-form.tsx`, `tracker-checklist.tsx`. The plan named two specific candidates in
`trade-form.tsx` in advance; one was real, the other checked out as a duplicate that happens to
always agree. Both the fact that they existed and the fact that they resolved differently is the
argument for reading and testing every one of these, not for trusting the pattern.

### W4 (Medium) — Target attainment: a second implementation, looser and with the wrong precedence

`trade-form.tsx:427-440` computed "Target attainment" inline instead of calling
`exitEfficiencyFromTrade` — the same function the grid's "Target %" column and the mentor export
both read. Two divergences from it, found by comparing the two side by side and confirmed by a
render test built to reproduce each:

- **No floor.** `exitEfficiencyFromTrade` refuses to grade against a planned reward under
  `MIN_PLANNED_REWARD_R` (0.1R) — a data-entry near-zero would otherwise make the percentage
  explode. The form's inline version guarded only `plannedReward > 0`, so a stored `1:0.05` planned
  reward next to a 2R realized result would have shown `4000%` instead of the library's `—`.
- **Wrong precedence.** `plannedRewardFromTrade`'s own comment says *why* the stored `planned_rr`
  must win over a live recompute from the price fields once a trade has left `planned`: editing
  `target_price` after the fact must not let a trader quietly move their own grading baseline. The
  form's inline version did the opposite — `plannedRR ?? parsePlannedRewardR(fields.planned_rr)`
  always preferred the LIVE value. Reproduced directly: entry 100 / stop 90 / target 200 implies a
  live reward of 10R, while the trade's actual stored plan was `1:2`; the on-screen badge showed
  10R's percentage instead of the 2R that was really being graded.

`FIXED` by deleting the duplicate and calling `exitEfficiencyFromTrade` with a small synthetic
`TradeRow` — the same pattern already used one block above it for `excursionFromTrade` ("Same
implementation the dashboard aggregates over — this used to be a second copy of the geometry living
only in the form"). One function, one floor, one precedence, for every screen that shows this
number.

### Checked and rejected — `grossPl − metrics.netPl` vs. `metrics.fees`

The plan's other suspicion (`:1024`, now the "Gross → Net" tile) turned out to be algebraically
guaranteed, not a duplicate that can drift: `position-stats.ts` defines
`net_pl = gross_pl − total_fees − total_swap`, so `grossPl − netPl` and `totalFees + totalSwap`
are the same expression rearranged, not two independent computations that happen to agree today.
Not fixed — there is nothing to fix — but given its own test asserting the two render identically,
so a future change to `position-stats.ts`'s definition would be caught here rather than assumed.

### Lifecycle button gating — regression guard for a bug this file already had once

Commit `dd5a079` (round 3-era) fixed exactly this class of defect: "Mark as missed" used to be
offered on an unsaved trade and then refuse on click, because `markTradeMissed` needs a saved row.
"A button that is shown and cannot work is worse than no button." Five render tests now hold the
current gating in place: an unsaved trade shows none of the three lifecycle buttons; a saved
`planned` trade with no fills offers Move-to-active and Mark-missed but not Restore; a trade with a
valid entry fill is already active and offers none of the three (the render-time phase promotion —
`hasValidEntryFill && tradePhase !== "active"` — is itself covered); a `missed` trade offers only
Restore; and clicking Mark-missed in the one state that shows it is confirmed to actually call
`markTradeMissed`, not just render.

FTMO freeze is covered the same way: a new trade on a frozen account has its Save button
`disabled`, not merely warned against on click — confirmed by asserting `toBeDisabled()` and that a
click on a disabled button reaches neither `createTrade` nor a toast. Editing an *already-saved*
trade on the same frozen account stays enabled, matching `ftmoBlocked`'s `!initial` guard — freezing
blocks new risk, not a correction to something already on the books.

### Day locking — `tracker-checklist.tsx` and `daily-report-form.tsx` together

The plan's stated goal for this step: "da zaključan dan zaista onemogući čekiranje." Proven at two
levels. In `tracker-checklist.tsx` alone: a locked `ManualRow` renders a read-only `Badge`, not a
disabled button — the interactive control is *absent*, not present-but-inert, which matters because
a disabled-but-visible checkbox reads as "you could check this if you tried harder." In
`daily-report-form.tsx`, embedding the same component: a locked day's `<fieldset disabled>` cascade
reaches all the way through to that same embedded tracker row, confirmed by asserting the badge
appears two component boundaries away from the prop that set it. Save and Zaključaj buttons are
removed entirely (not disabled) and replaced by "Dan je zaključan" text. The lock flow's own
ordering — save the report, then lock, abort the lock if the save fails — is confirmed by call
order, not just by both mocks having fired.

### A coverage gap the render layer surfaced, not introduced

`trade-form-prefs.ts` had no test before this step and had never appeared in any coverage report —
`exclude`-based coverage only measures files a test actually reaches, and nothing had ever imported
this module. `trade-form.render.test.tsx` finally pulled it in transitively, which surfaced it with
real but partial coverage and pulled the aggregate down (95.54 → 95.23 before the fix below) instead
of up, the mirror image of step 1's C1 coverage-scope note. Closed properly rather than left as an
accidental side effect: the module is `typeof window === "undefined"`-guarded for SSR, so its tests
split across both projects on purpose — `trade-form-prefs.test.ts` (`lib`, `environment: "node"`)
tests the SSR no-window branches for real, since that environment genuinely has no `window`, and
`trade-form-prefs.render.test.tsx` (`components`, jsdom) tests the real `localStorage` round trip,
merge, malformed-JSON recovery, and quota-failure paths — one module, one behaviour, tested in
whichever environment actually reproduces it.

### Outcome

`FIXED` — `W4`, target attainment's floor and precedence, by deleting the duplicate in favour of
the tested library function. **Checked, not fixed** — `grossPl − netPl` vs. `fees`, verified
algebraically identical, insured with a test. Lifecycle gating, FTMO freeze, and day-lock cascade
all confirmed correct under real renders and real clicks — no defect, but each now has a regression
test where none existed. One coverage gap (`trade-form-prefs.ts`) found and closed with its own
tests rather than left as a number.

1079 tests / 76 files (1042 → 1079). Coverage **95.56 / 90.49 / 96.51 / 96.64** — every floor above
where step 4 left it. Lint 1 warning, build green (12 routes), `tsc` clean, `knip` zero in own code.

---

## Step 6 — import-wizard

The plan's own stated goal, verbatim: "Odbijene ćelije (`nečitljivo: qty, fee`) na ekranu,
klasifikacija create/merge/skip, i da se dvosmislen datum i `1,234` vide kao odbijeni a ne kao
pogođeni." `parseImportNumber` and `parseImportTime` are already proven in isolation — both refuse
ambiguous input rather than guess at it, by design, per their own doc comments. What round 3 could
not prove is that a refused cell actually reaches the screen as refused, instead of the wizard
quietly substituting `0` or `null` and moving on. `import-wizard.render.test.tsx`, 9 tests, real
CSV text through the real dynamic `import("papaparse")` path — no mocked parser.

**The core claim, proven directly.** A row with qty `"1,234"` (ambiguous — 1234 to a US broker,
1.234 to a German one) and entry time `"02/03/2026 10:00"` (ambiguous — 2 March or 3 February,
nothing in the string says which) renders `nečitljivo: qty, entry time` in the row's Differences
column, exactly as the source comments describe. A clean, unambiguous row of the same shape shows
no rejected cells at all and classifies as `new`/`create` — the negative control, so the first
result isn't just "everything shows *something* here."

**The exit-time fallback, regression-guarded.** `exitAt = exitTime ?? entryTime`, never
`new Date()` — this was `import-wizard.tsx`'s own worst line before round 3 fixed it ("a row from
three months ago closed today, with nothing on screen to say the date was invented"). A row dated
2020 with no exit-time column commits with its exit execution stamped to the SAME 2020 entry
instant, confirmed by inspecting the actual `commitImport` payload rather than trusting the source
comment — a regression back to `new Date()` would be unmistakable against a 2020 fixture on a 2026
test run.

**Classification**, against a small `candidates` fixture: an exact repeat (same instrument,
direction, price, and time within the matcher's tolerance) reads `duplicate`, defaults to `skip`;
a matching position whose exit price differs reads `match`, defaults to `merge`, and names the
difference (`exit 2,100→2,050`); an instrument with nothing to match against has its `Merge` option
`aria-disabled` in that row's own decision `Select` — there is genuinely nothing to merge into, not
merely an unlikely choice. The decision is confirmed overridable per row (`create` → `skip`), and
the override is confirmed to reach the actual `commitImport` call, not just the visible `Select`.

**Guards.** The required-column check (`Map a column for "direction"`) blocks reconciling with a
missing mapping — confirmed by absence of the review table afterward, not just the toast. Partial
commit failure names the row and reason (`row 1 (EURUSD): missing account`) instead of a bare
`"1 row(s) failed"`.

### Outcome

No production defect found — `parseImportNumber`'s and `parseImportTime`'s refusals, the
`exitAt ?? entryTime` fallback (the round-3 fix this step exists to re-prove), and the
create/merge/skip classification all hold under a real render with real CSV parsing. Nine tests now
guard exactly the four things the plan named for this step in advance.

1088 tests / 77 files (1079 → 1088). Coverage **95.56 / 90.53 / 96.51 / 96.64** — branches ticked up
on `import-number.ts`'s and `time.ts`'s ambiguous-input paths, reached here through a real parse
instead of only through their own unit tests. Lint 1 warning, build green (12 routes), `tsc` clean,
`knip` zero in own code.
