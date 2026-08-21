"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  Lock,
  Plus,
  Trash2,
  Unlink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { pnlClass } from "@/lib/journal/format";
import { formatMetric, metric as mkMetric } from "@/lib/journal/units";
import { getMetric } from "@/lib/journal/reports/metrics";
// Aliased on the way in. `units.ts` exports a DIFFERENT type by the same name —
// that one is about FORMATTING (currency, equity base), this one about
// COMPUTING (pnl basis, breakeven band, rule answers). Both are legitimate and
// neither should borrow the other's fields, so the collision is defused here
// rather than resolved by picking a winner.
import type { MetricContext as ComputeContext } from "@/lib/journal/reports/metrics";
import type { ReportRow } from "@/lib/journal/reports/engine";
import {
  RULE_SAMPLE,
  type PlaybookLookup,
} from "@/lib/journal/reports/playbook-dimensions";
import { ruleScorecard, type RuleScore } from "@/lib/journal/reports/rule-scorecard";
import {
  RULE_CATEGORIES,
  RULE_CATEGORY_HINTS,
  RULE_CATEGORY_LABELS,
  SHOW_WHEN_LABELS,
  SHOW_WHEN_VALUES,
  rulesByCategory,
  type Playbook,
  type PlaybookRule,
  type RuleCategory,
  type ShowWhen,
} from "@/lib/journal/playbook-types";
import type { EnrichedTrade } from "@/lib/journal/enriched-trade";
import {
  addPlaybookRule,
  deletePlaybook,
  deletePlaybookRule,
  linkRule,
  movePlaybookRule,
  restorePlaybookRule,
  unlinkRule,
  updatePlaybook,
  updatePlaybookRule,
} from "@/app/(app)/settings/playbook-actions";

/** Header metrics per playbook — the TradeZella set, computed by our engine. */
export const HEADER_METRICS = [
  "trade_count",
  "win_rate",
  "expectancy",
  "profit_factor",
  "avg_r",
  "follow_rate",
] as const;

/**
 * Declared once because three `colSpan` sites depend on it.
 *
 * It used to be a literal `5` in one place. Adding a column meant remembering
 * all of them, and a stale one does not error — it just draws a category heading
 * that stops short of the table's edge.
 */
const RULE_COLUMNS = 7;

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Failed");
      else router.refresh();
    });
  return { pending, run };
}

/**
 * One side of the contrast.
 *
 * The count is shown even when the win rate is withheld, because "answered 4
 * times" is a fact worth seeing while "57 %" on four trades is not. Expectancy
 * (R) is a second line under the win rate rather than a column of its own —
 * this table already pushes `When` toward the edge of its horizontal scroll on
 * purpose (see the comment above the `<table>`), and an eighth column would
 * make that worse for a number that reads fine stacked under the one it
 * qualifies.
 */
function Side({
  n,
  winRate,
  r,
}: {
  n: number;
  winRate: number | null;
  r: number | null;
}) {
  if (n === 0) return <span className="text-muted-foreground">—</span>;
  if (n < RULE_SAMPLE.MIN || winRate == null) {
    return <span className="text-muted-foreground">n={n}</span>;
  }
  return (
    <>
      <span>{winRate.toFixed(0)}%</span>
      {r != null && (
        <span className="block text-xs font-normal text-muted-foreground">
          {formatMetric(mkMetric(r, "r"))}
        </span>
      )}
    </>
  );
}

/**
 * One rule: its editor and its evidence, on the same line.
 *
 * That adjacency is the entire point of this table. The two used to be separate
 * blocks on this page — a read-only scorecard above, an editable list below —
 * so "is the rule I am about to reword actually carrying anything?" meant
 * scrolling between them and pairing rows by eye.
 *
 * ONE DIMMING, ONE MEANING. `report-table.tsx` dims below-sample rows with
 * `opacity-45`; this row dims RETIRED ones with `opacity-60`. They must not
 * stack: a retired thin rule would then be indistinguishable from either. Here
 * opacity means retired and nothing else — thinness is already said by the `n`
 * column and by the literal words `too few`.
 */
