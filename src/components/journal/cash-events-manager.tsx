"use client";

import { useMemo, useState, useTransition } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney, pnlClass } from "@/lib/journal/format";
import type { CashEvent } from "@/lib/journal/balance";
import type { Account } from "@/lib/journal/types";
import { parseSettingsNumber } from "@/lib/journal/settings-rules";
import {
  accountFilterOptions,
  cashRowsWithOpening,
  netFlowByCurrency,
  pickableAccounts,
  primaryAccount,
  type CashRow,
} from "@/lib/journal/account-rules";
import { DATE, DEFAULT_TZ, fmtInTz, zonedDateKey, zonedInputToUtc } from "@/lib/journal/time";
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

const typeLabel = (t: CashRow["type"]) =>
  t === "opening" ? "Opening balance" : (TYPES.find((x) => x.value === t)?.label ?? t);

export function CashEventsManager({
  accounts,
  events,
}: {
  accounts: Account[];
  events: CashEvent[];
}) {
  const [pending, start] = useTransition();

  // New entries go only to accounts in use; the history still shows them all.
  const pickable = useMemo(() => pickableAccounts(accounts), [accounts]);
  const [accountId, setAccountId] = useState(() => primaryAccount(pickable)?.id ?? "");
  const [type, setType] = useState<CashEventType>("deposit");
  const [amount, setAmount] = useState("");
  const account = pickable.find((a) => a.id === accountId) ?? null;
  const tz = account?.timezone ?? DEFAULT_TZ;
  // "Today" is the account's today, not UTC's: in the evening in New York the
  // UTC date is already tomorrow.
  const [date, setDate] = useState(() => zonedDateKey(new Date(), tz));
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("all");
  const [confirming, setConfirming] = useState<CashRow | null>(null);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const currency = account?.currency ?? "USD";

  const amountCheck = amount.trim() === "" ? null : parseSettingsNumber(amount);
  const amountError =
    amountCheck == null
      ? null
      : !amountCheck.ok
        ? amountCheck.error
        : amountCheck.value === 0
          ? "Enter an amount other than zero."
          : null;

  const rows = useMemo(() => {
    const inScope = filter === "all" ? accounts : accounts.filter((a) => a.id === filter);
    const ids = new Set(inScope.map((a) => a.id));
    return cashRowsWithOpening(
      inScope,
      events.filter((e) => ids.has(e.account_id)),
    );
  }, [accounts, events, filter]);

  // The opening balance is where the account started, not money that moved.
  const nets = netFlowByCurrency(
    rows.filter((r) => r.type !== "opening"),
    (id) => accountById.get(id)?.currency ?? "USD",
  );

  function submit() {
    if (!account) {
      toast.error("Pick an account.");
      return;
    }
    // Read like the import reads money: "1.000,50" is a thousand, not one.
    if (amountCheck == null || amountError || !amountCheck.ok) {
      toast.error(amountError ? `Amount: ${amountError}` : "Enter an amount.");
      return;
    }
    // Midday in the ACCOUNT's zone: the entry lands on the day that was picked
    // there, whatever the zone of the browser.
    const occurredAt = zonedInputToUtc(`${date}T12:00`, tz);
    if (!occurredAt) {
      toast.error("Pick a valid date.");
      return;
    }
    start(async () => {
      const res = await addCashEvent({
        account_id: account.id,
        event_type: type,
        amount: amountCheck.value ?? 0,
        occurred_at: occurredAt,
        note,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setAmount("");
      setNote("");
      toast.success("Recorded");
    });
  }

  function remove(row: CashRow) {
    start(async () => {
      const res = await deleteCashEvent(row.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setConfirming(null);
      toast.success("Entry deleted");
    });
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Create an account before recording deposits and withdrawals.
      </p>
    );
  }

  const rowAccount = (r: CashRow) => accountById.get(r.accountId);

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
            <Label className="text-xs" htmlFor="cash-account">
              Account
            </Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="cash-account">
                <SelectValue placeholder="Account" />
              </SelectTrigger>
              <SelectContent>
                {pickable.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="cash-type">
              Type
            </Label>
            <Select value={type} onValueChange={(v) => setType(v as CashEventType)}>
              <SelectTrigger id="cash-type">
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
            <p className="text-xs text-muted-foreground">
              {TYPES.find((t) => t.value === type)?.hint}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="cash-amount">
              Amount ({currency})
            </Label>
            <Input
              id="cash-amount"
              inputMode="decimal"
              value={amount}
              placeholder="1000"
              aria-invalid={amountError != null}
              onChange={(e) => setAmount(e.target.value)}
            />
            {amountError ? (
              <p className="text-xs text-destructive">{amountError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {type === "adjustment"
                  ? "Signed: negative lowers the balance."
                  : type === "deposit"
                    ? "Added to the balance."
                    : "Taken off the balance."}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="cash-date">
              Date
            </Label>
            <Input
              id="cash-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="cash-note">
              Note
            </Label>
            <Input
              id="cash-note"
              value={note}
              placeholder="Optional"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-5">
            <Button
              disabled={pending || !account || amountCheck == null || amountError != null || !date}
              onClick={submit}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-base">History</CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            {nets.length > 0 && (
              <span className="text-sm text-muted-foreground">
                Net flow:{" "}
                {nets.map((n, i) => (
                  <span key={n.currency}>
                    {i > 0 && " · "}
                    <span className={`tabular-nums ${pnlClass(n.net)}`}>
                      {fmtMoney(n.net, n.currency, { sign: true })}
                    </span>
                  </span>
                ))}
              </span>
            )}
            {accounts.length > 1 && (
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="h-8 w-44" aria-label="Filter by account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {accountFilterOptions(accounts).map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deposits or withdrawals yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">Date</th>
                    <th className="py-2 text-left font-medium">Account</th>
                    <th className="py-2 text-left font-medium">Type</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                    <th className="py-2 pl-4 text-left font-medium">Note</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const acc = rowAccount(r);
                    return (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-2 tabular-nums">
                          {fmtInTz(r.at, acc?.timezone ?? DEFAULT_TZ, DATE)}
                        </td>
                        <td className="py-2">{acc?.name ?? "—"}</td>
                        <td className="py-2">{typeLabel(r.type)}</td>
                        <td
                          className={`py-2 text-right tabular-nums ${
                            r.readOnly ? "" : pnlClass(r.amount)
                          }`}
                        >
                          {fmtMoney(r.amount, acc?.currency ?? "USD", { sign: !r.readOnly })}
                        </td>
                        <td className="py-2 pl-4 text-muted-foreground">
                          {r.readOnly ? "Starting balance — change it on the account" : (r.note ?? "")}
                        </td>
                        <td className="py-2 text-right">
                          {!r.readOnly && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => setConfirming(r)}
                              aria-label={`Delete ${typeLabel(r.type).toLowerCase()} of ${fmtInTz(r.at, acc?.timezone ?? DEFAULT_TZ, DATE)}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
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

      <Dialog open={confirming != null} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this entry?</DialogTitle>
            <DialogDescription>
              {confirming &&
                (() => {
                  const acc = rowAccount(confirming);
                  return `${typeLabel(confirming.type)} of ${fmtMoney(confirming.amount, acc?.currency ?? "USD", { sign: true })} on ${fmtInTz(confirming.at, acc?.timezone ?? DEFAULT_TZ, DATE)}${acc ? ` (${acc.name})` : ""}. The balance and every percentage view change with it.`;
                })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => confirming && remove(confirming)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
