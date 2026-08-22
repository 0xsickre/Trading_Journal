import { describe, expect, it } from "vitest";
import {
  bookEquityLadder,
  buildEquityLadder,
  cashByDay,
  NO_EQUITY,
} from "./equity-ladder";
import { buildTradeDayIndex } from "./auto-rules";
import type { CashEvent } from "../balance";
import type { TradeRow } from "../types";

type Spec = { id: string; closed: string; net: number | null };

/** Opened a day before it closed, so only the close day matters here. */
function mkRow(s: Spec): TradeRow {
  return {
    id: s.id,
    status: "closed",
    account_id: "acc",
    stats: {
      opened_at: "2026-03-01T10:00:00Z",
      closed_at: s.closed,
      net_pl: s.net,
      point_value_source: s.net === null ? "missing" : "snapshot",
    },
  } as unknown as TradeRow;
}

const idx = (specs: Spec[]) => buildTradeDayIndex(specs.map(mkRow), () => "UTC");

const cash = (day: string, amount: number): CashEvent => ({
  id: day + amount,
  account_id: "acc",
  event_type: amount > 0 ? "deposit" : "withdrawal",
  amount,
  occurred_at: `${day}T12:00:00Z`,
  note: null,
});

describe("buildEquityLadder — the balance a day opened with", () => {
  it("answers the starting balance for a day before anything happened", () => {
    const ladder = buildEquityLadder(idx([]), 10_000, new Map());
    expect(ladder("2026-03-05")).toBe(10_000);
  });

  it("excludes the day's OWN trades, so the limit cannot move as the day loses", () => {
    // The whole point of the opening basis: a -2 000 day still gets judged
    // against 10 000, not against the 8 000 it is on the way to.
    const ladder = buildEquityLadder(
      idx([{ id: "a", closed: "2026-03-05T15:00:00Z", net: -2_000 }]),
      10_000,
      new Map(),
    );
    expect(ladder("2026-03-05")).toBe(10_000);
    expect(ladder("2026-03-06")).toBe(8_000);
  });

  it("carries earlier days forward", () => {
    const ladder = buildEquityLadder(
      idx([
        { id: "a", closed: "2026-03-02T15:00:00Z", net: -500 },
        { id: "b", closed: "2026-03-03T15:00:00Z", net: 1_200 },
      ]),
      10_000,
      new Map(),
    );
    expect(ladder("2026-03-03")).toBe(9_500);
    expect(ladder("2026-03-04")).toBe(10_700);
  });

  it("counts a deposit, because it really does change what a loss is worth", () => {
    const ladder = buildEquityLadder(
      idx([]),
      10_000,
      cashByDay([cash("2026-03-02", 5_000)], () => "UTC"),
    );
    expect(ladder("2026-03-02")).toBe(10_000);
    expect(ladder("2026-03-03")).toBe(15_000);
  });

  it("goes unknown after an unpriced trade instead of quoting a short balance", () => {
    // A trade with no point value leaves the realized total unknowable from
    // that day on. Reporting 10 000 would be quoting a balance that is missing
    // a trade, and the percentage taken from it would be wrong without saying so.
    const ladder = buildEquityLadder(
      idx([{ id: "a", closed: "2026-03-03T15:00:00Z", net: null }]),
      10_000,
      new Map(),
    );
    expect(ladder("2026-03-03")).toBe(10_000); // still before the damage
    expect(ladder("2026-03-04")).toBeNull();
    expect(ladder("2026-06-01")).toBeNull();
  });
});

describe("bookEquityLadder", () => {
  it("sums the accounts, matching the dashboard's unfiltered curve", () => {
    const ladder = bookEquityLadder(
      idx([]),
      [{ starting_balance: 6_000 }, { starting_balance: 4_000 }],
      [],
      () => "UTC",
    );
    expect(ladder("2026-03-05")).toBe(10_000);
  });

  it("answers null for a book with no starting balance", () => {
    // The seed writes 0, so this is the state a brand-new journal is in — the
    // percentage rules must report themselves unscored rather than divide by it.
    const ladder = bookEquityLadder(idx([]), [{ starting_balance: 0 }], [], () => "UTC");
    expect(ladder("2026-03-05")).toBeNull();
    expect(NO_EQUITY("2026-03-05")).toBeNull();
  });
});
