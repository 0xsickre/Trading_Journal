import { describe, expect, it } from "vitest";
import { accountDayZoneResolver, dayKeyIn, type DayZone } from "./time";
import { buildTradeDayIndex, evaluateAutoRulesForDay } from "./tracker/auto-rules";
import { resolveAutoResults } from "./tracker/compliance";
import type { TrackerCheckin, TrackerRule } from "./tracker-types";
import { cashByDay } from "./tracker/equity-ladder";
import { bucketByPeriod } from "./period-stats";
import { dailyPnl, toRealized } from "./analytics";
import { enrichTrades } from "./enriched-trade";
import { tradingDayKeysFromRows } from "./activity";
import { periodBounds, tradeDayKey } from "./trades-view";
import { reviewGaps } from "./review-gaps";
import { dailyPnlByInstrument, spansOf } from "./co-exposure";
import type { CashEvent } from "./balance";
import type { TradeRow } from "./types";

/**
 * F2: ONE day per account, everywhere a day is counted.
 *
 * The same evening goes through every module that keys days. On the Topstep
 * account it belongs to Topstep's next trading day (17:00 CT starts it); on the
 * CFD account, the same instant stays on its calendar day. Before F2 each module
 * used the account's zone, so the calendar and the banner's "DLL today" filed
 * the same evening under two different days.
 */

const NY = "America/New_York";
const accounts = [
  { id: "ts", timezone: NY, topstep_mode: true },
  { id: "cfd", timezone: NY, topstep_mode: false },
];
const zoneOf = accountDayZoneResolver(accounts, accounts[0]);
const zoneOfRow = (row: TradeRow): DayZone => zoneOf(row.account_id);

function row(id: string, account: string, opened: string, closed: string | null, net: number): TradeRow {
  return {
    id,
    account_id: account,
    trade_no: null,
    status: closed ? "closed" : "open",
    source: "manual",
    needs_review: false,
    created_at: opened,
    instrument: "MNQ",
    playbook_id: null,
    execution_rating: null,
    stop_price: 100,
    stats: {
      position_id: id,
      avg_entry: 100,
      avg_exit: closed ? 101 : null,
      entry_qty: 1,
      exit_qty: closed ? 1 : 0,
      gross_pl: net,
      net_pl: closed ? net : null,
      total_fees: 0,
      realized_r: null,
      realized_r_net: null,
      opened_at: opened,
      closed_at: closed,
      duration_seconds: null,
      point_value: 2,
      fx_rate: 1,
      tick_size: 0.25,
      point_value_source: "snapshot",
    },
  } as unknown as TradeRow;
}

// Mon 28.09.2026, 17:10 → 17:40 CT (18:10 → 18:40 ET): Tuesday's Topstep day.
const EVENING_OPEN = "2026-09-28T22:10:00Z";
const EVENING_CLOSE = "2026-09-28T22:40:00Z";
const tsEvening = row("ts-evening", "ts", EVENING_OPEN, EVENING_CLOSE, -600);
const cfdEvening = row("cfd-evening", "cfd", EVENING_OPEN, EVENING_CLOSE, -100);
// Sun 27.09.2026, 18:05 → 18:20 CT: the Sunday open, Monday's session.
const tsSunday = row("ts-sunday", "ts", "2026-09-27T23:05:00Z", "2026-09-27T23:20:00Z", 50);
const rows = [tsEvening, cfdEvening, tsSunday];

describe("the tracker counts the Topstep day (D1: each trade by its own account)", () => {
  const index = buildTradeDayIndex(rows, zoneOfRow);

  it("files the Topstep evening under Tuesday and the CFD one under Monday", () => {
    expect(index.byCloseDay.get("2026-09-29")?.map((t) => t.id)).toEqual(["ts-evening"]);
    expect(index.byCloseDay.get("2026-09-28")?.map((t) => t.id).sort()).toEqual(["cfd-evening", "ts-sunday"]);
    expect(index.byOpenDay.get("2026-09-29")?.map((t) => t.id)).toEqual(["ts-evening"]);
  });

  it("charges max loss per day to the day Topstep charges its DLL to", () => {
    const equity = () => 10_000;
    const tue = evaluateAutoRulesForDay("2026-09-29", index, { max_loss_per_day: { pct: 5 } }, equity);
    expect(tue.max_loss_per_day.verdict).toBe("fail");
    expect(tue.max_loss_per_day.observed).toBe(-600);
    const mon = evaluateAutoRulesForDay("2026-09-28", index, { max_loss_per_day: { pct: 5 } }, equity);
    expect(mon.max_loss_per_day.verdict).toBe("pass");
    expect(mon.max_loss_per_day.observed).toBe(-50);
  });
});

