import { describe, expect, it } from "vitest";
import {
  biasLateText,
  biasPoints,
  biasesOf,
  firstBiases,
  firstEntryResolver,
  outcomeText,
  parseDailyBias,
  rateText,
  splitTradesByBias,
  summarizeBias,
  type DailyBias,
} from "./daily-bias";
import type { TradeRow } from "./types";

const BG = "Europe/Belgrade";

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "b1",
    trading_day: "2026-10-19",
    root: "NQ",
    bias: "gore",
    reason: "  PDH iznad  ",
    set_at: "2026-10-19T05:02:00Z",
    eval_status: null,
    ...over,
  };
}

const graded = (over: Record<string, unknown>) =>
  row({
    eval_status: "ok",
    eval_start_at: "2026-10-19T07:00:00Z",
    eval_start_price: "25000",
    eval_end_price: "25142",
    eval_move: "142",
    eval_band: "61",
    eval_day: "gore",
    eval_contract: "NQZ6",
    ...over,
  });

const b = (over: Record<string, unknown>) => parseDailyBias(graded(over)) as DailyBias;

function trade(over: Partial<TradeRow> & Record<string, unknown>): TradeRow {
  return {
    id: "t1",
    account_id: "a",
    trade_no: 1,
    status: "closed",
    source: "import",
    needs_review: false,
    created_at: "2026-10-19T08:00:00Z",
    instrument: "MNQ",
    direction: "Long",
    stats: { opened_at: "2026-10-19T08:00:00Z", net_pl: 100, realized_r: 1 } as TradeRow["stats"],
    ...over,
  } as TradeRow;
}

describe("parseDailyBias", () => {
  it("reads a forecast and trims the reason", () => {
    const p = parseDailyBias(row())!;
    expect(p).toMatchObject({ root: "NQ", bias: "gore", reason: "PDH iznad", status: null, eval: null });
  });

  it("reads the grade, numbers arriving as strings", () => {
    const p = parseDailyBias(graded({}))!;
    expect(p.status).toBe("ok");
    expect(p.eval).toEqual({
      startAt: "2026-10-19T07:00:00Z",
      startPrice: 25000,
      endPrice: 25142,
      move: 142,
      band: 61,
      day: "gore",
      contract: "NQZ6",
    });
  });

  it("refuses an unknown root or direction", () => {
    expect(parseDailyBias(row({ root: "6E" }))).toBeNull();
    expect(parseDailyBias(row({ bias: "long" }))).toBeNull();
  });

  it("an `ok` without its numbers is not a grade", () => {
    const p = parseDailyBias(row({ eval_status: "ok" }))!;
    expect(p.eval).toBeNull();
    expect(p.status).toBeNull();
  });
});

describe("the first forecast counts", () => {
  const early = b({ id: "e", set_at: "2026-10-19T05:00:00Z", bias: "dole" });
  const later = b({ id: "l", set_at: "2026-10-19T09:00:00Z", bias: "gore" });

  it("orders a day's forecasts earliest first", () => {
    expect(biasesOf([later, early], "2026-10-19", "NQ").map((x) => x.id)).toEqual(["e", "l"]);
  });

  it("keeps one per day and root", () => {
    const es = b({ id: "es", root: "ES" });
    expect(firstBiases([later, early, es]).map((x) => x.id)).toEqual(["es", "e"]);
  });
});

describe("points and text", () => {
  it("Gore earns the move, Dole its opposite, Neutral nothing", () => {
    expect(biasPoints("gore", 40)).toBe(40);
    expect(biasPoints("dole", 40)).toBe(-40);
    expect(biasPoints("neutral", 40)).toBe(0);
  });

  it("says the day and the verdict", () => {
    expect(outcomeText(b({}))).toBe("dan Gore +142 (±61) → pogodak");
    expect(outcomeText(b({ bias: "neutral" }))).toBe("dan Gore +142 (±61) → promašaj");
    expect(outcomeText(parseDailyBias(row())!)).toBe("čeka cene");
    expect(outcomeText(parseDailyBias(row({ eval_status: "prekasno" }))!)).toMatch(/posle 18:00/);
  });

  it("marks a forecast set after the first entry, in Belgrade time", () => {
    const x = b({ set_at: "2026-10-19T12:02:00Z" });
    expect(biasLateText(x, "2026-10-19T07:24:00Z", BG)).toBe("upisano 14:02, posle prvog ulaza (09:24)");
    expect(biasLateText(x, "2026-10-19T13:00:00Z", BG)).toBeNull();
    expect(biasLateText(x, null, BG)).toBeNull();
  });

  it("rate", () => {
    expect(rateText(14, 24)).toBe("58 % (14/24)");
    expect(rateText(0, 0)).toBe("—");
  });
});

