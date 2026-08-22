"use client";

import { useMemo, useState, useTransition } from "react";
import type { ComponentProps, DragEvent, HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  GripVertical,
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
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { moveToIndex } from "@/lib/journal/playbook-order";
import {
  ruleCategoryLabel,
  RULE_CATEGORY_HINTS,
  SHOW_WHEN_LABELS,
  SHOW_WHEN_VALUES,
  rulesByCategory,
  type Playbook,
  type PlaybookRule,
  type RuleCategory,
  type ShowWhen,
} from "@/lib/journal/playbook-types";
import { RuleGroupDialog } from "@/components/journal/rule-group-dialog";
import type { EnrichedTrade } from "@/lib/journal/enriched-trade";
import type { OptionItem } from "@/lib/journal/types";
import {
  deletePlaybookRule,
  deletePlaybookSection,
  linkRule,
  movePlaybookRule,
  movePlaybookSection,
  reorderPlaybookRules,
  reorderPlaybookSections,
  restorePlaybookRule,
  unlinkRule,
  updatePlaybook,
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
  "grid grid-cols-[minmax(10rem,1fr)_3rem_5.5rem_5.5rem_6.5rem_2.25rem] items-center gap-2";

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
 * Reorder-by-dragging for a list of ids.
 *
 * Native HTML5 drag events, no library: the two lists here are short, flat and
 * same-axis, which is the case the native API handles without help. `commit`
 * receives the finished order and is expected to persist it.
 *
 * The pointer path is deliberately NOT the only one. Dragging cannot be done
 * from a keyboard, so both lists keep Move up / Move down in their menus — the
 * handle is the fast way, not the sole way.
 */
function useDragOrder(ids: string[], commit: (ordered: string[]) => void) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  function drop(targetId: string) {
    const from = dragId;
    setDragId(null);
    setOverId(null);
    if (!from) return;
    const next = moveToIndex(ids, from, targetId);
    if (next) commit(next);
  }

  /** Props for the element that RECEIVES a drop — the whole row or card. */
  function target(id: string): DragTargetProps {
    return {
      onDragOver: (e: DragEvent) => {
        if (!dragId) return;
        // Without preventDefault the browser refuses the drop outright.
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (overId !== id) setOverId(id);
      },
      onDragLeave: () => setOverId((cur) => (cur === id ? null : cur)),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        drop(id);
      },
      "data-dragging": dragId === id ? "" : undefined,
      "data-drop-target": overId === id && dragId !== id ? "" : undefined,
    };
  }

  /**
   * Props for the HANDLE that starts a drag.
   *
   * Only the handle is `draggable`, not the row: a draggable row swallows the
   * click that opens a rule for editing, and makes selecting its text a drag.
   *
   * The row is found from the EVENT rather than through a ref. A ref would have
   * to be created in the row and passed down into this function during render,
   * which is exactly what `react-hooks/refs` forbids — and it buys nothing here,
   * since `closest` runs at drag time, when the DOM is settled. Setting the drag
   * image to that row is what makes the whole row follow the cursor instead of a
   * lone six-dot glyph.
   */
  function handle(id: string): DragHandleProps {
    return {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.effectAllowed = "move";
        // Firefox starts no drag at all unless some data is attached.
        e.dataTransfer.setData("text/plain", id);
        const row = (e.currentTarget as HTMLElement).closest<HTMLElement>(
          "[data-drag-row]",
        );
        if (row) e.dataTransfer.setDragImage(row, 16, 16);
        setDragId(id);
      },
      onDragEnd: () => {
        setDragId(null);
        setOverId(null);
      },
    };
  }

  return { target, handle };
}

/** The two data attributes the CSS below keys off, alongside the drop handlers. */
type DragTargetProps = HTMLAttributes<HTMLElement> & {
  "data-dragging"?: string;
  "data-drop-target"?: string;
};

type DragHandleProps = Pick<
  HTMLAttributes<HTMLElement>,
  "onDragStart" | "onDragEnd"
> & { draggable?: boolean };

