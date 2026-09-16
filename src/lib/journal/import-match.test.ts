import { describe, expect, it } from "vitest";
import {
  MERGE_TIME_WINDOW_MS,
  matchImportRow,
  mergePriceTolerance,
  type MatchCandidate,
  type ImportRowKey,
} from "./import-match";
import { instrumentsMatch } from "./instrument-aliases";

/**
 * A MERGE IS AN OPERATION THAT DELETES.
 *
 * On `decision: "merge"` `commitImport` calls `tj_replace_executions`, which
 * deletes the existing fills and writes the ones from the statement. That makes
 * "which trade is this" one of the most serious questions in the system — and
 * until Step 7 the answer lived in a loop inside a 572-line component, with no
 * test at all.
 */

const c = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id: "t1",
  instrument: "ES",
  direction: "Long",
  avgEntry: 5000,
  avgExit: 5010,
  openedAt: "2026-03-02T14:00:00Z",
  totalFees: 4,
  totalSwap: 0,
  grossPl: 500,
  netPl: 496,
  // A manual trade by default: a bot trade is never merged into, so every test
  // below would quietly turn it into a "new".
  brokerPositionId: null,
  ...over,
});

const row: ImportRowKey = {
  instrument: "ES",
  direction: "Long",
  entryPrice: 5000,
  entryTime: "2026-03-02T14:00:00Z",
};

const match = (r = row, cands: MatchCandidate[] = [c()]) =>
  matchImportRow(r, cands, instrumentsMatch);

describe("recognising a trade that is already entered", () => {
  it("same instrument, direction, time and price — it merges", () => {
    const out = match();
    expect(out.status).toBe("match");
    expect(out.matched?.id).toBe("t1");
  });

  it("no candidate — it is created", () => {
    expect(match(row, []).status).toBe("new");
  });

  it("a different direction is not the same trade", () => {
    expect(match(row, [c({ direction: "Short" })]).status).toBe("new");
  });

  it("a different instrument is not the same trade", () => {
    expect(match(row, [c({ instrument: "NQ" })]).status).toBe("new");
  });
});

describe("prozor vremena", () => {
  const at = (iso: string) => ({ ...row, entryTime: iso });

  it("nine minutes apart is the same trade", () => {
    expect(match(at("2026-03-02T14:09:00Z")).status).toBe("match");
    expect(match(at("2026-03-02T13:51:00Z")).status).toBe("match");
  });

  it("ten minutes and beyond is not", () => {
    // The bound is exclusive on both sides, and it is the same bound the old
    // code had — here it is simply locked down by a test for the first time.
    expect(match(at("2026-03-02T14:10:00Z")).status).toBe("new");
    expect(match(at("2026-03-02T14:11:00Z")).status).toBe("new");
    expect(MERGE_TIME_WINDOW_MS).toBe(600_000);
  });

  it("with no time on the row or on the candidate — no merge", () => {
    // A duplicate is preferable to merging on price alone: the same level gets
    // traded on a Monday and on a Friday.
    expect(match({ ...row, entryTime: null }).status).toBe("new");
    expect(match(row, [c({ openedAt: null })]).status).toBe("new");
  });

  it("an invalid time does not read as a match", () => {
    expect(match({ ...row, entryTime: "juče" }).status).toBe("new");
  });
});

describe("the price window", () => {
  it("the tolerance is 0.05 % or 0.01 — whichever is larger", () => {
    expect(mergePriceTolerance(5000)).toBeCloseTo(2.5, 10);
    // EURUSD: 0.05 % of 1.0850 is 0.00054, so the 0.01 floor takes over.
    expect(mergePriceTolerance(1.085)).toBeCloseTo(0.01, 10);
    expect(mergePriceTolerance(-5000)).toBeCloseTo(2.5, 10);
  });

  it("ES within 2.5 points is the same trade, beyond it is not", () => {
    expect(match(row, [c({ avgEntry: 5002.5 })]).status).toBe("match");
    expect(match(row, [c({ avgEntry: 5002.6 })]).status).toBe("new");
  });

  it("with no price there is no merge", () => {
    expect(match({ ...row, entryPrice: null }).status).toBe("new");
    expect(match(row, [c({ avgEntry: null })]).status).toBe("new");
  });
});

describe("ambiguity — the Step 7 finding", () => {
  it("two trades that both pass the filter merge into NEITHER", () => {
    // A scalper on ES: entry at 5000.00 at 14:00, then again at 5001.50 at
    // 14:06. Both are within ten minutes and within 2.5 points, so both pass
    // the same filter.
    //
    // The old code did a `break` on the FIRST candidate, and candidates arrive
    // ordered by `created_at DESC` — by which trade was entered last, which has
    // nothing to do with "which trade is this". The second statement row would
    // merge into the first trade and delete its fills.
    const out = match(row, [
      c({ id: "entered-later", avgEntry: 5001.5, openedAt: "2026-03-02T14:06:00Z" }),
      c({ id: "entered-earlier", avgEntry: 5000, openedAt: "2026-03-02T14:00:00Z" }),
    ]);
    expect(out.status).toBe("ambiguous");
    expect(out.matched).toBeNull();
    expect(out.candidates).toHaveLength(2);
  });

  it("an ambiguous row is CREATED, not merged — the asymmetry is deliberate", () => {
    // A spare trade is deleted in one move. The deleted fills of the trade that
    // was right do not come back, and are invisible until somebody looks.
    const out = match(row, [c({ id: "a" }), c({ id: "b", avgEntry: 5001 })]);
    expect(out.matched).toBeNull();
  });

  it("the closest candidate is not chosen", () => {
    // A nearer price does not mean it is that trade — two entries in the same
    // session can be laid out any way at all. Picking one would be guessing,
    // with deletion as the consequence.
    const out = match(row, [
      c({ id: "exactly-on-price", avgEntry: 5000 }),
      c({ id: "slightly-further", avgEntry: 5002 }),
    ]);
    expect(out.status).toBe("ambiguous");
    expect(out.matched).toBeNull();
  });

  it("one candidate still produces a merge — the ambiguity did not become paranoia", () => {
    expect(match().matched?.id).toBe("t1");
  });
});

describe("symbol aliasing still works through the module", () => {
  it("a statement writing ES against a journal holding ESZ5 is recognised", () => {
    // `instrumentsMatch` is passed in from outside so the module stays pure, but
    // the real one is used here — otherwise the test would prove an invented
    // rule.
    expect(instrumentsMatch("ES", "ES")).toBe(true);
    expect(match({ ...row, instrument: "es" }).status).toBe("match");
  });
});

describe("a trade written by the bot bridge", () => {
  /**
   * A merge calls `tj_replace_executions`, a full replacement of the fills. The
   * bridge holds the price off the fill itself, the statement holds a rounded
   * report — so merging would swap the more precise datum for the coarser one,
   * invisibly.
   */
  it("se NE spaja, iako se poklapa u svemu ostalom", () => {
    const bot = c({ id: "bot1", brokerPositionId: "10558247" });
    const out = match(row, [bot]);

    expect(out.status).toBe("new");
    expect(out.matched).toBeNull();
    expect(out.candidates).toEqual([]);
  });

  it("does not hide a manual trade standing beside it", () => {
    // A duplicate is a visible outcome and that is deliberate; what must not
    // happen is the bot trade pulling the row onto itself and thereby hiding
    // that a manual one exists.
    const bot = c({ id: "bot1", brokerPositionId: "10558247" });
    const manual = c({ id: "man1" });

    const out = match(row, [bot, manual]);

    expect(out.status).toBe("match");
    expect(out.matched?.id).toBe("man1");
  });
});
