"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney, pnlClass } from "@/lib/journal/format";
import { netCashFlow, type CashEvent } from "@/lib/journal/balance";
import type { Account } from "@/lib/journal/types";
import {
  addCashEvent,
  deleteCashEvent,
  type CashEventType,
} from "@/app/(app)/settings/actions";

const TYPES: { value: CashEventType; label: string; hint: string }[] = [
  { value: "deposit", label: "Deposit", hint: "Money came into the account" },
  { value: "withdrawal", label: "Withdrawal", hint: "Money left the account" },
  { value: "payout", label: "Payout", hint: "Prop-firm profit payout" },
  { value: "adjustment", label: "Adjustment", hint: "Manual balance correction" },
];

const todayLocal = () => new Date().toISOString().slice(0, 10);

export function CashEventsManager({
  accounts,
  events,
}: {
  accounts: Account[];
  events: CashEvent[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [type, setType] = useState<CashEventType>("deposit");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayLocal);
  const [note, setNote] = useState("");

  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );
  const currency = accountById.get(accountId)?.currency ?? "USD";

  function submit() {
    const magnitude = Number(amount);
    if (!Number.isFinite(magnitude) || magnitude === 0) {
      toast.error("Enter an amount other than zero.");
      return;
    }
    start(async () => {
      const res = await addCashEvent({
        account_id: accountId,
        event_type: type,
        amount: magnitude,
        // Stored as an instant; midday avoids a same-day event landing before
        // the account's day boundary in western timezones.
        occurred_at: new Date(`${date}T12:00:00Z`).toISOString(),
        note,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setAmount("");
      setNote("");
      toast.success("Recorded");
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await deleteCashEvent(id);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Create an account before recording deposits and withdrawals.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">New entry</CardTitle>
          <p className="text-sm text-muted-foreground">
            Deposits and withdrawals are not P&amp;L. They move the balance, and with it
            every percentage view — drawdown in <strong>$</strong> stays the same,
            drawdown in <strong>%</strong> changes.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label className="text-xs">Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as CashEventType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              Amount ({currency})
              {type !== "adjustment" && (
                <span className="ml-1 text-muted-foreground">unsigned</span>
              )}
            </Label>
            <Input
              inputMode="decimal"
              value={amount}
              placeholder="1000"
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Note</Label>
            <Input
              value={note}
              placeholder="Optional"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-5">
            <Button disabled={pending} onClick={submit}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-base">History</CardTitle>
          <span className="text-sm text-muted-foreground">
            Net flow: {fmtMoney(netCashFlow(events), currency, { sign: true })}
          </span>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No deposits or withdrawals yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">Date</th>
                    <th className="py-2 text-left font-medium">Account</th>
                    <th className="py-2 text-left font-medium">Type</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                    <th className="py-2 text-left font-medium">Note</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => {
                    const acc = accountById.get(e.account_id);
                    return (
                      <tr key={e.id} className="border-b last:border-0">
                        <td className="py-2">{e.occurred_at.slice(0, 10)}</td>
                        <td className="py-2">{acc?.name ?? "—"}</td>
                        <td className="py-2">
                          {TYPES.find((t) => t.value === e.event_type)?.label ??
                            e.event_type}
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums ${pnlClass(
                            e.amount,
                          )}`}
                        >
                          {fmtMoney(e.amount, acc?.currency ?? "USD", {
                            sign: true,
                          })}
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {e.note ?? ""}
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => remove(e.id)}
                            aria-label="Delete"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
