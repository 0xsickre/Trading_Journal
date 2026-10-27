import { describe, expect, it } from "vitest";
import { AUTO_MISTAKES, autoMistakes, plannedRewardRisk, type AutoMistakeKey } from "./auto-mistakes";
import type { DayZone } from "./time";
import type { TradeRow } from "./types";

/**
 * Phase B4: the mistakes the journal finds by itself, at their edges. Tue
 * 20.10.2026 is in summer time in both Belgrade (UTC+2) and Chicago (UTC−5), so
 * 09:00 Belgrade is 07:00 UTC and the CME day is that calendar day until 22:00 UTC.
 */

const DAY = "2026-10-20";
const ZONE: DayZone = { tz: "Europe/Belgrade", cme: true };
const tzOf = () => ZONE;
const band = () => ({ from: 0, to: 0, riskShare: 0.1 });

type Spec = {
  id: string;
  /** UTC "HH:MM" of the entry and the exit on DAY. */
  opened: string;
  closed?: string | null;
  net?: number;
  dir?: "Long" | "Short";
  entry?: number;
  stop?: number | null;
  target?: number | null;
  finalStop?: number | null;
  mfePrice?: number | null;
  playbook?: string | null;
  instrument?: string;
};

const at = (hhmm: string) => `${DAY}T${hhmm}:00Z`;

function row(s: Spec): TradeRow {
  const entry = s.entry ?? 100;
  return {
    id: s.id,
    account_id: "acc",
    trade_no: null,
    status: s.closed === null ? "open" : "closed",
    source: "import",
    needs_review: false,
    created_at: at(s.opened),
    instrument: s.instrument ?? "MNQ",
    direction: s.dir ?? "Long",
    playbook_id: s.playbook === undefined ? "pb" : s.playbook,
    entry_price: null,
    stop_price: s.stop === undefined ? 90 : s.stop,
    target_price: s.target === undefined ? 130 : s.target,
    final_stop_price: s.finalStop ?? null,
    max_profit_price: s.mfePrice ?? null,
    max_drawdown_price: null,
    stats: {
      position_id: s.id,
      avg_entry: entry,
      avg_exit: entry,
      entry_qty: 1,
      exit_qty: s.closed === null ? 0 : 1,
      gross_pl: s.net ?? 0,
      net_pl: s.net ?? 0,
      total_fees: 0,
      realized_r: null,
      realized_r_net: null,
      opened_at: at(s.opened),
      closed_at: s.closed === null ? null : at(s.closed ?? s.opened),
      duration_seconds: null,
      point_value: 2,
      fx_rate: 1,
      tick_size: 0.25,
      point_value_source: "snapshot",
    },
  } as unknown as TradeRow;
}

const keysOf = (rows: TradeRow[], ctx: Parameters<typeof autoMistakes>[3] = {}) => {
  const m = autoMistakes(rows, tzOf, band, ctx);
  return (id: string): AutoMistakeKey[] => (m.get(id) ?? []).map((x) => x.key).sort();
};

describe("autoMistakes — the trading window, Belgrade clock (09:00–12:00)", () => {
  const ctx = { tradingWindowOf: () => ({ since: "2026-10-12", from: "09:00", to: "12:00" }) };
  it("an entry exactly at the window's start is inside it", () => {
    expect(keysOf([row({ id: "a", opened: "07:00" })], ctx)("a")).not.toContain("outside_window");
  });
  it("a minute before the start is outside", () => {
    expect(keysOf([row({ id: "a", opened: "06:59" })], ctx)("a")).toContain("outside_window");
  });
  it("an entry exactly at the window's end is outside — the window is [from, to)", () => {
    expect(keysOf([row({ id: "a", opened: "10:00" })], ctx)("a")).toContain("outside_window");
    expect(keysOf([row({ id: "b", opened: "09:59" })], ctx)("b")).not.toContain("outside_window");
  });
  it("with no window for the day, nothing is guessed", () => {
    expect(keysOf([row({ id: "a", opened: "03:00" })])("a")).not.toContain("outside_window");
  });
});

describe("autoMistakes — no red window since phase X9 (X-10)", () => {
  it("the brief writes no windows into the journal, so none is found", () => {
    expect(keysOf([row({ id: "a", opened: "12:30" })])("a")).not.toContain("red_window");
  });
});

describe("autoMistakes — after two stop losses", () => {
  // A stop loss: −20 on 20 of risk (10 points × $2), well past a tenth of it.
  const sl = (id: string, opened: string, closed: string) => row({ id, opened, closed, net: -20 });
  it("the entry after the SECOND SL of the day is the mistake, not the one after the first", () => {
    const k = keysOf([sl("l1", "08:00", "08:10"), sl("l2", "08:20", "08:30"), row({ id: "third", opened: "08:40" })]);
    expect(k("l2")).not.toContain("after_two_sl");
    expect(k("third")).toContain("after_two_sl");
  });
  it("a win in between breaks the run", () => {
    const k = keysOf([
      sl("l1", "08:00", "08:10"),
      row({ id: "w", opened: "08:12", closed: "08:15", net: 40 }),
      sl("l2", "08:20", "08:30"),
      row({ id: "next", opened: "08:40" }),
    ]);
    expect(k("next")).not.toContain("after_two_sl");
  });
});

