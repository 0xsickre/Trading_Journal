"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  Library,
  Lock,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  Unlink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { pnlClass } from "@/lib/journal/format";
import { formatMetric, metric as mkMetric } from "@/lib/journal/units";
// Aliased on the way in. `units.ts` exports a DIFFERENT type by the same name —
// that one is about FORMATTING (currency, equity base), this one about
// COMPUTING (pnl basis, breakeven band, rule answers). Both are legitimate and
// neither should borrow the other's fields, so the collision is defused here
// rather than resolved by picking a winner.
import type { MetricContext as ComputeContext } from "@/lib/journal/reports/metrics";
import {
  RULE_SAMPLE,
  type PlaybookLookup,
} from "@/lib/journal/reports/playbook-dimensions";
import { ruleScorecard, type RuleScore } from "@/lib/journal/reports/rule-scorecard";
import {
  Grip,
  useDragOrder,
  type DragHandleProps,
  type DragTargetProps,
} from "@/components/journal/drag-order";
import {
  SHOW_WHEN_LABELS,
  SHOW_WHEN_VALUES,
  rulesBySection,
  type LinkedRule,
  type Playbook,
  type PlaybookRule,
  type PlaybookSection,
  type ShowWhen,
} from "@/lib/journal/playbook-types";
import { RuleGroupDialog } from "@/components/journal/rule-group-dialog";
import { RuleLibraryDialog } from "@/components/journal/rule-library-dialog";
import { SectionDeleteDialog } from "@/components/journal/section-delete-dialog";
import type { EnrichedTrade } from "@/lib/journal/enriched-trade";
import {
  deletePlaybookRule,
  movePlaybookRule,
  movePlaybookSection,
  moveRuleToSection,
  reorderPlaybookRules,
  reorderPlaybookSections,
  restorePlaybookRule,
  setRuleCriterion,
  unlinkRule,
  updatePlaybookRule,
} from "@/app/(app)/settings/playbook-actions";

/**
 * The column layout, shared by the header strip and every rule row in every
 * section card.
 *
 * One string, so a number under "Followed" is actually under "Followed" no
 * matter which card it sits in — the cards are separate DOM subtrees, so
 * nothing else keeps them aligned. This replaces the seven-column `<table>`
 * that forced a 68rem minimum width and put "When" permanently past the right
 * edge; the controls that used to occupy those columns now live in the row's
 * own menu, and what is left fits without a horizontal scrollbar.
 */
const RULE_GRID =
  "grid grid-cols-[minmax(10rem,1fr)_4rem_5.5rem_5.5rem_6.5rem_2.25rem] items-center gap-2";

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
 * (R) sits on a second line under the win rate rather than in a column of its
 * own — it qualifies that number, and reads fine stacked under it.
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
    // The bare count, with the reason in the title. It used to read `n=14`,
    // which is statistician's shorthand for a screen nobody reads as a paper.
    return (
      <span
        className="text-muted-foreground"
        title={`Answered ${n} ${n === 1 ? "time" : "times"} — under ${RULE_SAMPLE.MIN}, too few for a win rate`}
      >
        {n}
      </span>
    );
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
 * The difference cell.
 *
 * Three outcomes, and they must not collapse into one dash: a gap; "one of the
 * two sides is too thin to compare"; and "there is no contrast here at all" — a
 * rule never broken, or never answered. The last is an honest absence rather
 * than a missing measurement, so it gets the dash and the other gets words.
 *
 * The "too few" case names the THINNER side's count against the floor — that is
 * the one holding the whole comparison back.
 */
