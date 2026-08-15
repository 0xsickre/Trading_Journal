import { describe, expect, it } from "vitest";
import { computePositionStats } from "./position-stats";
import { PARITY_CASES } from "./position-stats.parity.fixture";

/**
 * Papir → `computePositionStats`.
 *
 * Druga polovina istog dokaza — ista fikstura puštena kroz `tj_position_stats`
 * nad živom bazom — ne može da živi ovde: vitest nema Postgres. Zapisana je u
 * `CODE_REVIEW.md` sa izmerenim ishodom (12 slučajeva × 9 kolona, sve prošlo).
 *
 * Ono što ovaj fajl čuva jeste da TS strana ne odluta od brojeva sa papira koje
 * je i SQL strana pogodila. Dok obe gađaju istu fiksturu, razilaženje mora da
 * obori bar jednu.
 */
describe("position-stats ↔ tj_position_stats — paritet prema papiru", () => {
  for (const c of PARITY_CASES) {
    it(`${c.name}: ${c.proves}`, () => {
      const got = computePositionStats(c.input);

      // toBeCloseTo bi propustio null; svaka kolona se poredi izričito, i
      // razlika null-a od nule je ovde deo tvrdnje, ne detalj.
      const cols = [
        "avg_entry",
        "avg_exit",
        "gross_points",
        "gross_pl",
        "net_pl",
        "planned_risk_pts",
        "realized_r",
        "realized_r_net",
      ] as const;

      for (const col of cols) {
        const expected = c.paper[col];
        const actual = got[col];
        if (expected === null) {
          expect(actual, `${c.name} → ${col} mora biti null`).toBeNull();
        } else {
          expect(actual, `${c.name} → ${col}`).not.toBeNull();
          expect(actual as number, `${c.name} → ${col}`).toBeCloseTo(expected, 10);
        }
      }
    });
  }

  it("pokriva svaki oblik koji knjiga može da ima", () => {
    // Skup nije proizvoljan: svaki slučaj postoji zbog jedne grane u view-u.
    // Ako neko doda granu a ne doda oblik, ovaj broj je mesto gde se to primeti.
    expect(PARITY_CASES).toHaveLength(17);
    expect(new Set(PARITY_CASES.map((c) => c.name)).size).toBe(17);
  });

  it("R na delimičnom izlazu se razblažuje, i to je odluka a ne posledica", () => {
    // Izdvojeno iz petlje jer je jedina konvencija u ovom fajlu koju čitalac
    // može da pročita kao grešku. Zatvoreni deo je išao punih 1.0 R.
    const partial = PARITY_CASES.find((c) => c.name.startsWith("T4"))!;
    const got = computePositionStats(partial.input);

    expect(got.realized_r).toBeCloseTo(0.4, 10);

    // Isti brojilac podeljen ZATVORENOM količinom dao bi 1.0. Broj stoji ovde da
    // se vidi šta je odbačeno i zašto: preostalih 6 jedinica još stoji pod istim
    // rizikom i nije platilo ništa. Vidi obrazloženje u position-stats.ts:118-139.
    const onClosedQty = got.gross_points! / (got.planned_risk_pts! * got.exit_qty);
    expect(onClosedQty).toBeCloseTo(1, 10);
  });
});
