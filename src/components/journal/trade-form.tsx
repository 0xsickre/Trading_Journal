"use client";

import { Fragment, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Trash2,
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,

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
import {
  incompleteScaleOutRows,
  levelsToScaleOutRows,
  parseScaleOutLevels,
  scaleOutRowsToLevels,
  totalScaleOutPct,
  MAX_SCALE_OUT_PCT,
  type ScaleOutRow,
} from "@/lib/journal/scale-out";
import { PlaybookChecklist } from "@/components/journal/playbook-checklist";
import { NumberChoice } from "@/components/journal/number-choice";
import { StarRating } from "@/components/journal/star-rating";
import { ScaleOutEditor } from "@/components/journal/scale-out-editor";
import {
  buildFormTabs,
  TAGS_GROUP_ID,
  type FieldConfig,
  type FormGroup,
} from "@/lib/journal/form-config";
import type {
  FieldDef,
  FieldDefPhase,
} from "@/lib/journal/field-def-types";
import { Grip, useDragOrder } from "@/components/journal/drag-order";
import { reorderCategoriesByKey } from "@/app/(app)/settings/actions";
import { ruleAppliesTo, type Playbook } from "@/lib/journal/playbook-types";
import type { Account, Instrument, OptionsMap, TradeRow } from "@/lib/journal/types";
import {
  computeEntrySlippage,
  fmtSlippagePts,
  fmtSlippageR,
} from "@/lib/journal/entry-slippage";
import {
  exitEfficiencyFromTrade,
  fmtExitEfficiencyPct,
  plannedRewardFromTrade,
} from "@/lib/journal/exit-efficiency";
import { excursionFromTrade } from "@/lib/journal/excursion";
import { ExcursionBar } from "@/components/journal/viz/tile-visuals";
import { fmtMoney, fmtR, pnlClass } from "@/lib/journal/format";
import {
  computePlannedRewardR,
  computePositionSize,
  computeRiskAmount,
  formatPlannedRewardR,
  inferDirectionFromPrices,
  matchRiskOption,
  parseRiskPct,
  riskPlanFieldVisible,
  thesisGroupVisible,
} from "@/lib/journal/plan-calculations";
import { computePositionStats } from "@/lib/journal/position-stats";
import { resolveFxRate } from "@/lib/journal/fx";
import { utcToZonedInput, zonedInputToUtc, fmtInTz, DEFAULT_TZ, DATE_TIME } from "@/lib/journal/time";
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
import { InstrumentSelect } from "@/components/journal/instrument-select";

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
  scale_out_levels?: unknown;
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
  categoryOrder,
}: {
  optionsMap: OptionsMap;
  instruments: Instrument[];
  accounts: Account[];
  /** The trader's own categories, rendered as the flat group. */
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
  /**
   * Category key → the ordinal the trader dragged it to.
   *
   * The form renders the categories in this order, and dragging one writes
   * back into it. Optional so a caller that only wants the fields — a test, a
   * preview — need not read it; without it the config order stands.
   */
  categoryOrder?: Record<string, number>;
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

  // Structure is fixed; the trader's categories are filled from the DB.
  //
  // The phase is part of the key because a category can be asked for only while
  // the trade is planned, only once it is active, or only on a missed setup —
  // so moving the trade through its lifecycle changes which ones the form
  // renders. `missed` wins over the phase select: a missed setup was never
  // opened, so "once active" cannot be true of it.
  const defPhase: Exclude<FieldDefPhase, "always"> = isMissed
    ? "missed"
    : tradePhase === "active"
      ? "active"
      : "planned";
  const formTabs = useMemo(
    () => buildFormTabs(fieldDefs, defPhase, categoryOrder),
    [fieldDefs, defPhase, categoryOrder],
  );

  // Playbook state. Its own group rather than a field def: the checklist has
  // behaviour (outcome-scoped rules, three-state answers) that a field
  // definition cannot express.
  const [playbookId, setPlaybookId] = useState<string | null>(
    initial?.playbook_id ?? null,
  );
  const [scaleOutRows, setScaleOutRows] = useState<ScaleOutRow[]>(() =>
    levelsToScaleOutRows(parseScaleOutLevels(initial?.scale_out_levels)),
  );
  const [ruleAnswers, setRuleAnswers] = useState<Record<string, boolean>>(
    initial?.rule_answers ?? {},
  );


  /**
   * Picking a playbook offers its default risk — into an EMPTY field only.
   *
   * A suggestion, never a correction. A deliberate 0.5 % on a marginal setup is
   * the trader overriding their own default, and a prefill that overwrote it
   * would be the form arguing with the person filling it in.
   *
   * The option list is the source of truth for what "1 %" looks like as a
   * value: the field is a select over `risk_pct` options, so a playbook default
   * that has no matching option cannot be offered at all rather than being
   * written as a string the picker will not show.
   */
  function pickPlaybook(id: string | null) {
    setPlaybookId(id);
    const book = playbooks.find((p) => p.id === id);
    const pct = book?.default_risk_pct;
    if (pct == null) return;
    setFields((prev) => {
      if (prev.risk_pct != null && prev.risk_pct !== "") return prev;
      const match = matchRiskOption(optionsMap.risk_pct ?? [], pct);
      return match ? { ...prev, risk_pct: match } : prev;
    });
  }

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
  const tz = account?.timezone ?? DEFAULT_TZ;
  const currency = account?.currency ?? "USD";
  const costDefaults = account
    ? {
        default_commission_per_unit: account.default_commission_per_unit,
        default_fee_fixed: account.default_fee_fixed,
        default_swap_per_day: account.default_swap_per_day,
      }
    : NO_COST_DEFAULTS;

  // Not `useState`: the database assigns the number on insert and the form never changes it.
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

  /**
   * The quote currency's rate against the account's, resolved in the same order
   * `tj_position_stats` has in SQL — `resolveFxRate` is the one expression for
   * both.
   *
   * A trade being entered has no recorded rate yet, so what is answered here is
   * the question that can be answered without one: whether a conversion is
   * needed at all. When it is not (the instrument is quoted in the account's
   * currency) the preview shows money; when it is, it shows nothing rather than
   * a number in the wrong currency.
   */
  const fx = resolveFxRate({
    quoteCurrency: instrument?.quote_currency,
    accountCurrency: account?.currency,
  });

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
      fx_rate: fx.rate,
      // A transcribed result beats prices — the same as in the view. Without
          // this the form's preview would show the computed number while the trade
          // list showed the entered one.
      gross_pnl_override: n(String(fields.gross_pnl_override ?? "")),
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
    // One row literal, read twice. The attainment percentage and the planned
    // baseline printed next to it must never disagree about WHICH plan is being
    // graded — building the row once is what makes that structurally true.
    const attainmentRow = {
      planned_rr: fields.planned_rr,
      direction: dir || null,
      entry_price: pe,
      stop_price: stop,
      target_price: pt,
      // The scale-out belongs to the plan being graded: entry-to-target is the
      // whole plan only when the whole position leaves at one price. Without
      // this the form would print a planned reward the reports disagree with,
      // for the same trade, on the same screen.
      scale_out_levels: scaleOutRowsToLevels(scaleOutRows),
      stats: { realized_r: r },
    } as unknown as TradeRow;
    const targetAttainment = exitEfficiencyFromTrade(attainmentRow);
    // The planned baseline on its own. `exitEfficiencyFromTrade` returns null
    // for three different reasons — no plan, a plan too small to divide by, and
    // a trade that has not closed — and the line below has to tell them apart.
    const plannedReward = plannedRewardFromTrade(attainmentRow);

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
      // Exposed so the risk note can tell a BUDGET from a CONSEQUENCE: with no
      // stop on the form there is nothing that can be "hit", and the sentence
      // has to stop claiming there is.
      stop,
      totalFees,
      totalSwap,
      fees,
      maeR,
      mfeR,
      capturePct,
      slippage,
      plannedEntry: pe,
      targetAttainment,
      plannedReward,
    };
    // `fx.rate` is a primitive and changes with the instrument — without it in
          // the list the preview would keep money computed at the old rate after a
          // symbol change, which is exactly the class of error Phase 10 calls "a
          // number computed twice".
    // scaleOutRows is a dependency because the planned reward now weighs it:
    // without it the figure would freeze at whatever the levels were when some
    // other field last changed.
  }, [execs, fields, pointValue, fx.rate, account, accountEquity, scaleOutRows]);

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
    for (const rule of book.rules) {
      if (!ruleAppliesTo(rule.show_when, outcome)) continue;
      const v = ruleAnswers[rule.id];
      // A retired rule nobody ticked is left unanswered. Everything else gets
      // an explicit true or false, because the checklist has one tick per rule
      // and an untouched box IS the answer "not kept" — writing nothing would
      // leave the screen saying 3 of 8 while the statistics counted 3 of 3.
      if (rule.deleted_at != null && v === undefined) continue;
      out[rule.id] = v === true;
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

  function handleAddEntryFromPlan() {
    setTradePhase("active");
    if (execs.length === 0) addExec("entry");
    setActiveTab("execution");
  }

  function handleTabChange(v: string) {
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

    // Same contract as the fills above: a started row is an unfinished
    // intention, and dropping it silently would tell the trader it was saved.
    const badLevels = incompleteScaleOutRows(scaleOutRows);
    if (badLevels.length > 0) {
      toast.error(
        `Scale-out level ${badLevels.map((i) => i + 1).join(", ")} needs a percentage and a price above zero — remove it or complete it.`,
      );
      setActiveTab("plan");
      return;
    }

    // `> 100`, never `>= 100`: taking the whole position off in stages is a
    // legitimate plan, and 100 % is exactly that.
    const pctTotal = totalScaleOutPct(scaleOutRows);
    if (pctTotal > MAX_SCALE_OUT_PCT) {
      toast.error(
        `Scale-out levels add up to ${pctTotal}% — more than the position. Reduce them to ${MAX_SCALE_OUT_PCT}% or less.`,
      );
      setActiveTab("plan");
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
      // NULL on insert leaves the number to the trigger; on an edit the existing
      // one is left alone, because the trigger fills it only when it is NULL.
      trade_no: initial?.trade_no ?? null,
      fields: fieldsToSave,
      executions: buildExecInputs(),
      trade_phase: hasValidEntryFill ? "active" : tradePhase,
      current_status: isMissed ? "missed" : null,
      playbook_id: playbookId,
      scale_out_levels: scaleOutRowsToLevels(scaleOutRows),
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
   * and "Mark as missed" was offered but refused on click — `markTradeMissed`
   * needs a row to mark, so it answered with an error toast. A button that is
   * shown and cannot work is worse than no button.
   *
   * So: nothing while the trade is unsaved, and nothing once it is active —
   * a trade you are already in cannot be missed, and it is already active.
   */
  const isSaved = initial != null;
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
                · Missed {fmtInTz(missedAt, tz, DATE_TIME)}
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
            >
              {tab.title}
            </TabsTrigger>
          ))}
        </TabsList>

        {formTabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-4">
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
                  .map((group) => (
                    <Fragment key={group.id}>
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
                      // What the plan promised against what the exit
                      // delivered, on the outcome group where both are read.
                      //
                      // The plan tab used to put the playbook's A+ definition
                      // in this slot, hung on the tag group. That group is
                      // built from the trader's own categories now, so it is
                      // absent whenever none of them shows in the plan phase —
                      // and the criterion went with it. It sits in
                      // `PlaybookChecklist` instead, under the picker and above
                      // the grade it defines.
                      groupNote={
                        tab.id === "execution" && group.id === "outcome" ? (
                          <PlanVsRealized
                            planned={metrics.plannedReward}
                            realized={metrics.r}
                            efficiency={metrics.targetAttainment}
                          />
                        ) : null
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
                      scaleOut={
                        tab.id === "plan" && group.id === "risk_plan"
                          ? { rows: scaleOutRows, onChange: setScaleOutRows }
                          : undefined
                      }
                      // The percentage in money. A share of equity is an
                      // abstraction you can agree to without flinching; the same
                      // risk as a figure is what makes you re-check the stop.
                      //
                      // Two wordings, because before a stop is entered the
                      // figure is a BUDGET and after it is a CONSEQUENCE. On a
                      // blank form the old single sentence read "Risking $12.32
                      // if the stop is hit" — naming the loss of a stop that
                      // did not exist, on the screen where the plan is still
                      // being written. The number was right (a share of
                      // equity); the claim around it was not.
                      riskNote={
                        tab.id === "plan" &&
                        group.id === "risk_plan" &&
                        metrics.riskAmount != null
                          ? metrics.stop != null
                            ? `Risking ${fmtMoney(metrics.riskAmount, currency)} if the stop is hit.`
                            : `Risk budget ${fmtMoney(metrics.riskAmount, currency)} — set a stop to commit to it.`
                          : null
                      }
                    />
                    {/* Playbook right after the account and the instrument.

                        The order of a trade is the order of the decisions:
                        which account, what instrument, then WHICH SETUP and
                        whether its rules are all met — and only then the prices,
                        the risk and the rest. A plan whose checklist comes last
                        is a plan filled in before anyone asked whether the setup
                        qualified.

                        Playbook is a fixed group, not a field def: the checklist
                        scopes itself by outcome and answers are three-state,
                        which no field definition can express. */}
                    {tab.id === "plan" && group.id === "meta" && !isMissed && (
                      <PlaybookChecklist
                        playbooks={playbooks}
                        playbookId={playbookId}
                        onPlaybookChange={pickPlaybook}
                        answers={ruleAnswers}
                        onAnswerChange={setRuleAnswer}
                        netPl={metrics.netPl}
                      />
                    )}
                    </Fragment>
                  ))}

                {/* On Execution the checklist comes last: a 'winner' rule —
                    "did you let it run?" — only becomes answerable once the trade
                    is closed, which is where the trader is by then. */}
                {tab.id === "execution" && !isMissed && (
                  <PlaybookChecklist
                    playbooks={playbooks}
                    playbookId={playbookId}
                    onPlaybookChange={pickPlaybook}
                    answers={ruleAnswers}
                    onAnswerChange={setRuleAnswer}
                    netPl={metrics.netPl}
                  />
                )}

                {/* Lifecycle. There is no phase control: planned or active is
                    not the trader's to set, it is what the fills say. An entry
                    fill means you are in the trade; no entry fill means it is
                    still a plan. A select that could say "active" on a trade
                    with no fill, or "planned" on one with a fill, could only
                    ever disagree with the record.

                    What stays is the one lifecycle fact the fills cannot know:
                    that a plan was MISSED — the limit never hit, the setup never
                    came. */}
                {tab.id === "plan" && (showMarkMissed || showRestorePlanned) && (
                  <div className="mt-6 space-y-3 border-t pt-4">
                    <div className="flex flex-wrap gap-2">
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
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs text-muted-foreground">MAE / MFE</span>
                    <span className="font-semibold">
                      {metrics.maeR != null ? `−${metrics.maeR.toFixed(2)}R` : "—"}
                      {" … "}
                      {metrics.mfeR != null ? `+${metrics.mfeR.toFixed(2)}R` : "—"}
                    </span>
                  </div>
                  <div className="w-28" title="Sickre Scale — adverse ↔ favorable excursion, realized result marked">
                    <ExcursionBar maeR={metrics.maeR} mfeR={metrics.mfeR} realizedR={metrics.r} />
                  </div>
                </div>
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

/**
 * What you planned to make, against what you made — under the group that asks
 * how the trade exited.
 *
 * The contrast already existed, but only as a `title` tooltip on the summary
 * bar's "Target attainment": a number you have to hover to learn is a number
 * nobody reads. It sits in `outcome` rather than becoming a tenth `<Metric>`
 * because that bar is a `flex-wrap` row inside a fixed footer — a tenth entry
 * wraps and the bar grows over the form — and because this is a judgement about
 * the exit, which is what the group is named for.
 *
 * THE THREE NULLS ARE NOT THE SAME NULL, and that is the whole design.
 * `exitEfficiencyFromTrade` returns null when there is no plan, when the plan is
 * too small to divide by, and when the trade has not closed. Rendering "—%" for
 * all three would tell a trader still holding a position that they achieved
 * nothing of their target, which is a verdict on a trade that has not finished.
 * So an open trade says so in words, and a plan too small to grade shows both
 * R figures with no percentage rather than a fabricated one.
 */
function PlanVsRealized({
  planned,
  realized,
  efficiency,
}: {
  planned: number | null;
  realized: number | null | undefined;
  efficiency: { pct: number } | null;
}) {
  // No plan at all — there is no contrast to draw, so the line does not appear.
  if (planned == null) return null;

  const plannedTxt = `${planned.toFixed(2)}R`;

  if (realized == null || Number.isNaN(realized)) {
    return (
      <span>
        Planned {plannedTxt} → <span className="italic">not closed yet</span>
      </span>
    );
  }

  return (
    <span>
      Planned {plannedTxt} →{" "}
      <span className={`font-medium ${pnlClass(realized)}`}>
        {realized.toFixed(2)}R realized
      </span>
      {efficiency && ` · ${fmtExitEfficiencyPct(efficiency.pct)} of target`}
    </span>
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
  riskNote,
  groupNote,
  scaleOut,
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
  /** What the chosen risk % is worth in money — the number that makes you look twice. */
  riskNote?: string | null;
  /** A line of context for the whole group, shown under its fields. */
  /**
   * A note under a group's fields. `ReactNode`, not `string`, because the
   * plan-vs-realized line under "How it exited" colours the realized half —
   * see `PlanVsRealized`. The `<p>` this used to render became a `<div>` for
   * the same reason: a paragraph may not contain block content.
   */
  groupNote?: ReactNode;
  /**
   * Scale-out rows, supplied only for the `risk_plan` group. Bespoke rather
   * than a `FieldConfig` because the value is a jsonb array of objects, which
   * no field type expresses.
   */
  scaleOut?: {
    rows: ScaleOutRow[];
    onChange: (rows: ScaleOutRow[]) => void;
  };
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
          ? // `execution_rating` goes through THE SAME gate rather than a new
            // name: on a planned or missed trade there is no execution to rate,
            // just as there is no note about one. Reusing the existing predicate
            // means there is no new name that could fall out of step through
            // some `default: return true`.
            group.fields.filter(
              (field) =>
                field.name !== "trade_journal_notes" &&
                field.name !== "execution_rating",
            )
          : group.fields;

  /**
   * Reorder the categories from the form itself.
   *
   * Settings can do this too, and both write the same two ordinals — but this
   * is the screen where the order is felt, because this is where the trader
   * fills them in. Having to leave, drag in a table, and come back to see the
   * effect is the version that does not get used.
   *
   * Keyed by `listKey`: a rendered field knows which category it draws from,
   * and that is what the ordinal belongs to — the CATEGORY's, not the field's.
   * That is what lets `technical_tags` drag like the rest. It is declared in
   * the form config rather than in `tj_field_defs` and so has no field ordinal,
   * but the category behind it is an ordinary row with an ordinary
   * `sort_order`. Ordering the group by the category rather than by the field
   * is what put every one of them on the same footing.
   */
  const dragKeyOf = (field: FieldConfig) =>
    group.id === TAGS_GROUP_ID ? (field.listKey ?? null) : null;

  const dragKeys = fieldsToRender
    .map(dragKeyOf)
    .filter((k): k is string => k != null);

  const {
    order: keyOrder,
    target: dragTarget,
    handle: dragHandle,
  } = useDragOrder(dragKeys, reorderCategoriesByKey);

  /**
   * The fields in the order the drag preview says, with the undraggable ones
   * left exactly where the config put them.
   *
   * Rebuilt by walking the original list and pulling the next dragged key off a
   * queue whenever a draggable slot comes up — so `technical_tags` keeps its
   * position at the top while the four below it slide past one another.
   */
  const queue = [...keyOrder];
  const byKey = new Map(
    fieldsToRender.flatMap((f) => {
      const k = dragKeyOf(f);
      return k ? ([[k, f]] as [string, FieldConfig][]) : [];
    }),
  );
  const ordered = fieldsToRender.map((f) =>
    dragKeyOf(f) ? (byKey.get(queue.shift() ?? "") ?? f) : f,
  );

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
        {ordered.map((field) => {
          // Only the trader's own categories move. `technical_tags` is declared
          // in the form config rather than in `tj_field_defs`, so it has no
          // ordinal of its own to write — it keeps its place, and shows no grip
          // rather than a grip that would do nothing.
          const drag = dragKeyOf(field);
          return (
            <div
              key={field.name}
              {...(drag ? dragTarget(drag) : {})}
              data-drag-row
              className={cn(
                "relative",
                field.colSpan === 2 && "sm:col-span-2",
                drag && "data-[dragging]:opacity-40",
              )}
            >
              {drag && (
                <Grip
                  {...dragHandle(drag)}
                  className="absolute -left-5 top-1 hidden sm:inline-flex"
                />
              )}
              <FieldRenderer
                field={field}
                value={fields[field.name]}
                onChange={(v) => setField(field.name, v)}
                optionsMap={optionsMap}
                instruments={instruments}
                computedDisplay={computedDisplay?.[field.name]}
                fieldHint={fieldHints?.[field.name]}
              />
            </div>
          );
        })}
      </div>
      {/* Behind the SAME gate as `scale_out_plan` — reuses
          `riskPlanFieldVisible` instead of inventing a name, so
          `plan-calculations.ts` is not touched at all and the existing test for
          that gate already covers this. Levels are meaningless before there is
          a target to scale out toward. */}
      {scaleOut &&
        group.id === "risk_plan" &&
        riskPlanFieldVisible("scale_out_plan", entry, stop, target, riskPct) && (
          <ScaleOutEditor
            rows={scaleOut.rows}
            onChange={scaleOut.onChange}
            direction={String(fields.direction ?? "").trim() || null}
            entry={entry}
            stop={stop}
          />
        )}

      {riskNote && (
        <p className="text-xs text-muted-foreground">{riskNote}</p>
      )}
      {groupNote && (
        <div className="text-xs text-muted-foreground">{groupNote}</div>
      )}
      {onAddEntryFill && group.id === "risk_plan" && (
        <Button type="button" variant="outline" size="sm" onClick={onAddEntryFill}>
          <ArrowDownToLine className="size-4" /> Add Entry Fill
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      {/* No heading when the group has no title — that is the trader's own
          categories, which name themselves. A heading there would be the one
          piece of text on this form nobody could edit, which is exactly what
          the four fixed group names used to be. */}
      {!nested && group.title && (
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
  /**
   * Anything backed by an option list takes the full row.
   *
   * Forced here rather than left to each field's `colSpan`, because the rule is
   * about a KIND of field, not about individual ones: every option list on this
   * form is the same thing to the person filling it, and they were reading as
   * two different controls — the multi-valued ones full width, the single-valued
   * ones paired two to a row and half as wide. Declaring it per field would mean
   * remembering it on each new list, and a def-driven field (`toFieldConfig`)
   * has no config line to declare it on at all.
   */
  const listBacked =
    field.type === "tags" || (field.type === "select" && field.listKey != null);
  const colSpan = field.colSpan === 2 || listBacked ? "sm:col-span-2" : "";

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
        {/*
          Typed, not scrolled. The catalog is the whole universe (Forex, CFD,
          futures) and a grouped list of ninety entries was still a list of
          ninety entries: Radix's type-to-jump matches the start of a label, so
          "gold" found nothing. `InstrumentSelect` filters on symbol AND name and
          keeps the class grouping for when nothing is typed.
        */}
        <InstrumentSelect
          instruments={instruments}
          value={(value as string) ?? ""}
          onChange={(v) => onChange(v)}
        />
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

  if (field.type === "rating") {
    // `null` and `0` differ on purpose: an empty value is "not rated", never
    // zero stars. `Number(value)` on an empty string gives 0, so empty is
    // caught BEFORE the conversion.
    const n =
      value === "" || value == null ? null : Number(value);
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <Label className="text-xs">{field.label}</Label>
        <StarRating
          value={n != null && Number.isFinite(n) ? n : null}
          onChange={(next) => onChange(next == null ? "" : String(next))}
        />
      </div>
    );
  }

  if (field.type === "days") {
    // The same catch-empty-before-converting as `rating`: `Number("")` is 0,
    // and zero days does not exist here — empty means "no deadline".
    const n = value === "" || value == null ? null : Number(value);
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <Label className="text-xs">{field.label}</Label>
        <NumberChoice
          label={field.label}
          value={n != null && Number.isFinite(n) ? n : null}
          onChange={(next) => onChange(next == null ? "" : String(next))}
        />
        {field.placeholder && (
          <p className="text-xs text-muted-foreground">{field.placeholder}</p>
        )}
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
