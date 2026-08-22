import { describe, expect, it } from "vitest";
import {
  commitImportSchema,
  executionSchema,
  firstIssue,
  importItemSchema,
  invalidTradeNumber,
  tradeInputSchema,
} from "./trade-input-schema";
import { buildPositionPatch } from "./trade-fields";
import { computePositionStats } from "./position-stats";

/**
 * OPSEG NA PUTU UPISA.
 *
 * Do Koraka 6 je jedina odbrana bila `buildPositionPatch`, koja proverava IMENA
 * kolona i tip. Broj koji je konačan prolazio je bez obzira na znak.
 *
 * Ovaj fajl počinje demonstracijom posledice — istim brojevima koji su izmereni
 * na živoj bazi — a tek onda tvrdi da su odbijeni. Redosled je namerno takav:
 * bez prvog testa drugi izgleda kao proizvoljna strogost.
 */

const UUID = "3c5e07a9-8ad8-4e06-9343-60c316d4520f";

describe("zašto uopšte: negativna cena daje ubedljivo pogrešan broj", () => {
  it("omašen znak se ispisuje kao uredan dobitak, ne kao greška", () => {
    // Isto što je izmereno u bazi pre popravke: ES, ulaz −5000, izlaz −4990,
    // point_value 50 → gross_pl 500, realized_r 1.00. Ništa ne pada.
    const stats = computePositionStats({
      direction: "Long",
      entry_price: -5000,
      stop_price: -5010,
      point_value: 50,
      fx_rate: 1,
      executions: [
        { side: "entry", price: -5000, qty: 1 },
        { side: "exit", price: -4990, qty: 1 },
      ],
    });
    expect(stats.gross_pl).toBeCloseTo(500, 10);
    expect(stats.realized_r).toBeCloseTo(1, 10);
    // Nema nijedne oznake koja bi rekla da je nešto sumnjivo — zato provera
    // mora da stoji PRE ovoga, na ulazu.
  });
});

describe("cene na poziciji", () => {
  const patchOf = (fields: Record<string, string | number | null>) =>
    buildPositionPatch(fields).columns;

  it("negativna i nulta cena su odbijene, sa porukom koja imenuje polje", () => {
    for (const key of [
      "entry_price",
      "stop_price",
      "target_price",
      "max_drawdown_price",
      "max_profit_price",
      "position_size",
    ]) {
      expect(invalidTradeNumber(patchOf({ [key]: -1 })), key).toBeTruthy();
      expect(invalidTradeNumber(patchOf({ [key]: 0 })), key).toBeTruthy();
      expect(invalidTradeNumber(patchOf({ [key]: 5000 })), key).toBeNull();
    }
  });

  it("poruka kaže koje polje, ne samo da nešto ne valja", () => {
    expect(invalidTradeNumber(patchOf({ stop_price: -1 }))).toBe(
      "Stop price must be greater than zero.",
    );
  });

  it("polje koje nije poslato se ne proverava", () => {
    // Izmena jednog polja ne sme da traži da su sva ostala popunjena.
    expect(invalidTradeNumber({})).toBeNull();
    expect(invalidTradeNumber({ entry_price: null })).toBeNull();
  });

  it("gubitak u `gross_pnl_override` PROLAZI — to mu je ispravna vrednost", () => {
    // Jedini broj na trejdu koji sme da bude negativan. Kad bi i on dobio
    // granicu, journal ne bi mogao da zabeleži gubitak sa izvoda.
    expect(invalidTradeNumber({ gross_pnl_override: -250 })).toBeNull();
    expect(invalidTradeNumber({ gross_pnl_override: 0 })).toBeNull();
  });

  it("ali `gross_pnl_override` koji nije broj i dalje pada", () => {
    // Kroz formular je ovo nedostižno: `buildPositionPatch` polje tipa `number`
    // već svodi na broj ili null. Provera stoji jer je funkcija granica koja
    // prima običan objekat, i jer je REZULTAT jedina kolona koju view uzima
    // zdravo za gotovo — kad je postavljena, zaobilazi i specifikaciju i kurs.
    expect(invalidTradeNumber({ gross_pnl_override: "sto dolara" })).toBe(
      "Actual Gross P&L must be a number.",
    );
    expect(invalidTradeNumber({ gross_pnl_override: Number.NaN })).toBeTruthy();
  });

  it("time_stop_days mora biti ceo broj veći od nule", () => {
    expect(invalidTradeNumber({ time_stop_days: 0 })).toBeTruthy();
    expect(invalidTradeNumber({ time_stop_days: -3 })).toBeTruthy();
    expect(invalidTradeNumber({ time_stop_days: 2.5 })).toBeTruthy();
    expect(invalidTradeNumber({ time_stop_days: 3 })).toBeNull();
  });

  it("execution_rating mora biti ceo broj veći od nule", () => {
    // Nula i polovina zvezdice nisu ocene. Gornju granicu (5) čuva DB CHECK i
    // nedostižna je iz UI-ja sa tačno pet dugmadi, pa se ovde ne dokazuje.
    expect(invalidTradeNumber({ execution_rating: 0 })).toBeTruthy();
    expect(invalidTradeNumber({ execution_rating: 2.5 })).toBeTruthy();
    expect(invalidTradeNumber({ execution_rating: 4 })).toBeNull();
    // NULL je legitiman i čest: „nije ocenjeno" nije greška.
    expect(invalidTradeNumber({ execution_rating: null })).toBeNull();
  });
});

