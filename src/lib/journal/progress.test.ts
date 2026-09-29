import { describe, expect, it } from "vitest";
import type { EnrichedTrade } from "./enriched-trade";
import { buildProgress } from "./progress";

type T = {
  id: string;
  day: string;
  at: string;
  pnl: number;
  r: number | null;
  setup?: string | null;
  rating?: number | null;
  mistake?: string[];
  hour?: number | null;
  mae?: number | null;
  mfe?: number | null;
  capture?: number | null;
};

function trade(t: T): EnrichedTrade {
  return {
    id: t.id,
    pnl: t.pnl,
    r: t.r,
    outcome: t.pnl > 0 ? "win" : t.pnl < 0 ? "loss" : "breakeven",
    openDay: t.day,
    openedAt: `${t.day}T${t.at}:00Z`,
    closedAt: `${t.day}T${t.at}:30Z`,
    openHour: t.hour === undefined ? Number(t.at.slice(0, 2)) : t.hour,
    excursion: { maeR: t.mae ?? null, mfeR: t.mfe ?? null, capturePct: t.capture ?? null },
    trade: {
      id: t.id,
      closedAt: null,
      net: t.pnl,
      gross: t.pnl,
      r: t.r,
      row: {
        id: t.id,
        playbook_id: t.setup ?? null,
        execution_rating: t.rating ?? null,
        mistake: t.mistake ?? [],
      },
    },
  } as unknown as EnrichedTrade;
}

const WEEK = [
  // Monday: a clean win, then a loss, then a revenge trade after the loss.
  trade({ id: "1", day: "2026-09-28", at: "13:35", pnl: 200, r: 2, setup: "orb", rating: 5, mistake: ["Bez greške"], mae: 0.4, capture: 80 }),
  trade({ id: "2", day: "2026-09-28", at: "14:10", pnl: -100, r: -1, setup: "orb", rating: 3, mistake: ["Early entry"], mfe: 0.6 }),
  trade({ id: "3", day: "2026-09-28", at: "14:40", pnl: -150, r: -1.5, setup: "vwap", rating: 1, mistake: ["Pomerio stop", "Oversized"] }),
  trade({ id: "4", day: "2026-09-28", at: "15:05", pnl: 50, r: 0.5, setup: null, rating: null }),
  // Tuesday: one trade, no stop.
  trade({ id: "5", day: "2026-09-29", at: "13:40", pnl: 120, r: null, setup: "vwap", rating: 5, hour: null }),
];
const NAMES = { orb: "OR breakout", vwap: "VWAP return" };

describe("buildProgress", () => {
  const p = buildProgress(WEEK, NAMES);

  it("totals: money over all, R over the trades that have a stop", () => {
    expect(p.total.n).toBe(5);
    expect(p.total.net).toBe(120);
    expect(p.total.avgR).toBeCloseTo((2 - 1 - 1.5 + 0.5) / 4);
    expect(p.total.winRate).toBeCloseTo(3 / 5);
  });

  it("setups by R, the trades without one last", () => {
    expect(p.setups.map((s) => [s.label, s.n])).toEqual([
      ["OR breakout", 2],
      ["VWAP return", 2],
      ["No setup", 1],
    ]);
    expect(p.setups[0].avgR).toBeCloseTo(0.5);
    expect(p.setups[1].avgR).toBeCloseTo(-1.5); // the stopless trade has no R
    expect(buildProgress([trade({ id: "x", day: "2026-09-28", at: "13:00", pnl: 1, r: 1, setup: "gone" })], {}).setups[0].label).toBe(
      "Deleted setup",
    );
  });

  it("mistakes: most expensive first, 'No mistake' is not one, two mistakes count in both", () => {
    expect(p.mistakes.map((m) => [m.label, m.net])).toEqual([
      ["Pomerio stop", -150],
      ["Oversized", -150],
      ["Early entry", -100],
    ]);
  });

  it("A against B/C against ungraded", () => {
    expect(p.grades.map((g) => [g.key, g.n, g.net])).toEqual([
      ["A", 2, 320],
      ["BC", 2, -250],
      ["none", 1, 50],
    ]);
  });

  it("hour of entry, only where the hour is known", () => {
    expect(p.hours.map((h) => [h.label, h.n])).toEqual([
      ["13:00–13:59", 1],
      ["14:00–14:59", 2],
      ["15:00–15:59", 1],
    ]);
  });

  it("trade number in the day and the trade after a loss", () => {
    expect(p.order.map((o) => [o.label, o.n, o.net])).toEqual([
      ["1st of the day", 2, 320],
      ["2nd of the day", 1, -100],
      ["3rd and later", 2, -100],
    ]);
    // #3 followed the loss of #2, #4 followed the loss of #3.
    expect(p.afterLoss).toMatchObject({ n: 2, net: -100 });
  });

  it("excursions: heat on winners, profit given back on losers, move kept", () => {
    expect(p.excursion).toEqual({ winnersMaeR: 0.4, losersMfeR: 0.6, capture: 80, n: 2 });
  });

  it("an empty week is empty, not an error", () => {
    const e = buildProgress([], NAMES);
    expect(e.total).toMatchObject({ n: 0, net: 0, avgR: null, winRate: 0 });
    expect(e.afterLoss).toBeNull();
    expect(e.excursion).toEqual({ winnersMaeR: null, losersMfeR: null, capture: null, n: 0 });
  });
});
