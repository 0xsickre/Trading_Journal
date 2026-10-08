"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Chips } from "@/components/journal/quick-log-form";
import { createMissedSetup } from "@/app/(app)/trades/actions";
import { missedSetupProblem, type MissedSetupInput } from "@/lib/journal/missed-setup";
import { primaryAccount } from "@/lib/journal/account-rules";
import { zonedInputToUtc } from "@/lib/journal/time";
import type { Account, Instrument, OptionsMap } from "@/lib/journal/types";
import type { Playbook } from "@/lib/journal/playbook-types";

const num = (s: string) => {
  const v = Number(s.replace(",", "."));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};

/**
 * A setup seen and not taken, off the recording (phase O). The numbers the
 * setup offered and when; the R2 walk prices what it would have done.
 */
export function MissedSetupForm({
  accounts,
  instruments,
  playbooks,
  optionsMap,
  today,
}: {
  accounts: Account[];
  instruments: Pick<Instrument, "symbol">[];
  playbooks: Playbook[];
  optionsMap: OptionsMap;
  /** The primary account's day, `yyyy-MM-dd`. */
  today: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const open = accounts.filter((a) => a.archived_at == null);
  const [accountId, setAccountId] = useState<string | null>(primaryAccount(open)?.id ?? open[0]?.id ?? null);
  const account = open.find((a) => a.id === accountId) ?? null;
  const [symbol, setSymbol] = useState<string>(instruments[0]?.symbol ?? "");
  const [direction, setDirection] = useState<"Long" | "Short">("Long");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [day, setDay] = useState(today);
  const [time, setTime] = useState("");
  const [playbookId, setPlaybookId] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const input: MissedSetupInput = {
    accountId,
    instrument: symbol || null,
    direction,
    entry: num(entry),
    stop: num(stop),
    target: num(target),
    seenAt: day && time ? zonedInputToUtc(`${day}T${time}`, account?.timezone ?? "UTC") : null,
    playbookId,
    reason,
    note,
  };
  const problem = missedSetupProblem(input);

  function save() {
    if (problem) {
      toast.error(problem);
      return;
    }
    start(async () => {
      const res = await createMissedSetup({
        account_id: input.accountId!,
        instrument: input.instrument!,
        direction: input.direction,
        entry_price: input.entry!,
        stop_price: input.stop!,
        target_price: input.target,
        seen_at: input.seenAt!,
        playbook_id: input.playbookId,
        miss_reason: input.reason,
        trade_journal_notes: input.note,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Propušten setup sačuvan — ishod iz sveća stiže uveče.");
      router.push("/daily");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Setup koji nisi uzeo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {open.length > 1 && (
          <Chips items={open.map((a) => ({ value: a.id, label: a.name }))} selected={accountId ? [accountId] : []} onToggle={setAccountId} />
        )}
        <Chips items={instruments.map((i) => ({ value: i.symbol, label: i.symbol }))} selected={[symbol]} onToggle={setSymbol} />
        <Chips
          items={[
            { value: "Long", label: "Long" },
            { value: "Short", label: "Short" },
          ]}
          selected={[direction]}
          onToggle={(v) => setDirection(v as "Long" | "Short")}
        />
        <div className="flex flex-wrap gap-3">
          {(
            [
              ["Ulaz", entry, setEntry],
              ["Stop", stop, setStop],
              ["Cilj (opciono)", target, setTarget],
            ] as const
          ).map(([label, value, set]) => (
            <label key={label} className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">{label}</span>
              <Input inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} className="w-32" />
            </label>
          ))}
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Dan</span>
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-40" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Vreme ({account?.timezone ?? "UTC"})</span>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-28" />
          </label>
        </div>
        {playbooks.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Setup</span>
            <Chips
              items={playbooks.map((p) => ({ value: p.id, label: p.name }))}
              selected={playbookId ? [playbookId] : []}
              onToggle={(v) => setPlaybookId((p) => (p === v ? null : v))}
            />
          </div>
        )}
        {(optionsMap.miss_reason ?? []).length > 0 && (
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Zašto nisi ušao</span>
            <Chips
              items={(optionsMap.miss_reason ?? []).map((o) => ({ value: o.value, label: o.label }))}
              selected={reason ? [reason] : []}
              onToggle={(v) => setReason((r) => (r === v ? null : v))}
              tone="loss"
            />
          </div>
        )}
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">Beleška (šta si video, šta te je zaustavilo)</span>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </label>
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending}>
            Sačuvaj propušten setup
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
