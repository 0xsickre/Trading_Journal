"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Target } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { daysOnActiveGoal, type FocusGoal } from "@/lib/journal/focus-goal";
import { endFocusGoal, saveFocusGoal } from "@/app/(app)/daily/actions";

export function FocusGoalCard({
  goal,
  reportDate,
}: {
  goal: FocusGoal | null;
  reportDate: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState(goal?.goal_text ?? "");

  function openEdit() {
    setDraft(goal?.goal_text ?? "");
    setEditOpen(true);
  }

  function save() {
    start(async () => {
      const res = await saveFocusGoal(draft);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Fokus cilj sačuvan");
      setEditOpen(false);
      router.refresh();
    });
  }

  function graduate() {
    start(async () => {
      const res = await endFocusGoal();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Cilj završen — postavi novi kad budeš spreman");
      setDraft("");
      setEditOpen(true);
      router.refresh();
    });
  }

  if (!goal) {
    return (
      <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <Target className="mt-0.5 size-5 text-amber-600" />
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium">Prvo postavi fokus cilj</p>
            <p className="text-sm text-muted-foreground">
              Jedan cilj u jednom trenutku, kroz nedelje. Ocena dana meri
              napredak ka tom cilju — nikad P&amp;L.
            </p>
            <Button size="sm" onClick={openEdit}>
              Postavi fokus cilj
            </Button>
          </div>
        </div>
        <GoalDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          draft={draft}
          onDraftChange={setDraft}
          onSave={save}
          pending={pending}
          title="Novi fokus cilj"
        />
      </div>
    );
  }

  const dayNum = daysOnActiveGoal(goal, reportDate);

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Target className="mt-0.5 size-5 text-primary" />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Aktivan fokus · dan {dayNum}
            </p>
            <p className="mt-1 text-sm font-medium">{goal.goal_text}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Jedan cilj u jednom trenutku. Promeni ga kad više nije tvoje
              najveće poboljšanje.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={openEdit}
            disabled={pending}
          >
            <Pencil className="mr-1.5 size-3.5" />
            Izmeni cilj
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={graduate}
            disabled={pending}
          >
            Završi i postavi novi
          </Button>
        </div>
      </div>
      <GoalDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        draft={draft}
        onDraftChange={setDraft}
        onSave={save}
        pending={pending}
        title={goal ? "Izmeni fokus cilj" : "Novi fokus cilj"}
      />
    </div>
  );
}

function GoalDialog({
  open,
  onOpenChange,
  draft,
  onDraftChange,
  onSave,
  pending,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draft: string;
  onDraftChange: (v: string) => void;
  onSave: () => void;
  pending: boolean;
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder='npr. "Bez novih pozicija kad je mentalno stanje ispod 5"'
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Otkaži
          </Button>
          <Button onClick={onSave} disabled={pending || !draft.trim()}>
            Sačuvaj cilj
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
