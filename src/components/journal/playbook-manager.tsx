"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  Lock,
  Plus,
  Trash2,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
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
import {
  addPlaybook,
  addPlaybookRule,
  deletePlaybook,
  deletePlaybookRule,
  linkRule,
  restorePlaybookRule,
  unlinkRule,
  updatePlaybook,
  updatePlaybookRule,
} from "@/app/(app)/settings/playbook-actions";

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

function RuleRow({ rule, playbookId }: { rule: PlaybookRule; playbookId: string }) {
  const { pending, run } = useAction();
  const [text, setText] = useState(rule.text);
  const locked = rule.answerCount > 0;
  const retired = rule.deleted_at != null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5",
        retired && "opacity-60",
      )}
    >
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text.trim() && text !== rule.text)
            run(() => updatePlaybookRule(rule.id, { text }));
        }}
        className="h-8 min-w-0 flex-1"
        disabled={pending || retired}
      />

      <Select
        value={rule.show_when}
        disabled={pending || locked || retired}
        onValueChange={(v) =>
          run(() => updatePlaybookRule(rule.id, { show_when: v as ShowWhen }))
        }
      >
        <SelectTrigger
          className="h-8 w-48"
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

      {locked && (
        <Badge variant="outline" className="gap-1">
          <Lock className="size-3" /> {rule.answerCount}
        </Badge>
      )}
      {retired && <Badge variant="outline">archived</Badge>}

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
    </div>
  );
}

/**
 * One category's rules inside a playbook, plus the two ways to add one.
 *
 * Replaces `GroupBlock`. The difference is not cosmetic: a group was a row this
 * playbook owned, so deleting it cascaded to the rules and their answers. A
 * category is a property of the RULE, so this block owns nothing — it draws the
 * rules linked here and can only link or unlink them.
 */
function CategoryBlock({
  book,
  category,
  rules,
  library,
}: {
  book: Playbook;
  category: RuleCategory;
  rules: PlaybookRule[];
  library: PlaybookRule[];
}) {
  const { pending, run } = useAction();
  const [draft, setDraft] = useState("");
  const [showWhen, setShowWhen] = useState<ShowWhen>("always");

  const linked = new Set(rules.map((r) => r.id));
  // Rules already written in this category and NOT yet in this book. This is
  // the whole point of the library: the second playbook that needs "waited for
  // the sweep" picks it here instead of retyping it into a new id whose
  // statistics would start from zero.
  const available = library.filter(
    (r) => r.category === category && !linked.has(r.id) && r.deleted_at == null,
  );

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
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-baseline gap-2">
        <h4 className="text-sm font-medium">{RULE_CATEGORY_LABELS[category]}</h4>
        <span className="text-xs text-muted-foreground">
          {RULE_CATEGORY_HINTS[category]}
        </span>
      </div>

      {rules.map((rule) => (
        <RuleRow key={rule.id} rule={rule} playbookId={book.id} />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addRule();
          }}
          placeholder="New rule, e.g. Wait for the sweep, then MSS"
          className="h-8 min-w-0 flex-1"
          disabled={pending}
        />
        <Select value={showWhen} onValueChange={(v) => setShowWhen(v as ShowWhen)}>
          <SelectTrigger className="h-8 w-48">
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

      {available.length > 0 && (
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
      )}
    </div>
  );
}

function PlaybookCard({
  book,
  library,
}: {
  book: Playbook;
  library: PlaybookRule[];
}) {
  const { pending, run } = useAction();
  const [name, setName] = useState(book.name);
  const [risk, setRisk] = useState(
    book.default_risk_pct != null ? String(book.default_risk_pct) : "",
  );
  const [aPlus, setAPlus] = useState(book.a_plus_criteria ?? "");
  const ruleCount = book.rules.length;
  const byCategory = rulesByCategory(book.rules);
  // Every category is offered, not only the populated ones — an empty "No-trade"
  // section is the prompt to write the rule that is missing, and it is the one
  // most books never get around to.
  const sections = RULE_CATEGORIES.map((category) => ({
    category,
    rules: byCategory.find((g) => g.category === category)?.rules ?? [],
  }));

  return (
    <Card className={cn(!book.is_active && "opacity-60")}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name !== book.name)
                run(() => updatePlaybook(book.id, { name }));
            }}
            className="h-9 w-56 font-semibold"
            disabled={pending}
          />
          <CardTitle className="sr-only">{book.name}</CardTitle>
          <span className="text-xs text-muted-foreground">
            {ruleCount} {ruleCount === 1 ? "rule" : "rules"}
          </span>
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
      <CardContent className="space-y-3">
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
                  run(() =>
                    updatePlaybook(book.id, { default_risk_pct: next }),
                  );
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
                  run(() =>
                    updatePlaybook(book.id, { a_plus_criteria: aPlus }),
                  );
              }}
              className="h-8"
            />
          </div>
        </div>

        {sections.map(({ category, rules }) => (
          <CategoryBlock
            key={category}
            book={book}
            category={category}
            rules={rules}
            library={library}
          />
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Playbook CRUD.
 *
 * Two rules run through the whole screen, and both exist so that editing
 * configuration can never rewrite history:
 *
 *   - `show_when` is locked the moment a rule has been answered on any trade.
 *     Its follow rate is measured against the population it applies to, so
 *     flipping it afterwards would change the denominator under answers already
 *     recorded.
 *   - Deleting an answered rule archives it instead. The checklist stops
 *     offering it; the statistics keep every observation it earned.
 */
export function PlaybookManager({
  playbooks,
  library = [],
}: {
  playbooks: Playbook[];
  /** Every rule the user has written, so an existing one can be re-linked. */
  library?: PlaybookRule[];
}) {
  const { pending, run } = useAction();
  const [draft, setDraft] = useState("");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Rules are a library: written once, linked into any number of playbooks,
        and keeping one set of statistics wherever they are used. Removing a rule
        from a playbook is not deleting it.
      </p>

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim())
              run(async () => {
                const res = await addPlaybook(draft);
                if (res.ok) setDraft("");
                return res;
              });
          }}
          placeholder="New playbook, e.g. London Reversal"
          className="h-9 w-64"
          disabled={pending}
        />
        <Button
          size="sm"
          className="h-9"
          disabled={pending || !draft.trim()}
          onClick={() =>
            run(async () => {
              const res = await addPlaybook(draft);
              if (res.ok) setDraft("");
              return res;
            })
          }
        >
          <Plus className="size-4" /> Add playbook
        </Button>
      </div>

      {playbooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No playbook yet.</p>
      ) : (
        playbooks.map((book) => (
          <PlaybookCard key={book.id} book={book} library={library} />
        ))
      )}
    </div>
  );
}
