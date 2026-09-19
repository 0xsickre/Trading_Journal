"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Copy,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Checkbox } from "@/components/ui/checkbox";
import type { Account } from "@/lib/journal/types";
import { parseSettingsNumber } from "@/lib/journal/settings-rules";
import { duplicateSettings, isArchived } from "@/lib/journal/account-rules";
import { fmtMoney } from "@/lib/journal/format";
import { isValidTimeZone } from "@/lib/journal/time";
import {
  updateAccount,
  addAccount,
  archiveAccount,
  restoreAccount,
  resetFtmoChallenge,
  countAccountUsage,
  deleteAccount,
} from "@/app/(app)/settings/actions";

const COMMON_TIMEZONES = [
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

/** Every zone the browser knows, for the searchable list; the common ones first. */
function allTimezones(): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  return [...new Set([...COMMON_TIMEZONES, ...all])];
}

const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD"];

const KIND_LABEL: Record<Account["account_kind"], string> = {
  trading: "Live",
  backtest: "Backtest",
};
const KIND_HELP: Record<Account["account_kind"], string> = {
  trading: "Real money. MAE/MFE is filled from MT5 by the sync script.",
  backtest: "Replayed trades. MAE/MFE comes from the TradingView import.",
};

// --- Delete permanently -------------------------------------------------------

/**
 * Deleting one account for good.
 *
 * An account holding nothing is a mistake being tidied away — one button. One
 * holding trades is the only click in this application that destroys trade
 * records and that undo does not cover, so it names what disappears and asks
 * for the name to be typed. Archive, beside it in the menu, is the reversible
 * option.
 */
