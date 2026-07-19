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

  function save() {
    start(async () => {
      const res = await updateAccount(account.id, {
        name: name.trim() || account.name,
        timezone: tz,
        currency,
        starting_balance: Number(balance) || 0,
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
        <div className="col-span-2 space-y-3 rounded-md border p-3">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={ftmoMode}
              onCheckedChange={(v) => setFtmoMode(v === true)}
            />
            <span className="text-sm font-medium">FTMO nalog mod</span>
            <span className="text-xs text-muted-foreground">
              Pravila zamrznu nalog kad se prekrše
            </span>
          </label>

          {ftmoMode && (
            <div className="space-y-2 pl-1">
              <FtmoRule
                label="Max dnevni gubitak"
                enabled={dailyOn}
                onEnabled={setDailyOn}
                value={dailyPct}
                onValue={setDailyPct}
                suffix="% balansa / dan"
              />
              <FtmoRule
                label="Max ukupni gubitak"
                enabled={maxOn}
                onEnabled={setMaxOn}
                value={maxPct}
                onValue={setMaxPct}
                suffix="% balansa (drawdown)"
              />
              <FtmoRule
                label="Profitni cilj"
                enabled={targetOn}
                onEnabled={setTargetOn}
                value={targetPct}
                onValue={setTargetPct}
                suffix="% balansa"
              />
              <FtmoRule
                label="Min. trading dana"
                enabled={minDaysOn}
                onEnabled={setMinDaysOn}
                value={minDays}
                onValue={setMinDays}
                suffix="dana"
                step="1"
              />
              <p className="text-xs text-muted-foreground">
                Drawdown je statički (od početnog balansa {balance || "0"}{" "}
                {currency}). Prekršaj = crveni banner + blokada novih trejdova dok
                ne resetuješ izazov.
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
    <div className="flex items-center gap-2">
      <Checkbox
        checked={enabled}
        onCheckedChange={(v) => onEnabled(v === true)}
      />
      <span className="w-40 text-sm">{label}</span>
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
