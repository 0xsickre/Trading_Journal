/**
 * Mistakes the journal finds by itself (phase B4, 26.10.2026), per trade.
 *
 * The trader picks only what the data cannot know — an early entry, a chased
 * price. Everything below is read off what is already stored: the fills, the
 * trading window, the playbook link, the stop
 * and target, the orders export's last stop and the excursion from the
 * contract's candles.
 *
 * COMPUTED ON READ, NEVER WRITTEN to `tj_positions.mistake`. A stored copy
 * would go stale the moment a window is corrected or MFE arrives from R2, and
 * it would mix with the trader's own picks so that neither could be trusted.
 * The labels are the option-list values the trader used to pick by hand, so a
 * report sums an old manual "Pomerio stop" and a new automatic one as one tag.
 *
 * NOTHING IS GUESSED. Each detection answers only when its input exists: no
 * window for the day, no orders export, no MFE yet, no stop or no
 * target — and that mistake is simply not there. "Not known" is not "not made".
 *
 * Left out on purpose (decision B-1 A): an entry after the daily target or the
 * DLL, an oversized position and too many trades. Each needs a money limit or
 * a count per account, which phase X took out of the journal. An entry in a red
 * window of the brief left in phase X9 (X-10): the brief writes nothing here.
 * No bias of the day before the entry left in phase E (27.10.2026): the
 * journal holds no forecast of direction.
 */
import { excursionFromTrade } from "./excursion";
import { numberFieldValue } from "./field-values";
import { plannedEntryOf } from "./plan-snapshot";
import { stopStatus } from "./stop-moved";
import { DEFAULT_TZ, zonedDateKey, zonedInputToUtc } from "./time";
import {
  buildTradeDayIndex,
  evaluateAutoRulesForDay,
  type AutoContext,
} from "./tracker/auto-rules";
import { tradeOutcome, type BreakevenRange } from "./breakeven";
import type { DayZone } from "./time";
import type { TradeRow } from "./types";

/** The automatic mistakes, keyed, with the option-list value each one stands for. */
export const AUTO_MISTAKES = {
  outside_window: "Ulaz van prozora",
  after_two_sl: "Ulaz posle 2 SL",
  no_playbook: "Ulaz bez setupa iz playbook-a",
  target_below_2r: "Cilj ispod 2R",
  moved_stop: "Pomerio stop",
  win_to_loss: "Dobitak pretvorio u gubitak",
} as const;

export type AutoMistakeKey = keyof typeof AUTO_MISTAKES;

export type AutoMistake = {
  key: AutoMistakeKey;
  /** The option-list value, the same text a manual pick carried. */
  label: (typeof AUTO_MISTAKES)[AutoMistakeKey];
  /** Why, in a sentence the trade page shows beside the "auto" mark. */
  reason: string;
};

/** The planned reward-to-risk below which a target is a mistake. Exactly 2R is not one. */
export const MIN_TARGET_R = 2;

/** MFE, in R, from which a closed loser had been a winner first. Exactly 1R counts. */
export const WIN_TO_LOSS_MFE_R = 1;

const isShort = (row: TradeRow) => String(row.direction ?? "").toLowerCase().startsWith("short");
const epoch = (iso: string | null | undefined) => Date.parse(String(iso ?? ""));
const mark = (key: AutoMistakeKey, reason: string): AutoMistake => ({ key, label: AUTO_MISTAKES[key], reason });

/** Planned reward ÷ risk from the stop and target on the trade; null without both. */
export function plannedRewardRisk(row: TradeRow): number | null {
  const entry = plannedEntryOf(row) ?? row.stats?.avg_entry ?? null;
  const stop = numberFieldValue(row, "stop_price");
  const target = numberFieldValue(row, "target_price");
  if (entry == null || stop == null || target == null) return null;
  const dir = isShort(row) ? -1 : 1;
  const risk = dir * (entry - stop);
  const reward = dir * (target - entry);
  if (!(risk > 0) || !(reward > 0)) return null;
  return reward / risk;
}

