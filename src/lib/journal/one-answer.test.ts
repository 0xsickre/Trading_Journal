import { describe, expect, it } from "vitest";
import { winRateOf } from "./analytics";
import {
  EXACT_ZERO_RANGE,
  resolveBreakevenRange,
  sharedBreakevenRange,
  type BreakevenConfig,
} from "./breakeven";
import { isFriday } from "./daily-report";
import { daysBetweenKeys } from "./open-positions";
import { isShortDirection } from "./plan-calculations";
import { tradeDirectionMultiplier } from "./position-stats";
import { accountTimezoneResolver, daysBetweenDayKeys, isoWeekdayOfDayKey } from "./time";

/**
 * JEDNO PITANJE, JEDAN ODGOVOR.
 *
 * Runda 3 je klasu „dva odgovora na jedno pitanje" našla sedam puta. Korak 5 je
 * našao još osam mesta koja su na isto pitanje odgovarala sopstvenim izrazom:
 * win rate na šest, znak smera na tri, razlika dana na tri, dan u nedelji na
 * dva, breakeven pojas na pet, zona naloga na pet.
 *
 * Dok su kopije davale iste odgovore, dupliranje je bilo samo trošak. Opasnost
 * je u tome što izmena JEDNE tiho razilazi ekrane — isti trejd bi imao jedan
 * win rate na Dashboard-u a drugi na kalendaru, i ništa ne bi palo.
 *
 * Ovaj fajl ne testira nove funkcije (svaka ima svoj test). Testira da su stare
 * kopije zaista nestale, i da konvencije koje se RAZLIKUJU ostaju razdvojene
 * namerno umesto slučajno.
 */

describe("znak smera — jedan predikat", () => {
  it("množilac je izveden iz predikata, ne iz druge kopije istog izraza", () => {
    for (const dir of [
      "Short", "short", "SHORT", "Short (swing)", "shorting",
      "Long", "long", "buy", "", null,
    ]) {
      expect(tradeDirectionMultiplier(dir), `smer: ${dir}`).toBe(
        isShortDirection(dir) ? -1 : 1,
      );
    }
  });

  it("sve što ne počinje sa 'short' je long, uključujući prazno i null", () => {
    // Namerno, i vredi da stoji zapisano: nepoznat smer se čita kao long umesto
    // da obori trejd. Alternativa bi bila da trejd bez smera nema rezultat.
    expect(isShortDirection(null)).toBe(false);
    expect(isShortDirection("")).toBe(false);
    expect(isShortDirection("sell")).toBe(false);
  });
});

describe("win rate — jedna formula", () => {
  it("breakeven je van imenioca, i to je jedina definicija", () => {
    expect(winRateOf(2, 1)).toBeCloseTo((2 / 3) * 100, 10);
    expect(winRateOf(0, 5)).toBe(0);
    expect(winRateOf(5, 0)).toBe(100);
  });

  it("null bez ijedne odluke — razlika koju su kopije rešavale svaka za sebe", () => {
    // Šest kopija je biralo svoju rezervu: neke 0, `month-calendar` „—".
    // Formula sada vraća null, a svaki pozivalac bira šta sa tim radi na svom
    // mestu — vidljivo, umesto zakopano u izraz.
    expect(winRateOf(0, 0)).toBeNull();
  });
});

describe("razlika dana — dve konvencije, obe namerne", () => {
  it("kalendarska razlika je 0-bazna", () => {
    expect(daysBetweenDayKeys("2026-03-02", "2026-03-02")).toBe(0);
    expect(daysBetweenDayKeys("2026-03-02", "2026-03-05")).toBe(3);
  });

  it("broj sesija držanja je 1-bazan i tačno za jedan veći", () => {
    // Dan otvaranja se broji kao prva sesija. Razlika u konvenciji je stvarna i
    // ostaje; ono što je uklonjeno je druga IMPLEMENTACIJA — petlja koja je
    // dodavala po jedan dan i brojala korake do 3650.
    expect(daysBetweenKeys("2026-03-02", "2026-03-02")).toBe(1);
    expect(daysBetweenKeys("2026-03-02", "2026-03-05")).toBe(4);

    for (const [from, to] of [
      ["2026-02-26", "2026-03-02"], // prelaz meseca
      ["2024-02-27", "2024-03-01"], // prestupna godina
      ["2026-12-30", "2027-01-02"], // prelaz godine
      ["2026-03-06", "2026-03-10"], // preko promene vremena u SAD
    ]) {
      expect(daysBetweenKeys(from, to), `${from} → ${to}`).toBe(
        daysBetweenDayKeys(from, to) + 1,
      );
    }
  });

  it("obrnut redosled daje 0, ne negativan broj sesija", () => {
    expect(daysBetweenKeys("2026-03-05", "2026-03-02")).toBe(0);
  });
});

