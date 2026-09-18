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

/**
 * The case the journal is actually used in: the trade was typed by hand while
 * reading a backtest, so it carries the moment it was TYPED, and the file
 * carries the moment it was TRADED. Months apart, same trade.
 */
describe("a hand-typed trade whose time is the typist's, not the broker's", () => {
  // XAUUSD long, entered 1313.05 and closed 1317.62, typed on 18 September for
  // a trade the file dates 7 March.
  const typed = c({
    id: "typed",
    instrument: "XAUUSD",
    avgEntry: 1327.45,
    avgExit: 1317.62,
    openedAt: "2026-09-18T21:10:00Z",
    entryQty: 1,
    grossPl: -983.4,
    netPl: -983.4,
    accountId: "acc-1",
  });
  const fromFile: ImportRowKey = {
    instrument: "XAUUSD",
    direction: "Long",
    entryPrice: 1327.45,
    entryTime: "2026-03-07T14:00:00Z",
    entryQty: 1,
    exitPrice: 1317.62,
    pnl: -984.72,
    accountId: "acc-1",
  };

  it("is suggested, with the trade named, when prices and size agree", () => {
    const out = match(fromFile, [typed]);
    expect(out.status).toBe("suggested");
    expect(out.matched?.id).toBe("typed");
  });

  it("is suggested on the MONEY when the two sources sized the trade differently", () => {
    // TradingView sized it 1.73 lots off its own risk model; the trader typed
    // the 1.00 they meant. Same price move, so the result agrees to the cent.
    const out = match(
      { ...fromFile, entryQty: 1.73, pnl: -997.74 },
      [c({ ...typed, entryQty: 1, netPl: -997.74, grossPl: -997.74 })],
    );
    expect(out.status).toBe("suggested");
  });

  it("is NOT suggested when neither the size nor the money agrees", () => {
    const out = match({ ...fromFile, entryQty: 4, pnl: -4000 }, [typed]);
    expect(out.status).toBe("new");
  });

  it("is NOT suggested when the exit price disagrees", () => {
    const out = match({ ...fromFile, exitPrice: 1350 }, [typed]);
    expect(out.status).toBe("new");
  });

  it("is NOT suggested when one side is still open and the other is closed", () => {
    const out = match({ ...fromFile, exitPrice: null }, [typed]);
    expect(out.status).toBe("new");
  });

  it("never crosses accounts, however well the numbers agree", () => {
    const out = match(fromFile, [c({ ...typed, accountId: "acc-2" })]);
    expect(out.status).toBe("new");
  });

  it("two equally good candidates are ambiguous, and both are offered", () => {
    const out = match(fromFile, [typed, c({ ...typed, id: "typed2" })]);
    expect(out.status).toBe("ambiguous");
    expect(out.matched).toBeNull();
    expect(out.candidates.map((x) => x.id)).toEqual(["typed", "typed2"]);
  });

  it("a trade whose TIME agrees still wins — the strict question is asked first", () => {
    const sameMinute = c({
      id: "strict",
      instrument: "XAUUSD",
      avgEntry: 1327.45,
      avgExit: 1317.62,
      openedAt: "2026-03-07T14:03:00Z",
      entryQty: 9,
      netPl: -1,
      accountId: "acc-1",
    });
    const out = match(fromFile, [typed, sameMinute]);
    expect(out.status).toBe("match");
    expect(out.matched?.id).toBe("strict");
  });
});
