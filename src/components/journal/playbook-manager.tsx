"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  SHOW_WHEN_LABELS,
  SHOW_WHEN_VALUES,
  type Playbook,
  type PlaybookGroup,
  type PlaybookRule,
  type ShowWhen,
} from "@/lib/journal/playbook-types";
import {
  addPlaybook,
  addPlaybookGroup,
  addPlaybookRule,
  deletePlaybook,
  deletePlaybookGroup,
  deletePlaybookRule,
  renamePlaybookGroup,
  restorePlaybookRule,
  updatePlaybook,
  updatePlaybookRule,
} from "@/app/(app)/settings/playbook-actions";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Nije uspelo");
      else router.refresh();
    });
  return { pending, run };
}

function RuleRow({ rule }: { rule: PlaybookRule }) {
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
              ? `Zaključano — pravilo je već čekirano na ${rule.answerCount} trejdova. Izmena bi retroaktivno promenila statistiku.`
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
      {retired && <Badge variant="outline">arhivirano</Badge>}

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
        aria-label={retired ? "Vrati pravilo" : "Obriši pravilo"}
        title={
          retired
            ? "Vrati na čeklistu."
            : locked
              ? "Sklanja se sa čekliste. Statistika starih trejdova ostaje netaknuta."
              : "Briše se — nijedan trejd ga nije čekirao."
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

function GroupBlock({ group }: { group: PlaybookGroup }) {
  const { pending, run } = useAction();
  const [name, setName] = useState(group.name);
  const [draft, setDraft] = useState("");
  const [showWhen, setShowWhen] = useState<ShowWhen>("always");

  function addRule() {
    if (!draft.trim()) return;
    run(async () => {
      const res = await addPlaybookRule({
        group_id: group.id,
        text: draft,
        show_when: showWhen,
      });
      if (res.ok) setDraft("");
      return res;
    });
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== group.name)
              run(() => renamePlaybookGroup(group.id, name));
          }}
          className="h-8 w-52 font-medium"
          disabled={pending}
        />
        <span className="text-xs text-muted-foreground">
          {group.rules.length} {group.rules.length === 1 ? "pravilo" : "pravila"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          disabled={pending}
          onClick={() => run(() => deletePlaybookGroup(group.id))}
          aria-label="Obriši grupu"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {group.rules.map((rule) => (
        <RuleRow key={rule.id} rule={rule} />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addRule();
          }}
          placeholder="Novo pravilo, npr. Čekaj sweep pa MSS"
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
          <Plus className="size-3.5" /> Dodaj
        </Button>
      </div>
    </div>
  );
}

function PlaybookCard({ book }: { book: Playbook }) {
  const { pending, run } = useAction();
  const [name, setName] = useState(book.name);
  const [groupDraft, setGroupDraft] = useState("");
  const ruleCount = book.groups.reduce((s, g) => s + g.rules.length, 0);

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
            {ruleCount} {ruleCount === 1 ? "pravilo" : "pravila"}
          </span>
          {!book.is_active && <Badge variant="outline">neaktivan</Badge>}
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={pending}
              onClick={() =>
                run(() => updatePlaybook(book.id, { is_active: !book.is_active }))
              }
              aria-label={book.is_active ? "Deaktiviraj" : "Aktiviraj"}
              title={
                book.is_active
                  ? "Skloni iz izbora na formi. Stari trejdovi ostaju vezani za njega."
                  : "Vrati u izbor na formi."
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
              aria-label="Obriši playbook"
              title="Moguće samo dok ga nijedan trejd ne koristi."
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {book.groups.map((group) => (
          <GroupBlock key={group.id} group={group} />
        ))}

        <div className="flex items-center gap-2">
          <Input
            value={groupDraft}
            onChange={(e) => setGroupDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && groupDraft.trim())
                run(async () => {
                  const res = await addPlaybookGroup(book.id, groupDraft);
                  if (res.ok) setGroupDraft("");
                  return res;
                });
            }}
            placeholder="Nova grupa pravila"
            className="h-8 w-56"
            disabled={pending}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={pending || !groupDraft.trim()}
            onClick={() =>
              run(async () => {
                const res = await addPlaybookGroup(book.id, groupDraft);
                if (res.ok) setGroupDraft("");
                return res;
              })
            }
          >
            <Plus className="size-3.5" /> Grupa
          </Button>
        </div>
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
export function PlaybookManager({ playbooks }: { playbooks: Playbook[] }) {
  const { pending, run } = useAction();
  const [draft, setDraft] = useState("");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Svako pravilo nosi sopstvenu statistiku — na <b>/reports</b> grupiši po
        „Pravilo iz playbook-a“ i vidi follow rate uz veličinu uzorka. To je
        razlika između pravila koje nosi edge i onog koje je postalo ritual.
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
          placeholder="Novi playbook, npr. London Reversal"
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
          <Plus className="size-4" /> Dodaj playbook
        </Button>
      </div>

      {playbooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Još nema nijednog playbook-a.</p>
      ) : (
        playbooks.map((book) => <PlaybookCard key={book.id} book={book} />)
      )}
    </div>
  );
}
