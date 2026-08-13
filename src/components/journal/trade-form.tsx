"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Trash2,
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EditableSelect } from "@/components/journal/editable-select";
import { TagMultiSelect } from "@/components/journal/tag-multi-select";
import { TradeImages } from "@/components/journal/trade-images";
import {
  TradeImageDrafts,
  imageDraftsToPayload,
  type ImageDrafts,
  type PreImageKind,
} from "@/components/journal/trade-image-drafts";
import { PlaybookChecklist } from "@/components/journal/playbook-checklist";
import {
  buildFormTabs,
  type FieldConfig,
  type FormGroup,
} from "@/lib/journal/form-config";
import type { FieldDef } from "@/lib/journal/field-def-types";
import { ruleAppliesTo, type Playbook } from "@/lib/journal/playbook-types";
import type { Account, Instrument, OptionsMap, TradeRow } from "@/lib/journal/types";
import {
  computeEntrySlippage,
  fmtSlippagePts,
  fmtSlippageR,
} from "@/lib/journal/entry-slippage";
import { exitEfficiencyFromTrade, fmtExitEfficiencyPct } from "@/lib/journal/exit-efficiency";
import { excursionFromTrade } from "@/lib/journal/excursion";
import { fmtMoney, fmtR, pnlClass } from "@/lib/journal/format";
import {
  computePlannedRewardR,
  computePositionSize,
  computeRiskAmount,
  formatPlannedRewardR,
  inferDirectionFromPrices,
  parseRiskPct,
  riskPlanFieldVisible,
  thesisGroupVisible,
} from "@/lib/journal/plan-calculations";
import { computePositionStats } from "@/lib/journal/position-stats";
import { utcToZonedInput, zonedInputToUtc, fmtInTz } from "@/lib/journal/time";
import {
  NO_COST_DEFAULTS,
  nightsBetween,
  prefillFee,
  prefillSwap,
} from "@/lib/journal/cost-defaults";
import {
  createTrade,
  updateTrade,
  markTradeMissed,
  restoreTradeToPlanned,
  type ExecutionInput,
} from "@/app/(app)/trades/actions";
import {
  canMarkMissed,
  canRestoreToPlanned,
  isValidFill,
  statusToTradePhase,
  type TradePhase,
} from "@/lib/journal/trade-lifecycle";
import {
  getTradeFormPrefs,
  setTradeFormPrefs,
  defaultRiskPctOption,
} from "@/lib/journal/trade-form-prefs";
import { cn } from "@/lib/utils";

type ExecRow = {
  side: "entry" | "exit";
  price: string;
  qty: string;
  executedLocal: string;
  fee: string;
  swap: string;
};

export type FieldValue = string | number | string[] | null;

export type TradeFormInitial = {
  id: string;
  account_id: string | null;
  trade_no: number | null;
  status?: string;
  missed_at?: string | null;
  playbook_id?: string | null;
  conviction?: number | null;
  /** Rule id → followed, for rules answered on this trade. */
  rule_answers?: Record<string, boolean>;
  fields: Record<string, FieldValue>;
  executions: {
    side: "entry" | "exit";
    price: number;
    qty: number;
    executed_at: string;
    fee: number;
    swap_funding: number;
  }[];
};

