"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Save } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import type { Account } from "@/lib/journal/types";
import { updateAccount, addAccount } from "@/app/(app)/settings/actions";

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

function AccountCard({ account }: { account: Account }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(account.name);
  const [tz, setTz] = useState(account.timezone);
  const [currency, setCurrency] = useState(account.currency);
  const [balance, setBalance] = useState(String(account.starting_balance));

  // FTMO / prop-firm challenge mode.
  const [ftmoMode, setFtmoMode] = useState(account.ftmo_mode);
  const [dailyOn, setDailyOn] = useState(account.ftmo_daily_loss_enabled);
  const [dailyPct, setDailyPct] = useState(String(account.ftmo_daily_loss_pct));
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
                suffix="dana"
                step="1"
              />
              <p className="text-xs text-muted-foreground">
                Drawdown is static (from the starting balance {balance || "0"}{" "}
                {currency}). A breach = a red banner plus a block on new trades
                until you reset the challenge.
              </p>
            </div>
          )}
        </div>

        <div className="col-span-2">
          <Button disabled={pending} onClick={save}>
            <Save className="size-4" /> Save
          </Button>
        </div>
      </CardContent>
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
          <AccountCard key={a.id} account={a} />
        ))}
      </div>
      <Button variant="outline" disabled={pending} onClick={addNew}>
        <Plus className="size-4" /> Add account
      </Button>
    </div>
  );
}