describe("the calendar counts it too", () => {
  const realized = toRealized(rows);
  const tzOf = (t: { row: TradeRow }) => zoneOfRow(t.row);

  it("day cells", () => {
    const days = new Map(bucketByPeriod(realized, "day", tzOf).map((r) => [r.key, r.net]));
    expect(days.get("2026-09-29")).toBe(-600);
    expect(days.get("2026-09-28")).toBe(-50);
    expect(dailyPnl(realized, "net", tzOf).get("2026-09-29")).toBe(-600);
  });

  it("weeks (D4): the Sunday open belongs to Monday's week", () => {
    const weeks = new Map(bucketByPeriod(realized, "week", tzOf).map((r) => [r.key, r.trades]));
    expect(weeks.get("2026-09-28")).toBe(3);
    expect(weeks.has("2026-09-21")).toBe(false);
  });

  it("insights read the same open and close days, on the account's clock for hours", () => {
    const e = enrichTrades(realized, { tzOf }).find((x) => x.id === "ts-evening")!;
    expect(e.openDay).toBe("2026-09-29");
    expect(e.closeDay).toBe("2026-09-29");
    expect(e.closeWeek).toBe("2026-09-28");
    // The hour is still what the account's clock read: 18:10 in New York.
    expect(e.openHour).toBe(18);
  });

  it("activity counts Tuesday as the day traded", () => {
    expect([...tradingDayKeysFromRows(rows, zoneOfRow)].sort()).toEqual(["2026-09-28", "2026-09-29"]);
    expect(tradeDayKey(tsEvening, zoneOfRow(tsEvening))).toBe("2026-09-29");
  });
});

describe("today and this week follow the primary account's rule (D3)", () => {
  it("at 17:30 CT on a Topstep primary, today is tomorrow", () => {
    const now = new Date("2026-09-28T22:30:00Z");
    expect(periodBounds("today", now, zoneOf("ts"))).toEqual({ from: "2026-09-29", to: "2026-09-29" });
    expect(periodBounds("today", now, zoneOf("cfd"))).toEqual({ from: "2026-09-28", to: "2026-09-28" });
  });

  it("on Sunday evening this week is already next week", () => {
    const sundayEvening = new Date("2026-09-27T23:30:00Z");
    expect(periodBounds("week", sundayEvening, zoneOf("ts"))).toEqual({ from: "2026-09-28", to: "2026-09-28" });
  });
});

describe("cash and exposure use the same day", () => {
  it("a deposit after 17:00 CT opens the next Topstep day's balance", () => {
    const ev = { account_id: "ts", occurred_at: "2026-09-28T22:30:00Z", amount: 500 } as unknown as CashEvent;
    expect([...cashByDay([ev], zoneOf).keys()]).toEqual(["2026-09-29"]);
  });

  it("spans and per-instrument days", () => {
    expect(spansOf([tsEvening], zoneOfRow, "2026-09-30")).toEqual([
      { instrument: "MNQ", openDay: "2026-09-29", closeDay: "2026-09-29" },
    ]);
    expect([...(dailyPnlByInstrument([tsEvening], zoneOfRow, (r) => r.stats?.net_pl ?? null).get("MNQ")?.keys() ?? [])]).toEqual([
      "2026-09-29",
    ]);
  });
});

describe("\"Bez pregleda\" counts the day the 21:25 reminder counts", () => {
  // futures-trading's journal_podsetnik.py keys the day with racun.trgovacki_dan:
  // 17:00 CT starts the next one. This is the same rule, so /daily and the
  // Telegram message list the same trades for the same date.
  const trgovackiDan = (iso: string) => {
    const ct = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago" }));
    if (ct.getHours() >= 17) ct.setDate(ct.getDate() + 1);
    return `${ct.getFullYear()}-${String(ct.getMonth() + 1).padStart(2, "0")}-${String(ct.getDate()).padStart(2, "0")}`;
  };

  it("lists the Topstep evening trade on Tuesday, where the reminder puts it", () => {
    const dayOf = (t: TradeRow) => dayKeyIn(t.stats?.closed_at ?? null, zoneOfRow(t));
    expect(trgovackiDan(EVENING_CLOSE)).toBe("2026-09-29");
    expect(reviewGaps([tsEvening], "2026-09-29", dayOf).map((g) => g.id)).toEqual(["ts-evening"]);
    expect(reviewGaps([tsEvening], "2026-09-28", dayOf)).toEqual([]);
  });
});

describe("a locked day keeps what it was locked with", () => {
  it("the evening trade moves to Tuesday, Monday's frozen verdict does not move with it", () => {
    // Locked before F2, Monday carried the -600 evening trade and failed its daily
    // limit. Read live under the Topstep day, Monday no longer holds that trade —
    // but the frozen row is what Monday was scored with, and it stays.
    const index = buildTradeDayIndex(rows, zoneOfRow);
    const live = evaluateAutoRulesForDay("2026-09-28", index, { max_loss_per_day: { pct: 5 } }, () => 10_000);
    expect(live.max_loss_per_day.verdict).toBe("pass");

    const rule = { id: "r-dll", auto_key: "max_loss_per_day" } as unknown as TrackerRule;
    const frozen = new Map([["r-dll", { checked: false, auto_evaluated: true } as unknown as TrackerCheckin]]);
    const shown = resolveAutoResults([rule], live, frozen);
    expect(shown.max_loss_per_day?.verdict).toBe("fail");
    expect(shown.max_loss_per_day?.reason).toBe("frozen");
  });
});