describe("fill", () => {
  const fill = (over: Record<string, unknown> = {}) => ({
    side: "entry",
    price: 5000,
    qty: 1,
    executed_at: "2026-03-02T14:00:00Z",
    fee: 0,
    swap_funding: 0,
    ...over,
  });

  it("cena mora biti pozitivna", () => {
    expect(executionSchema.safeParse(fill()).success).toBe(true);
    expect(executionSchema.safeParse(fill({ price: -5000 })).success).toBe(false);
    expect(executionSchema.safeParse(fill({ price: 0 })).success).toBe(false);
  });

  it("neispravno vreme se ODBIJA umesto da red tiho ispadne", () => {
    // `tj_replace_executions` je red sa neispravnim `executed_at` izostavljao
    // kroz svoj WHERE i vraćao manji broj upisanih — a `updateTrade` tu
    // vrednost nikad nije gledao. Trejd bi se sačuvao sa dva fill-a umesto tri
    // i javio `ok`.
    expect(executionSchema.safeParse(fill({ executed_at: "juče" })).success).toBe(
      false,
    );
  });

  it("provizija i swap smeju biti negativni — rabat je stvaran", () => {
    expect(executionSchema.safeParse(fill({ fee: -0.25 })).success).toBe(true);
  });
});

describe("struktura submisije", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    account_id: UUID,
    trade_no: null,
    fields: {},
    executions: [],
    ...over,
  });

  it("account_id koji nije uuid pada ovde, ne u Postgres-u", () => {
    expect(tradeInputSchema.safeParse(input()).success).toBe(true);
    expect(tradeInputSchema.safeParse(input({ account_id: "prvi" })).success).toBe(
      false,
    );
    expect(tradeInputSchema.safeParse(input({ account_id: null })).success).toBe(
      true,
    );
  });

  it("ubeđenost više ne postoji kao polje i ne stiže do baze", () => {
    // Ocena 1–5 pre ulaza je uklonjena: isti setap je istog dana dobijao 3, a
    // sutradan 5, pa je grupisanje izveštaja po njoj merilo raspoloženje a ne
    // trejd. Šema nije `.strict()`, pa stari klijent koji je i dalje šalje ne
    // dobija grešku — vrednost prosto ispada iz parsiranog rezultata i nikada
    // se ne upiše.
    const parsed = tradeInputSchema.safeParse(input({ conviction: 3 }));
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("conviction");
  });

  it("trade_no je pozitivan ceo broj ili null", () => {
    expect(tradeInputSchema.safeParse(input({ trade_no: 7 })).success).toBe(true);
    expect(tradeInputSchema.safeParse(input({ trade_no: 0 })).success).toBe(false);
    expect(tradeInputSchema.safeParse(input({ trade_no: -2 })).success).toBe(false);
  });

  it("nepoznat slot za grafik ne prolazi", () => {
    expect(
      tradeInputSchema.safeParse(
        input({ images: [{ kind: "htf_pre", image_url: "x" }] }),
      ).success,
    ).toBe(true);
    expect(
      tradeInputSchema.safeParse(
        input({ images: [{ kind: "izmisljen", image_url: "x" }] }),
      ).success,
    ).toBe(false);
  });

  it("poruka nosi put do polja", () => {
    const res = tradeInputSchema.safeParse(
      input({ executions: [{ side: "entry", price: -1, qty: 1, executed_at: "2026-03-02T14:00:00Z", fee: 0, swap_funding: 0 }] }),
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(firstIssue(res.error)).toContain("executions.0.price");
    }
  });
});

describe("uvoz", () => {
  it("omotač se proverava, redovi se NE proveravaju unapred", () => {
    // Namerno: jedan pokvaren red ne sme da odbije fajl od tri stotine trejdova.
    // Redove proverava `commitImport` u petlji, gde svaki ima svoj `try`.
    const withBadRow = {
      account_id: UUID,
      filename: "izvod.csv",
      items: [{ ovo: "nije red uvoza" }],
    };
    expect(commitImportSchema.safeParse(withBadRow).success).toBe(true);
    expect(
      commitImportSchema.safeParse({ ...withBadRow, account_id: "nije-uuid" })
        .success,
    ).toBe(false);
  });

  it("red sa negativnom cenom pada — pogrešno mapirana kolona", () => {
    // Mapiranje koje profit spusti u kolonu cene daje negativne „cene". Izvod
    // nije nepogrešiv izvor; nepogrešivo je samo mapiranje koje niko nije
    // proverio.
    const row = {
      decision: "create",
      match_status: "new",
      matched_position_id: null,
      instrument: "ES",
      direction: "Long",
      gross_pnl_override: -250,
      raw: { Symbol: "ES" },
      executions: [
        {
          side: "entry",
          price: -5000,
          qty: 1,
          executed_at: "2026-03-02T14:00:00Z",
          fee: 0,
          swap_funding: 0,
        },
      ],
    };
    expect(importItemSchema.safeParse(row).success).toBe(false);
    expect(
      importItemSchema.safeParse({
        ...row,
        executions: [{ ...row.executions[0], price: 5000 }],
      }).success,
    ).toBe(true);
  });
});