function n(v: string): number | null {
  if (v == null || v.trim() === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function initialTradePhase(initial?: TradeFormInitial): TradePhase {
  if (!initial) return "planned";
  return statusToTradePhase(initial.status);
}

function defaultTab(initial?: TradeFormInitial): "plan" | "execution" {
  if (!initial) return "plan";
  const hasExit = initial.executions.some((e) => e.side === "exit");
  if (hasExit || initial.executions.length > 0) return "execution";
  if (
    initial.status === "open" ||
    initial.status === "partial" ||
    initial.status === "closed"
  ) {
    return "execution";
  }
  return "plan";
}

export function TradeForm({
  optionsMap,
  instruments,
  accounts,
  fieldDefs = [],
  playbooks = [],
  initial,
  ftmoFailedAccountIds = [],
  accountEquity = {},
}: {
  optionsMap: OptionsMap;
  instruments: Instrument[];
  accounts: Account[];
  /** User-defined fields, appended to their methodology group. */
  fieldDefs?: FieldDef[];
  /** Playbooks with their rule checklists. */
  playbooks?: Playbook[];
  initial?: TradeFormInitial;
  /** Accounts whose FTMO challenge is frozen — new trades are blocked. */
  ftmoFailedAccountIds?: string[];
  /**
   * Current equity per account id — starting balance + realized P&L + cash
   * flow. Risk % is a share of what the account is worth NOW, not of what it
   * opened with.
   */
  accountEquity?: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [activeTab, setActiveTab] = useState<"plan" | "execution">(() =>
    defaultTab(initial),
  );
  const [tradePhase, setTradePhase] = useState<TradePhase>(() =>
    initialTradePhase(initial),
  );
  const [isMissed, setIsMissed] = useState(
    () => initial?.status === "missed",
  );

  // Structure is fixed; the methodology groups are filled from the DB.
  const formTabs = useMemo(() => buildFormTabs(fieldDefs), [fieldDefs]);

  // Playbook state. Its own group rather than a field def: the checklist has
  // behaviour (outcome-scoped rules, three-state answers) that a field
  // definition cannot express.
  const [playbookId, setPlaybookId] = useState<string | null>(
    initial?.playbook_id ?? null,
  );
  const [conviction, setConviction] = useState<number | null>(
    initial?.conviction ?? null,
  );
  const [ruleAnswers, setRuleAnswers] = useState<Record<string, boolean>>(
    initial?.rule_answers ?? {},
  );

  function setRuleAnswer(ruleId: string, followed: boolean | null) {
    setRuleAnswers((prev) => {
      const next = { ...prev };
      // Deleting rather than storing null: absent IS "not answered", and one
      // representation of it means the save path cannot disagree with the form.
      if (followed == null) delete next[ruleId];
      else next[ruleId] = followed;
      return next;
    });
  }

  const [accountId, setAccountId] = useState<string | null>(
    initial?.account_id ?? accounts.find((a) => a.is_active)?.id ?? accounts[0]?.id ?? null,
  );
  const account = accounts.find((a) => a.id === accountId) ?? null;
  // Block only NEW trades on a frozen FTMO account (editing existing is allowed).
  const ftmoBlocked =
    !initial && accountId != null && ftmoFailedAccountIds.includes(accountId);
  const tz = account?.timezone ?? "America/New_York";
  const currency = account?.currency ?? "USD";
  const costDefaults = account
    ? {
        default_commission_per_unit: account.default_commission_per_unit,
        default_fee_fixed: account.default_fee_fixed,
        default_swap_per_day: account.default_swap_per_day,
      }
    : NO_COST_DEFAULTS;

  const [tradeNo, setTradeNo] = useState<string>(
    initial?.trade_no != null ? String(initial.trade_no) : "",
  );
  const [fields, setFields] = useState<Record<string, FieldValue>>(
    initial?.fields ?? {},
  );

  // Only meaningful before the trade exists. Once it does, `TradeImages` owns
  // the rows and writes them itself, so this state is never read again.
  const [imageDrafts, setImageDrafts] = useState<ImageDrafts>({});
  function setImageDraft(kind: PreImageKind, url: string) {
    setImageDrafts((prev) => ({ ...prev, [kind]: url }));
  }

  const [execs, setExecs] = useState<ExecRow[]>(() => {
    if (initial && initial.executions.length > 0) {
      return initial.executions.map((e) => ({
        side: e.side,
        price: String(e.price),
        qty: String(e.qty),
        executedLocal: utcToZonedInput(e.executed_at, tz),
        fee: String(e.fee ?? 0),
        swap: String(e.swap_funding ?? 0),
      }));
    }
    return [];
  });

  function setField(name: string, value: FieldValue) {
    setFields((prev) => {
      const next: Record<string, FieldValue> = { ...prev, [name]: value };
      if (name === "entry_price") {
        const entry = n(String(value ?? ""));
        if (entry == null) {
          next.stop_price = "";
          next.target_price = "";
        }
      }
      if (name === "stop_price") {
        const stop = n(String(value ?? ""));
        if (stop == null) {
          next.target_price = "";
        }
      }
      // Direction follows planned geometry: recompute whenever entry/stop change
      // (event-driven — avoids a setState-in-effect sync loop).
      if (name === "entry_price" || name === "stop_price") {
        const inferred = inferDirectionFromPrices(
          n(String(next.entry_price ?? "")),
          n(String(next.stop_price ?? "")),
        );
        if (inferred != null) next.direction = inferred;
      }
      return next;
    });
  }

  // Mount-only: hydrate defaults from localStorage (a client-only external store,
  // so this must run in an effect, not during SSR render).
  useEffect(() => {
    if (initial) return;
    const prefs = getTradeFormPrefs();
    if (prefs.accountId && accounts.some((a) => a.id === prefs.accountId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- external-store init
      setAccountId(prefs.accountId);
    }
    setFields((prev) => {
      if (prev.risk_pct != null && prev.risk_pct !== "") return prev;
      const riskOptions = optionsMap.risk_pct ?? [];
      const fromPrefs =
        prefs.riskPct && riskOptions.some((o) => o.value === prefs.riskPct)
          ? prefs.riskPct
          : defaultRiskPctOption(riskOptions);
      if (!fromPrefs) return prev;
      return { ...prev, risk_pct: fromPrefs };
    });
  }, [initial, accounts, optionsMap.risk_pct]);

  const inferredDirection = useMemo(
    () =>
      inferDirectionFromPrices(
        n(String(fields.entry_price ?? "")),
        n(String(fields.stop_price ?? "")),
      ),
    [fields.entry_price, fields.stop_price],
  );

  const executionUnlocked =
    tradePhase === "active" ||
    execs.length > 0 ||
    initial?.status === "partial" ||
    initial?.status === "closed";

  const hasValidEntryFill = useMemo(
    () =>
      execs.some(
        (e) =>
          e.side === "entry" &&
          n(e.price) != null &&
          n(e.qty) != null &&
          (n(e.qty) ?? 0) > 0,
      ),
    [execs],
  );

  // Adjust phase during render (React-sanctioned, converges) rather than in an
  // effect: a valid entry fill implies the trade is active.
  if (hasValidEntryFill && tradePhase !== "active" && !isMissed) {
    setTradePhase("active");
  }

  const instrument = instruments.find((i) => i.symbol === fields.instrument);
  /**
   * Contract point value, or null when the symbol resolves to no instrument —
   * an imported symbol (`normalizeInstrumentSymbol` passes unknown broker
   * symbols straight through), a deactivated one, or one typed before it was
   * added in Settings.
   *
   * This used to fall back to 1, and that fallback reached the position-size
   * calculator: `riskAmount / (stopDist × 1)` instead of `× 50` suggests an ES
   * position FIFTY TIMES too large, and the submit handler writes the suggestion
   * into `position_size`. Because 1 passes every `> 0` guard, nothing anywhere
   * signalled the miss. `tj_position_stats` dropped exactly this `COALESCE(…, 1)`
   * so an unpriceable trade reads as missing rather than as a confident wrong
   * number; a sizing calculator is the last place that may guess.
   */
  const pointValue = instrument?.point_value ?? null;

  const metrics = useMemo(() => {
    const executionFills = execs
      .map((e) => ({
        side: e.side,
        price: n(e.price),
        qty: n(e.qty),
        fee: n(e.fee) ?? 0,
        swap_funding: n(e.swap) ?? 0,
      }))
      .filter(isValidFill)
      .map((e) => ({ ...e, price: e.price!, qty: e.qty! }));

    const pe = n(String(fields.entry_price ?? ""));
    const stop = n(String(fields.stop_price ?? ""));
    const dir = String(fields.direction ?? "");

    const posStats = computePositionStats({
      direction: dir,
      entry_price: pe,
      stop_price: stop,
      point_value: pointValue,
      executions: executionFills,
    });

    const {
      avg_entry: avgEntry,
      avg_exit: avgExit,
      entry_qty: entryQty,
      exit_qty: exitQty,
      gross_pl: grossPl,
      net_pl: netPl,
      total_fees: totalFees,
      total_swap: totalSwap,
      realized_r: r,
    } = posStats;
    const fees = totalFees + totalSwap;

    const pt = n(String(fields.target_price ?? ""));
    const maePrice = n(String(fields.max_drawdown_price ?? ""));
    const mfePrice = n(String(fields.max_profit_price ?? ""));
    const plannedRR = computePlannedRewardR({
      direction: dir || null,
      entry: pe,
      stop,
      target: pt,
    });

    // Same implementation the dashboard aggregates over — this used to be a
    // second copy of the geometry living only in the form.
    const { maeR, mfeR, capturePct } = excursionFromTrade({
      direction: dir || null,
      entry_price: pe,
      stop_price: stop,
      max_drawdown_price: maePrice,
      max_profit_price: mfePrice,
      stats: { avg_entry: avgEntry, realized_r: r },
    } as unknown as TradeRow);

    const riskPct = parseRiskPct(fields.risk_pct as string | number | null);
    // Current equity, falling back to the opening balance only when the
    // account has no history yet. Sizing off starting_balance forever meant
    // "risk 1%" drifted further from 1% with every trade.
    const balance =
      (account ? accountEquity[account.id] : undefined) ??
      account?.starting_balance ??
      0;
    const sizeSuggestion = computePositionSize({
      balance,
      riskPct,
      entry: pe,
      stop,
      pointValue,
    });
    // Computed even when sizing is impossible. A missing point value blocks the
    // SIZE, not the risk: "1 % of this account is 420" is true whether or not
    // the instrument spec is on file, and it is the half of the answer worth
    // showing while the other half is unavailable.
    const riskAmount = computeRiskAmount({ balance, riskPct });

    const slippage = computeEntrySlippage({
      direction: String(fields.direction ?? ""),
      plannedEntry: pe,
      avgEntry,
      stopPrice: stop,
      entryQty: entryQty > 0 ? entryQty : null,
      pointValue,
    });

    // Same function the grid's "Target %" column and the mentor export read —
    // this used to be a second copy with two divergences from it: no floor on
    // a near-zero planned reward (a stray 0.01 R target could blow the shown
    // percentage into the thousands, where `exitEfficiencyFromTrade` would
    // have shown "—"), and the WRONG precedence between stored and live —
    // it preferred the price fields' live-computed plan over the stored
    // `planned_rr`, so editing `target_price` after a trade went active
    // silently moved its own grading baseline instead of grading against the
    // plan as it stood when the trade was taken (see `plannedRewardFromTrade`
    // in `exit-efficiency.ts` for why stored wins on purpose).
    const targetAttainment = exitEfficiencyFromTrade({
      planned_rr: fields.planned_rr,
      direction: dir || null,
      entry_price: pe,
      stop_price: stop,
      target_price: pt,
      stats: { realized_r: r },
    } as unknown as TradeRow);

    return {
      avgEntry,
      avgExit,
      entryQty,
      exitQty,
      grossPl,
      netPl,
      r,
      plannedRR,
      sizeSuggestion,
      riskAmount,
      totalFees,
      totalSwap,
      fees,
      maeR,
      mfeR,
      capturePct,
      slippage,
      plannedEntry: pe,
      targetAttainment,
    };
  }, [execs, fields, pointValue, account, accountEquity]);

  /**
   * Answers to rules the checklist is currently OFFERING.
   *
   * The save path writes only these, so an answer recorded while the trade was
   * green cannot survive into a red trade's statistics. It is the same rule
   * `ruleAppliesTo` enforces on the reporting side — if the two could disagree,
   * a rule's follow rate would be measured against a population the trader was
   * never asked about.
   */
  const visibleRuleAnswers = useMemo(() => {
    const book = playbooks.find((p) => p.id === playbookId);
    if (!book) return {};
    const outcome =
      metrics.netPl == null
        ? null
        : metrics.netPl > 0
          ? ("win" as const)
          : metrics.netPl < 0
            ? ("loss" as const)
            : ("breakeven" as const);

    const out: Record<string, boolean> = {};
    for (const group of book.groups) {
      for (const rule of group.rules) {
        if (!ruleAppliesTo(rule.show_when, outcome)) continue;
        const v = ruleAnswers[rule.id];
        if (v !== undefined) out[rule.id] = v;
      }
    }
    return out;
  }, [playbooks, playbookId, ruleAnswers, metrics.netPl]);

  function addExec(side: "entry" | "exit") {
    setExecs((prev) => {
      const nowIso = new Date().toISOString();
      const qtyStr = side === "exit" ? "" : "1";
      const qty = n(qtyStr) ?? 0;

      // Swap only accrues once a position has been open overnight, so it is
      // suggested on exits, measured from the first entry fill.
      const firstEntry = prev.find((e) => e.side === "entry");
      const nights =
        side === "exit" && firstEntry
          ? nightsBetween(
              zonedInputToUtc(firstEntry.executedLocal, tz),
              nowIso,
              tz,
            )
          : 0;

      const fee = prefillFee(qty, costDefaults);
      const swap = prefillSwap(qty, nights, costDefaults);

      return [
        ...prev,
        {
          side,
          price: "",
          qty: qtyStr,
          executedLocal: utcToZonedInput(nowIso, tz),
          fee: fee !== 0 ? String(fee) : "",
          swap: swap !== 0 ? String(swap) : "",
        },
      ];
    });
  }
  function setExec(i: number, patch: Partial<ExecRow>) {
    setExecs((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function removeExec(i: number) {
    setExecs((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleMoveToActive() {
    setTradePhase("active");
    setActiveTab("execution");
  }

  function handleAddEntryFromPlan() {
    setTradePhase("active");
    if (execs.length === 0) addExec("entry");
    setActiveTab("execution");
  }

  function handleTabChange(v: string) {
    if (v === "execution" && !executionUnlocked) return;
    setActiveTab(v as "plan" | "execution");
  }

  /** Rows the user started but left unusable — never silently dropped. */
  function incompleteExecRows(): number[] {
    return execs
      .map((e, i) => (isValidFill({ side: e.side, price: n(e.price), qty: n(e.qty) }) ? -1 : i))
      .filter((i) => i >= 0);
  }

  function buildExecInputs(): ExecutionInput[] {
    return execs
      .filter((e) => isValidFill({ side: e.side, price: n(e.price), qty: n(e.qty) }))
      .map((e) => ({
        side: e.side,
        price: n(e.price)!,
        qty: n(e.qty)!,
        executed_at:
          zonedInputToUtc(e.executedLocal, tz) ?? new Date().toISOString(),
        fee: n(e.fee) ?? 0,
        swap_funding: n(e.swap) ?? 0,
      }));
  }

  function submit() {
    if (ftmoBlocked) {
      toast.error(
        "The FTMO account is frozen — a rule was breached. Reset the challenge in Settings.",
      );
      return;
    }
    if (!fields.instrument) {
      toast.error("Pick an instrument.");
      setActiveTab("plan");
      return;
    }

    // The server drops fills without a price and a positive quantity — along
    // with any fee typed on them. Say so rather than let them vanish.
    const incomplete = incompleteExecRows();
    if (incomplete.length > 0) {
      toast.error(
        `Fill ${incomplete.map((i) => i + 1).join(", ")} needs a price and a quantity above zero — remove it or complete it.`,
      );
      setActiveTab("execution");
      return;
    }

    const fieldsToSave = { ...fields };

    // planned_rr is the PLAN. Once the trade is live it is what "Target
    // attainment" measures against, so recomputing it from edited prices would
    // let a trader quietly move the goalposts and improve their own score.
    const planIsStillEditable = tradePhase === "planned" && execs.length === 0;
    if (
      metrics.plannedRR != null &&
      (planIsStillEditable || !fields.planned_rr)
    ) {
      fieldsToSave.planned_rr = formatPlannedRewardR(metrics.plannedRR);
    }

    // position_size is a record of what was traded. Only offer the suggestion
    // while it is still a plan and the field is empty — never overwrite a size
    // once real fills exist, where entry_qty is the truth.
    if (
      metrics.sizeSuggestion != null &&
      planIsStillEditable &&
      (fields.position_size == null || fields.position_size === "")
    ) {
      fieldsToSave.position_size = Number(metrics.sizeSuggestion.toFixed(4));
    }

    const payload = {
      account_id: accountId,
      trade_no: tradeNo ? Number(tradeNo) : null,
      fields: fieldsToSave,
      executions: buildExecInputs(),
      trade_phase: hasValidEntryFill ? "active" : tradePhase,
      current_status: isMissed ? "missed" : null,
      playbook_id: playbookId,
      conviction,
      // Only on create. An existing trade's images are owned by `TradeImages`,
      // which writes them directly — sending them here too would give one row
      // two writers.
      images: initial ? undefined : imageDraftsToPayload(imageDrafts),
      // Only answers to rules the checklist actually offered. An answer to a
      // rule hidden by the current outcome would be recorded against a
      // population the trader was never shown.
      rule_answers: visibleRuleAnswers,
    };
    start(async () => {
      const res = initial
        ? await updateTrade(initial.id, payload)
        : await createTrade(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setTradeFormPrefs({
        accountId: accountId ?? undefined,
        riskPct: String(fieldsToSave.risk_pct ?? ""),
      });
      toast.success(initial ? "Trade updated" : "Trade saved");
      router.push("/journal");
      router.refresh();
    });
  }

  function handleMarkMissed() {
    if (!initial?.id) {
      toast.error("Save the plan before marking it missed.");
      return;
    }
    start(async () => {
      const res = await markTradeMissed(initial.id, {
        miss_reason: String(fields.miss_reason ?? "") || null,
        notes: null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setIsMissed(true);
      toast.success("Trade marked as missed");
      router.refresh();
    });
  }

  function handleRestorePlanned() {
    if (!initial?.id) return;
    start(async () => {
      const res = await restoreTradeToPlanned(initial.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setIsMissed(false);
      setTradePhase("planned");
      toast.success("Restored to planned");
      router.refresh();
    });
  }

  const isPlannedPhase = tradePhase === "planned" && !isMissed;

  /**
   * Lifecycle actions belong to a plan that EXISTS.
   *
   * On a new trade they were noise at best and broken at worst: the phase select
   * at the top already says planned or active, "Move to active" only repeated it,
   * and "Označi kao miss" was offered but refused on click — `markTradeMissed`
   * needs a row to mark, so it answered with an error toast. A button that is
   * shown and cannot work is worse than no button.
   *
   * So: nothing while the trade is unsaved, and nothing once it is active —
   * a trade you are already in cannot be missed, and it is already active.
   */
  const isSaved = initial != null;
  const showMoveToActive = isSaved && isPlannedPhase;
  const showMarkMissed =
    isSaved && isPlannedPhase && canMarkMissed(execs.length, "planned");
  const showRestorePlanned =
    isMissed && canRestoreToPlanned(execs.length, "missed");
  const missedAt = initial?.missed_at ?? null;

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {initial ? "Edit Trade" : "New Trade"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Times shown in {tz.replace("_", " ")} ({currency}).
            {isMissed && missedAt && (
              <>
                {" "}
                · Missed {fmtInTz(missedAt, tz, "yyyy-MM-dd HH:mm")}
              </>
            )}
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full sm:w-auto">
          {formTabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="flex-1 sm:flex-none"
              disabled={tab.id === "execution" && !executionUnlocked}
              title={
                tab.id === "execution" && !executionUnlocked
                  ? "Set Trade phase to Active, or use Add Entry Fill."
                  : undefined
              }
            >
              {tab.title}
            </TabsTrigger>
          ))}
        </TabsList>

        {formTabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-4">
            {tab.id === "execution" && !executionUnlocked ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  Set <b>Trade phase</b> to <b>Active</b>, or use{" "}
                  <b>Add Entry Fill</b> on the Plan tab to log execution.
                </CardContent>
              </Card>
            ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{tab.title}</CardTitle>
                {tab.description && (
                  <CardDescription>{tab.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-6">
                {tab.id === "execution" && (
                  <ExecutionsEditor
                    execs={execs}
                    tz={tz}
                    onAdd={addExec}
                    onSet={setExec}
                    onRemove={removeExec}
                    metrics={metrics}
                    currency={currency}
                  />
                )}

                {tab.groups
                  .filter((g) => !g.advanced)
                  // The miss reason only exists for a missed setup; on every
                  // other trade the group would be a heading over one dead
                  // select.
                  .filter((g) => g.id !== "plan_review" || isMissed)
                  .map((group) => (
                    <FormGroupSection
                      key={group.id}
                      group={group}
                      fields={fields}
                      setField={setField}
                      optionsMap={optionsMap}
                      instruments={instruments}
                      accountId={accountId}
                      accounts={accounts}
                      onAccountChange={setAccountId}
                      showAccount={tab.id === "plan" && group.id === "meta"}
                      tradeNo={tradeNo}
                      onTradeNoChange={
                        tab.id === "plan" && group.id === "meta"
                          ? setTradeNo
                          : undefined
                      }
                      tradePhase={tradePhase}
                      isMissed={isMissed}
                      computedDisplay={
                        tab.id === "plan" && group.id === "risk_plan"
                          ? {
                              direction:
                                inferredDirection ??
                                (fields.direction as string) ??
                                "—",
                              planned_rr:
                                metrics.plannedRR != null
                                  ? formatPlannedRewardR(metrics.plannedRR)
                                  : "—",
                              position_size:
                                metrics.sizeSuggestion != null
                                  ? `${metrics.sizeSuggestion.toFixed(2)}${instrument?.symbol ? ` ${instrument.symbol}` : ""}`
                                  : "—",
                            }
                          : undefined
                      }
                      fieldHints={
                        tab.id === "plan" &&
                        group.id === "risk_plan" &&
                        pointValue == null
                          ? {
                              // Why the suggestion is blank. Without this the
                              // field just reads "—" and looks like the form
                              // failed, rather than saying what is missing.
                              position_size: fields.instrument
                                ? `No point value for ${String(fields.instrument)} — add the instrument in Settings so position size can be computed.`
                                : "Pick an instrument so position size can be computed.",
                            }
                          : undefined
                      }
                      onAddEntryFill={
                        tab.id === "plan" && group.id === "risk_plan"
                          ? handleAddEntryFromPlan
                          : undefined
                      }
                      // The percentage in money. A share of equity is an
                      // abstraction you can agree to without flinching; the same
                      // risk as a figure is what makes you re-check the stop.
                      riskNote={
                        tab.id === "plan" &&
                        group.id === "risk_plan" &&
                        metrics.riskAmount != null
                          ? `Risking ${fmtMoney(metrics.riskAmount, currency)} if the stop is hit.`
                          : null
                      }
                    />
                  ))}

                {/* Playbook is a fixed group, not a field def: the checklist
                    scopes itself by outcome and answers are three-state, which
                    no field definition can express.

                    Placed AFTER the fields, not before them. Committing to a
                    strategy and ticking its rules is the last thing you do
                    before saving — asking it above the instrument put the
                    question "did you follow the plan" before you had said what
                    you were trading.

                    On BOTH tabs deliberately. Plan is where you commit, but a
                    'winner' rule — "did you let it run?" — only becomes
                    answerable once the trade is closed, and by then the trader
                    is on Execution. Offering it in one place only would make
                    those rules unanswerable in practice. */}
                {!isMissed && (
                  <PlaybookChecklist
                    playbooks={playbooks}
                    playbookId={playbookId}
                    onPlaybookChange={setPlaybookId}
                    conviction={conviction}
                    onConvictionChange={setConviction}
                    answers={ruleAnswers}
                    onAnswerChange={setRuleAnswer}
                    netPl={metrics.netPl}
                  />
                )}

                {tab.groups.some((g) => g.advanced) && (
                  <AdvancedSection>
                    {tab.groups
                      .filter((g) => g.advanced)
                      .map((group) => (
                        <FormGroupSection
                          key={group.id}
                          group={group}
                          fields={fields}
                          setField={setField}
                          optionsMap={optionsMap}
                          instruments={instruments}
                          tradePhase={tradePhase}
                          isMissed={isMissed}
                          nested
                        />
                      ))}
                  </AdvancedSection>
                )}

                {/* Lifecycle, at the bottom and on its own.
                    `Trade phase` used to sit in the "Trade" group at the very
                    top, between the account and the instrument. It is not a
                    field of the trade — it is the same control as the buttons
                    below it, worded as a select, and asking "planned or active?"
                    before the trader has said what they are trading put the
                    lifecycle question first in a form about a setup. Here it
                    stands next to the actions that move the trade between the
                    same two states. */}
                {tab.id === "plan" && (
                  <div className="mt-6 space-y-3 border-t pt-4">
                    {!isMissed && (
                      <div className="max-w-xs space-y-1.5">
                        <Label className="text-xs">Trade phase</Label>
                        <Select
                          value={tradePhase}
                          onValueChange={(v) => setTradePhase(v as TradePhase)}
                          disabled={hasValidEntryFill}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="planned" disabled={hasValidEntryFill}>
                              Planned
                            </SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {hasValidEntryFill
                            ? "Automatically active — an entry fill exists."
                            : "Planned = the trade is still a plan. Active = you are already in the position."}
                        </p>
                      </div>
                    )}
                    {isMissed && (
                      <p className="text-xs text-muted-foreground">
                        Restore from missed to change the phase.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {showMoveToActive && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={handleMoveToActive}
                        >
                          Move to active trade
                        </Button>
                      )}
                      {showMarkMissed && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          onClick={handleMarkMissed}
                        >
                          Mark as missed
                        </Button>
                      )}
                      {showRestorePlanned && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={handleRestorePlanned}
                        >
                          Restore to planned
                        </Button>
                      )}
                    </div>
                    {showMarkMissed && (
                      <p className="text-xs text-muted-foreground">
                        Miss = the plan was never opened (the limit never hit, the setup
                        never came…).
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {initial ? (
        <TradeImages positionId={initial.id} />
      ) : (
        <TradeImageDrafts drafts={imageDrafts} onChange={setImageDraft} />
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur md:left-60">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {activeTab === "plan" ? (
              <>
                <Metric
                  label="Planned R:R"
                  value={
                    metrics.plannedRR != null
                      ? formatPlannedRewardR(metrics.plannedRR)
                      : "—"
                  }
                />
                <Metric
                  label="Position Size"
                  value={
                    metrics.sizeSuggestion != null
                      ? `${metrics.sizeSuggestion.toFixed(2)}${instrument?.symbol ? ` ${instrument.symbol}` : ""}`
                      : "—"
                  }
                />
                {metrics.slippage != null && (
                  <Metric
                    label="Slippage"
                    value={fmtSlippageR(metrics.slippage.slippageR)}
                    title={`${fmtSlippagePts(metrics.slippage.adversePts)} vs planned`}
                  />
                )}
              </>
            ) : (
              <>
                <Metric
                  label="Net P/L"
                  value={fmtMoney(metrics.netPl, currency, { sign: true })}
                  cls={pnlClass(metrics.netPl)}
                />
                <Metric label="R" value={fmtR(metrics.r)} cls={pnlClass(metrics.r)} />
                <Metric
                  label="MAE"
                  value={metrics.maeR != null ? `−${metrics.maeR.toFixed(2)}R` : "—"}
                />
                <Metric
                  label="MFE"
                  value={metrics.mfeR != null ? `+${metrics.mfeR.toFixed(2)}R` : "—"}
                />
                <Metric
                  label="Capture"
                  value={metrics.capturePct != null ? `${metrics.capturePct.toFixed(0)}%` : "—"}
                  title="MFE capture — realized R / max favorable excursion"
                />
                {metrics.targetAttainment != null && (
                  <Metric
                    label="Target attainment"
                    value={fmtExitEfficiencyPct(metrics.targetAttainment.pct)}
                    title={`${metrics.targetAttainment.realizedR.toFixed(2)}R realized / ${metrics.targetAttainment.plannedRewardR.toFixed(2)}R planned target`}
                  />
                )}
                {metrics.slippage != null && (
                  <Metric
                    label="Slippage"
                    value={fmtSlippageR(metrics.slippage.slippageR)}
                    title={`${fmtSlippagePts(metrics.slippage.adversePts)} vs planned`}
                  />
                )}
                <Metric
                  label="Fees + Swap"
                  value={fmtMoney(metrics.fees, currency)}
                />
                {metrics.fees > 0 && metrics.grossPl != null && metrics.netPl != null && (
                  <Metric
                    label="Gross → Net"
                    value={fmtMoney(metrics.grossPl - metrics.netPl, currency)}
                  />
                )}
              </>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {ftmoBlocked && (
              <p className="text-xs text-[var(--loss)]">
                FTMO account frozen — a rule was breached. Reset the challenge in
                Settings to add new trades.
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={pending || ftmoBlocked}>
                {pending ? "Saving…" : initial ? "Update trade" : "Save trade"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  cls,
  title,
}: {
  label: string;
  value: string;
  cls?: string;
  title?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5" title={title}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-semibold ${cls ?? ""}`}>{value}</span>
    </div>
  );
}

function AdvancedSection({ children }: { children: ReactNode }) {
  return (
    <details className="group rounded-lg border bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        Advanced
      </summary>
      <div className="space-y-6 border-t px-4 py-4">{children}</div>
    </details>
  );
}

function FormGroupSection({
  group,
  fields,
  setField,
  optionsMap,
  instruments,
  accountId,
  accounts,
  onAccountChange,
  showAccount,
  onAddEntryFill,
  tradePhase,
  isMissed,
  computedDisplay,
  fieldHints,
  tradeNo,
  onTradeNoChange,
  riskNote,
  nested,
}: {
  group: FormGroup;
  fields: Record<string, FieldValue>;
  setField: (name: string, value: FieldValue) => void;
  optionsMap: OptionsMap;
  instruments: Instrument[];
  accountId?: string | null;
  accounts?: Account[];
  onAccountChange?: (id: string) => void;
  showAccount?: boolean;
  onAddEntryFill?: () => void;
  /** Only to hide the review note on a trade that has not happened yet. */
  tradePhase?: TradePhase;
  isMissed?: boolean;
  computedDisplay?: Record<string, string>;
  fieldHints?: Record<string, string>;
  tradeNo?: string;
  onTradeNoChange?: (value: string) => void;
  /** What the chosen risk % is worth in money — the number that makes you look twice. */
  riskNote?: string | null;
  nested?: boolean;
}) {
  const entry = n(String(fields.entry_price ?? ""));
  const stop = n(String(fields.stop_price ?? ""));
  const target = n(String(fields.target_price ?? ""));
  const riskPct = parseRiskPct(fields.risk_pct as string | number | null);

  const fieldsToRender =
    group.id === "risk_plan"
      ? group.fields.filter((field) =>
          riskPlanFieldVisible(field.name, entry, stop, target, riskPct),
        )
      : group.id === "psychology_notes" &&
            (isMissed || tradePhase === "planned")
          ? group.fields.filter((field) => field.name !== "trade_journal_notes")
          : group.fields;

  // Gated as a whole, not field by field — see `thesisGroupVisible`. Rendering
  // nothing rather than an empty heading: a title over no inputs reads like the
  // form failed to load.
  if (group.id === "thesis" && !thesisGroupVisible(entry, stop)) return null;

  const body = (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {showAccount && accounts && onAccountChange && (
          <div className="space-y-1.5">
            <Label className="text-xs">Account</Label>
            <Select
              value={accountId ?? undefined}
              onValueChange={(v) => onAccountChange(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Account" />
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
        )}
        {onTradeNoChange && (
          <div className="space-y-1.5">
            <Label className="text-xs">Trade #</Label>
            <Input
              inputMode="numeric"
              value={tradeNo ?? ""}
              onChange={(e) => onTradeNoChange(e.target.value)}
            />
          </div>
        )}
        {fieldsToRender.map((field) => (
          <FieldRenderer
            key={field.name}
            field={field}
            value={fields[field.name]}
            onChange={(v) => setField(field.name, v)}
            optionsMap={optionsMap}
            instruments={instruments}
            computedDisplay={computedDisplay?.[field.name]}
            fieldHint={fieldHints?.[field.name]}
          />
        ))}
      </div>
      {riskNote && (
        <p className="text-xs text-muted-foreground">{riskNote}</p>
      )}
      {onAddEntryFill && group.id === "risk_plan" && (
        <Button type="button" variant="outline" size="sm" onClick={onAddEntryFill}>
          <ArrowDownToLine className="size-4" /> Add Entry Fill
        </Button>
      )}
    </>
  );

  if (group.collapsed && !nested) {
    return (
      <details className="rounded-md border">
        <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-1.5">
            <ChevronDown className="size-4 transition-transform [details[open]_&]:rotate-180" />
            {group.title}
          </span>
        </summary>
        <div className="space-y-4 border-t p-3">
          {group.description && (
            <p className="text-sm text-muted-foreground">{group.description}</p>
          )}
          {body}
        </div>
      </details>
    );
  }

  return (
    <div className="space-y-4">
      {!nested && (
        <div>
          <h3 className="text-sm font-semibold">{group.title}</h3>
          {group.description && (
            <p className="text-sm text-muted-foreground">{group.description}</p>
          )}
        </div>
      )}
      {body}
    </div>
  );
}

function FieldRenderer({
  field,
  value,
  onChange,
  optionsMap,
  instruments,
  computedDisplay,
  fieldHint,
}: {
  field: FieldConfig;
  value: FieldValue | undefined;
  onChange: (v: FieldValue) => void;
  optionsMap: OptionsMap;
  instruments: Instrument[];
  computedDisplay?: string;
  fieldHint?: string;
}) {
  const colSpan = field.colSpan === 2 ? "sm:col-span-2" : "";

  if (field.type === "computed") {
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <Label className="text-xs">{field.label}</Label>
        <Input
          readOnly
          disabled
          className="bg-muted/40 font-medium"
          value={computedDisplay ?? "—"}
          placeholder={field.placeholder ?? "Auto"}
        />
      </div>
    );
  }

  if (field.type === "instrument") {
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <Label className="text-xs">{field.label}</Label>
        <Select
          value={(value as string) || undefined}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select instrument…" />
          </SelectTrigger>
          <SelectContent>
            {instruments.map((i) => (
              <SelectItem key={i.id} value={i.symbol}>
                {i.symbol}
                {i.name ? ` — ${i.name}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <Label className="text-xs" title={fieldHint}>
          {field.label}
        </Label>
        {fieldHint && (
          <p className="text-xs text-muted-foreground">{fieldHint}</p>
        )}
        <EditableSelect
          listKey={field.listKey!}
          options={optionsMap[field.listKey!] ?? []}
          value={(value as string) ?? ""}
          onChange={(v) => onChange(v)}
        />
      </div>
    );
  }

  if (field.type === "tags") {
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <Label className="text-xs">{field.label}</Label>
        <TagMultiSelect
          value={Array.isArray(value) ? value : []}
          onChange={(v) => onChange(v)}
          optionsMap={optionsMap}
          listKey={field.listKey}
          listKeys={field.listKeys}
          placeholder={field.placeholder}
        />
      </div>
    );
  }

  if (field.type === "url") {
    const url = ((value as string) ?? "").trim();
    const valid = /^https?:\/\//i.test(url);
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <Label className="text-xs">{field.label}</Label>
        <div className="flex gap-2">
          <Input
            type="url"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
          />
          {valid ? (
            <Button
              asChild
              variant="outline"
              size="icon"
              className="size-9 shrink-0"
              title="Open chart"
            >
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
              </a>
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 shrink-0"
              disabled
              title="Enter a valid https:// link"
            >
              <ExternalLink className="size-4" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <Label className="text-xs">{field.label}</Label>
        <Textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 ${colSpan}`}>
      <Label className="text-xs">{field.label}</Label>
      <Input
        inputMode={field.type === "number" ? "decimal" : "text"}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
      />
    </div>
  );
}

function ExecutionsEditor({
  execs,
  tz,
  onAdd,
  onSet,
  onRemove,
  metrics,
  currency,
}: {
  execs: ExecRow[];
  tz: string;
  onAdd: (side: "entry" | "exit") => void;
  onSet: (i: number, patch: Partial<ExecRow>) => void;
  onRemove: (i: number) => void;
  metrics: {
    avgEntry: number | null;
    avgExit: number | null;
    entryQty: number;
    exitQty: number;
    grossPl: number | null;
    netPl: number | null;
    r: number | null;
    totalFees: number;
    totalSwap: number;
    fees: number;
    plannedEntry: number | null;
    slippage: ReturnType<typeof computeEntrySlippage>;
  };
  currency: string;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">
            Fills (Executions){" "}
            <span className="font-normal text-muted-foreground">
              ({tz.replace("_", " ")})
            </span>
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Swap and fees significantly affect Net P/L for swing positions held over
            weekends.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onAdd("entry")}>
            <ArrowDownToLine className="size-4" /> Entry fill
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onAdd("exit")}>
            <ArrowUpFromLine className="size-4" /> Partial exit
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {execs.map((e, i) => (
          <div
            key={i}
            className="grid grid-cols-12 items-end gap-2 rounded-md border bg-background p-2"
          >
            <div className="col-span-12 sm:col-span-2">
              <Label className="text-[11px] text-muted-foreground">Side</Label>
              <Select
                value={e.side}
                onValueChange={(v) => onSet(i, { side: v as "entry" | "exit" })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entry">Entry</SelectItem>
                  <SelectItem value="exit">Exit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-6 sm:col-span-2">
              <Label className="text-[11px] text-muted-foreground">Price</Label>
              <Input
                className="h-8"
                inputMode="decimal"
                value={e.price}
                onChange={(ev) => onSet(i, { price: ev.target.value })}
              />
            </div>
            <div className="col-span-6 sm:col-span-1">
              <Label className="text-[11px] text-muted-foreground">Qty</Label>
              <Input
                className="h-8"
                inputMode="decimal"
                value={e.qty}
                onChange={(ev) => onSet(i, { qty: ev.target.value })}
              />
            </div>
            <div className="col-span-12 sm:col-span-3">
              <Label className="text-[11px] text-muted-foreground">Time</Label>
              <Input
                className="h-8"
                type="datetime-local"
                value={e.executedLocal}
                onChange={(ev) => onSet(i, { executedLocal: ev.target.value })}
              />
            </div>
            <div
              className={cn(
                "col-span-6 rounded-md border-l-2 border-amber-500/40 bg-amber-500/5 p-1 sm:col-span-2",
              )}
            >
              <Label className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
                Fee
              </Label>
              <Input
                className="h-8 border-amber-500/20"
                inputMode="decimal"
                value={e.fee}
                onChange={(ev) => onSet(i, { fee: ev.target.value })}
                placeholder="0"
              />
            </div>
            <div
              className={cn(
                "col-span-6 rounded-md border-l-2 border-amber-500/40 bg-amber-500/5 p-1 sm:col-span-2",
              )}
            >
              <Label className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
                Swap / Funding
              </Label>
              <Input
                className="h-8 border-amber-500/20"
                inputMode="decimal"
                value={e.swap}
                onChange={(ev) => onSet(i, { swap: ev.target.value })}
                placeholder="0"
              />
            </div>
            <div className="col-span-12 flex justify-end sm:col-span-1 sm:justify-start">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => onRemove(i)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        {execs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No fills yet — add an entry when you enter, and exits when you close.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-2 text-sm">
        <span className="text-muted-foreground">
          Planned entry:{" "}
          <b className="text-foreground">
            {metrics.plannedEntry?.toFixed(2) ?? "—"}
          </b>
        </span>
        <span className="text-muted-foreground">
          Avg entry: <b className="text-foreground">{metrics.avgEntry?.toFixed(2) ?? "—"}</b>
        </span>
        {metrics.slippage != null && (
          <span className="text-muted-foreground">
            Slippage:{" "}
            <b className="text-foreground">
              {fmtSlippagePts(metrics.slippage.adversePts)}
              {metrics.slippage.slippageR != null
                ? ` (${fmtSlippageR(metrics.slippage.slippageR)})`
                : ""}
            </b>
          </span>
        )}
        <span className="text-muted-foreground">
          Avg exit: <b className="text-foreground">{metrics.avgExit?.toFixed(2) ?? "—"}</b>
        </span>
        <span className="text-muted-foreground">
          Size: <b className="text-foreground">{metrics.entryQty || "—"}</b>
        </span>
        <span className="text-muted-foreground">
          Gross:{" "}
          <b className={pnlClass(metrics.grossPl)}>
            {fmtMoney(metrics.grossPl, currency, { sign: true })}
          </b>
        </span>
        <span className="text-muted-foreground">
          Net:{" "}
          <b className={pnlClass(metrics.netPl)}>
            {fmtMoney(metrics.netPl, currency, { sign: true })}
          </b>
        </span>
        <span className="text-muted-foreground">
          Total fees: <b className="text-foreground">{fmtMoney(metrics.totalFees, currency)}</b>
        </span>
        <span className="text-muted-foreground">
          Total swap: <b className="text-foreground">{fmtMoney(metrics.totalSwap, currency)}</b>
        </span>
        <span className="text-muted-foreground">
          Combined costs: <b className="text-foreground">{fmtMoney(metrics.fees, currency)}</b>
        </span>
      </div>
    </div>
  );
}