function RuleRow({
  rule,
  playbookId,
  score,
  canUp,
  canDown,
}: {
  rule: PlaybookRule;
  playbookId: string;
  score: RuleScore | undefined;
  canUp: boolean;
  canDown: boolean;
}) {
  const { pending, run } = useAction();
  const [text, setText] = useState(rule.text);
  const locked = rule.answerCount > 0;
  const retired = rule.deleted_at != null;

  return (
    <tr className={cn("border-b last:border-0", retired && "opacity-60")}>
      <td className="py-1.5 pr-3">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text.trim() && text !== rule.text)
              run(() => updatePlaybookRule(rule.id, { text }));
          }}
          className="h-8 w-full"
          aria-label="Rule text"
          disabled={pending || retired}
        />
      </td>

      <td className="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">
        {score?.n ?? 0}
      </td>
      <td className="py-1.5 pl-3 text-right tabular-nums">
        <Side
          n={score?.followed.n ?? 0}
          winRate={score?.followed.winRate ?? null}
          r={score?.followed.expectancy ?? null}
        />
      </td>
      <td className="py-1.5 pl-3 text-right tabular-nums">
        <Side
          n={score?.broken.n ?? 0}
          winRate={score?.broken.winRate ?? null}
          r={score?.broken.expectancy ?? null}
        />
      </td>
      <td
        className={cn(
          "py-1.5 pl-3 text-right tabular-nums",
          pnlClass(score?.gapPp),
        )}
      >
        {/* Three outcomes, and they must not collapse into one dash:
            a gap; "one of the two sides is too thin to compare"; and "there is
            no contrast here at all" — a rule never broken, or never answered.
            The last one is an honest absence rather than a missing measurement,
            so it gets the dash and the other gets words.

            The "too few" case carries its own count against the floor
            (whichever side is thinner — that's the one holding the whole
            comparison back) rather than a bare "too few" with no number behind
            it. A book with one playbook per setup routinely sits at 20/30
            for MOST of its rules at once, capped by that playbook's own total
            trade count rather than by any one rule — seeing the same "X/30"
            repeat down the column is what makes that legible without reading
            the paragraph below or the source. */}
        {score?.gapPp != null
          ? `${score.gapPp > 0 ? "+" : ""}${score.gapPp.toFixed(0)} pp`
          : score && score.followed.n > 0 && score.broken.n > 0
            ? `too few (${Math.min(score.followed.n, score.broken.n)}/${RULE_SAMPLE.MIN})`
            : "—"}
      </td>

      <td className="py-1.5 pl-4">
        <Select
          value={rule.show_when}
          disabled={pending || locked || retired}
          onValueChange={(v) =>
            run(() => updatePlaybookRule(rule.id, { show_when: v as ShowWhen }))
          }
        >
          <SelectTrigger
            className="h-8 w-full"
            aria-label="When it shows"
            title={
              locked
                ? `Locked — the rule is already answered on ${rule.answerCount} trades. Editing it would retroactively change the statistics.`
                : undefined
            }
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHOW_WHEN_VALUES.map((v) => (
              <SelectItem key={v} value={v}>
                {SHOW_WHEN_LABELS[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>

      {/* Marks a rule as one of the conditions the SETUP GRADE is computed from.
          Only offered for a rule that shows on every trade: a criterion asked
          just of winners would judge the setup already knowing the outcome, and
          the database refuses that combination outright. */}
      <td className="py-1.5 pl-4">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={rule.is_setup_criterion}
            disabled={pending || retired || rule.show_when !== "always"}
            onCheckedChange={(v: boolean | "indeterminate") =>
              run(() =>
                updatePlaybookRule(rule.id, { is_setup_criterion: v === true }),
              )
            }
            aria-label="Counts toward the setup grade"
            title={
              rule.show_when !== "always"
                ? "Only a rule that shows on every trade can grade the setup — otherwise it would judge with hindsight."
                : undefined
            }
          />
          grade
        </label>
      </td>

      <td className="py-1.5 pl-3 whitespace-nowrap text-right">
        {locked && (
          <Badge variant="outline" className="mr-1 gap-1">
            <Lock className="size-3" /> {rule.answerCount}
          </Badge>
        )}
        {retired && (
          <Badge variant="outline" className="mr-1">
            archived
          </Badge>
        )}

        {/* Scoped to the category, not to the table. The first Context rule has
            no up-arrow even though rules of other categories precede it in the
            flat link order — right, because the table groups by category and
            moving a rule ACROSS one is `updatePlaybookRule({ category })`, which
            this screen does not offer.

            Client and server agree on the set only because `/playbooks` loads
            `includeDeleted: true`: every link the action counts is a row drawn
            here. Rendered from an `includeDeleted: false` load, retired rules
            would be invisible yet still counted, and an arrow would appear to
            skip a place. */}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={pending || !canUp}
          aria-label="Move up"
          onClick={() => run(() => movePlaybookRule(playbookId, rule.id, -1))}
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={pending || !canDown}
          aria-label="Move down"
          onClick={() => run(() => movePlaybookRule(playbookId, rule.id, 1))}
        >
          <ChevronDown className="size-3.5" />
        </Button>

        {/* Unlink ≠ delete, and the difference is the whole reason the library
            exists. This takes the rule OUT OF THIS PLAYBOOK: the rule survives,
            every answer it ever collected survives, and any other playbook
            linking it is untouched. */}
        {!retired && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={pending}
            onClick={() => run(() => unlinkRule(playbookId, rule.id))}
            aria-label="Remove from this playbook"
            title="Removes it from THIS playbook only. The rule and its statistics stay."
          >
            <Unlink className="size-3.5" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={pending}
          onClick={() =>
            run(() =>
              retired ? restorePlaybookRule(rule.id) : deletePlaybookRule(rule.id),
            )
          }
          aria-label={retired ? "Restore rule" : "Delete rule from the library"}
          title={
            retired
              ? "Restore to the checklist."
              : locked
                ? "Archived across every playbook. Statistics on past trades stay untouched."
                : "Deleted from the library — no trade has ever answered it."
          }
        >
          {retired ? (
            <ArchiveRestore className="size-3.5" />
          ) : locked ? (
            <Archive className="size-3.5" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </Button>
      </td>
    </tr>
  );
}

/**
 * The "write a new rule here" row.
 *
 * Its own component because the draft text and the pending `show_when` are
 * local to ONE category. Hoisting them into the card would give all five
 * categories a single draft, so typing under Entry would appear under Exit.
 */
function AddRuleRow({ book, category }: { book: Playbook; category: RuleCategory }) {
  const { pending, run } = useAction();
  const [draft, setDraft] = useState("");
  const [showWhen, setShowWhen] = useState<ShowWhen>("always");

  function addRule() {
    if (!draft.trim()) return;
    run(async () => {
      const res = await addPlaybookRule({
        category,
        text: draft,
        show_when: showWhen,
        playbook_id: book.id,
      });
      if (res.ok) setDraft("");
      return res;
    });
  }

  return (
    <tr>
      <td colSpan={RULE_COLUMNS} className="py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addRule();
            }}
            placeholder="New rule, e.g. Wait for the sweep, then MSS"
            aria-label={`New ${RULE_CATEGORY_LABELS[category]} rule`}
            className="h-8 min-w-0 flex-1"
            disabled={pending}
          />
          <Select value={showWhen} onValueChange={(v) => setShowWhen(v as ShowWhen)}>
            <SelectTrigger className="h-8 w-44" aria-label="When the new rule shows">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHOW_WHEN_VALUES.map((v) => (
                <SelectItem key={v} value={v}>
                  {SHOW_WHEN_LABELS[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8" onClick={addRule} disabled={pending}>
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
      </td>
    </tr>
  );
}

/** Rules already written in this category and not yet in this book. */
function ReuseRow({
  book,
  available,
}: {
  book: Playbook;
  available: PlaybookRule[];
}) {
  const { pending, run } = useAction();
  return (
    <tr>
      <td colSpan={RULE_COLUMNS} className="pb-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Or reuse:</span>
          {available.map((r) => (
            <Button
              key={r.id}
              variant="outline"
              size="sm"
              className="h-7"
              disabled={pending}
              onClick={() => run(() => linkRule(book.id, r.id))}
              title="Links the existing rule — it keeps its id, and its statistics keep accumulating under it."
            >
              <Plus className="size-3" /> {r.text}
            </Button>
          ))}
        </div>
      </td>
    </tr>
  );
}

function CategorySection({
  book,
  category,
  rules,
  library,
  scoreById,
}: {
  book: Playbook;
  category: RuleCategory;
  rules: PlaybookRule[];
  library: PlaybookRule[];
  scoreById: Map<string, RuleScore>;
}) {
  const linked = new Set(rules.map((r) => r.id));
  const available = library.filter(
    (r) => r.category === category && !linked.has(r.id) && r.deleted_at == null,
  );

  return (
    <>
      <tr>
        <td
          colSpan={RULE_COLUMNS}
          className="pt-4 pb-1 text-xs font-semibold text-muted-foreground"
        >
          {RULE_CATEGORY_LABELS[category]}{" "}
          {/* The hint rides along deliberately: it is what makes an empty
              No-trade section a prompt to write the missing rule rather than a
              gap in the table. */}
          <span className="font-normal">{RULE_CATEGORY_HINTS[category]}</span>
        </td>
      </tr>

      {rules.map((rule, i) => (
        <RuleRow
          key={rule.id}
          rule={rule}
          playbookId={book.id}
          score={scoreById.get(rule.id)}
          canUp={i > 0}
          canDown={i < rules.length - 1}
        />
      ))}

      <AddRuleRow book={book} category={category} />
      {available.length > 0 && <ReuseRow book={book} available={available} />}
    </>
  );
}

/**
 * One playbook: what it is, what it did, and every rule it holds.
 *
 * Replaces the old `PlaybookScorecard` + `PlaybookCard` pair. Keeping them apart
 * meant two components drawing the same book from two prop sets, and it showed:
 * the scorecard rendered `default_risk_pct` as a badge while the manager
 * rendered it as an input, so the two visibly disagreed for as long as you were
 * typing. Merged, each value has one owner.
 */
export function PlaybookCard({
  book,
  library,
  row,
  trades,
  lookup,
  computeCtx,
  currency,
  collapsed,
  onToggleCollapsed,
}: {
  book: Playbook;
  library: PlaybookRule[];
  row: ReportRow | undefined;
  trades: EnrichedTrade[];
  lookup: PlaybookLookup;
  computeCtx: ComputeContext;
  /**
   * Passed separately from `computeCtx` on purpose: that one is the context of
   * CALCULATION and no metric reads a currency from it. `formatMetric` has its
   * own format context, and the currency belongs there.
   */
  currency: string;
  /** Whether the body — inputs, headline metrics, the rule table — is hidden. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { pending, run } = useAction();
  const [name, setName] = useState(book.name);
  const [risk, setRisk] = useState(
    book.default_risk_pct != null ? String(book.default_risk_pct) : "",
  );
  const [aPlus, setAPlus] = useState(book.a_plus_criteria ?? "");

  // Memoized, and not as a micro-optimisation. The old scorecard held no state
  // and never re-rendered, so recomputing on every render cost nothing. This
  // card owns three text inputs, so it re-renders on every KEYSTROKE — and
  // `ruleScorecard` walks every trade for every rule.
  const scores = useMemo(
    () => ruleScorecard(trades, lookup.rules, computeCtx, book.rules.map((r) => r.id)),
    [trades, lookup, computeCtx, book.rules],
  );
  const scoreById = useMemo(
    () => new Map(scores.map((s) => [s.ruleId, s])),
    [scores],
  );

  // Every category, not only the populated ones: an empty No-trade section is
  // the prompt to write the rule that is missing, and it is the one most books
  // never get around to. `rulesByCategory` does the bucketing and drops empties;
  // mapping over `RULE_CATEGORIES` puts them back.
  const sections = useMemo(() => {
    const byCategory = rulesByCategory(book.rules);
    return RULE_CATEGORIES.map((category) => ({
      category,
      rules: byCategory.find((g) => g.category === category)?.rules ?? [],
    }));
  }, [book.rules]);

  const n = row?.n ?? 0;

  // Compact enough to read on a COLLAPSED card, so folding a card never means
  // losing the one thing worth scanning ten of these for. Reads the same `row`
  // `HEADER_METRICS` renders below — not a second computation — but hand-formats
  // it rather than routing through `formatMetric`: that formatter is tuned for
  // the full-precision "62.0%" / "1.8" shape every other screen wants, and a
  // dense one-line summary asks for the opposite (a whole-number percent, a
  // ratio that keeps its trailing zero) — a second job, not a bug in the first.
  const winRatePct = row?.values.win_rate;
  const pf = row?.values.profit_factor;
  const summary =
    n > 0 && winRatePct != null && pf != null
      ? `${Math.round(winRatePct)}% win · ${Number.isFinite(pf) ? pf.toFixed(2) : "∞"} PF`
      : null;

  return (
    <Card className={cn(!book.is_active && "opacity-60")}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* The one control that always toggles the SAME thing regardless of
              what else is in the header — kept first in this group, ahead of
              archive/delete, so it is never one misclick away from a
              destructive action. */}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand playbook" : "Collapse playbook"}
            aria-expanded={!collapsed}
          >
            <ChevronDown
              className={cn("size-4 transition-transform", !collapsed && "rotate-180")}
            />
          </Button>

          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name !== book.name)
                run(() => updatePlaybook(book.id, { name }));
            }}
            className="h-9 w-56 font-semibold"
            aria-label="Playbook name"
            disabled={pending}
          />
          {/* Not decoration: the input above has no accessible name of its own
              once it is empty, and this is what the card is findable by. */}
          <CardTitle className="sr-only">{book.name}</CardTitle>

          <span className="text-sm text-muted-foreground">
            {n} {n === 1 ? "trade" : "trades"} · {book.rules.length}{" "}
            {book.rules.length === 1 ? "rule" : "rules"}
            {summary && <> · {summary}</>}
          </span>

          {n > 0 && n < RULE_SAMPLE.MIN && (
            <Badge variant="secondary">counts only</Badge>
          )}
          {n >= RULE_SAMPLE.MIN && n < RULE_SAMPLE.USABLE && (
            <Badge variant="secondary">provisional</Badge>
          )}
          {!book.is_active && <Badge variant="outline">inactive</Badge>}

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={pending}
              onClick={() =>
                run(() => updatePlaybook(book.id, { is_active: !book.is_active }))
              }
              aria-label={book.is_active ? "Deactivate" : "Activate"}
              title={
                book.is_active
                  ? "Remove from the picker on the form. Old trades stay attached to it."
                  : "Restore to the picker on the form."
              }
            >
              {book.is_active ? (
                <Archive className="size-3.5" />
              ) : (
                <ArchiveRestore className="size-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={pending}
              onClick={() => run(() => deletePlaybook(book.id))}
              aria-label="Delete playbook"
              title="Only possible while no trade uses it."
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Compute above is never gated on `collapsed` — `scores`, `sections`
          and `summary` all still run. Only the DOM is skipped, for the same
          reason `dashboard.tsx` keeps its own render gate separate from
          compute: re-expanding must not wait on a recompute, and the header
          summary above needs these values whether or not the body is shown. */}
      {!collapsed && (
      <CardContent className="space-y-4">
        {/* The operating model. A playbook that only lists rules does not say
            how much to risk or what earns an A+ — and an A+ grade that changes
            nothing about size or management is decoration. */}
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <div className="space-y-1.5">
            <Label className="text-xs">Default risk %</Label>
            <Input
              value={risk}
              inputMode="decimal"
              placeholder="e.g. 1"
              disabled={pending}
              onChange={(e) => setRisk(e.target.value)}
              onBlur={() => {
                const raw = risk.trim();
                const next = raw === "" ? null : Number(raw);
                if (next !== (book.default_risk_pct ?? null))
                  run(() => updatePlaybook(book.id, { default_risk_pct: next }));
              }}
              className="h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">What earns an A+ here</Label>
            <Input
              value={aPlus}
              placeholder="The conditions that justify full size"
              disabled={pending}
              onChange={(e) => setAPlus(e.target.value)}
              onBlur={() => {
                if (aPlus.trim() !== (book.a_plus_criteria ?? ""))
                  run(() => updatePlaybook(book.id, { a_plus_criteria: aPlus }));
              }}
              className="h-8"
            />
          </div>
        </div>

        {n === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No trade has used this playbook yet. Numbers appear once it does —
            and stay counts, not verdicts, until {RULE_SAMPLE.MIN} observations.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {HEADER_METRICS.map((key) => {
              const m = getMetric(key);
              if (!m) return null;
              return (
                <div key={key}>
                  <dt className="text-xs text-muted-foreground">{m.label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {formatMetric(
                      mkMetric(row?.values[key] ?? null, m.unit, { currency }),
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}

        <div className="overflow-x-auto">
          {/*
            Numbers come SECOND, before the `When` control, and that order is
            the whole reason this table exists.

            Seven columns do not fit the content area at a normal window width,
            so something is always past the right edge — measured, not guessed:
            928 px of table in a 420 px column on this machine. What scrolls off
            is therefore a design decision, not an accident. Putting `When`
            after the statistics means the part still visible is
            "rule → how often, and did keeping it help", which is the question
            the merge was for; `show_when` is a setting touched once and then
            left alone, so it is the right thing to push out of view.
          */}
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b text-xs">
                <th className="py-2 pr-3 text-left font-medium">Rule</th>
                <th className="w-12 py-2 pl-3 text-right font-medium">n</th>
                <th className="w-20 py-2 pl-3 text-right font-medium">Followed</th>
                <th className="w-20 py-2 pl-3 text-right font-medium">Broken</th>
                <th className="w-28 py-2 pl-3 text-right font-medium">Difference</th>
                <th className="w-40 py-2 pl-4 text-left font-medium">When</th>
                <th className="w-40 py-2 pl-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sections.map(({ category, rules }) => (
                <CategorySection
                  key={category}
                  book={book}
                  category={category}
                  rules={rules}
                  library={library}
                  scoreById={scoreById}
                />
              ))}
            </tbody>
          </table>

          {/* Said on the screen, not only in the plan. The alternative — a
              sorted list of rules by win rate — is exactly how a journal
              talks its owner into keeping whichever rule got lucky. */}
          <p className="mt-3 text-xs text-muted-foreground">
            Difference is win % when you kept the rule minus win % when you did
            not — the only comparison that holds the setup constant. It needs{" "}
            {RULE_SAMPLE.MIN} observations on <em>each</em> side, not just
            between them, because a difference cannot be sounder than the weaker
            half of it. Blank when a rule has never been broken. Rules are never
            ranked by result.
          </p>
        </div>
      </CardContent>
      )}
    </Card>
  );
}
