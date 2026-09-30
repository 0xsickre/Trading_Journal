"use client";

import { useState, useTransition } from "react";
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
import {
  TOPSTEP_DEFAULT_RISK_PCT,
  TOPSTEP_PLANS,
  TOPSTEP_XFA_PAYOUT,
  TOPSTEP_XFA_SCALING,
  topstepBreakevenBand,
  type TopstepPlan,
  type TopstepStage,
} from "@/lib/journal/topstep";
import { DEFAULT_TZ } from "@/lib/journal/time";
import {
  updateAccount,
  addAccount,
  archiveAccount,
  restoreAccount,
  resetTopstepAccount,
  countAccountUsage,
  deleteAccount,
} from "@/app/(app)/settings/actions";

const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD"];

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
                    playbook answers and chart images
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
  const [currency, setCurrency] = useState(seed?.currency ?? "USD");
  const [balance, setBalance] = useState(seed ? String(seed.starting_balance) : "");

  const balanceCheck = parseSettingsNumber(balance, { min: 0 });
  const canCreate = name.trim() !== "" && balanceCheck.ok;

  function create() {
    if (!balanceCheck.ok) return;
    start(async () => {
      const res = await addAccount({
        name,
        currency,
        starting_balance: balanceCheck.value ?? 0,
        // Always the trader's zone (K5); a duplicate does not carry another.
        timezone: DEFAULT_TZ,
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
              ? "Copies the currency, timezone, costs and Topstep rules. Trades and deposits are not copied, and the challenge starts fresh."
              : "These decide how every trade on the account reads. Everything else can be set later."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-name">Name</Label>
            <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
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
          <TimezoneNote />
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

/**
 * The zone every time is shown in — the trader's, always (K5, 29.09.2026: "uvek
 * moja zona po defaultu"). Not a setting: a file that states its own offset is
 * read in that offset on import, and a Topstep account counts its days by
 * Topstep's 17:00 CT whatever the zone shows.
 */
function TimezoneNote() {
  return (
    <div className="space-y-1">
      <Label>Timezone</Label>
      <p className="text-sm">{DEFAULT_TZ.replace("_", " ")}</p>
      <p className="text-xs text-muted-foreground">
        Every time is shown in your zone. An imported file with its own offset is converted; the
        Topstep day still runs 17:00 → 17:00 CT.
      </p>
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
 * typo as 0 and re-base every drawdown and Topstep limit on the account.
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
  const [topstepResetOpen, setTopstepResetOpen] = useState(false);
  const hasTrades = trades == null || trades > 0;

  const [name, setName] = useState(account.name);
  const [currency, setCurrency] = useState(account.currency);
  const [balance, setBalance] = useState(String(account.starting_balance));

  const [topstepMode, setTopstepMode] = useState(account.topstep_mode === true);
  const [topstepPlan, setTopstepPlan] = useState<TopstepPlan>(account.topstep_plan ?? "50K");
  const [topstepStage, setTopstepStage] = useState<TopstepStage>(account.topstep_stage === "xfa" ? "xfa" : "combine");
  const [payoutDate, setPayoutDate] = useState(account.topstep_payout_at ? account.topstep_payout_at.slice(0, 10) : "");
  const [riskPct, setRiskPct] = useState(String(account.risk_rule_pct ?? 12.5));
  const [riskMin, setRiskMin] = useState(account.risk_rule_min == null ? "" : String(account.risk_rule_min));
  const [riskMax, setRiskMax] = useState(account.risk_rule_max == null ? "" : String(account.risk_rule_max));
  const [personalDll, setPersonalDll] = useState(
    account.topstep_personal_dll == null ? "" : String(account.topstep_personal_dll),
  );
  const [dailyTarget, setDailyTarget] = useState(
    account.topstep_daily_target == null ? "" : String(account.topstep_daily_target),
  );
  const plan = TOPSTEP_PLANS[topstepPlan];

  const [commPerUnit, setCommPerUnit] = useState(String(account.default_commission_per_unit));
  const [feeFixed, setFeeFixed] = useState(String(account.default_fee_fixed));

  const checks = {
    balance: parseSettingsNumber(balance, { min: 0 }),
    comm: parseSettingsNumber(commPerUnit, { min: 0 }),
    fee: parseSettingsNumber(feeFixed, { min: 0 }),
    riskPct: parseSettingsNumber(riskPct, { min: 0.1, max: 100 }),
    riskMin: parseSettingsNumber(riskMin, { min: 1, allowEmpty: true }),
    riskMax: parseSettingsNumber(riskMax, { min: 1, allowEmpty: true }),
    personalDll: parseSettingsNumber(personalDll, { min: 1, allowEmpty: true }),
    dailyTarget: parseSettingsNumber(dailyTarget, { min: 1, allowEmpty: true }),
  };
  const err = (k: keyof typeof checks) => (checks[k].ok ? null : checks[k].error);
  const val = (k: keyof typeof checks) => {
    const r = checks[k];
    return r.ok ? (r.value ?? 0) : 0;
  };
  const nullable = (k: "riskMin" | "riskMax" | "personalDll" | "dailyTarget") => {
    const r = checks[k];
    return r.ok ? r.value : null;
  };
  const riskOrder =
    nullable("riskMin") != null && nullable("riskMax") != null && nullable("riskMin")! > nullable("riskMax")!
      ? "The minimum is above the maximum."
      : null;
  const invalid =
    Object.values(checks).some((c) => !c.ok) || riskOrder != null || !name.trim();

  const balanceChanged = checks.balance.ok && val("balance") !== account.starting_balance;

  function save() {
    if (invalid) return;
    start(async () => {
      const res = await updateAccount(account.id, {
        name: name.trim(),
        currency,
        starting_balance: val("balance"),
        default_commission_per_unit: val("comm"),
        default_fee_fixed: val("fee"),
        topstep_mode: topstepMode,
        topstep_plan: topstepPlan,
        topstep_stage: topstepStage,
        topstep_payout_at: payoutDate ? new Date(`${payoutDate}T00:00:00Z`).toISOString() : null,
        risk_rule_pct: val("riskPct"),
        risk_rule_min: nullable("riskMin"),
        risk_rule_max: nullable("riskMax"),
        topstep_personal_dll: nullable("personalDll"),
        topstep_daily_target: nullable("dailyTarget"),
      });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Account saved");
        onOpenChange(false);
      }
    });
  }

  function resetTopstep() {
    start(async () => {
      const res = await resetTopstepAccount(account.id);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Topstep account reset");
        setTopstepResetOpen(false);
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
                ? "Changes every drawdown % and the Topstep floor on past trades too."
                : checks.balance.ok
                  ? fmtMoney(val("balance"), currency)
                  : undefined
            }
          />
          <div className="sm:col-span-2">
            <TimezoneNote />
          </div>
        </div>

        <section className="space-y-1 rounded-md border p-3">
          <h3 className="text-sm font-medium">Breakeven range</h3>
          <p className="text-sm tabular-nums">
            {topstepMode
              ? `±0.1R of the trade's risk · ±${fmtMoney(topstepBreakevenBand(topstepPlan), currency)} without a stop`
              : `${fmtMoney(account.breakeven_from, currency)} to ${fmtMoney(account.breakeven_to, currency)}`}
          </p>
          <p className="text-xs text-muted-foreground">
            Fixed, not a setting: a trade whose net P&amp;L is within 0.1R of its own risk to
            the stop is a scratch — a full stop on one micro contract is a loss, however few
            dollars it is. A trade with no stop, and a day or a week, use 0.1R of the plan&apos;s
            starting risk budget ({TOPSTEP_DEFAULT_RISK_PCT} % of the room above the MLL).
          </p>
        </section>

        <section className="space-y-2 rounded-md border p-3">
          <h3 className="text-sm font-medium">Default costs</h3>
          <p className="text-xs text-muted-foreground">
            Pre-filled on every new fill.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField id={`com-${account.id}`} label="Commission per unit" value={commPerUnit} onChange={setCommPerUnit} error={err("comm")} />
            <NumberField id={`fee-${account.id}`} label="Fixed fee per fill" value={feeFixed} onChange={setFeeFixed} error={err("fee")} />
          </div>
        </section>

        <section className="space-y-3 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`topstep-${account.id}`}
              checked={topstepMode}
              onCheckedChange={(v) => setTopstepMode(v === true)}
            />
            <Label htmlFor={`topstep-${account.id}`} className="text-sm font-medium">
              Topstep rules (futures)
            </Label>
          </div>
          {topstepMode && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`tsplan-${account.id}`} className="text-xs">
                    Plan
                  </Label>
                  <Select value={topstepPlan} onValueChange={(v) => setTopstepPlan(v as TopstepPlan)}>
                    <SelectTrigger id={`tsplan-${account.id}`} className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TOPSTEP_PLANS) as TopstepPlan[]).map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`tsstage-${account.id}`} className="text-xs">
                    Phase
                  </Label>
                  <Select value={topstepStage} onValueChange={(v) => setTopstepStage(v as TopstepStage)}>
                    <SelectTrigger id={`tsstage-${account.id}`} className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="combine">Trading Combine</SelectItem>
                      <SelectItem value="xfa">Express Funded Account</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`tspay-${account.id}`} className="text-xs">
                    First payout date (or record the payout under Deposits / withdrawals)
                  </Label>
                  <Input
                    id={`tspay-${account.id}`}
                    type="date"
                    className="h-8"
                    value={payoutDate}
                    onChange={(e) => setPayoutDate(e.target.value)}
                  />
                </div>
              </div>
              {topstepStage === "combine" ? (
                <p className="text-xs text-muted-foreground">
                  Max loss {fmtMoney(plan.mll, "USD")}, trailing the highest end-of-day balance and
                  locking at the starting balance · daily loss {fmtMoney(plan.dll, "USD")} · target{" "}
                  {fmtMoney(plan.target, "USD")}, best day at most 55 % of it · at most {plan.maxMini} mini /{" "}
                  {plan.maxMini * 10} micro.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Starting balance $0 (TopstepX shows the XFA from $0) · max loss {fmtMoney(plan.mll, "USD")},
                  trailing the end-of-day balance and locking at $0, and $0 for good after the first payout · no
                  target. Contracts by the Scaling Plan, from the balance at the last close:{" "}
                  {TOPSTEP_XFA_SCALING[topstepPlan]
                    .map(([from, mini]) => `${Number.isFinite(from) ? `from ${fmtMoney(from, "USD")}` : "below"} ${mini}`)
                    .join(" · ")}{" "}
                  mini (a micro is a tenth). Payout: Standard — {TOPSTEP_XFA_PAYOUT.winningDays} days of{" "}
                  {fmtMoney(TOPSTEP_XFA_PAYOUT.winningDay, "USD")}+; Consistency — {TOPSTEP_XFA_PAYOUT.consistencyDays}{" "}
                  days, best day at most {TOPSTEP_XFA_PAYOUT.consistencyShare * 100} % of the profit; at most half the
                  balance, up to {fmtMoney(TOPSTEP_XFA_PAYOUT.caps[topstepPlan].standard, "USD")} /{" "}
                  {fmtMoney(TOPSTEP_XFA_PAYOUT.caps[topstepPlan].consistency, "USD")}.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField
                  id={`pdll-${account.id}`}
                  label="Personal daily loss limit (empty = the plan's DLL)"
                  value={personalDll}
                  onChange={setPersonalDll}
                  error={err("personalDll")}
                />
                <NumberField
                  id={`ptgt-${account.id}`}
                  label="Personal daily profit target (empty = none)"
                  value={dailyTarget}
                  onChange={setDailyTarget}
                  error={err("dailyTarget")}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The same two numbers as TopstepX › Risk Limits. Either one ends the trading day: the
                banner counts down to both, and the tracker grades the day&apos;s loss against the
                tighter of the two loss limits and any entry taken after the target was banked. There
                is no limit on the number of trades.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <NumberField
                  id={`rp-${account.id}`}
                  label="Risk per trade, % of room above the MLL"
                  value={riskPct}
                  onChange={setRiskPct}
                  error={err("riskPct")}
                />
                <NumberField
                  id={`rmin-${account.id}`}
                  label={`At least (empty = ${fmtMoney(plan.riskMin, "USD")})`}
                  value={riskMin}
                  onChange={setRiskMin}
                  error={err("riskMin") ?? riskOrder}
                />
                <NumberField
                  id={`rmax-${account.id}`}
                  label={`At most (empty = ${fmtMoney(plan.riskMax, "USD")})`}
                  value={riskMax}
                  onChange={setRiskMax}
                  error={err("riskMax")}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The trade form sizes a planned futures trade from this: whole contracts, rounded down,
                commission counted, never over today&apos;s daily loss room.
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <p className="text-xs text-muted-foreground">
                  Reaching the MLL shows a red banner and blocks new plans until the account is
                  reset. A trade that already closed can always be logged.
                </p>
                <Button variant="outline" size="sm" onClick={() => setTopstepResetOpen(true)} disabled={pending}>
                  <RotateCcw className="size-4" /> Reset account…
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

      <Dialog open={topstepResetOpen} onOpenChange={setTopstepResetOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset the Topstep account?</DialogTitle>
            <DialogDescription>
              Trades before now stop counting toward the Topstep limits — the balance starts again
              from the starting balance and a reached MLL is cleared. The trades themselves stay.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTopstepResetOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={resetTopstep} disabled={pending}>
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
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
      <td className="px-3 py-2 text-muted-foreground">{account.currency}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {fmtMoney(account.starting_balance, account.currency)}
      </td>
      <td className="px-3 py-2">
        {account.topstep_mode ? (
          <Badge variant="secondary">Topstep {account.topstep_plan}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
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
                Hidden from every account picker. Their trades still count under All accounts.
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
