import { describe, expect, it } from "vitest";
import { fxRateNeedsAttention, resolveFxRate } from "./fx";

describe("resolveFxRate", () => {
  it("snimljen kurs pobeđuje sve ostalo", () => {
    // Istorija se ne preračunava. Čak i kad se valute poklapaju, snimljena
    // vrednost je ono što je trejd nosio — isto pravilo kao point_value_at_trade.
    expect(
      resolveFxRate({ snapshot: 0.0067, quoteCurrency: "JPY", accountCurrency: "USD" }),
    ).toEqual({ rate: 0.0067, source: "snapshot" });

    expect(
      resolveFxRate({ snapshot: 1.02, quoteCurrency: "USD", accountCurrency: "USD" }),
    ).toEqual({ rate: 1.02, source: "snapshot" });
  });

  it("ista valuta daje jedinicu", () => {
    expect(
      resolveFxRate({ quoteCurrency: "USD", accountCurrency: "USD" }),
    ).toEqual({ rate: 1, source: "same_currency" });
  });

  it("različite valute bez snimljenog kursa daju null, ne jedinicu", () => {
    // Ovo je cela poenta modula. Jedinica ovde bi sabrala 100 000 jena sa
    // dolarima i ispisala ih sa `$` — greška od 149 puta, tiha.
    expect(
      resolveFxRate({ quoteCurrency: "JPY", accountCurrency: "USD" }),
    ).toEqual({ rate: null, source: "missing" });
  });

  it("trejd bez naloga se ne poredi ni sa čim", () => {
    expect(
      resolveFxRate({ quoteCurrency: "USD", accountCurrency: null }),
    ).toEqual({ rate: null, source: "no_account" });

    // Nedostatak naloga se proverava PRE poklapanja valuta: bez naloga se ne zna
    // ni sa čim bi se poklapalo, pa 'same_currency' ovde ne bi bio odgovor.
    expect(
      resolveFxRate({ quoteCurrency: "USD" }).source,
    ).toBe("no_account");
  });

  it("nepoznata valuta kotacije pada u missing, ne u jedinicu", () => {
    // Instrument koji ne postoji u tabeli nema quote_currency. Poklapanje
    // undefined-a sa 'USD' ne sme da prođe kao 'ista valuta'.
    expect(
      resolveFxRate({ quoteCurrency: null, accountCurrency: "USD" }),
    ).toEqual({ rate: null, source: "missing" });
  });

  it("neispravan snimljen kurs se odbija umesto da se koristi", () => {
    // DB CHECK drži `fx_rate_at_trade > 0`, ali ovaj modul čita i vrednosti iz
    // forme, gde još nema ograničenja. Nula bi obesmislila svako deljenje.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        resolveFxRate({ snapshot: bad, quoteCurrency: "JPY", accountCurrency: "USD" }),
      ).toEqual({ rate: null, source: "missing" });
    }
  });
});

describe("fxRateNeedsAttention", () => {
  it("označava tačno one slučajeve u kojima novac ne može da se prikaže", () => {
    expect(fxRateNeedsAttention("missing")).toBe(true);
    expect(fxRateNeedsAttention("no_account")).toBe(true);
    expect(fxRateNeedsAttention("snapshot")).toBe(false);
    expect(fxRateNeedsAttention("same_currency")).toBe(false);
  });
});
