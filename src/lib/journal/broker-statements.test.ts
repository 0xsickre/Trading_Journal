import { describe, expect, it } from "vitest";
import { parseImportNumber } from "./import-number";
import { parseImportTime } from "./time";

/**
 * STVARNI IZVODI, NE IZMIŠLJENI.
 *
 * `import-number.test.ts` i `time.test.ts` pokrivaju svaki svoju funkciju po
 * pravilima. Ovaj fajl radi drugu stvar: uzima OBLIK ćelije kakav pojedine
 * platforme zaista pišu i pušta ga kroz isti put kojim ide uvoz, jer je Korak 7
 * tražio provere „na stvarnim izvodima brokera".
 *
 * Razlika nije kozmetička. Pravilo se testira na primeru koji ga ilustruje;
 * izvod donosi kombinacije koje niko ne bi izmislio — MT5 na srpskom
 * lokalitetu piše `2 345,67` sa razmakom kao separatorom hiljada, cTrader piše
 * ISO sa `Z`, TradeZella izvozi `$1,234.56` sa znakom valute u ćeliji, a
 * Interactive Brokers piše negativnu proviziju kao `-2.15` i datum kao
 * `2026-03-02, 14:00:00`.
 *
 * Gde format NIJE čitljiv, test tvrdi `null`. To nije rupa nego politika ovog
 * uvoza: ćelija koja se ne može pročitati pošteno vidi se na ekranu kao red
 * koji neće ući, umesto da se pogodi.
 */

const TZ = "Europe/Belgrade";

describe("brojevi kako ih platforme pišu", () => {
  const cases: [string, string, number | null][] = [
    // MetaTrader 5, izvoz na engleskom lokalitetu
    ["MT5 / en", "1234.56", 1234.56],
    ["MT5 / en, hiljade", "1 234.56", 1234.56],
    // MetaTrader 5, srpski / nemački lokalitet — razlog zbog kojeg
    // `import-number.ts` uopšte postoji: raniji kod je ovo čitao kao 234567.
    ["MT5 / sr", "2345,67", 2345.67],
    ["MT5 / sr, hiljade", "1.234,56", 1234.56],
    ["MT5 / sr, razmak", "1 234,56", 1234.56],
    ["MT5 / sr, NBSP", "1 234,56", 1234.56],
    // TradeZella / TraderSync CSV — znak valute ostaje u ćeliji
    ["TradeZella", "$1,234.56", 1234.56],
    ["TradeZella, gubitak", "-$250.00", -250],
    ["TradeZella, nula", "$0.00", 0],
    // Interactive Brokers — negativna provizija, i računovodstveni minus
    ["IBKR provizija", "-2.15", -2.15],
    ["IBKR zagrade", "(1,234.56)", -1234.56],
    // cTrader — količina u jedinicama, bez separatora
    ["cTrader units", "100000", 100000],
    // Lot sa tri decimale
    ["mikro lot", "0.010", 0.01],
    // Fjučers cena sa 1/32 zapisom se NE tumači kao broj
    ["ZB 32-inski zapis", "110'16", null],
  ];

  for (const [name, cell, want] of cases) {
    it(`${name}: "${cell}" → ${want}`, () => {
      expect(parseImportNumber(cell)).toBe(want);
    });
  }

  it("`1,234` ostaje odbijeno i na stvarnom izvodu", () => {
    // 1234 američkom brokeru, 1.234 nemačkom. Ništa u ćeliji ne odlučuje, a oba
    // čitanja su verodostojne veličine i za cenu i za proviziju i za količinu.
    // Ovo je jedina ćelija u celom skupu koja se odbija iako izgleda uredno, pa
    // vredi da stoji zapisano zašto.
    expect(parseImportNumber("1,234")).toBeNull();
    // Sa četiri cifre iza zareza više nije dvosmisleno — decimalni je.
    expect(parseImportNumber("1,2345")).toBe(1.2345);
  });
});

describe("vremena kako ih platforme pišu", () => {
  it("MT5: 2026.03.02 14:00:00 u zoni naloga", () => {
    // MT5 piše tačku kao separator datuma i vreme u zoni servera. Uvoz ga čita
    // kao zid-sat u zoni NALOGA, jer je to zona u kojoj trejder gleda svoj dan.
    expect(parseImportTime("2026.03.02 14:00:00", TZ)).toBe(
      "2026-03-02T13:00:00.000Z",
    );
  });

  it("cTrader / API: ISO sa Z je apsolutan trenutak", () => {
    expect(parseImportTime("2026-03-02T14:00:00Z", TZ)).toBe(
      "2026-03-02T14:00:00.000Z",
    );
  });

  it("ISO sa pomerajem se ne pomera dvaput", () => {
    expect(parseImportTime("2026-03-02T14:00:00+01:00", TZ)).toBe(
      "2026-03-02T13:00:00.000Z",
    );
  });

  it("Interactive Brokers: 2026-03-02, 14:00:00", () => {
    // Zarez između datuma i vremena. Ne pogađa ga ni jedan od regularnih
    // izraza, pa pada na granu sa imenom meseca — koja ga pročita ispravno.
    expect(parseImportTime("2026-03-02, 14:00:00", TZ)).toBe(
      "2026-03-02T13:00:00.000Z",
    );
  });

  it("samo datum se čita kao ponoć u zoni naloga", () => {
    expect(parseImportTime("2026-03-02", TZ)).toBe("2026-03-01T23:00:00.000Z");
  });

  it("letnje računanje vremena se poštuje", () => {
    // 2026-07-01 je u Beogradu UTC+2, 2026-03-02 je UTC+1. Fiksni pomeraj bi
    // ovde promašio za sat — a sat pomera trejd u drugi dan kad je blizu
    // ponoći, pa i u drugu ćeliju kalendara.
    expect(parseImportTime("2026-07-01 14:00:00", TZ)).toBe(
      "2026-07-01T12:00:00.000Z",
    );
  });

  it("dd/mm/yyyy se ODBIJA, i to je politika a ne propust", () => {
    // 02/03/2026 je 2. mart pola sveta a 3. februar drugoj polovini. Ništa u
    // ćeliji ne odlučuje. Odbijen red se vidi na ekranu; pogođen red bi tiho
    // seo mesec dana dalje, u pogrešan mesec izveštaja.
    expect(parseImportTime("02/03/2026", TZ)).toBeNull();
    expect(parseImportTime("02/03/2026 14:00", TZ)).toBeNull();
    expect(parseImportTime("02-03-2026", TZ)).toBeNull();
    // Ni pomeraj je ne razrešava — on određuje sat, nikad redosled polja.
    expect(parseImportTime("02/03/2026 14:00:00+01:00", TZ)).toBeNull();
  });

  it("ime meseca je nedvosmisleno i zato prolazi", () => {
    expect(parseImportTime("2 Mar 2026 14:00:00", TZ)).toBe(
      "2026-03-02T13:00:00.000Z",
    );
  });

  it("prazna i neprepoznatljiva celija daju null, ne sada", () => {
    // `?? new Date()` je nekad zatvarao ovu granu i bio je najgori red u uvozu:
    // trejd od pre tri meseca dobijao je TRENUTAK UVOZA i seo u današnji P&L.
    expect(parseImportTime("", TZ)).toBeNull();
    expect(parseImportTime("   ", TZ)).toBeNull();
    expect(parseImportTime("n/a", TZ)).toBeNull();
    expect(parseImportTime(null, TZ)).toBeNull();
  });
});
