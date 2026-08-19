import { describe, expect, it } from "vitest";
import { daysBetweenKeys, openPositionsOn } from "./open-positions";
import type { TradeRow } from "./types";

const NY = "America/New_York";
const tzOf = () => NY;

function trade(over: Partial<TradeRow> & { id: string }): TradeRow {
  // `rest` widened to a plain record before the spread. `over` is a Partial, so
  // a key it omits is genuinely absent and the default below survives — but the
  // TradeRow type says those keys are present, and TS reads the spread as
  // unconditionally clobbering them.
  const { stats, ...rest } = over as TradeRow & { stats?: unknown };
  return {
    account_id: "acc-1",
    trade_no: null,
    status: "open",
    source: "manual",
    needs_review: false,
    created_at: "2026-03-02T00:00:00Z",
    ...(rest as Record<string, unknown>),
    stats: (stats ?? null) as TradeRow["stats"],
  } as TradeRow;
}

/** Opened/closed at 15:00 New York on the given day keys. */
function held(id: string, open: string, close?: string, extra: Partial<TradeRow> = {}) {
  return trade({
    id,
    ...extra,
    stats: {
      opened_at: `${open}T19:00:00Z`,
      closed_at: close ? `${close}T19:00:00Z` : null,
    },
  } as Partial<TradeRow> & { id: string });
}

describe("daysBetweenKeys — the open day is day 1", () => {
  it("counts the open day itself as one", () => {
    expect(daysBetweenKeys("2026-03-02", "2026-03-02")).toBe(1);
  });

  it("counts inclusively across days", () => {
    expect(daysBetweenKeys("2026-03-02", "2026-03-05")).toBe(4);
  });

  it("crosses a DST boundary without drifting", () => {
    // US DST starts 2026-03-08. A 23-hour day must not shorten the count.
    expect(daysBetweenKeys("2026-03-06", "2026-03-10")).toBe(5);
  });

  it("answers 0 rather than a negative for a backwards range", () => {
    expect(daysBetweenKeys("2026-03-05", "2026-03-02")).toBe(0);
  });
});

describe("openPositionsOn", () => {
  it("includes a position opened before the day and still running", () => {
    const rows = [held("a", "2026-03-02")];
    const open = openPositionsOn(rows, "2026-03-04", tzOf);
    expect(open.map((p) => p.id)).toEqual(["a"]);
    expect(open[0].daysInTrade).toBe(3);
  });

  it("includes the day the position OPENED", () => {
    expect(
      openPositionsOn([held("a", "2026-03-04")], "2026-03-04", tzOf),
    ).toHaveLength(1);
  });

  it("includes the day the position CLOSED", () => {
    // The last day of a trade is often the one that decided it. Excluding it
    // would make that the one day nobody journalled.
    expect(
      openPositionsOn([held("a", "2026-03-02", "2026-03-04")], "2026-03-04", tzOf),
    ).toHaveLength(1);
  });

  it("excludes a position closed before the day", () => {
    expect(
      openPositionsOn([held("a", "2026-03-02", "2026-03-03")], "2026-03-04", tzOf),
    ).toHaveLength(0);
  });

  it("excludes a position not opened yet on that day", () => {
    expect(
      openPositionsOn([held("a", "2026-03-05")], "2026-03-04", tzOf),
    ).toHaveLength(0);
  });

  it("excludes planned and missed trades — no exposure, nothing to check", () => {
    const rows = [
      trade({ id: "p", status: "planned", stats: null } as never),
      trade({
        id: "m",
        status: "missed",
        stats: { opened_at: "2026-03-02T19:00:00Z", closed_at: null },
      } as never),
    ];
    expect(openPositionsOn(rows, "2026-03-04", tzOf)).toHaveLength(0);
  });

  it("reads the open day in the ACCOUNT's zone, not UTC", () => {
    // 2026-03-04 20:00 New York is 2026-03-05 01:00 UTC. Asked about the 4th,
    // a UTC reading would call the position not yet open.
    const rows = [
      trade({
        id: "a",
        stats: { opened_at: "2026-03-05T01:00:00Z", closed_at: null },
      } as never),
    ];
    expect(openPositionsOn(rows, "2026-03-04", tzOf)).toHaveLength(1);
  });

  it("flags a position past its time stop, but not one exactly at it", () => {
    // Day 3 of a 3-day stop is still the plan being followed; day 4 is not.
    const at = openPositionsOn(
      [held("a", "2026-03-02", undefined, { time_stop_days: 3 })],
      "2026-03-04",
      tzOf,
    );
    expect(at[0].daysInTrade).toBe(3);
    expect(at[0].pastTimeStop).toBe(false);

    const past = openPositionsOn(
      [held("a", "2026-03-02", undefined, { time_stop_days: 3 })],
      "2026-03-05",
      tzOf,
    );
    expect(past[0].daysInTrade).toBe(4);
    expect(past[0].pastTimeStop).toBe(true);
  });

  it("never flags a position that has no time stop", () => {
    const open = openPositionsOn([held("a", "2026-01-01")], "2026-03-04", tzOf);
    expect(open[0].timeStopDays).toBeNull();
    expect(open[0].pastTimeStop).toBe(false);
  });

  it("TREATS AN EXPLICIT null THE SAME AS AN ABSENT KEY, which is the shape production sends", () => {
    // The test above passed for two years while every open position on screen
    // wore a false "Past time stop" badge, because `held()` OMITS the key when
    // no `extra` is given: `Number(undefined)` is NaN and coerces to null, but
    // `Number(null)` is 0 and coerces to a zero-day stop. `trades.ts` uses
    // `select("*")`, so the column arrives present-and-null — this path.
    for (const empty of [null, ""]) {
      const open = openPositionsOn(
        [held("a", "2026-01-01", undefined, { time_stop_days: empty } as Partial<TradeRow>)],
        "2026-03-04",
        tzOf,
      );
      expect(open[0].timeStopDays).toBeNull();
      expect(open[0].pastTimeStop).toBe(false);
    }
  });

  it("sorts oldest first — closest to a decision, not last on the page", () => {
    const rows = [held("new", "2026-03-04"), held("old", "2026-03-02")];
    expect(openPositionsOn(rows, "2026-03-05", tzOf).map((p) => p.id)).toEqual([
      "old",
      "new",
    ]);
  });

  it("labels by trade number and instrument when it has them", () => {
    const rows = [held("a", "2026-03-02", undefined, { trade_no: 12, instrument: "XAUUSD" })];
    expect(openPositionsOn(rows, "2026-03-03", tzOf)[0].label).toBe("#12 XAUUSD");
  });
});
