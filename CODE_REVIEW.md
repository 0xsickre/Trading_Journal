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
