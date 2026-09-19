"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resetAllData } from "@/app/(app)/settings/actions";
import { RESET_PHRASE } from "@/lib/journal/reset-phrase";

/**
 * Start over: delete everything, then re-seed the defaults.
 *
 * The phrase, rather than a second "are you sure", because the two clicks of a
 * double confirmation are the same reflex twice. Typing is the only gate that
 * costs attention rather than time.
 *
 * WHAT ACTUALLY COMES BACK is named by kind, not counted: the numbers change
 * whenever the seed does, and a count written here was already wrong once.
 * `tj_reset_my_data` calls `tj_seed_my_defaults()`, which is exactly what a new
 * signup ends up with after its first dashboard load — so "reset" and "first
 * ever load" do land on the same state.
 *
 * WHAT DOES NOT COME BACK, and why the copy below says so out loud: playbooks.
 * `tj_seed_defaults` DOES call `tj_seed_playbooks`, but that function has been a
 * deliberate no-op since 20260813200000: it used to guard itself with
 * `if exists (… ) then return`, which cannot tell a new user from one who
 * deleted every playbook on purpose — both have zero rows — so deleting them
 * appeared to work and then undid itself on the next dashboard load. A reset
 * therefore ends with zero playbooks and zero playbook rules no matter how many
 * were written. Anything else added by hand (extra options, extra tracker rules)
 * is in the same position. Naming the restore without naming that gap would be
 * the same screen telling the truth about the easy half.
 */
export function DangerZone() {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const matches = typed.trim() === RESET_PHRASE;

  // A phrase typed once must not still be there when the dialog is reopened.
  function close(next: boolean) {
    setOpen(next);
    if (!next) setTyped("");
  }

  function confirm() {
    start(async () => {
      const res = await resetAllData(typed);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // The action revalidates the pages itself.
      toast.success("Everything deleted. Defaults restored.");
      close(false);
    });
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <AlertTriangle className="size-4" /> Danger zone
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">Delete everything and start over</div>
          <p className="text-sm text-muted-foreground">
            Deletes every trade, report, note, import, deposit, playbook, rule,
            category and account, then restores the defaults. There is no undo.
          </p>
        </div>
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium">Restored afterwards</p>
          <p className="text-muted-foreground">
            One Main Account, the instrument catalog, the default categories and
            tags, the default tracker rules and note folders.
          </p>
          <p className="mt-2 font-medium">Not restored</p>
          <p className="text-muted-foreground">
            <strong>Your playbooks</strong>, and anything else you added yourself.
          </p>
        </div>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <AlertTriangle className="size-4" /> Delete all data
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete everything?</DialogTitle>
            <DialogDescription>
              Every trade and note is deleted and the journal returns to its
              first-day state, without your playbooks. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="reset-phrase" className="text-xs">
              Type <span className="font-mono">{RESET_PHRASE}</span> to confirm
            </Label>
            <Input
              id="reset-phrase"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => close(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending || !matches}
              onClick={confirm}
            >
              {pending ? "Deleting…" : "Delete everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