/** The mistakes one trade carries on its own, without the rest of its day. */
function ownMistakes(row: TradeRow, band: BreakevenRange): AutoMistake[] {
  const out: AutoMistake[] = [];
  if (row.playbook_id == null || row.playbook_id === "") {
    out.push(mark("no_playbook", "Trejd nema playbook („No playbook“)."));
  }
  const rr = plannedRewardRisk(row);
  if (rr != null && rr < MIN_TARGET_R) {
    out.push(mark("target_below_2r", `Planirani R:R ${rr.toFixed(2)}R, ispod ${MIN_TARGET_R}R.`));
  }
  const status = stopStatus(row);
  const stop = numberFieldValue(row, "stop_price");
  const last = numberFieldValue(row, "final_stop_price");
  const differs = stop != null && last != null && Math.abs(stop - last) > 1e-9;
  if (differs || status === "moved_be" || status === "moved_mae") {
    out.push(
      mark(
        "moved_stop",
        differs
          ? `Originalni stop ${stop} ≠ poslednji u platformi ${last}.`
          : `Poslednji stop u platformi (${last}) pomeren posle ulaza; originalni nije upisan.`,
      ),
    );
  }
  const net = row.stats?.net_pl ?? null;
  // A loss as the tracker counts one: below the breakeven band (a tenth of the
  // risk), so a scratch after a good run is not "a win turned into a loss".
  if (row.status === "closed" && net != null && tradeOutcome(row, net, band) === "loss") {
    const mfe = excursionFromTrade(row).mfeR;
    if (mfe != null && mfe >= WIN_TO_LOSS_MFE_R) {
      out.push(mark("win_to_loss", `Bio +${mfe.toFixed(2)}R (MFE), zatvoren u minusu.`));
    }
  }
  return out;
}

/** Entry outside the day's trading window, Belgrade clock: before `from`, or at `to` and after. */
function outsideWindow(day: string, openedAt: string, ctx: AutoContext): AutoMistake | null {
  // The window in force on the trading day, as `trading_window` reads it; its times are Belgrade's.
  const w = ctx.tradingWindowOf?.(day);
  const date = zonedDateKey(openedAt, DEFAULT_TZ);
  if (!w) return null;
  const start = epoch(zonedInputToUtc(`${date}T${w.from}`, DEFAULT_TZ));
  const end = epoch(zonedInputToUtc(`${date}T${w.to}`, DEFAULT_TZ));
  const at = epoch(openedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(at)) return null;
  return at < start || at >= end ? mark("outside_window", `Ulaz van prozora ${w.from}–${w.to} (po Beogradu).`) : null;
}

/**
 * Every executed trade's automatic mistakes, by trade id. A trade with none
 * is absent from the map.
 *
 * The day-level ones come from the same evaluators the tracker grades with
 * (`stop_after_two_losses`), so the trade page, the reports and
 * the day's checklist cannot disagree about which entry broke them.
 */
export function autoMistakes(
  rows: readonly TradeRow[],
  tzOf: (row: TradeRow) => DayZone,
  bandOf: (accountId: string | null) => BreakevenRange,
  ctx: AutoContext = {},
): Map<string, AutoMistake[]> {
  const index = buildTradeDayIndex([...rows], tzOf, bandOf);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, AutoMistake[]>();
  const add = (id: string, m: AutoMistake) => out.set(id, [...(out.get(id) ?? []), m]);

  for (const [day, opened] of index.byOpenDay) {
    const results = evaluateAutoRulesForDay(day, index, ctx);
    const afterTwo = new Set(results.stop_after_two_losses.offenders);
    for (const t of opened) {
      const row = byId.get(t.id);
      if (!row) continue;
      const window = outsideWindow(day, t.openedAt, ctx);
      if (window) add(t.id, window);
      if (afterTwo.has(t.id)) add(t.id, mark("after_two_sl", "Ulaz posle dva SL zaredom istog dana."));
      for (const m of ownMistakes(row, bandOf(row.account_id))) add(t.id, m);
    }
  }
  return out;
}