function DeleteAccountDialog({
  account,
  usage,
  counting,
  open,
  onOpenChange,
}: {
  account: Account;
  usage: AccountUsage;
  /** True while the contents are still being counted. */
  counting: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [pending, start] = useTransition();
  const [typed, setTyped] = useState("");

  const empty = usageIsEmpty(usage);
  const unknown = usageIsUnknown(usage);
  const nameMatches = typed.trim() === account.name.trim();

  function close(v: boolean) {
    // A typed confirmation must not survive a Cancel into the next opening.
    if (!v) setTyped("");
    onOpenChange(v);
  }

  function confirm() {
    start(async () => {
      const res = await deleteAccount(account.id, typed);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(`Account "${account.name}" deleted`);
        close(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{account.name}&rdquo; permanently?</DialogTitle>
          <DialogDescription>
            {counting
              ? "Checking what this account holds…"
              : empty
              ? "This account holds no trades, no deposits and no imports. Nothing else is affected."
              : "This cannot be undone, and import undo does not cover it. To keep the history, archive the account instead."}
          </DialogDescription>
        </DialogHeader>

        {!empty && (
          <div className="space-y-3">
            <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              {counting ? (
                <li className="text-muted-foreground">Checking what this account holds…</li>
              ) : unknown ? (
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
              <Label htmlFor={`confirm-${account.id}`} className="text-xs">
                Type <span className="font-mono">{account.name}</span> to confirm
              </Label>
              <Input
                id={`confirm-${account.id}`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || counting || (!empty && !nameMatches)}
            onClick={confirm}
          >
            <Trash2 className="size-4" />
            {pending ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Create / duplicate ------------------------------------------------------

/** The new-account dialog, also used for a duplicate (prefilled). */
function CreateAccountDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The account being duplicated, or null for a blank new one. */
  source: Account | null;
}) {
  const [pending, start] = useTransition();
  const seed = source ? duplicateSettings(source) : null;
  const [name, setName] = useState(seed?.name ?? "");
  const [kind, setKind] = useState<Account["account_kind"]>(seed?.account_kind ?? "trading");
  const [currency, setCurrency] = useState(seed?.currency ?? "USD");
  const [balance, setBalance] = useState(seed ? String(seed.starting_balance) : "");
  const [tz, setTz] = useState(seed?.timezone ?? "America/New_York");

  const balanceCheck = parseSettingsNumber(balance, { min: 0 });
  const tzOk = isValidTimeZone(tz);
  const canCreate = name.trim() !== "" && balanceCheck.ok && tzOk;

  function create() {
    if (!balanceCheck.ok) return;
    start(async () => {
      const res = await addAccount({
        name,
        account_kind: kind,
        currency,
        starting_balance: balanceCheck.value ?? 0,
        timezone: tz,
        copyFrom: source?.id ?? null,
      });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(source ? `Duplicated "${source.name}"` : "Account created");
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{source ? `Duplicate "${source.name}"` : "New account"}</DialogTitle>
          <DialogDescription>
            {source
              ? "Copies the type, currency, timezone, breakeven range, costs and FTMO rules. Trades and deposits are not copied, and the challenge starts fresh."
              : "These decide how every trade on the account reads. Everything else can be set later."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-name">Name</Label>
            <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <KindField value={kind} onChange={setKind} id="new-kind" />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="new-currency">
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
            <NumberField
              id="new-balance"
              label="Starting balance"
              value={balance}
              onChange={setBalance}
              error={balance.trim() === "" ? null : balanceCheck.ok ? null : balanceCheck.error}
              hint={balanceCheck.ok && balanceCheck.value != null ? fmtMoney(balanceCheck.value, currency) : undefined}
            />
          </div>
          <TimezoneField id="new-tz" value={tz} onChange={setTz} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={create} disabled={pending || !canCreate}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Shared fields ------------------------------------------------------------

function KindField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Account["account_kind"];
  onChange: (v: Account["account_kind"]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Type</Label>
      <Select value={value} onValueChange={(v) => onChange(v as Account["account_kind"])}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="trading">Live</SelectItem>
          <SelectItem value="backtest">Backtest</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{KIND_HELP[value]}</p>
    </div>
  );
}

/** A searchable timezone input that shows the current value even when it is not in the short list. */
function TimezoneField({
  id,
  value,
  onChange,
  warning,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  warning?: string | null;
}) {
  const zones = useMemo(() => allTimezones(), []);
  const ok = isValidTimeZone(value);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Timezone</Label>
      <Input
        id={id}
        list={`${id}-list`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!ok}
        autoComplete="off"
      />
      <datalist id={`${id}-list`}>
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      {!ok ? (
        <p className="text-xs text-destructive">Unknown timezone — pick one from the list.</p>
      ) : warning ? (
        <p className="text-xs text-amber-600 dark:text-amber-500">{warning}</p>
      ) : (
        <p className="text-xs text-muted-foreground">Decides which day every trade belongs to.</p>
      )}
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  hint?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error != null}
        className="h-8"
      />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

// --- Edit ---------------------------------------------------------------------

/**
 * Every setting of one account, with one Save.
 *
 * Numbers are checked as they are typed and a value that cannot be read is
 * named under its field and blocks the save — `Number(x) || 0` used to store a
 * typo as 0 and re-base every drawdown and FTMO limit on the account.
 */
function EditAccountDialog({
  account,
  trades,
  open,
  onOpenChange,
}: {
  account: Account;
  /** Trades on the account, or null when the count failed. */
  trades: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [pending, start] = useTransition();
  const [resetOpen, setResetOpen] = useState(false);
  const hasTrades = trades == null || trades > 0;

  const [name, setName] = useState(account.name);
  const [kind, setKind] = useState<Account["account_kind"]>(account.account_kind ?? "trading");
  const [tz, setTz] = useState(account.timezone);
  const [currency, setCurrency] = useState(account.currency);
  const [balance, setBalance] = useState(String(account.starting_balance));

  const [ftmoMode, setFtmoMode] = useState(account.ftmo_mode);
  const [dailyOn, setDailyOn] = useState(account.ftmo_daily_loss_enabled);
  const [dailyPct, setDailyPct] = useState(String(account.ftmo_daily_loss_pct));
  const [dailyBasis, setDailyBasis] = useState(account.ftmo_daily_loss_basis);
  const [maxOn, setMaxOn] = useState(account.ftmo_max_loss_enabled);
  const [maxPct, setMaxPct] = useState(String(account.ftmo_max_loss_pct));
  const [targetOn, setTargetOn] = useState(account.ftmo_profit_target_enabled);
  const [targetPct, setTargetPct] = useState(String(account.ftmo_profit_target_pct));
  const [minDaysOn, setMinDaysOn] = useState(account.ftmo_min_days_enabled);
  const [minDays, setMinDays] = useState(String(account.ftmo_min_days));

  const [beFrom, setBeFrom] = useState(String(account.breakeven_from));
  const [beTo, setBeTo] = useState(String(account.breakeven_to));
  const [beUnit, setBeUnit] = useState(account.breakeven_unit);

  const [commPerUnit, setCommPerUnit] = useState(String(account.default_commission_per_unit));
  const [feeFixed, setFeeFixed] = useState(String(account.default_fee_fixed));
  const [swapPerDay, setSwapPerDay] = useState(String(account.default_swap_per_day));

  const checks = {
    balance: parseSettingsNumber(balance, { min: 0 }),
    beFrom: parseSettingsNumber(beFrom),
    beTo: parseSettingsNumber(beTo),
    comm: parseSettingsNumber(commPerUnit, { min: 0 }),
    fee: parseSettingsNumber(feeFixed, { min: 0 }),
    swap: parseSettingsNumber(swapPerDay),
    daily: parseSettingsNumber(dailyPct, { min: 0, max: 100 }),
    max: parseSettingsNumber(maxPct, { min: 0, max: 100 }),
    target: parseSettingsNumber(targetPct, { min: 0, max: 100 }),
    minDays: parseSettingsNumber(minDays, { min: 0, max: 365, integer: true }),
  };
  const err = (k: keyof typeof checks) => (checks[k].ok ? null : checks[k].error);
  const val = (k: keyof typeof checks) => {
    const r = checks[k];
    return r.ok ? (r.value ?? 0) : 0;
  };
  const beOrder =
    checks.beFrom.ok && checks.beTo.ok && val("beFrom") > val("beTo")
      ? "'From' must be less than or equal to 'to'."
      : null;
  const invalid =
    Object.values(checks).some((c) => !c.ok) || beOrder != null || !isValidTimeZone(tz) || !name.trim();

  const balanceChanged = checks.balance.ok && val("balance") !== account.starting_balance;
  const tzChanged = tz !== account.timezone;

  function save() {
    if (invalid) return;
    start(async () => {
      const res = await updateAccount(account.id, {
        name: name.trim(),
        account_kind: kind,
        timezone: tz,
        currency,
        starting_balance: val("balance"),
        breakeven_from: val("beFrom"),
        breakeven_to: val("beTo"),
        breakeven_unit: beUnit,
        default_commission_per_unit: val("comm"),
        default_fee_fixed: val("fee"),
        default_swap_per_day: val("swap"),
        ftmo_mode: ftmoMode,
        ftmo_daily_loss_enabled: dailyOn,
        ftmo_daily_loss_pct: val("daily"),
        ftmo_daily_loss_basis: dailyBasis,
        ftmo_max_loss_enabled: maxOn,
        ftmo_max_loss_pct: val("max"),
        ftmo_profit_target_enabled: targetOn,
        ftmo_profit_target_pct: val("target"),
        ftmo_min_days_enabled: minDaysOn,
        ftmo_min_days: val("minDays"),
      });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Account saved");
        onOpenChange(false);
      }
    });
  }

  function resetChallenge() {
    start(async () => {
      const res = await resetFtmoChallenge(account.id);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Challenge restarted");
        setResetOpen(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit &ldquo;{account.name}&rdquo;</DialogTitle>
          <DialogDescription>Everything here is saved together.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`name-${account.id}`}>Name</Label>
            <Input id={`name-${account.id}`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <KindField id={`kind-${account.id}`} value={kind} onChange={setKind} />

          <div className="space-y-1.5">
            <Label htmlFor={`cur-${account.id}`}>Currency</Label>
            <Select value={currency} onValueChange={setCurrency} disabled={hasTrades}>
              <SelectTrigger id={`cur-${account.id}`}>
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
            <p className="text-xs text-muted-foreground">
              {hasTrades
                ? "Locked: the trades on this account were converted into this currency."
                : "Locked once the first trade is saved."}
            </p>
          </div>
          <NumberField
            id={`bal-${account.id}`}
            label="Starting balance"
            value={balance}
            onChange={setBalance}
            error={err("balance")}
            hint={
              balanceChanged && hasTrades
                ? "Changes every drawdown % and FTMO limit on past trades too."
                : checks.balance.ok
                  ? fmtMoney(val("balance"), currency)
                  : undefined
            }
          />
          <div className="sm:col-span-2">
            <TimezoneField
              id={`tz-${account.id}`}
              value={tz}
              onChange={setTz}
              warning={
                tzChanged && hasTrades
                  ? "Past trades will be re-dated to this timezone's days."
                  : null
              }
            />
          </div>
        </div>

        <section className="space-y-2 rounded-md border p-3">
          <h3 className="text-sm font-medium">Breakeven range</h3>
          <p className="text-xs text-muted-foreground">
            A trade whose net P&amp;L lands in this range counts as breakeven. Usually
            from minus your costs to 0.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField id={`bef-${account.id}`} label="From" value={beFrom} onChange={setBeFrom} error={err("beFrom") ?? beOrder} />
            <NumberField id={`bet-${account.id}`} label="To" value={beTo} onChange={setBeTo} error={err("beTo")} />
            <div className="space-y-1.5">
              <Label htmlFor={`beu-${account.id}`} className="text-xs">
                Unit
              </Label>
              <Select value={beUnit} onValueChange={(v) => setBeUnit(v as "currency" | "pct")}>
                <SelectTrigger id={`beu-${account.id}`} className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="currency">{currency}</SelectItem>
                  <SelectItem value="pct">% of balance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="space-y-2 rounded-md border p-3">
          <h3 className="text-sm font-medium">Default costs</h3>
          <p className="text-xs text-muted-foreground">
            Pre-filled on every new fill. A positive swap is a cost.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField id={`com-${account.id}`} label="Commission per unit" value={commPerUnit} onChange={setCommPerUnit} error={err("comm")} />
            <NumberField id={`fee-${account.id}`} label="Fixed fee per fill" value={feeFixed} onChange={setFeeFixed} error={err("fee")} />
            <NumberField id={`swp-${account.id}`} label="Swap per unit / night" value={swapPerDay} onChange={setSwapPerDay} error={err("swap")} />
          </div>
        </section>

        <section className="space-y-3 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`ftmo-${account.id}`}
              checked={ftmoMode}
              onCheckedChange={(v) => setFtmoMode(v === true)}
            />
            <Label htmlFor={`ftmo-${account.id}`} className="text-sm font-medium">
              FTMO challenge rules
            </Label>
          </div>
          {ftmoMode && (
            <div className="space-y-2">
              <FtmoRule id={`d-${account.id}`} label="Max daily loss" enabled={dailyOn} onEnabled={setDailyOn} value={dailyPct} onValue={setDailyPct} suffix="%" error={err("daily")} />
              {dailyOn && (
                <div className="flex items-center gap-2 pl-6">
                  <span className="text-xs text-muted-foreground">of</span>
                  <Select
                    value={dailyBasis}
                    onValueChange={(v) => setDailyBasis(v as "starting_balance" | "prev_close")}
                  >
                    <SelectTrigger className="h-7 w-auto text-xs" aria-label="Daily loss basis">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starting_balance">starting balance (2-Step)</SelectItem>
                      <SelectItem value="prev_close">previous day&apos;s close (1-Step)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <FtmoRule id={`m-${account.id}`} label="Max total loss" enabled={maxOn} onEnabled={setMaxOn} value={maxPct} onValue={setMaxPct} suffix="%" error={err("max")} />
              <FtmoRule id={`t-${account.id}`} label="Profit target" enabled={targetOn} onEnabled={setTargetOn} value={targetPct} onValue={setTargetPct} suffix="%" error={err("target")} />
              <FtmoRule id={`n-${account.id}`} label="Min. trading days" enabled={minDaysOn} onEnabled={setMinDaysOn} value={minDays} onValue={setMinDays} suffix="days" error={err("minDays")} />
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <p className="text-xs text-muted-foreground">
                  A breach shows a red banner and blocks new trades until the
                  challenge is restarted.
                </p>
                <Button variant="outline" size="sm" onClick={() => setResetOpen(true)} disabled={pending}>
                  <RotateCcw className="size-4" /> Restart challenge…
                </Button>
              </div>
            </div>
          )}
        </section>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || invalid}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Restart the challenge?</DialogTitle>
            <DialogDescription>
              Trades before now stop counting toward the FTMO limits, and a
              breach is cleared. The trades themselves stay.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={resetChallenge} disabled={pending}>
              Restart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function FtmoRule({
  id,
  label,
  enabled,
  onEnabled,
  value,
  onValue,
  suffix,
  error,
}: {
  id: string;
  label: string;
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  value: string;
  onValue: (v: string) => void;
  suffix: string;
  error: string | null;
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox id={`${id}-on`} checked={enabled} onCheckedChange={(v) => onEnabled(v === true)} />
        {/* The text is the checkbox's label, so clicking it toggles the rule. */}
        <Label htmlFor={`${id}-on`} className="shrink-0 text-sm font-normal sm:w-40">
          {label}
        </Label>
        <Input
          id={`${id}-val`}
          aria-label={`${label} value`}
          inputMode="decimal"
          value={value}
          disabled={!enabled}
          onChange={(e) => onValue(e.target.value)}
          aria-invalid={error != null}
          className="h-8 w-24"
        />
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
      {enabled && error && <p className="pl-6 text-xs text-destructive">{error}</p>}
    </div>
  );
}

// --- The list -----------------------------------------------------------------

function AccountRow({
  account,
  trades,
  canArchive,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  account: Account;
  trades: number | null;
  canArchive: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [pending, start] = useTransition();
  const archived = isArchived(account);

  function toggleArchive() {
    start(async () => {
      const res = archived ? await restoreAccount(account.id) : await archiveAccount(account.id);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(archived ? `Restored "${account.name}"` : `Archived "${account.name}"`);
      }
    });
  }

  return (
    <tr className="border-b last:border-0">
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{account.name}</span>
          {account.is_active && !archived && <Badge variant="secondary">Default</Badge>}
        </div>
      </td>
      <td className="px-3 py-2">
        <Badge variant="outline">{KIND_LABEL[account.account_kind ?? "trading"]}</Badge>
      </td>
      <td className="px-3 py-2 text-muted-foreground">{account.currency}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {fmtMoney(account.starting_balance, account.currency)}
      </td>
      <td className="px-3 py-2">
        {account.ftmo_mode ? <Badge variant="secondary">FTMO</Badge> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {trades == null ? <span title="Count unavailable">—</span> : trades}
      </td>
      <td className="w-10 px-3 py-2 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" disabled={pending} aria-label={`Actions for ${account.name}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="size-4" /> Edit…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy className="size-4" /> Duplicate…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={toggleArchive}
              disabled={!archived && !canArchive}
              title={!archived && !canArchive ? "Your only account that is not archived." : undefined}
            >
              {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
              {archived ? "Restore" : "Archive (reversible)"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 className="size-4" /> Delete permanently…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function AccountTable({
  rows,
  tradeCounts,
  canArchive,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  rows: Account[];
  tradeCounts: Record<string, number | null>;
  canArchive: boolean;
  onEdit: (a: Account) => void;
  onDuplicate: (a: Account) => void;
  onDelete: (a: Account) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-2xl text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Account</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Currency</th>
            <th className="px-3 py-2 text-right font-medium">Starting balance</th>
            <th className="px-3 py-2 font-medium">Rules</th>
            <th className="px-3 py-2 text-right font-medium">Trades</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              trades={tradeCounts[a.id] ?? null}
              canArchive={canArchive}
              onEdit={() => onEdit(a)}
              onDuplicate={() => onDuplicate(a)}
              onDelete={() => onDelete(a)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Accounts as a compact list — one row each, everything else behind its menu.
 *
 * Built for many prop-firm accounts: a card per account with the whole form
 * open stopped being readable past three. Archived accounts fold away under
 * their own heading, still one click from Restore.
 */
export function AccountSettings({
  accounts,
  tradeCounts = {},
}: {
  accounts: Account[];
  /** Trades per account id; null when a count failed. */
  tradeCounts?: Record<string, number | null>;
}) {
  const [editing, setEditing] = useState<Account | null>(null);
  const [creating, setCreating] = useState<{ source: Account | null } | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [usage, setUsage] = useState<AccountUsage>(UNKNOWN_USAGE);
  const [counting, setCounting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [, startCount] = useTransition();

  const live = accounts.filter((a) => !isArchived(a));
  const archived = accounts.filter((a) => isArchived(a));

  function openDelete(a: Account) {
    setUsage(UNKNOWN_USAGE);
    setCounting(true);
    setDeleting(a);
    startCount(async () => {
      const res = await countAccountUsage(a.id);
      if (res.ok) setUsage(res.usage);
      setCounting(false);
    });
  }

  const table = (rows: Account[]) => (
    <AccountTable
      rows={rows}
      tradeCounts={tradeCounts}
      canArchive={live.length > 1}
      onEdit={setEditing}
      onDuplicate={(a) => setCreating({ source: a })}
      onDelete={openDelete}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {live.length} {live.length === 1 ? "account" : "accounts"}
          {archived.length > 0 && `, ${archived.length} archived`}
        </p>
        <Button size="sm" onClick={() => setCreating({ source: null })}>
          <Plus className="size-4" /> New account
        </Button>
      </div>

      {table(live)}

      {archived.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            aria-expanded={showArchived}
          >
            {showArchived ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            Archived ({archived.length})
          </button>
          {showArchived && (
            <>
              <p className="text-xs text-muted-foreground">
                Hidden from every account picker. Their trades still count under All and under
                Live / Backtest.
              </p>
              {table(archived)}
            </>
          )}
        </div>
      )}

      {editing && (
        <EditAccountDialog
          key={editing.id}
          account={editing}
          trades={tradeCounts[editing.id] ?? null}
          open
          onOpenChange={(v) => !v && setEditing(null)}
        />
      )}
      {creating && (
        <CreateAccountDialog
          key={creating.source?.id ?? "new"}
          source={creating.source}
          open
          onOpenChange={(v) => !v && setCreating(null)}
        />
      )}
      {deleting && (
        <DeleteAccountDialog
          account={deleting}
          usage={usage}
          counting={counting}
          open
          onOpenChange={(v) => !v && setDeleting(null)}
        />
      )}
    </div>
  );
}
