"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  UNKNOWN_USAGE,
  usageIsEmpty,
  usageIsUnknown,
  type AccountUsage,
} from "@/lib/journal/account-usage";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { Account } from "@/lib/journal/types";
import {
  updateAccount,
  addAccount,
  countAccountUsage,
  deleteAccount,
  fillAccountExcursions,
} from "@/app/(app)/settings/actions";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "UTC",
  "Europe/London",
  "Europe/Belgrade",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD"];

/**
 * The confirmation for deleting one account.
 *
 * Two paths on purpose. An account holding nothing is a mistake being tidied
 * away — a single button is the honest weight for that. An account holding
 * trades is the only click in this application that destroys a trade record and
 * that undo does not cover, so it asks for the name to be typed and, above the
 * box, says exactly what disappears. The counts are the point: "delete account?"
 * cannot be answered honestly without them.
 */
function DeleteAccountDialog({
  account,
  usage,
  open,
  onOpenChange,
}: {
  account: Account;
  usage: AccountUsage;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [typed, setTyped] = useState("");

  const empty = usageIsEmpty(usage);
  const unknown = usageIsUnknown(usage);
  const nameMatches = typed.trim() === account.name.trim();

  function confirm() {
    start(async () => {
      const res = await deleteAccount(account.id, typed);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(`Account "${account.name}" deleted`);
        onOpenChange(false);
        setTyped("");
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{account.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            {empty
              ? "This account holds no trades, no deposits and no imports. Nothing else is affected."
              : "This cannot be undone. Import undo does not cover it."}
          </DialogDescription>
        </DialogHeader>

        {!empty && (
          <div className="space-y-3">
            <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              {unknown ? (
                <li className="text-destructive">
                  The contents of this account could not be counted. Continuing
                  deletes whatever is in it.
                </li>
              ) : (
                <>
                  <li>
                    <strong>{usage.trades}</strong> trades, with their fills,
                    playbook answers, check-ins and chart images
                  </li>
                  <li>
                    <strong>{usage.cashEvents}</strong> deposits / withdrawals
                  </li>
                  <li>
                    <strong>{usage.importBatches}</strong> import batches
                  </li>
                </>
              )}
            </ul>
            <p className="text-xs text-muted-foreground">
              Notes written about these trades keep their text and lose the link.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Type <span className="font-mono">{account.name}</span> to confirm
              </Label>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                aria-label="Confirm account name"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || (!empty && !nameMatches)}
            onClick={confirm}
          >
            <Trash2 className="size-4" />
            {pending ? "Deleting…" : "Delete account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountCard({
  account,
  canDelete,
}: {
  account: Account;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Counted when the dialog opens, not with the page. `UNKNOWN_USAGE` until it
  // lands, which `usageIsEmpty` treats as non-empty — so the dialog shows the
  // careful path first and relaxes only once the real numbers are in, never the
  // other way round.
  const [usage, setUsage] = useState<AccountUsage>(UNKNOWN_USAGE);
  const [, startCount] = useTransition();

  function openDelete() {
    setUsage(UNKNOWN_USAGE);
    setConfirmOpen(true);
    startCount(async () => {
      const res = await countAccountUsage(account.id);
      if (res.ok) setUsage(res.usage);
    });
  }
  const [name, setName] = useState(account.name);
  const [kind, setKind] = useState<"trading" | "backtest">(account.account_kind ?? "trading");
  const [filling, startFill] = useTransition();
  const [tz, setTz] = useState(account.timezone);
  const [currency, setCurrency] = useState(account.currency);
  const [balance, setBalance] = useState(String(account.starting_balance));

  // FTMO / prop-firm challenge mode.
  const [ftmoMode, setFtmoMode] = useState(account.ftmo_mode);
  const [dailyOn, setDailyOn] = useState(account.ftmo_daily_loss_enabled);
  const [dailyPct, setDailyPct] = useState(String(account.ftmo_daily_loss_pct));
  const [dailyBasis, setDailyBasis] = useState(account.ftmo_daily_loss_basis);
  const [maxOn, setMaxOn] = useState(account.ftmo_max_loss_enabled);
  const [maxPct, setMaxPct] = useState(String(account.ftmo_max_loss_pct));
  const [targetOn, setTargetOn] = useState(account.ftmo_profit_target_enabled);
  const [targetPct, setTargetPct] = useState(
    String(account.ftmo_profit_target_pct),
  );
  const [minDaysOn, setMinDaysOn] = useState(account.ftmo_min_days_enabled);
  const [minDays, setMinDays] = useState(String(account.ftmo_min_days));

  // Breakeven band — asymmetric, e.g. -37.50 .. 0.
  const [beFrom, setBeFrom] = useState(String(account.breakeven_from));
  const [beTo, setBeTo] = useState(String(account.breakeven_to));
  const [beUnit, setBeUnit] = useState(account.breakeven_unit);

  // Cost defaults for new execution rows.
  const [commPerUnit, setCommPerUnit] = useState(
    String(account.default_commission_per_unit),
  );
  const [feeFixed, setFeeFixed] = useState(String(account.default_fee_fixed));
  const [swapPerDay, setSwapPerDay] = useState(
    String(account.default_swap_per_day),
  );

  function save() {
    start(async () => {
      const res = await updateAccount(account.id, {
        name: name.trim() || account.name,
        account_kind: kind,
        timezone: tz,
        currency,
        starting_balance: Number(balance) || 0,
        breakeven_from: Number(beFrom) || 0,
        breakeven_to: Number(beTo) || 0,
        breakeven_unit: beUnit,
        default_commission_per_unit: Number(commPerUnit) || 0,
        default_fee_fixed: Number(feeFixed) || 0,
        default_swap_per_day: Number(swapPerDay) || 0,
        ftmo_mode: ftmoMode,
        ftmo_daily_loss_enabled: dailyOn,
        ftmo_daily_loss_pct: Number(dailyPct) || 0,
        ftmo_daily_loss_basis: dailyBasis,
        ftmo_max_loss_enabled: maxOn,
        ftmo_max_loss_pct: Number(maxPct) || 0,
        ftmo_profit_target_enabled: targetOn,
        ftmo_profit_target_pct: Number(targetPct) || 0,
        ftmo_min_days_enabled: minDaysOn,
        ftmo_min_days: Math.max(0, Math.round(Number(minDays) || 0)),
      });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Account saved");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{account.name}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label className="text-xs">Timezone (for sessions / display)</Label>
          <Select value={tz} onValueChange={setTz}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 space-y-1.5 rounded-md border p-3">
          <Label className="text-xs">Account type</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as "trading" | "backtest")}>
            <SelectTrigger className="max-w-xs" aria-label="Account type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="trading">Trading — live account</SelectItem>
              <SelectItem value="backtest">Backtest — replayed trades</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {kind === "backtest"
              ? "MAE/MFE is filled automatically from Dukascopy 1-minute candles for every closed trade, after each import and save. A value you type yourself is never overwritten."
              : "MAE/MFE will come from your MT5 terminal. Until MT5 is connected, it is entered by hand."}
          </p>
          {account.account_kind === "backtest" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={filling}
              onClick={() =>
                startFill(async () => {
                  const res = await fillAccountExcursions(account.id);
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  const { filled, skipped } = res.report;
                  toast.success(`MAE/MFE filled on ${filled} trade${filled === 1 ? "" : "s"}`, {
                    description:
                      skipped.length > 0
                        ? skipped
                            .slice(0, 4)
                            .map((s) => `${s.tradeNo != null ? `#${s.tradeNo}` : "a trade"}: ${s.reason}`)
                            .join("\n")
                        : undefined,
                    duration: 12_000,
                  });
                  router.refresh();
                })
              }
            >
              {filling ? "Filling MAE/MFE…" : "Fill MAE/MFE now"}
            </Button>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Starting balance</Label>
          <Input
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
        </div>
        <div className="col-span-2 space-y-2 rounded-md border p-3">
          <div className="text-sm font-medium">Breakeven range</div>
          <p className="text-xs text-muted-foreground">
            A trade whose net P&amp;L lands in this range counts as breakeven, not as a
            loss. The range is <strong>asymmetric</strong> — typically
            &minus;cost to 0, not &plusmn;X. While it is 0 to 0, breakeven means
            exactly zero and practically never fires.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              inputMode="decimal"
              value={beFrom}
              onChange={(e) => setBeFrom(e.target.value)}
              className="h-8 w-28"
              aria-label="Breakeven from"
            />
            <span className="text-sm text-muted-foreground">do</span>
            <Input
              inputMode="decimal"
              value={beTo}
              onChange={(e) => setBeTo(e.target.value)}
              className="h-8 w-28"
              aria-label="Breakeven to"
            />
            <Select
              value={beUnit}
              onValueChange={(v) => setBeUnit(v as "currency" | "pct")}
            >
              <SelectTrigger className="h-8 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="currency">{currency}</SelectItem>
                <SelectItem value="pct">% of balance</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="col-span-2 space-y-2 rounded-md border p-3">
          <div className="text-sm font-medium">Default costs</div>
          <p className="text-xs text-muted-foreground">
            Pre-filled on every new fill in the form. Always possible to
            override by hand. <strong>A positive swap is a cost</strong> — enter a
            negative number only if you earn carry on that position.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Commission per unit</Label>
              <Input
                inputMode="decimal"
                value={commPerUnit}
                onChange={(e) => setCommPerUnit(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fixed fee per fill</Label>
              <Input
                inputMode="decimal"
                value={feeFixed}
                onChange={(e) => setFeeFixed(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Swap per unit / night</Label>
              <Input
                inputMode="decimal"
                value={swapPerDay}
                onChange={(e) => setSwapPerDay(e.target.value)}
                className="h-8"
              />
            </div>
          </div>
        </div>

        <div className="col-span-2 space-y-3 rounded-md border p-3">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={ftmoMode}
              onCheckedChange={(v) => setFtmoMode(v === true)}
            />
            <span className="text-sm font-medium">FTMO account mode</span>
            <span className="text-xs text-muted-foreground">
              Rules freeze the account when breached
            </span>
          </label>

          {ftmoMode && (
            <div className="space-y-2 pl-1">
              <FtmoRule
                label="Max daily loss"
                enabled={dailyOn}
                onEnabled={setDailyOn}
                value={dailyPct}
                onValue={setDailyPct}
                suffix="% of balance / day"
              />
              {dailyOn && (
                <div className="flex items-center gap-2 pl-6">
                  <span className="text-xs text-muted-foreground">of</span>
                  <Select
                    value={dailyBasis}
                    onValueChange={(v) =>
                      setDailyBasis(v as "starting_balance" | "prev_close")
                    }
                  >
                    <SelectTrigger className="h-7 w-auto text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starting_balance">
                        starting balance (fixed — FTMO 2-Step)
                      </SelectItem>
                      <SelectItem value="prev_close">
                        previous day&apos;s close (rolling — FTMO 1-Step)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <FtmoRule
                label="Max total loss"
                enabled={maxOn}
                onEnabled={setMaxOn}
                value={maxPct}
                onValue={setMaxPct}
                suffix="% of balance (drawdown)"
              />
              <FtmoRule
                label="Profit target"
                enabled={targetOn}
                onEnabled={setTargetOn}
                value={targetPct}
                onValue={setTargetPct}
                suffix="% of balance"
              />
              <FtmoRule
                label="Min. trading days"
                enabled={minDaysOn}
                onEnabled={setMinDaysOn}
                value={minDays}
                onValue={setMinDays}
                suffix="days"
                step="1"
              />
              <p className="text-xs text-muted-foreground">
                Max total loss is always static (from the starting balance{" "}
                {balance || "0"} {currency}). Max daily loss uses whichever
                basis is picked above — fixed matches an FTMO 2-Step
                challenge, rolling matches a 1-Step. A breach = a red banner
                plus a block on new trades until you reset the challenge.
              </p>
            </div>
          )}
        </div>

        <div className="col-span-2 flex items-center justify-between">
          <Button disabled={pending} onClick={save}>
            <Save className="size-4" /> Save
          </Button>
          {/* Hidden rather than disabled on the last account: a greyed button
              invites a hover to find out why, and the reason only arrives after
              the click. The Danger zone below is where "start over" lives. */}
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={openDelete}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          )}
        </div>
      </CardContent>

      <DeleteAccountDialog
        account={account}
        usage={usage}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
      />
    </Card>
  );
}

function FtmoRule({
  label,
  enabled,
  onEnabled,
  value,
  onValue,
  suffix,
  step = "0.1",
}: {
  label: string;
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  value: string;
  onValue: (v: string) => void;
  suffix: string;
  step?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Checkbox
        checked={enabled}
        onCheckedChange={(v) => onEnabled(v === true)}
      />
      <span className="shrink-0 text-sm sm:w-40">{label}</span>
      {/* Label + input don't fit on one line inside the card on a phone, so the
          input drops to its own row rather than squeezing the label to nothing. */}
      <div className="flex basis-full items-center gap-2 pl-6 sm:basis-auto sm:pl-0">
        <Input
          type="number"
          inputMode="decimal"
          step={step}
          min="0"
          value={value}
          disabled={!enabled}
          onChange={(e) => onValue(e.target.value)}
          className="h-8 w-24"
        />
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}

export function AccountSettings({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function addNew() {
    start(async () => {
      const res = await addAccount({ name: "New Account" });
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {accounts.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            canDelete={accounts.length > 1}
          />
        ))}
      </div>
      <Button variant="outline" disabled={pending} onClick={addNew}>
        <Plus className="size-4" /> Add account
      </Button>
    </div>
  );
}
