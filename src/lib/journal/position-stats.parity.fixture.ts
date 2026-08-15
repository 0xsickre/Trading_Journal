import type { PositionStatsInput } from "./position-stats";

/**
 * DVANAEST OBLIKA TREJDA, IZVEDENIH NA PAPIRU, ZA OBA MOTORA KOJI RAČUNAJU NOVAC.
 *
 * `position-stats.ts` počinje rečenicom „must stay in sync with `tj_position_stats`
 * SQL view". Do ovog fajla to je bila samo rečenica: TS strana je imala testove,
 * SQL strana nijedan, a nijedan test nije poredio to dvoje. Novac koji aplikacija
 * pokazuje dolazi iz SQL-a; TS blizanac se koristi za pregled u formi pre snimanja.
 * Grešku u view-u nijedan `lib/` test nije mogao da vidi.
 *
 * Zato ovde stoje OČEKIVANE vrednosti izvedene na papiru, a ne izlaz nijednog od
 * dva motora. Fikstura je merilo; oba motora se mere prema njoj:
 *
 *   - `position-stats.parity.test.ts` pušta `computePositionStats` kroz sve ove
 *     slučajeve pri svakom `vitest run`;
 *   - ista knjiga je puštena i kroz `tj_position_stats` nad živom bazom, 12
 *     slučajeva × 9 kolona = 108 tvrdnji, sve prošle. Postupak i rezultat su
 *     zapisani u `CODE_REVIEW.md`.
 *
 * Dok obe strane gađaju iste brojeve sa papira, ne mogu da se raziđu a da bar
 * jedna ne padne. Snapshot testovi zaključavaju trenutno ponašanje uključujući
 * njegove bagove; ovaj zaključava ODGOVOR.
 *
 * Brojevi su birani tako da se svaki proverava napamet.
 */

export type ParityCase = {
  name: string;
  /** Šta ovaj oblik dokazuje — zašto je u skupu. */
  proves: string;
  input: PositionStatsInput;
  paper: {
    avg_entry: number | null;
    avg_exit: number | null;
    gross_points: number | null;
    gross_pl: number | null;
    net_pl: number | null;
    planned_risk_pts: number | null;
    realized_r: number | null;
    realized_r_net: number | null;
  };
};

