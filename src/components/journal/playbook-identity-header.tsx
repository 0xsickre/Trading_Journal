"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ChevronLeft, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Playbook } from "@/lib/journal/playbook-types";
import { deletePlaybook, updatePlaybook } from "@/app/(app)/settings/playbook-actions";

/**
 * Identity block above a playbook's tabs: its name, an inactive badge, and the
 * archive/delete controls that used to live in the list card's header row.
 */
export function PlaybookIdentityHeader({ book }: { book: Playbook }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(book.name);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Failed");
      else router.refresh();
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
              onBlur={() => {
                if (name.trim() && name !== book.name)
                  run(() => updatePlaybook(book.id, { name }));
              }}
              className="h-9 w-64 text-lg font-semibold"
              aria-label="Playbook name"
              disabled={pending}
            />
            {!book.is_active && <Badge variant="outline">inactive</Badge>}
          </div>
          {book.description && (
            <p className="text-sm text-muted-foreground">{book.description}</p>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
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
              <Archive className="size-4" />
            ) : (
              <ArchiveRestore className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deletePlaybook(book.id);
                if (!res.ok) {
                  toast.error(res.error ?? "Failed");
                  return;
                }
                router.push("/playbooks");
              })
            }
            aria-label="Delete playbook"
            title="Only possible while no trade uses it."
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