function Difference({ score }: { score: RuleScore | undefined }) {
  if (score?.gapPp != null) {
    return (
      <span className={pnlClass(score.gapPp)}>
        {score.gapPp > 0 ? "+" : ""}
        {score.gapPp.toFixed(0)} pp
      </span>
    );
  }
  if (score && score.followed.n > 0 && score.broken.n > 0) {
    return (
      <span className="text-xs text-muted-foreground">
        too few ({Math.min(score.followed.n, score.broken.n)}/{RULE_SAMPLE.MIN})
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

/**
 * One rule: its text, its evidence, and — behind the menu — everything you can
 * do to it.
 *
 * The text is PLAIN until you click it. Every rule used to be a permanently
 * open `<Input>`, which turned a ten-rule playbook into ten boxes stacked down
 * the page and made the numbers beside them hard to read at a glance. A
 * checklist is read far more often than it is edited, so reading is what the
 * default state serves.
 *
 * `show_when`, the grade toggle, reordering, unlink and delete all moved into
 * the row menu. They were four buttons, a select and a checkbox competing with
 * the statistics for the same horizontal space — and `show_when` in particular
 * is set once and then left alone, which is not something that earns a
 * permanent column.
 */
function RuleRow({
  rule,
  playbookId,
  score,
  canUp,
  canDown,
  dragTarget,
  dragHandle,
  sections,
}: {
  rule: LinkedRule;
  playbookId: string;
  /** Every section of THIS book, for the "move to" submenu. */
  sections: readonly PlaybookSection[];
  score: RuleScore | undefined;
  canUp: boolean;
  canDown: boolean;
  dragTarget: DragTargetProps;
  dragHandle: DragHandleProps;
}) {
  const { pending, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(rule.text);
  const locked = rule.answerCount > 0;
  const retired = rule.deleted_at != null;

  function commit() {
    setEditing(false);
    if (text.trim() && text !== rule.text) {
      run(() => updatePlaybookRule(rule.id, { text }));
    } else {
      setText(rule.text);
    }
  }

  return (
    <div
      data-rule-row
      data-drag-row
      {...dragTarget}
      className={cn(
        RULE_GRID,
        "border-b px-3 py-2 text-sm last:border-b-0",
        retired && "opacity-60",
        "data-[dragging]:opacity-40",
        "data-[drop-target]:bg-accent/60",
      )}
    >
      {/* Indented inside the FIRST CELL rather than by padding the row, which
          is what keeps every number under the header it belongs to: padding the
          row would shrink its content box and drag the fixed-width columns left
          of the strip above. The step is only wide enough to read as "under the
          heading", since a rule is a child of its group, not a sibling. */}
      <div className="flex min-w-0 items-center gap-1.5 ps-5">
        <Grip {...dragHandle} />
        {editing ? (
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setText(rule.text);
                setEditing(false);
              }
            }}
            className="h-7"
            aria-label="Rule text"
            autoFocus
            disabled={pending}
          />
        ) : (
          <button
            type="button"
            // Click-to-edit, with the same action also in the menu — the menu is
            // what makes it discoverable, this is what makes it quick.
            onClick={() => !retired && setEditing(true)}
            disabled={retired}
            className={cn(
              "min-w-0 truncate rounded px-1 py-0.5 text-left",
              !retired && "hover:bg-accent/60",
            )}
            title={rule.text}
          >
            {rule.text}
          </button>
        )}
        {locked && (
          <Badge
            variant="outline"
            className="shrink-0 gap-1"
            title={`Answered on ${rule.answerCount} trades`}
          >
            <Lock className="size-3" /> {rule.answerCount}
          </Badge>
        )}
        {retired && (
          <Badge variant="outline" className="shrink-0">
            archived
          </Badge>
        )}
        {/* On/off in place, not a checkbox two clicks deep in the menu. Whether
            a rule grades the setup is a property worth SEEING down the list —
            grey says "not counted", green says "counted" — and the thing you
            look at should be the thing you press.

            Offered only for a rule that shows on every trade: a criterion asked
            just of winners would judge the setup already knowing the outcome,
            and the database refuses that combination outright.

            Per PLAYBOOK. The flag lives on the link, so the same rule can decide
            the grade in a swing book and count as ordinary process in a scalp
            one — which is what `criteriaByPlaybook` in the reports lookup was
            already computing, from a flag that could not vary. */}
        <button
          type="button"
          onClick={() =>
            run(() => setRuleCriterion(playbookId, rule.id, !rule.is_setup_criterion))
          }
          disabled={pending || retired || rule.show_when !== "always"}
          aria-pressed={rule.is_setup_criterion}
          aria-label="Counts toward the setup grade"
          title={
            rule.show_when !== "always"
              ? "Only a rule that shows on every trade can grade the setup — otherwise it would judge with hindsight."
              : rule.is_setup_criterion
                ? "Counts toward the setup grade. Click to stop counting it."
                : "Not counted toward the setup grade. Click to count it."
          }
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
            rule.is_setup_criterion
              ? "border-[var(--profit)]/40 bg-[var(--profit)]/15 text-[var(--profit)]"
              : "border-transparent bg-muted text-muted-foreground",
            !retired && rule.show_when === "always" && "hover:brightness-125",
          )}
        >
          grade
        </button>
        {rule.show_when !== "always" && (
          <Badge variant="secondary" className="shrink-0">
            {SHOW_WHEN_LABELS[rule.show_when]}
          </Badge>
        )}
      </div>

      <span className="text-right tabular-nums text-muted-foreground">
        {score?.n ?? 0}
      </span>
      <span className="text-right tabular-nums">
        <Side
          n={score?.followed.n ?? 0}
          winRate={score?.followed.winRate ?? null}
          r={score?.followed.expectancy ?? null}
        />
      </span>
      <span className="text-right tabular-nums">
        <Side
          n={score?.broken.n ?? 0}
          winRate={score?.broken.winRate ?? null}
          r={score?.broken.expectancy ?? null}
        />
      </span>
      <span className="text-right tabular-nums">
        <Difference score={score} />
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={pending}
            aria-label="Rule actions"
          >
            <MoreVertical className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem disabled={retired} onSelect={() => setEditing(true)}>
            <Pencil className="size-3.5" /> Edit text
          </DropdownMenuItem>

          {/* A submenu rather than a `Select`: a select's own popover inside an
              open menu fights it for focus, and radio items say the same thing
              with the current value already ticked. */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              disabled={locked || retired}
              title={
                locked
                  ? `Locked — the rule is already answered on ${rule.answerCount} trades. Editing it would retroactively change the statistics.`
                  : undefined
              }
            >
              When it shows
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={rule.show_when}
                onValueChange={(v) =>
                  run(() => updatePlaybookRule(rule.id, { show_when: v as ShowWhen }))
                }
              >
                {SHOW_WHEN_VALUES.map((v) => (
                  <DropdownMenuRadioItem key={v} value={v}>
                    {SHOW_WHEN_LABELS[v]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* No "counts toward the grade" item here: it is the `grade` pill on
              the row itself, which is both the state and the switch. */}
          <DropdownMenuSeparator />

          {/* The keyboard path for what the grip does with a pointer. Scoped to
              the category: the first Entry rule has no "Move up" even though
              rules of other categories precede it in the flat link order —
              right, because the screen groups by section. */}
          <DropdownMenuItem
            disabled={!canUp}
            onSelect={() => run(() => movePlaybookRule(playbookId, rule.id, -1))}
          >
            <ChevronUp className="size-3.5" /> Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canDown}
            onSelect={() => run(() => movePlaybookRule(playbookId, rule.id, 1))}
          >
            <ChevronDown className="size-3.5" /> Move down
          </DropdownMenuItem>

          {/* Refiles it IN THIS BOOK ONLY, which is the move the old schema
              could not express: the section was a property of the rule, so
              moving it here moved it in every playbook at once. */}
          {sections.length > 1 && !retired && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to section</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={rule.section_id}
                  onValueChange={(v) =>
                    run(() => moveRuleToSection(playbookId, rule.id, v))
                  }
                >
                  {sections.map((s) => (
                    <DropdownMenuRadioItem key={s.id} value={s.id}>
                      {s.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          <DropdownMenuSeparator />

          {/* Unlink ≠ delete, and the difference is the whole reason the library
              exists. This takes the rule OUT OF THIS PLAYBOOK: the rule
              survives, every answer it ever collected survives, and any other
              playbook linking it is untouched. */}
          {!retired && (
            <DropdownMenuItem
              onSelect={() => run(() => unlinkRule(playbookId, rule.id))}
              title="Removes it from THIS playbook only. The rule and its statistics stay."
            >
              <Unlink className="size-3.5" /> Remove from this playbook
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant={retired ? "default" : "destructive"}
            onSelect={() =>
              run(() =>
                retired ? restorePlaybookRule(rule.id) : deletePlaybookRule(rule.id),
              )
            }
            title={
              retired
                ? "Restore to the checklist."
                : locked
                  ? "Archived across every playbook. Statistics on past trades stay untouched."
                  : "Deleted from the library — no trade has ever answered it."
            }
          >
            {retired ? (
              <>
                <ArchiveRestore className="size-3.5" /> Restore rule
              </>
            ) : locked ? (
              <>
                <Archive className="size-3.5" /> Archive rule
              </>
            ) : (
              <>
                <Trash2 className="size-3.5" /> Delete rule
              </>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * One section: a card holding its rules.
 *
 * A card per section, rather than headings inside one long table, is what makes
 * "Entry" and "Exit" read as two separate checklists instead of two labels in a
 * list of rows.
 *
 * Adding a rule opens the group dialog rather than a box under the last row.
 * The rule most likely to be written badly is the one that repeats a rule
 * already in the group, and the dialog is the only view that puts the existing
 * ones in front of you while you type the new one.
 */
function SectionCard({
  book,
  section,
  rules,
  library,
  scoreById,
  canUp,
  canDown,
  dragTarget,
  dragHandle,
}: {
  book: Playbook;
  /**
   * The heading itself — a row of THIS playbook.
   *
   * Never optional any more. It used to be, because a section was a value in a
   * shared list and a rule could go on pointing at one that had been archived
   * or deleted: the card drew with no row behind it and no way to rename, move
   * or delete it. The link's FK cascades now, so a rule cannot outlive its
   * heading and every card has something to edit.
   */
  section: PlaybookSection;
  rules: LinkedRule[];
  library: PlaybookRule[];
  scoreById: Map<string, RuleScore>;
  canUp: boolean;
  canDown: boolean;
  dragTarget: DragTargetProps;
  dragHandle: DragHandleProps;
}) {
  const { pending, run } = useAction();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Everything the trader has written that this BOOK does not already use —
  // NOT filtered by section. The old filter was `rule.category === category`,
  // so the library could only ever offer a rule back into the heading it was
  // already filed under, which is the restriction being removed: any rule into
  // any section.
  const linkedInBook = useMemo(
    () => new Set(book.rules.map((r) => r.id)),
    [book.rules],
  );
  const available = useMemo(
    () => library.filter((r) => !linkedInBook.has(r.id) && r.deleted_at == null),
    [library, linkedInBook],
  );

  const ruleIds = rules.map((r) => r.id);
  const ruleDrag = useDragOrder(ruleIds, (ordered) =>
    reorderPlaybookRules(book.id, section.id, ordered),
  );
  // Rendered from the drag order, not from the prop: while a drag is in flight
  // that order is the preview, which is what makes the rows move under the
  // pointer instead of after the drop.
  const orderedRules = useMemo(() => {
    const byId = new Map(rules.map((r) => [r.id, r]));
    return ruleDrag.order.flatMap((id) => {
      const r = byId.get(id);
      return r ? [r] : [];
    });
  }, [rules, ruleDrag.order]);

  return (
    // Plain divs inside the Card rather than CardHeader/CardContent: those carry
    // a `py-6` and a `[.border-b]:pb-6` sized for a page-level card, and a list
    // of section rules wants a tighter header than a dashboard panel.
    <Card
      data-drag-row
      {...dragTarget}
      className={cn(
        "gap-0 overflow-hidden py-0",
        "data-[dragging]:opacity-40",
        "data-[drop-target]:ring-2 data-[drop-target]:ring-primary/60",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
        <Grip {...dragHandle} />
        <h3 className="font-semibold">{section.label}</h3>

        {section.description && (
          <span className="text-xs text-muted-foreground">{section.description}</span>
        )}

        <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7"
                disabled={pending}
                aria-label="Section actions"
              >
                <MoreVertical className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
                <Pencil className="size-3.5" /> Edit rule group
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canUp}
                onSelect={() => run(() => movePlaybookSection(book.id, section.id, -1))}
              >
                <ChevronUp className="size-3.5" /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canDown}
                onSelect={() => run(() => movePlaybookSection(book.id, section.id, 1))}
              >
                <ChevronDown className="size-3.5" /> Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Never refused. The dialog says how many rules leave THIS
                  playbook and that they stay in the library — which is what the
                  cascade does: it drops links, not rules. It used to refuse
                  whenever any rule in the account sat under the same heading,
                  including ones in other playbooks that were not on this card
                  at all. */}
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-3.5" /> Delete section
              </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div>
        {orderedRules.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            No rules here yet.
          </p>
        ) : (
          orderedRules.map((rule, i) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              playbookId={book.id}
              sections={book.sections}
              score={scoreById.get(rule.id)}
              canUp={i > 0}
              canDown={i < orderedRules.length - 1}
              dragTarget={ruleDrag.target(rule.id)}
              dragHandle={ruleDrag.handle(rule.id)}
            />
          ))
        )}

        <div className="flex flex-wrap gap-1 p-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="size-3.5" /> Add rule
          </Button>
          {/* A dialog rather than the row of buttons this used to be. That row
              listed only the library rules already filed under this heading,
              which kept it short — and was exactly the restriction being
              removed. The unfiltered list is long enough to want a search box. */}
          {available.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground"
              onClick={() => setLibraryOpen(true)}
              title="Link a rule you have already written. It keeps its id, so its statistics keep accumulating under it."
            >
              <Library className="size-3.5" /> Reuse a rule ({available.length})
            </Button>
          )}
        </div>
      </div>

      <RuleGroupDialog
        book={book}
        section={section}
        rules={rules}
        open={dialogOpen}
        // Keyed on the open flag so each opening starts from the section as it
        // is NOW. The dialog seeds its draft in `useState` initialisers, which
        // a re-render alone would not revisit — so without this, a group
        // edited, saved and reopened would show the draft it had last time.
        key={dialogOpen ? "open" : "closed"}
        onOpenChange={setDialogOpen}
      />

      <RuleLibraryDialog
        playbookId={book.id}
        section={section}
        available={available}
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
      />

      <SectionDeleteDialog
        section={section}
        ruleCount={rules.length}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </Card>
  );
}

/**
 * The Rules tab of a playbook's detail page: the operating model (default risk,
 * A+ criteria) and the checklist, section by section.
 */
export function PlaybookRulesEditor({
  book,
  library,
  trades,
  lookup,
  computeCtx,
}: {
  book: Playbook;
  library: PlaybookRule[];
  trades: EnrichedTrade[];
  lookup: PlaybookLookup;
  computeCtx: ComputeContext;
}) {
  // No `useAction` here any more: the drag hook owns its own transition, and
  // nothing else on this level writes.

  const [addOpen, setAddOpen] = useState(false);

  const scores = useMemo(
    () => ruleScorecard(trades, lookup.rules, computeCtx, book.rules.map((r) => r.id)),
    [trades, lookup, computeCtx, book.rules],
  );
  const scoreById = useMemo(
    () => new Map(scores.map((s) => [s.ruleId, s])),
    [scores],
  );

  /**
   * This book's own sections, populated or not.
   *
   * EMPTIES ARE KEPT: an empty section is a prompt to write the rule that is
   * missing. That is only true now that a section exists because someone
   * created it IN THIS BOOK — the list used to be one per account, so a
   * playbook that used one heading still drew every other as a card over
   * nothing, which is what "a new playbook gives me all the categories" was.
   */
  const sections = useMemo(
    () => rulesBySection(book.sections, book.rules),
    [book.sections, book.rules],
  );

  const sectionDrag = useDragOrder(
    useMemo(() => sections.map((s) => s.section.id), [sections]),
    (ordered) => reorderPlaybookSections(book.id, ordered),
  );

  /**
   * The cards in the order they are drawn.
   *
   * Rendered from the drag order rather than the prop, so a card follows the
   * pointer instead of jumping after the drop. No orphan branch any more: the
   * link's FK cascades, so a rule cannot point at a section that is gone.
   */
  const displaySections = useMemo(() => {
    const byId = new Map(sections.map((s) => [s.section.id, s]));
    const ordered = sectionDrag.order.flatMap((id) => {
      const s = byId.get(id);
      return s ? [s] : [];
    });
    return ordered.map((s, i) => ({
      ...s,
      canUp: i > 0,
      canDown: i < ordered.length - 1,
    }));
  }, [sections, sectionDrag.order]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          A group is a heading with its rules under it, in THIS playbook. Drag
          the grip to reorder — groups, or rules inside one.
        </p>
        <Button size="sm" className="h-9 shrink-0" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add rule group
        </Button>
      </div>

      {sections.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Nothing here yet — this playbook starts empty, on purpose. Add a group
          above, name it after a decision you actually make, then write its
          rules or reuse ones you have already written.
        </p>
      ) : (
        <>
          {/* The column strip, once, above the cards — every row in every card
              uses the same `RULE_GRID`, so it labels all of them. */}
          <div
            className={cn(
              RULE_GRID,
              "px-3 text-xs font-medium text-muted-foreground",
            )}
          >
            <span>Rule</span>
            {/* "Trades", not the "n" it used to say. `n` is what a statistician
                calls a sample size and what nobody else calls anything — and
                the quantity really is "how many trades answered this rule". */}
            <span className="text-right">Trades</span>
            <span className="text-right">Followed</span>
            <span className="text-right">Broken</span>
            <span className="text-right">Difference</span>
            <span />
          </div>

          <div className="space-y-3">
            {displaySections.map(({ section, rules, canUp, canDown }) => (
              <SectionCard
                key={section.id}
                book={book}
                section={section}
                rules={rules}
                library={library}
                scoreById={scoreById}
                canUp={canUp}
                canDown={canDown}
                dragTarget={sectionDrag.target(section.id)}
                dragHandle={sectionDrag.handle(section.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* Same remount-on-open reasoning as the per-section dialog above. */}
      <RuleGroupDialog
        book={book}
        open={addOpen}
        key={addOpen ? "add-open" : "add-closed"}
        onOpenChange={setAddOpen}
      />

      {/* Said on the screen, not only in the plan. The alternative — a sorted
          list of rules by win rate — is exactly how a journal talks its owner
          into keeping whichever rule got lucky. */}
      <p className="text-xs text-muted-foreground">
        Difference is win % when you kept the rule minus win % when you did not —
        the only comparison that holds the setup constant. It needs{" "}
        {RULE_SAMPLE.MIN} observations on <em>each</em> side, not just between
        them, because a difference cannot be sounder than the weaker half of it.
        Blank when a rule has never been broken. Rules are never ranked by
        result.
      </p>
    </div>
  );
}
