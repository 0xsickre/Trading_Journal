import { describe, expect, it } from "vitest";
import {
  THESIS_STATES,
  TOUCHED_SEVERITY,
  TOUCHED_STATES,
  isInterference,
  worstTouched,
  type TouchedState,
} from "./position-checkin";

/**
 * DNEVNA PROVERA OTVORENE POZICIJE.
 *
 * Modul je stigao posle poslednje revizije i nije imao nijedan test, a
 * `worstTouched` odlučuje po čemu se sving trejdovi GRUPIŠU u izveštajima —
 * dakle koji broj stoji pored kog reda.
 */

describe("worstTouched — najdalje od plana, ne najgori ishod", () => {
  it("bez ijednog odgovora vraća null, ne `untouched`", () => {
    // Razlika je stvarna: `untouched` znači „gledao sam i nisam dirao",
    // null znači „nisam se javio". Prvo je disciplina, drugo je ćutanje, i
    // izveštaj koji ih pomeša bi ćutanje ubrojao kao vrlinu.
    expect(worstTouched([])).toBeNull();
    expect(worstTouched([null, null])).toBeNull();
  });

  it("jedan dodir u pet dana je ono što se pamti", () => {
    expect(
      worstTouched(["untouched", "untouched", "stop_moved", "untouched"]),
    ).toBe("stop_moved");
  });

  it("redosled je udaljenost od plana: added > stop_moved > partial_exit > untouched", () => {
    expect(worstTouched(["added", "stop_moved"])).toBe("added");
    expect(worstTouched(["stop_moved", "partial_exit"])).toBe("stop_moved");
    expect(worstTouched(["partial_exit", "untouched"])).toBe("partial_exit");
    // Delimičan izlaz je odstupanje ka MANJEM riziku, pa stoji ispod pomeranja
    // stopa — koji menja gubitak dogovoren pre ulaska.
    expect(TOUCHED_SEVERITY.partial_exit).toBeLessThan(
      TOUCHED_SEVERITY.stop_moved,
    );
  });

  it("null vrednosti se preskaču a ne obaraju rezultat", () => {
    expect(worstTouched([null, "partial_exit", null])).toBe("partial_exit");
  });

  it("redosled ulaza ne menja odgovor", () => {
    const states: TouchedState[] = ["untouched", "added", "partial_exit"];
    expect(worstTouched(states)).toBe("added");
    expect(worstTouched([...states].reverse())).toBe("added");
  });

  it("svako stanje ima težinu — nijedno ne pada na undefined", () => {
    for (const s of TOUCHED_STATES) {
      expect(TOUCHED_SEVERITY[s], s).toBeTypeOf("number");
    }
  });
});

describe("isInterference", () => {
  it("`untouched` nije mešanje, i ćutanje takođe nije", () => {
    expect(isInterference("untouched")).toBe(false);
    expect(isInterference(null)).toBe(false);
  });

  it("sve ostalo jeste", () => {
    expect(isInterference("partial_exit")).toBe(true);
    expect(isInterference("stop_moved")).toBe(true);
    expect(isInterference("added")).toBe(true);
  });

  it("slaže se sa težinom: mešanje je tačno ono što ima težinu iznad nule", () => {
    for (const s of TOUCHED_STATES) {
      expect(isInterference(s), s).toBe(TOUCHED_SEVERITY[s] > 0);
    }
  });
});

describe("zatvoreni skupovi prate CHECK u bazi", () => {
  it("stanja teze i dodira su tačno ona koja baza prihvata", () => {
    // Provereno protiv živog CHECK-a na `tj_position_checkins`.
    expect([...THESIS_STATES].sort()).toEqual(
      ["intact", "invalidated", "weakened"].sort(),
    );
    expect([...TOUCHED_STATES].sort()).toEqual(
      ["added", "partial_exit", "stop_moved", "untouched"].sort(),
    );
  });

  it("redosled DEKLARACIJE je redosled na ekranu, ne težina", () => {
    // Vredi da stoji zapisano jer je zbunjujuće: lista je poređana kako se
    // dugmad prikazuju (`untouched, stop_moved, partial_exit, added`), a
    // udaljenost od plana je druga stvar i živi u `TOUCHED_SEVERITY`. Test koji
    // ih pomeša pao bi na tačnom kodu — što se ovde i desilo pri pisanju.
    expect([...TOUCHED_STATES]).toEqual([
      "untouched",
      "stop_moved",
      "partial_exit",
      "added",
    ]);
    expect(TOUCHED_SEVERITY.stop_moved).toBeGreaterThan(
      TOUCHED_SEVERITY.partial_exit,
    );
  });
});