describe("autoMistakes — an entry in the first ten minutes (phase G)", () => {
  it("is found from the same verdict as the tracker's rule", () => {
    // 20.10.2026: New York on EDT, 09:30 = 13:30 UTC.
    expect(keysOf([row({ id: "a", opened: "13:35" })])("a")).toContain("first_minutes");
    expect(keysOf([row({ id: "b", opened: "13:45" })])("b")).not.toContain("first_minutes");
  });
});

describe("autoMistakes — no bias of the day (phase E)", () => {
  it("the journal holds no forecast, so there is no mistake about one", () => {
    expect(Object.keys(AUTO_MISTAKES)).not.toContain("no_bias");
    expect(Object.values(AUTO_MISTAKES)).not.toContain("Bez biasa dana pre ulaza");
  });
});

describe("autoMistakes — the trade on its own", () => {
  it("no playbook", () => {
    expect(keysOf([row({ id: "a", opened: "08:00", playbook: null })])("a")).toContain("no_playbook");
    expect(keysOf([row({ id: "b", opened: "08:00" })])("b")).not.toContain("no_playbook");
  });

  it("a target below 2R; exactly 2R is not a mistake", () => {
    expect(keysOf([row({ id: "a", opened: "08:00", target: 115 })])("a")).toContain("target_below_2r");
    expect(keysOf([row({ id: "b", opened: "08:00", target: 120 })])("b")).not.toContain("target_below_2r");
    expect(plannedRewardRisk(row({ id: "c", opened: "08:00", target: 120 }))).toBe(2);
  });

  it("a short reads its target and stop the other way round", () => {
    const short = row({ id: "s", opened: "08:00", dir: "Short", stop: 110, target: 85 });
    expect(plannedRewardRisk(short)).toBe(1.5);
    expect(keysOf([short])("s")).toContain("target_below_2r");
  });

  it("moved stop: the original differs from the platform's last", () => {
    expect(keysOf([row({ id: "a", opened: "08:00", stop: 90, finalStop: 95 })])("a")).toContain("moved_stop");
    expect(keysOf([row({ id: "b", opened: "08:00", stop: 90, finalStop: 90 })])("b")).not.toContain("moved_stop");
  });

  it("without the orders export there is no last stop, and nothing is said about moving it", () => {
    expect(keysOf([row({ id: "a", opened: "08:00", stop: 90, finalStop: null })])("a")).not.toContain("moved_stop");
  });

  it("winner turned loser: MFE exactly 1R and closed in the red", () => {
    // Long from 100, stop 90: one R is 10 points, so an MFE price of 110 is exactly 1R.
    const k = keysOf([
      row({ id: "exact", opened: "08:00", closed: "08:30", net: -10, mfePrice: 110 }),
      row({ id: "short-of", opened: "09:00", closed: "09:30", net: -10, mfePrice: 109.9 }),
      row({ id: "green", opened: "10:00", closed: "10:30", net: 5, mfePrice: 115 }),
      row({ id: "unmeasured", opened: "11:00", closed: "11:30", net: -10, mfePrice: null }),
    ]);
    expect(k("exact")).toContain("win_to_loss");
    expect(k("short-of")).not.toContain("win_to_loss");
    expect(k("green")).not.toContain("win_to_loss");
    expect(k("unmeasured")).not.toContain("win_to_loss");
  });

  it("a scratch after 1R of MFE is not a win turned into a loss — inside a tenth of the risk", () => {
    // Risk is 10 points × $2 = $20, so −$1 is inside the ±$2 breakeven band.
    const k = keysOf([row({ id: "scratch", opened: "08:00", closed: "08:30", net: -1, mfePrice: 115 })]);
    expect(k("scratch")).not.toContain("win_to_loss");
  });

  it("no stop: no R, so neither the target nor the excursion is judged", () => {
    const k = keysOf([row({ id: "a", opened: "08:00", closed: "08:30", net: -10, stop: null, target: 101, mfePrice: 200 })]);
    expect(k("a")).not.toContain("target_below_2r");
    expect(k("a")).not.toContain("win_to_loss");
  });

  it("names each mistake with the option-list value a manual pick carried", () => {
    const m = autoMistakes([row({ id: "a", opened: "08:00", playbook: null })], tzOf, band).get("a")!;
    expect(m[0].label).toBe(AUTO_MISTAKES.no_playbook);
    expect(m[0].label).toBe("Ulaz bez setupa iz playbook-a");
    expect(m[0].reason).not.toBe("");
  });

  it("a trade with nothing found is absent from the map", () => {
    expect(autoMistakes([row({ id: "clean", opened: "08:00" })], tzOf, band).has("clean")).toBe(false);
  });
});