describe("summarizeBias: moj bias against uvek long on the same days", () => {
  const none = () => null;

  it("grades both from the same move; a direction on a neutral day misses for both", () => {
    const s = summarizeBias(
      [
        b({ id: "1", trading_day: "2026-10-19", bias: "gore", eval_move: "142", eval_day: "gore" }),
        b({ id: "2", trading_day: "2026-10-20", bias: "dole", eval_move: "-90", eval_day: "dole" }),
        b({ id: "3", trading_day: "2026-10-21", bias: "gore", eval_move: "20", eval_day: "neutral" }),
        b({ id: "4", trading_day: "2026-10-22", bias: "neutral", eval_move: "-10", eval_day: "neutral" }),
      ],
      none,
    );
    const nq = s.byRoot.NQ;
    expect(nq).toMatchObject({ n: 4, hits: 3, longHits: 1, points: 142 + 90 + 20 + 0, longPoints: 142 - 90 + 20 - 10 });
    expect(nq.curve.map((p) => p.day)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(s.total).toEqual({ n: 4, hits: 3, longHits: 1 });
  });

  it("a forecast set after the first entry is counted apart, an ungraded one too", () => {
    const s = summarizeBias(
      [b({ id: "late", set_at: "2026-10-19T09:00:00Z" }), parseDailyBias(row({ id: "wait", trading_day: "2026-10-20" }))!],
      (day) => (day === "2026-10-19" ? "2026-10-19T08:00:00Z" : null),
    );
    expect(s.byRoot.NQ.n).toBe(0);
    expect(s.late).toBe(1);
    expect(s.ungraded).toBe(1);
  });

  it("only the first forecast of the day is graded", () => {
    const s = summarizeBias(
      [b({ id: "first", bias: "dole", set_at: "2026-10-19T05:00:00Z" }), b({ id: "second", bias: "gore", set_at: "2026-10-19T06:00:00Z" })],
      none,
    );
    expect(s.byRoot.NQ).toMatchObject({ n: 1, hits: 0 });
  });
});

describe("real money by bias", () => {
  const zone = () => BG;

  it("finds the first entry per day and root, a micro on its mini's root", () => {
    const of = firstEntryResolver(
      [
        trade({ id: "a", stats: { opened_at: "2026-10-19T09:00:00Z" } as TradeRow["stats"] }),
        trade({ id: "b", stats: { opened_at: "2026-10-19T07:30:00Z" } as TradeRow["stats"] }),
        trade({ id: "c", instrument: "6E", stats: { opened_at: "2026-10-19T06:00:00Z" } as TradeRow["stats"] }),
      ],
      zone,
    );
    expect(of("2026-10-19", "NQ")).toBe("2026-10-19T07:30:00Z");
    expect(of("2026-10-19", "ES")).toBeNull();
  });

  it("splits closed trades: with the bias, against it, on a neutral day, without one", () => {
    const biases = [
      b({ trading_day: "2026-10-19", bias: "gore" }),
      b({ id: "n", trading_day: "2026-10-20", bias: "neutral", set_at: "2026-10-20T05:00:00Z" }),
    ];
    const split = splitTradesByBias(
      [
        trade({ id: "w", direction: "Long" }),
        trade({ id: "x", direction: "Short", stats: { opened_at: "2026-10-19T09:00:00Z", net_pl: -50, realized_r: -1 } as TradeRow["stats"] }),
        trade({ id: "y", stats: { opened_at: "2026-10-20T08:00:00Z", net_pl: 30, realized_r: null } as TradeRow["stats"] }),
        trade({ id: "z", stats: { opened_at: "2026-10-21T08:00:00Z", net_pl: 10, realized_r: 0.5 } as TradeRow["stats"] }),
        trade({ id: "open", status: "open" }),
      ],
      biases,
      zone,
    );
    expect(split.with).toEqual({ n: 1, net: 100, r: 1, rCount: 1 });
    expect(split.against).toEqual({ n: 1, net: -50, r: -1, rCount: 1 });
    expect(split.neutral).toEqual({ n: 1, net: 30, r: 0, rCount: 0 });
    expect(split.none).toEqual({ n: 1, net: 10, r: 0.5, rCount: 1 });
  });
});