describe("dan u nedelji — jedna numeracija", () => {
  it("isFriday se slaže sa ISO numeracijom", () => {
    // 2026-03-06 je petak. Ranije je `isFriday` išao kroz `parseISO().getDay()`,
    // što je bilo tačno ali je tražilo da čitalac zna zašto — `time.ts` je oko
    // toga nosio upozorenje „do not copy this pattern".
    expect(isFriday("2026-03-06")).toBe(true);
    expect(isoWeekdayOfDayKey("2026-03-06")).toBe(5);

    for (const [day, iso] of [
      ["2026-03-02", 1], ["2026-03-03", 2], ["2026-03-04", 3],
      ["2026-03-05", 4], ["2026-03-06", 5], ["2026-03-07", 6],
      ["2026-03-08", 7],
    ] as const) {
      expect(isoWeekdayOfDayKey(day), day).toBe(iso);
      expect(isFriday(day), day).toBe(iso === 5);
    }
  });

  it("nedelja je 7, nikad 0 — `Date#getDay` konvencija ovde ne postoji", () => {
    expect(isoWeekdayOfDayKey("2026-03-08")).toBe(7);
  });
});

describe("breakeven pojas — jedno pravilo za pet ekrana", () => {
  const acct = (from: number, to: number): BreakevenConfig =>
    ({
      breakeven_from: from,
      breakeven_to: to,
      breakeven_unit: "currency",
      starting_balance: 10_000,
    }) as BreakevenConfig;

  it("pojas važi kad se svi nalozi slažu", () => {
    const r = sharedBreakevenRange([acct(-20, 20), acct(-20, 20)]);
    expect(r).toEqual({ from: -20, to: 20 });
    expect(r).toEqual(resolveBreakevenRange(acct(-20, 20)));
  });

  it("nalozi koji se ne slažu padaju na tačnu nulu, ne na prvi pojas", () => {
    // Trejd od +15 $ ne može biti breakeven na jednom nalogu a dobitak na
    // drugom. Uzeti prvi pojas značilo bi primeniti tuđe pravilo na tuđe
    // trejdove — pa se ne primenjuje nijedan.
    expect(sharedBreakevenRange([acct(-20, 20), acct(-5, 5)])).toEqual(
      EXACT_ZERO_RANGE,
    );
  });

  it("prazan skup naloga daje tačnu nulu", () => {
    expect(sharedBreakevenRange([])).toEqual(EXACT_ZERO_RANGE);
  });

  it("jedan nalog daje svoj pojas — ovo je Dashboard filtriran na nalog", () => {
    // Razlika između Dashboard-a i ruta je u tome ŠTA se prosleđuje, ne u
    // pravilu: Dashboard šalje izabrane naloge, rute sve. Ta razlika je namerna.
    expect(sharedBreakevenRange([acct(-50, 50)])).toEqual({ from: -50, to: 50 });
  });
});

describe("zona naloga — jedan lanac rezervi", () => {
  const accounts = [
    { id: "a1", timezone: "Europe/Berlin" },
    { id: "a2", timezone: "Asia/Tokyo" },
  ];

  it("trejd nosi zonu svog naloga", () => {
    const tz = accountTimezoneResolver(accounts, "Europe/Berlin");
    expect(tz("a1")).toBe("Europe/Berlin");
    expect(tz("a2")).toBe("Asia/Tokyo");
  });

  it("trejd bez naloga pada na PRIMARNI, ne na zakucani New York", () => {
    // Ovo je bila stvarna razlika, ne samo dupliranje: `dashboard.tsx` je imao
    // `?? "America/New_York"` bez rezerve na primarni nalog, dok su `/calendar`
    // i `/playbooks` padale na `primary?.timezone`. Trejd bez `account_id`
    // nastaje kad se nalog obriše (`ON DELETE SET NULL`), i takav bi na nalogu u
    // Berlinu bio datiran u dve različite kolone kalendara.
    const tz = accountTimezoneResolver(accounts, "Europe/Berlin");
    expect(tz(null)).toBe("Europe/Berlin");
    expect(tz(undefined)).toBe("Europe/Berlin");
    expect(tz("nepostojeci-id")).toBe("Europe/Berlin");
  });

  it("bez primarnog naloga pada na DEFAULT_TZ", () => {
    const tz = accountTimezoneResolver([], null);
    expect(tz(null)).toBe("America/New_York");
  });
});
