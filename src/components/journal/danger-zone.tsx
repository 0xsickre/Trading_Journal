"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
 * WHAT ACTUALLY COMES BACK, counted from the seed functions rather than assumed
 * from their names: one Main Account, 91 instruments, 11 dropdown lists holding
 * 55 options, 8 tracker rules, 7 custom fields and 3 note folders.
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
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const matches = typed.trim() === RESET_PHRASE;

  function confirm() {
    start(async () => {
      const res = await resetAllData(typed);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Everything deleted. Defaults restored.");
      setOpen(false);
      setTyped("");
      router.refresh();
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
            Removes every trade, fill, daily and weekly report, note, import,
            deposit, playbook, tracker rule, custom field and account you own —
            then puts back the defaults a new account starts with. There is no
            undo, and no export is taken first.
          </p>
        </div>
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium">Restored afterwards</p>
          <p className="text-muted-foreground">
            One Main Account, 91 instruments, 11 dropdown lists with 55 options,
            8 tracker rules, 7 custom fields, 3 note folders.
          </p>
          <p className="mt-2 font-medium">Not restored</p>
          <p className="text-muted-foreground">
            <strong>Your playbooks and their rules.</strong> Playbooks are not
            part of the seeded defaults, so they are deleted and do not come
            back. The same goes for any option, tracker rule or account you added
            yourself.
          </p>
        </div>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <AlertTriangle className="size-4" /> Delete all data
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete everything?</DialogTitle>
            <DialogDescription>
              This is irreversible. Every trade and every note you have written
              is deleted, and the journal returns to the state it had on the day
              you signed up — without the playbooks you have written since, which
              are not part of the defaults and do not come back.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label className="text-xs">
              Type <span className="font-mono">{RESET_PHRASE}</span> to confirm
            </Label>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              aria-label="Confirm reset phrase"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
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
