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
      toast.success("Focus goal saved");
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
      toast.success("Focus goal completed — set a new one when ready");
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
            <p className="text-sm font-medium">Set your focus goal first</p>
            <p className="text-sm text-muted-foreground">
              One goal at a time for weeks. Your day grade measures progress on
              this goal only — never P&amp;L.
            </p>
            <Button size="sm" onClick={openEdit}>
              Set focus goal
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
          title="New focus goal"
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
              Active focus · day {dayNum}
            </p>
            <p className="mt-1 text-sm font-medium">{goal.goal_text}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              One goal at a time. Change when it&apos;s no longer your
              highest-ROI improvement.
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
            Edit goal
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={graduate}
            disabled={pending}
          >
            Mark complete &amp; set new
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
        title={goal ? "Update focus goal" : "New focus goal"}
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
          placeholder='e.g. "No new positions when mental temp is below 5"'
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={pending || !draft.trim()}>
            Save goal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
