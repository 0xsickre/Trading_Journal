import { describe, expect, it } from "vitest";
import { missingReview, reviewGaps } from "./review-gaps";
import type { TradeRow } from "./types";

function row(over: Record<string, unknown>): TradeRow {
  return {
    id: "00000000-aaaa",
    account_id: null,
    trade_no: 7,
    status: "closed",
    source: "manual",
    needs_review: false,
    created_at: "2026-09-28T10:00:00Z",
    instrument: "MNQ",
    playbook_id: "pb",
    execution_rating: 5,
    stats: { closed_at: "2026-09-28T14:00:00Z" },
    ...over,
  } as unknown as TradeRow;
}

describe("review gaps", () => {
  it("a trade needs a setup and a grade", () => {
    expect(missingReview(row({}))).toEqual([]);
    expect(missingReview(row({ playbook_id: null }))).toEqual(["setup"]);
    expect(missingReview(row({ execution_rating: null }))).toEqual(["grade"]);
    expect(missingReview(row({ playbook_id: null, execution_rating: null }))).toEqual(["setup", "grade"]);
  });

  it("lists the day's closed trades with a gap, in closing order", () => {
    const day = (t: TradeRow) => String(t.stats?.closed_at).slice(0, 10);
    const gaps = reviewGaps(
      [
        row({ id: "b", trade_no: 9, execution_rating: null, stats: { closed_at: "2026-09-28T15:00:00Z" } }),
        row({ id: "a", trade_no: 8, playbook_id: null, stats: { closed_at: "2026-09-28T14:30:00Z" } }),
        row({ id: "c" }), // complete
        row({ id: "d", playbook_id: null, stats: { closed_at: "2026-09-27T15:00:00Z" } }), // another day
        row({ id: "e", playbook_id: null, status: "open" }), // not closed
        row({ id: "f", trade_no: null, instrument: null, playbook_id: null }),
      ],
      "2026-09-28",
      day,
    );
    expect(gaps).toEqual([
      { id: "f", label: "f", missing: ["setup"] },
      { id: "a", label: "#8 MNQ", missing: ["setup"] },
      { id: "b", label: "#9 MNQ", missing: ["grade"] },
    ]);
  });
});