/** The six-dot grip. Purely a pointer affordance — the menu is the keyboard path. */
function Grip({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      {...props}
      aria-hidden
      title="Drag to reorder"
      className={cn(
        "shrink-0 cursor-grab text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing",
        className,
      )}
    >
      <GripVertical className="size-4" />
    </span>
  );
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
}: {
  rule: PlaybookRule;
  playbookId: string;
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
      <div className="flex min-w-0 items-center gap-1.5">
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
        {rule.is_setup_criterion && (
          <Badge
            variant="secondary"
            className="shrink-0"
            title="Counts toward the setup grade"
          >
            grade
          </Badge>
        )}
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

          {/* Only offered for a rule that shows on every trade: a criterion
              asked just of winners would judge the setup already knowing the
              outcome, and the database refuses that combination outright. */}
          <DropdownMenuCheckboxItem
            checked={rule.is_setup_criterion}
            disabled={retired || rule.show_when !== "always"}
            onCheckedChange={(v) =>
              run(() => updatePlaybookRule(rule.id, { is_setup_criterion: v === true }))
            }
            title={
              rule.show_when !== "always"
                ? "Only a rule that shows on every trade can grade the setup — otherwise it would judge with hindsight."
                : undefined
            }
          >
            Counts toward the setup grade
          </DropdownMenuCheckboxItem>

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
    <div className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2">
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
function CategorySection({
  book,
  category,
  item,
  hint,
  rules,
  library,
  scoreById,
  categories,
  canUp,
  canDown,
  dragTarget,
  dragHandle,
}: {
  book: Playbook;
  category: RuleCategory;
  /**
   * The row behind this heading, absent when the section is no longer on the
   * list but rules are still filed under it. Those cannot be renamed, moved or
   * deleted from here — there is nothing left to edit — but they are still
   * drawn, because hiding rules to tidy a heading is data loss by presentation.
   */
  item: OptionItem | undefined;
  /** The line under the heading: the trader's own, or the built-in fallback. */
  hint: string;
  rules: PlaybookRule[];
  library: PlaybookRule[];
  scoreById: Map<string, RuleScore>;
  categories: readonly OptionItem[];
  canUp: boolean;
  canDown: boolean;
  dragTarget: DragTargetProps;
  dragHandle: DragHandleProps;
}) {
  const { pending, run } = useAction();
  const [dialogOpen, setDialogOpen] = useState(false);
  const linked = new Set(rules.map((r) => r.id));
  const available = library.filter(
    (r) => r.category === category && !linked.has(r.id) && r.deleted_at == null,
  );

  const ruleIds = rules.map((r) => r.id);
  const ruleDrag = useDragOrder(ruleIds, (ordered) =>
    run(() => reorderPlaybookRules(book.id, category, ordered)),
  );

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
        {item && <Grip {...dragHandle} />}
        <h3 className="font-semibold">{ruleCategoryLabel(category, categories)}</h3>

        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}

        {item && (
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
                onSelect={() => run(() => movePlaybookSection(item.id, -1))}
              >
                <ChevronUp className="size-3.5" /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canDown}
                onSelect={() => run(() => movePlaybookSection(item.id, 1))}
              >
                <ChevronDown className="size-3.5" /> Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Hard delete, and it refuses while rules are still filed here —
                  the count comes back in the message, including rules that live
                  only in your other playbooks and so are not on this card at
                  all. */}
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => run(() => deletePlaybookSection(item.id))}
                title="Deletes the section. Only possible once no rule is left in it."
              >
                <Trash2 className="size-3.5" /> Delete section
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div>
        {rules.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            No rules here yet.
          </p>
        ) : (
          rules.map((rule, i) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              playbookId={book.id}
              score={scoreById.get(rule.id)}
              canUp={i > 0}
              canDown={i < rules.length - 1}
              dragTarget={ruleDrag.target(rule.id)}
              dragHandle={ruleDrag.handle(rule.id)}
            />
          ))
        )}

        {item && (
          <Button
            variant="ghost"
            size="sm"
            className="m-1 h-8 text-muted-foreground"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="size-3.5" /> Add rule
          </Button>
        )}
        {available.length > 0 && <ReuseRow book={book} available={available} />}
      </div>

      {item && (
        <RuleGroupDialog
          book={book}
          section={{ item, category, rules, hint }}
          open={dialogOpen}
          // Keyed on the open flag so each opening starts from the section as it
          // is NOW. The dialog seeds its draft in `useState` initialisers, which
          // a re-render alone would not revisit — so without this, a group
          // edited, saved and reopened would show the draft it had last time.
          key={dialogOpen ? "open" : "closed"}
          onOpenChange={setDialogOpen}
        />
      )}
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
  categories,
}: {
  book: Playbook;
  library: PlaybookRule[];
  trades: EnrichedTrade[];
  lookup: PlaybookLookup;
  computeCtx: ComputeContext;
  /** The trader's own playbook sections, in their order, from `rule_category`. */
  categories: readonly OptionItem[];
}) {
  const { pending, run } = useAction();
  const [addOpen, setAddOpen] = useState(false);
  const [risk, setRisk] = useState(
    book.default_risk_pct != null ? String(book.default_risk_pct) : "",
  );
  const [aPlus, setAPlus] = useState(book.a_plus_criteria ?? "");

  const scores = useMemo(
    () => ruleScorecard(trades, lookup.rules, computeCtx, book.rules.map((r) => r.id)),
    [trades, lookup, computeCtx, book.rules],
  );
  const scoreById = useMemo(
    () => new Map(scores.map((s) => [s.ruleId, s])),
    [scores],
  );

  /**
   * Every section the trader HAS, populated or not — plus any that a rule still
   * uses after the section left the list.
   *
   * An empty section is a prompt to write the rule that is missing, which is why
   * empties are put back after `rulesByCategory` drops them.
   *
   * `canUp` / `canDown` are scoped to the LIST, not to this array: the appended
   * orphans have no row to reorder, so the last listed section is the last one
   * that can move down even when orphans are drawn below it.
   *
   * `hint` prefers the section's own description and falls back to the built-in
   * text for the values this repo seeds — so a heading nobody has edited still
   * reads the way it always did, and one that HAS been edited never has the
   * constant put back over it.
   */
  const sections = useMemo(() => {
    const keys = categories.map((c) => c.value);
    const byCategory = rulesByCategory(book.rules, keys);
    const all = [...keys];
    for (const g of byCategory) if (!all.includes(g.category)) all.push(g.category);
    const itemOf = new Map(categories.map((c) => [c.value, c]));
    return all.map((category, i) => {
      const item = itemOf.get(category);
      return {
        category,
        item,
        hint: item?.description ?? RULE_CATEGORY_HINTS[category] ?? "",
        canUp: i > 0,
        canDown: i < categories.length - 1,
        rules: byCategory.find((g) => g.category === category)?.rules ?? [],
      };
    });
  }, [book.rules, categories]);

  // Only the sections that still have an option row can be reordered — an
  // orphan heading has no ordinal to write.
  const sectionDrag = useDragOrder(
    sections.flatMap((s) => (s.item ? [s.item.id] : [])),
    (ordered) => run(() => reorderPlaybookSections(ordered)),
  );

  return (
    <div className="space-y-4">
      {/* The operating model. A playbook that only lists rules does not say how
          much to risk or what earns an A+ — and an A+ grade that changes
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

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          A group is a heading with its rules under it. Drag the grip to reorder
          — groups, or rules inside one.
        </p>
        <Button size="sm" className="h-9 shrink-0" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add rule group
        </Button>
      </div>

      {sections.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          No groups yet. Add one above — name it after a decision you actually
          make, then write the rules under it.
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
            <span className="text-right">n</span>
            <span className="text-right">Followed</span>
            <span className="text-right">Broken</span>
            <span className="text-right">Difference</span>
            <span />
          </div>

          <div className="space-y-3">
            {sections.map(({ category, item, hint, rules, canUp, canDown }) => (
              <CategorySection
                key={category}
                book={book}
                category={category}
                item={item}
                hint={hint}
                rules={rules}
                library={library}
                categories={categories}
                scoreById={scoreById}
                canUp={canUp}
                canDown={canDown}
                dragTarget={item ? sectionDrag.target(item.id) : {}}
                dragHandle={item ? sectionDrag.handle(item.id) : {}}
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