export const PARITY_CASES: ParityCase[] = [
  {
    name: "T1 long, jedan fill",
    proves: "osnovni slučaj: dir_mult = +1, gross_points = izlaz − ulaz",
    input: {
      direction: "Long",
      entry_price: 5000,
      stop_price: 4990,
      point_value: 1,
      executions: [
        { side: "entry", price: 5000, qty: 1 },
        { side: "exit", price: 5030, qty: 1 },
      ],
    },
    // rizik = |5000 − 4990| = 10 ; bruto = (5030 − 5000) × 1 = 30 ; R = 30 / (10 × 1)
    paper: {
      avg_entry: 5000,
      avg_exit: 5030,
      gross_points: 30,
      gross_pl: 30,
      net_pl: 30,
      planned_risk_pts: 10,
      realized_r: 3,
      realized_r_net: 3,
    },
  },
  {
    name: "T2 short",
    proves: "dir_mult = −1: pad cene je dobitak",
    input: {
      direction: "Short",
      entry_price: 5000,
      stop_price: 5010,
      point_value: 1,
      executions: [
        { side: "entry", price: 5000, qty: 1 },
        { side: "exit", price: 4970, qty: 1 },
      ],
    },
    // bruto = (4970 − 5000) × (−1) = +30 ; rizik = |5000 − 5010| = 10
    paper: {
      avg_entry: 5000,
      avg_exit: 4970,
      gross_points: 30,
      gross_pl: 30,
      net_pl: 30,
      planned_risk_pts: 10,
      realized_r: 3,
      realized_r_net: 3,
    },
  },
  {
    name: "T3 scale-in, dva ulazna fill-a",
    proves: "avg_entry je ponderisan količinom, ne prosek cena",
    input: {
      direction: "Long",
      entry_price: 5000,
      stop_price: 4990,
      point_value: 1,
      executions: [
        { side: "entry", price: 5000, qty: 2 },
        { side: "entry", price: 5010, qty: 2 },
        { side: "exit", price: 5045, qty: 4 },
      ],
    },
    // ulaz: (10000 + 10020) / 4 = 5005 ; bruto = 20180 − 5005×4 = 160
    // rizik ide od PLANIRANOG ulaza 5000, ne od 5005 → 10 ; R = 160 / (10 × 4) = 4
    paper: {
      avg_entry: 5005,
      avg_exit: 5045,
      gross_points: 160,
      gross_pl: 160,
      net_pl: 160,
      planned_risk_pts: 10,
      realized_r: 4,
      realized_r_net: 4,
    },
  },
  {
    name: "T4 delimičan izlaz, 4 od 10",
    proves:
      "R se meri prema PREUZETOM riziku, ne prema zatvorenom delu — zatvoreni " +
      "deo je išao punih 1.0 R, a trejd prijavljuje 0.4 R jer preostalih 6 " +
      "jedinica i dalje stoji pod istim rizikom",
    input: {
      direction: "Long",
      entry_price: 100,
      stop_price: 90,
      point_value: 1,
      executions: [
        { side: "entry", price: 100, qty: 10 },
        { side: "exit", price: 110, qty: 4 },
      ],
    },
    // bruto pokriva samo zatvorene 4: (440 − 100×4) = 40
    // imenilac pokriva svih 10: 10 × 10 = 100 → R = 0.4
    paper: {
      avg_entry: 100,
      avg_exit: 110,
      gross_points: 40,
      gross_pl: 40,
      net_pl: 40,
      planned_risk_pts: 10,
      realized_r: 0.4,
      realized_r_net: 0.4,
    },
  },
  {
    name: "T5 provizije i swap",
    proves: "net = bruto − provizije − swap ; realized_r ostaje na BRUTO osnovi",
    input: {
      direction: "Long",
      entry_price: 5000,
      stop_price: 4990,
      point_value: 1,
      executions: [
        { side: "entry", price: 5000, qty: 1, fee: 2, swap_funding: 3 },
        { side: "exit", price: 5030, qty: 1, fee: 2 },
      ],
    },
    // bruto 30 ; troškovi 4 + 3 = 7 ; neto 23
    // R = 30/10 = 3.0 (bruto) ; R_net = 23/10 = 2.3 — dve različite osnove, namerno
    paper: {
      avg_entry: 5000,
      avg_exit: 5030,
      gross_points: 30,
      gross_pl: 30,
      net_pl: 23,
      planned_risk_pts: 10,
      realized_r: 3,
      realized_r_net: 2.3,
    },
  },
  {
    name: "T6 bez point_value",
    proves:
      "novac je null a R preživi: R je odnos u prostoru CENA i ne traži " +
      "ugovornu specifikaciju. Ovde je pao `COALESCE(point_value, 1)` — " +
      "vidi 20260728120000_snapshot_instrument_spec.sql",
    input: {
      direction: "Long",
      entry_price: 100,
      stop_price: 90,
      point_value: null,
      executions: [
        { side: "entry", price: 100, qty: 1 },
        { side: "exit", price: 130, qty: 1 },
      ],
    },
    paper: {
      avg_entry: 100,
      avg_exit: 130,
      gross_points: 30,
      gross_pl: null,
      net_pl: null,
      planned_risk_pts: 10,
      realized_r: 3,
      realized_r_net: null,
    },
  },
  {
    name: "T7 stop jednak ulazu",
    proves:
      "nulti rizik daje NEDEFINISAN R, ne beskonačan — `NULLIF(..., 0)` u " +
      "view-u, `risk > 0 ? risk : null` u TS-u",
    input: {
      direction: "Long",
      entry_price: 5000,
      stop_price: 5000,
      point_value: 1,
      executions: [
        { side: "entry", price: 5000, qty: 1 },
        { side: "exit", price: 5030, qty: 1 },
      ],
    },
    paper: {
      avg_entry: 5000,
      avg_exit: 5030,
      gross_points: 30,
      gross_pl: 30,
      net_pl: 30,
      planned_risk_pts: null,
      realized_r: null,
      realized_r_net: null,
    },
  },
  {
    name: "T8 otvorena pozicija",
    proves: "bez izlaza nema realizovanog rezultata — null, ne nula",
    input: {
      direction: "Long",
      entry_price: 5000,
      stop_price: 4990,
      point_value: 1,
      executions: [{ side: "entry", price: 5000, qty: 1 }],
    },
    paper: {
      avg_entry: 5000,
      avg_exit: null,
      gross_points: null,
      gross_pl: null,
      net_pl: null,
      planned_risk_pts: 10,
      realized_r: null,
      realized_r_net: null,
    },
  },
  {
    name: "T9 breakeven",
    proves: "izlaz po ulaznoj ceni daje tačnu nulu, i ona je podatak a ne odsustvo",
    input: {
      direction: "Long",
      entry_price: 5000,
      stop_price: 4990,
      point_value: 1,
      executions: [
        { side: "entry", price: 5000, qty: 1 },
        { side: "exit", price: 5000, qty: 1 },
      ],
    },
    paper: {
      avg_entry: 5000,
      avg_exit: 5000,
      gross_points: 0,
      gross_pl: 0,
      net_pl: 0,
      planned_risk_pts: 10,
      realized_r: 0,
      realized_r_net: 0,
    },
  },
  {
    name: "T10 dva izlazna fill-a",
    proves: "avg_exit je takođe ponderisan količinom",
    input: {
      direction: "Long",
      entry_price: 100,
      stop_price: 90,
      point_value: 1,
      executions: [
        { side: "entry", price: 100, qty: 4 },
        { side: "exit", price: 110, qty: 2 },
        { side: "exit", price: 120, qty: 2 },
      ],
    },
    // izlaz: (220 + 240) / 4 = 115 ; bruto = 460 − 400 = 60 ; R = 60 / (10 × 4) = 1.5
    paper: {
      avg_entry: 100,
      avg_exit: 115,
      gross_points: 60,
      gross_pl: 60,
      net_pl: 60,
      planned_risk_pts: 10,
      realized_r: 1.5,
      realized_r_net: 1.5,
    },
  },
  {
    name: "T11 forex point_value",
    proves:
      "poeni × 100 000: mali pomeraj cene je pravi novac. Ovo je razlika " +
      "između $1000 i $0.01 ako ugovorna specifikacija otkaže",
    input: {
      direction: "Long",
      entry_price: 1.1,
      stop_price: 1.095,
      point_value: 100_000,
      executions: [
        { side: "entry", price: 1.1, qty: 1 },
        { side: "exit", price: 1.11, qty: 1 },
      ],
    },
    // bruto = 0.01 poena ; × 100 000 = $1000 ; rizik = 0.005 → R = 2
    paper: {
      avg_entry: 1.1,
      avg_exit: 1.11,
      gross_points: 0.01,
      gross_pl: 1000,
      net_pl: 1000,
      planned_risk_pts: 0.005,
      realized_r: 2,
      realized_r_net: 2,
    },
  },
  {
    name: "T12 bez planirane ulazne cene",
    proves:
      "rizik pada na PROSEČAN FILL kad plan ne postoji — `COALESCE(entry_price, avg_entry)`",
    input: {
      direction: "Long",
      entry_price: null,
      stop_price: 90,
      point_value: 1,
      executions: [
        { side: "entry", price: 100, qty: 1 },
        { side: "exit", price: 110, qty: 1 },
      ],
    },
    paper: {
      avg_entry: 100,
      avg_exit: 110,
      gross_points: 10,
      gross_pl: 10,
      net_pl: 10,
      planned_risk_pts: 10,
      realized_r: 1,
      realized_r_net: 1,
    },
  },
];
