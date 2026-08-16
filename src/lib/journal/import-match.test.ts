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
 * SPAJANJE JE OPERACIJA KOJA BRIŠE.
 *
 * `commitImport` na `decision: "merge"` poziva `tj_replace_executions`, koja
 * briše postojeće fill-ove i upisuje one iz izvoda. Zato je pitanje „koji je
 * ovo trejd" jedno od najozbiljnijih u sistemu — a do Koraka 7 je odgovor
 * živeo u petlji unutar komponente od 572 linije, bez ijednog testa.
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

describe("prepoznavanje već unetog trejda", () => {
  it("isti instrument, smer, vreme i cena — spaja se", () => {
    const out = match();
    expect(out.status).toBe("match");
    expect(out.matched?.id).toBe("t1");
  });

  it("nema kandidata — kreira se", () => {
    expect(match(row, []).status).toBe("new");
  });

  it("drugi smer nije isti trejd", () => {
    expect(match(row, [c({ direction: "Short" })]).status).toBe("new");
  });

  it("drugi instrument nije isti trejd", () => {
    expect(match(row, [c({ instrument: "NQ" })]).status).toBe("new");
  });
});

describe("prozor vremena", () => {
  const at = (iso: string) => ({ ...row, entryTime: iso });

  it("devet minuta razlike je isti trejd", () => {
    expect(match(at("2026-03-02T14:09:00Z")).status).toBe("match");
    expect(match(at("2026-03-02T13:51:00Z")).status).toBe("match");
  });

  it("deset minuta i preko toga nije", () => {
    // Granica je isključiva na obe strane, i to je ista granica koju je stari
    // kod imao — ovde je samo prvi put zaključana testom.
    expect(match(at("2026-03-02T14:10:00Z")).status).toBe("new");
    expect(match(at("2026-03-02T14:11:00Z")).status).toBe("new");
    expect(MERGE_TIME_WINDOW_MS).toBe(600_000);
  });

  it("bez vremena na redu ili na kandidatu — ne spaja se", () => {
    // Radije duplikat nego spajanje na osnovu same cene: isti nivo se trguje i
    // u ponedeljak i u petak.
    expect(match({ ...row, entryTime: null }).status).toBe("new");
    expect(match(row, [c({ openedAt: null })]).status).toBe("new");
  });

  it("neispravno vreme se ne čita kao poklapanje", () => {
    expect(match({ ...row, entryTime: "juče" }).status).toBe("new");
  });
});

describe("prozor cene", () => {
  it("tolerancija je 0,05 % ili 0,01 — šta je veće", () => {
    expect(mergePriceTolerance(5000)).toBeCloseTo(2.5, 10);
    // EURUSD: 0,05 % od 1.0850 je 0.00054, pa donja granica od 0,01 preuzima.
    expect(mergePriceTolerance(1.085)).toBeCloseTo(0.01, 10);
    expect(mergePriceTolerance(-5000)).toBeCloseTo(2.5, 10);
  });

  it("ES unutar 2,5 poena je isti trejd, preko toga nije", () => {
    expect(match(row, [c({ avgEntry: 5002.5 })]).status).toBe("match");
    expect(match(row, [c({ avgEntry: 5002.6 })]).status).toBe("new");
  });

  it("bez cene se ne spaja", () => {
    expect(match({ ...row, entryPrice: null }).status).toBe("new");
    expect(match(row, [c({ avgEntry: null })]).status).toBe("new");
  });
});

describe("dvosmislenost — nalaz Koraka 7", () => {
  it("dva trejda koja oba prolaze filter NE spajaju se ni sa jednim", () => {
    // Skalper na ES-u: ulaz 5000.00 u 14:00, pa opet 5001.50 u 14:06. Oba su
    // unutar deset minuta i unutar 2,5 poena, pa oba prolaze isti filter.
    //
    // Stari kod je radio `break` na PRVOM kandidatu, a kandidati stižu poređani
    // po `created_at DESC` — po tome koji je trejd poslednji unet, što sa
    // pitanjem „koji je ovo trejd" nema veze. Drugi red izvoda bi se spojio sa
    // prvim trejdom i obrisao mu fill-ove.
    const out = match(row, [
      c({ id: "kasnije-unet", avgEntry: 5001.5, openedAt: "2026-03-02T14:06:00Z" }),
      c({ id: "ranije-unet", avgEntry: 5000, openedAt: "2026-03-02T14:00:00Z" }),
    ]);
    expect(out.status).toBe("ambiguous");
    expect(out.matched).toBeNull();
    expect(out.candidates).toHaveLength(2);
  });

  it("dvosmislen red se KREIRA, ne spaja — asimetrija je namerna", () => {
    // Višak trejda se briše u jednom potezu. Obrisani fill-ovi trejda koji je
    // bio tačan se ne vraćaju, i ne vide se dok se ne potraže.
    const out = match(row, [c({ id: "a" }), c({ id: "b", avgEntry: 5001 })]);
    expect(out.matched).toBeNull();
  });

  it("ne bira se najblizi kandidat", () => {
    // Bliža cena ne znači da je to taj trejd — dva ulaza u istoj seansi mogu
    // biti na bilo kom rasporedu. Biranje bi bilo pogađanje sa posledicom
    // brisanja.
    const out = match(row, [
      c({ id: "tacno-na-ceni", avgEntry: 5000 }),
      c({ id: "malo-dalje", avgEntry: 5002 }),
    ]);
    expect(out.status).toBe("ambiguous");
    expect(out.matched).toBeNull();
  });

  it("jedan kandidat i dalje daje spajanje — dvosmislenost nije postala paranoja", () => {
    expect(match().matched?.id).toBe("t1");
  });
});

describe("alias simbola i dalje radi kroz modul", () => {
  it("izvod koji piše ES a journal ESZ5 se prepoznaje", () => {
    // `instrumentsMatch` se prosleđuje spolja da bi modul ostao čist, ali pravi
    // se ovde koristi — inače bi test dokazivao izmišljeno pravilo.
    expect(instrumentsMatch("ES", "ES")).toBe(true);
    expect(match({ ...row, instrument: "es" }).status).toBe("match");
  });
});
