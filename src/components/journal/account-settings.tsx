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

  function save() {
    start(async () => {
      const res = await updateAccount(account.id, {
        name: name.trim() || account.name,
        timezone: tz,
        currency,
        starting_balance: Number(balance) || 0,
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
        <div className="col-span-2">
          <Button disabled={pending} onClick={save}>
            <Save className="size-4" /> Save
          </Button>
        </div>
      </CardContent>
    </Card>
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
