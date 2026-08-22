"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SHOW_WHEN_LABELS,
  SHOW_WHEN_VALUES,
  type Playbook,
  type PlaybookRule,
  type RuleCategory,
  type ShowWhen,
} from "@/lib/journal/playbook-types";
import type { OptionItem } from "@/lib/journal/types";
import {
  addPlaybookRule,
  addPlaybookSection,
  unlinkRule,
  updatePlaybookRule,
  updatePlaybookSection,
} from "@/app/(app)/settings/playbook-actions";

/**
 * One row in the dialog's draft.
 *
 * `ruleId` is what separates the two halves of the save: null means the row was
 * typed here and has to be created, non-null means it already exists and is
 * only edited or removed. `original` is kept so an untouched row produces no
 * write at all — a Save that reissued every rule would bump `updated_at` on
 * rules nobody edited, and would try to resend `show_when` on locked ones.
 */
type DraftRule = {
  /** Stable across re-renders so React does not remount an input mid-type. */
  key: string;
  ruleId: string | null;
  text: string;
  showWhen: ShowWhen;
  /** Answered on at least one trade: `show_when` is frozen, per the DB trigger. */
  locked: boolean;
  original: { text: string; showWhen: ShowWhen } | null;
};

function draftFrom(rule: PlaybookRule): DraftRule {
  return {
    key: rule.id,
    ruleId: rule.id,
    text: rule.text,
    showWhen: rule.show_when,
    locked: rule.answerCount > 0,
    original: { text: rule.text, showWhen: rule.show_when },
  };
}

export type RuleGroupSection = {
  item: OptionItem;
  category: RuleCategory;
  /** Every rule of this section that this playbook links, in display order. */
  rules: PlaybookRule[];
  /**
   * The line currently shown under the heading, whether it comes from the
   * item's own `description` or from the built-in hint for a seeded value.
   * Seeding the field with the built-in text is what lets a trader edit that
   * sentence instead of only being able to add one where there was none.
   */
  hint: string;
};

/**
 * Name a group and write its rules in one place.
 *
 * The same dialog does both jobs, because they are the same form: "Add rule
 * group" opens it empty with one blank rule, "Edit rule group" opens it filled
 * with what the section already holds. Adding a rule to an existing group goes
 * through here too — seeing the four rules already written is what stops the
 * fifth from repeating one of them, which an isolated "new rule" box beneath
 * the list cannot do.
 *
 * Everything is a DRAFT until Save. Nothing is written on keystroke, unlike the
 * rows on the card behind it, so Cancel really does discard — including a rule
 * removed with ✕, which is why removal here is deliberately not a delete (see
 * `save`).
 */
