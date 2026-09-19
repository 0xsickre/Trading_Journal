"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ChevronLeft, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Playbook } from "@/lib/journal/playbook-types";
import { deletePlaybook, updatePlaybook } from "@/app/(app)/settings/playbook-actions";

/**
 * Name, status and what the setup IS — the part of a playbook that is not
 * statistics.
 *
 * The description, the default risk and the A+ criterion had no editor at all
 * once playbooks moved to their own pages: the description could be typed
 * only at creation, the other two never. Both feed the trade form — picking a
 * playbook prefills its default risk, and its checklist shows the A+ line — so
 * two form features were unreachable. They are edited here now.
 */
export function PlaybookIdentityHeader({ book }: { book: Playbook }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(book.name);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Failed");
        return;
      }
      onOk?.();
      router.refresh();
    });
  }

  /**
   * Save the name, or put the old one back. An emptied box used to stay empty:
   * the server refused the blank name, and the field went on showing nothing.
   */
  function commitName() {
    const clean = name.trim();
    if (!clean) {
      setName(book.name);
      return;
    }
    if (clean !== book.name)
      start(async () => {
        const res = await updatePlaybook(book.id, { name: clean });
        if (!res.ok) {
          toast.error(res.error ?? "Failed");
          setName(book.name);
          return;
        }
        router.refresh();
      });
  }

  return (
    <div className="space-y-2">
      <Link
        href="/playbooks"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Playbooks
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setName(book.name);
                  e.currentTarget.blur();
                }
              }}
              className="h-9 w-64 text-lg font-semibold"
              aria-label="Playbook name"
              disabled={pending}
            />
            {!book.is_active && <Badge variant="outline">inactive</Badge>}
            {book.default_risk_pct != null && (
              <Badge variant="secondary" title="Prefilled on a new trade that picks this playbook">
                Risk {book.default_risk_pct}%
              </Badge>
            )}
          </div>
          {book.description && (
            <p className="text-sm text-muted-foreground">{book.description}</p>
          )}
          {book.a_plus_criteria && (
            <p className="text-sm">
              <span className="font-medium">A+ setup:</span>{" "}
              <span className="text-muted-foreground">{book.a_plus_criteria}</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setDetailsOpen(true)}
          >
            <Pencil className="size-4" /> Edit details
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={pending}
            onClick={() => run(() => updatePlaybook(book.id, { is_active: !book.is_active }))}
            aria-label={book.is_active ? "Deactivate" : "Activate"}
            title={
              book.is_active
                ? "Remove from the picker on the form. Old trades stay attached to it."
                : "Restore to the picker on the form."
            }
          >
            {book.is_active ? <Archive className="size-4" /> : <ArchiveRestore className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={pending}
            onClick={() => setDeleteOpen(true)}
            aria-label="Delete playbook"
            title="Only possible while no trade uses it."
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <PlaybookDetailsDialog
        book={book}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        pending={pending}
        onSave={(patch) => run(() => updatePlaybook(book.id, patch), () => setDetailsOpen(false))}
      />

      <DeletePlaybookDialog
        name={book.name}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        pending={pending}
        onConfirm={() =>
          start(async () => {
            const res = await deletePlaybook(book.id);
            if (!res.ok) {
              toast.error(res.error ?? "Failed");
              return;
            }
            setDeleteOpen(false);
            router.push("/playbooks");
          })
        }
      />
    </div>
  );
}

type DetailsPatch = {
  description: string | null;
  default_risk_pct: number | null;
  a_plus_criteria: string | null;
};

function PlaybookDetailsDialog({
  book,
  open,
  onOpenChange,
  pending,
  onSave,
}: {
  book: Playbook;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pending: boolean;
  onSave: (patch: DetailsPatch) => void;
}) {
  const [description, setDescription] = useState(book.description ?? "");
  const [risk, setRisk] = useState(book.default_risk_pct != null ? String(book.default_risk_pct) : "");
  const [aPlus, setAPlus] = useState(book.a_plus_criteria ?? "");

  const riskNum = risk.trim() === "" ? null : Number(risk.replace(",", "."));
  const riskInvalid = riskNum != null && (!Number.isFinite(riskNum) || riskNum <= 0 || riskNum > 100);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Reopening starts from what is saved, not from an abandoned edit.
        if (v) {
          setDescription(book.description ?? "");
          setRisk(book.default_risk_pct != null ? String(book.default_risk_pct) : "");
          setAPlus(book.a_plus_criteria ?? "");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Playbook details</DialogTitle>
          <DialogDescription>
            What the setup is. The default risk and the A+ line show up on the trade form
            when this playbook is picked.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pb-description">Description</Label>
            <Textarea
              id="pb-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this setup is, in a sentence"
              className="min-h-20"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pb-risk">Default risk %</Label>
            <Input
              id="pb-risk"
              inputMode="decimal"
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
              placeholder="e.g. 0.5"
              className="w-32"
              aria-invalid={riskInvalid}
            />
            <p className="text-xs text-muted-foreground">
              {riskInvalid
                ? "Between 0 and 100."
                : "Prefilled into an empty risk field on a new trade. Leave empty for none."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pb-aplus">A+ criteria</Label>
            <Textarea
              id="pb-aplus"
              value={aPlus}
              onChange={(e) => setAPlus(e.target.value)}
              placeholder="What makes this an A+ trade, in one line"
              className="min-h-16"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending || riskInvalid}
            onClick={() =>
              onSave({
                description: description.trim() || null,
                default_risk_pct: riskNum,
                a_plus_criteria: aPlus.trim() || null,
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shared by this header and the playbook list — one wording for one consequence. */
export function DeletePlaybookDialog({
  name,
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  name: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{name}”?</DialogTitle>
          <DialogDescription>
            Its sections and rule links go with it; the rules stay in your library and
            its notes stay in the Notebook, unlinked. This is refused while any trade
            uses the playbook — deactivate it instead to keep its history.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
