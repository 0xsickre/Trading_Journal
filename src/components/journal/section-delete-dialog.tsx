"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlaybookSection } from "@/lib/journal/playbook-types";
import { deletePlaybookSection } from "@/app/(app)/settings/playbook-actions";

/**
 * Confirm deleting a section, saying what actually happens to its rules.
 *
 * The action never refuses. Deleting the section cascades the LINKS, not the
 * rules: every rule stays in the library with every answer it collected, and
 * every other playbook using it is untouched. Deleting a section is an unlink of
 * several rules at once, and unlink has never been destructive here.
 *
 * The old version refused instead, counting every rule in the ACCOUNT that
 * carried the same heading — archived ones, and ones living only in other
 * playbooks, neither of which was visible on the card being looked at. So a
 * section that appeared empty could not be deleted and the message named a
 * number the trader could not see. The count here is this playbook's, and it is
 * the count of what leaves it.
 */
export function SectionDeleteDialog({
  section,
  ruleCount,
  open,
  onOpenChange,
}: {
  section: PlaybookSection;
  /** Rules this playbook files under the section — what leaves it. */
  ruleCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function confirm() {
    start(async () => {
      const res = await deletePlaybookSection(section.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete „{section.label}“?</DialogTitle>
          <DialogDescription>
            {ruleCount === 0 ? (
              <>The section is empty, so nothing else changes.</>
            ) : (
              <>
                {ruleCount} {ruleCount === 1 ? "rule leaves" : "rules leave"} this
                playbook along with it. They stay in your library with every
                answer they have collected, and every other playbook using them is
                untouched — you can link them back into any section here later.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            Delete section
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