export function RuleGroupDialog({
  book,
  section,
  open,
  onOpenChange,
}: {
  book: Playbook;
  /** The section to edit. Absent means this creates a new one. */
  section?: RuleGroupSection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const idPrefix = useId();
  const [seq, setSeq] = useState(0);

  const [name, setName] = useState(section?.item.label ?? "");
  const [hint, setHint] = useState(section?.hint ?? "");
  const [rules, setRules] = useState<DraftRule[]>(() =>
    section ? section.rules.map(draftFrom) : [blankRule(`${idPrefix}-0`)],
  );
  /** Existing rules the trader removed with ✕ — unlinked on Save, not before. */
  const [removed, setRemoved] = useState<string[]>([]);

  function blankRule(key: string): DraftRule {
    return {
      key,
      ruleId: null,
      text: "",
      showWhen: "always",
      locked: false,
      original: null,
    };
  }

  function addRow() {
    const next = seq + 1;
    setSeq(next);
    setRules((rs) => [...rs, blankRule(`${idPrefix}-${next}`)]);
  }

  function patchRow(key: string, patch: Partial<DraftRule>) {
    setRules((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(row: DraftRule) {
    setRules((rs) => rs.filter((r) => r.key !== row.key));
    if (row.ruleId) setRemoved((ids) => [...ids, row.ruleId!]);
  }

  /**
   * Write the draft.
   *
   * Sequential, not `Promise.all`, and that is load-bearing for the new rules:
   * `linkRule` assigns `max(sort_order) + 1` through a read-then-write, so two
   * links created in parallel can claim the same ordinal and land in whatever
   * order the id tiebreak gives — which is not the order they were typed in.
   *
   * A removed rule is UNLINKED, never deleted. The rule keeps its id, its text
   * and every answer ever recorded against it, and any other playbook using it
   * is untouched; this dialog only decides what THIS playbook's checklist
   * contains. Retiring a rule everywhere is a different act, and it stays on the
   * row menu where its consequences are spelled out.
   *
   * The first failure stops the run and is reported as itself. Earlier writes
   * are NOT rolled back — there is no transaction across server actions — so the
   * dialog stays open over refreshed data, showing exactly how far it got rather
   * than claiming a success it cannot vouch for.
   */
  function save() {
    const label = name.trim();
    if (!label) return;

    start(async () => {
      let category: string;
      const description = hint.trim();

      if (section) {
        category = section.category;
        const patch: { label?: string; description?: string | null } = {};
        if (label !== section.item.label) patch.label = label;
        // Compared against what the field was SEEDED with, not against
        // `item.description`: for a seeded section those differ — the field
        // starts holding the built-in hint while the column is still null — and
        // comparing to the column would write that constant into the database
        // the first time the dialog was opened and saved with nothing touched.
        // `|| null`, not the empty string: null is what makes the built-in hint
        // reappear for a seeded section, so "I deleted the sentence" has to
        // reach the database as an absence. The action normalises "" the same
        // way, but the wire should say what it means.
        if (description !== section.hint.trim())
          patch.description = description || null;
        if (Object.keys(patch).length > 0) {
          const res = await updatePlaybookSection(section.item.id, patch);
          if (!res.ok) return fail(res.error);
        }
      } else {
        const res = await addPlaybookSection(label);
        if (!res.ok) return fail(res.error);
        category = res.value;
        if (description) {
          const described = await updatePlaybookSection(res.id, { description });
          if (!described.ok) return fail(described.error);
        }
      }

      for (const id of removed) {
        const res = await unlinkRule(book.id, id);
        if (!res.ok) return fail(res.error);
      }

      for (const row of rules) {
        const text = row.text.trim();
        if (!text) continue;

        if (row.ruleId) {
          const patch: { text?: string; show_when?: ShowWhen } = {};
          if (text !== row.original?.text) patch.text = text;
          // Never sent for a locked rule: the control is disabled, so the value
          // cannot have changed, and sending it anyway would trip the action's
          // own refusal on rules that are merely being renamed.
          if (!row.locked && row.showWhen !== row.original?.showWhen)
            patch.show_when = row.showWhen;
          if (Object.keys(patch).length === 0) continue;

          const res = await updatePlaybookRule(row.ruleId, patch);
          if (!res.ok) return fail(res.error);
        } else {
          const res = await addPlaybookRule({
            category,
            text,
            show_when: row.showWhen,
            playbook_id: book.id,
          });
          if (!res.ok) return fail(res.error);
        }
      }

      setRemoved([]);
      onOpenChange(false);
      router.refresh();
    });

    function fail(error?: string) {
      toast.error(error ?? "Failed");
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{section ? "Edit rule group" : "Add rule group"}</DialogTitle>
          <DialogDescription>
            {section
              ? "Everything this playbook checks under this heading. Changes are saved together."
              : "Name the group, then write the rules that belong under it."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Example: Entry criteria"
            aria-label="Group name"
            autoFocus={!section}
            disabled={pending}
          />

          <Input
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="One line about what this group decides (optional)"
            aria-label="Group description"
            className="text-sm"
            disabled={pending}
          />

          <div className="space-y-2 rounded-md border p-2">
            {rules.length === 0 && (
              <p className="px-1 py-2 text-sm text-muted-foreground">
                No rules in this group yet.
              </p>
            )}

            {rules.map((row, i) => (
              <div key={row.key} className="flex items-center gap-2">
                <Input
                  value={row.text}
                  onChange={(e) => patchRow(row.key, { text: e.target.value })}
                  onKeyDown={(e) => {
                    // Enter opens the next row instead of submitting — the whole
                    // point of this dialog is writing several rules in a run.
                    if (e.key === "Enter" && i === rules.length - 1) {
                      e.preventDefault();
                      addRow();
                    }
                  }}
                  placeholder="(E.g. Trading above VWAP)"
                  aria-label={`Rule ${i + 1}`}
                  className="min-w-0 flex-1"
                  disabled={pending}
                />
                <Select
                  value={row.showWhen}
                  onValueChange={(v) => patchRow(row.key, { showWhen: v as ShowWhen })}
                  disabled={pending || row.locked}
                >
                  <SelectTrigger
                    className="w-36 shrink-0"
                    aria-label={`When rule ${i + 1} shows`}
                    title={
                      row.locked
                        ? "Locked — the rule is already answered on past trades. Changing when it shows would retroactively change the statistics."
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={() => removeRow(row)}
                  disabled={pending}
                  aria-label={`Remove rule ${i + 1}`}
                  title={
                    row.ruleId
                      ? "Takes it out of this playbook on Save. The rule and its statistics stay."
                      : "Discards this row."
                  }
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}

            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground"
              onClick={addRow}
              disabled={pending}
            >
              <Plus className="size-3.5" /> Add rule
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
