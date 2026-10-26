import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Phase J: what "Delete all data" and a new account get is the trader's own
 * book of 15.10.2026, not the list of 30.09. Read from `tj_option_lists`,
 * `tj_option_items` and `tj_field_defs` that day (SELECT only), in order.
 *
 * The function is read from the LATEST migration that defines it — that is the
 * one the database runs.
 */
const sql = (() => {
  const dir = "supabase/migrations";
  const defines = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) =>
      readFileSync(`${dir}/${f}`, "utf8").includes(
        "CREATE OR REPLACE FUNCTION public.tj_seed_categories",
      ),
    );
  return readFileSync(`${dir}/${defines[defines.length - 1]}`, "utf8").split("\r\n").join("\n");
})();

function block(from: string, to: string): string {
  const a = sql.indexOf(from);
  const b = sql.indexOf(to, a);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return sql.slice(a, b);
}

const LISTS = [
  ["direction", "Smer", "Context", 0],
  ["htf_bias", "Bias dana", "Context", 1],
  ["entry_tf", "TF ulaza", "Context", 2],
  ["technical_tag", "Tehnički tagovi", "ICT Setup", 3],
  ["setup_grade", "Ocena setupa", "ICT Setup", 4],
  ["exit_reason", "Razlog izlaza", "Risk", 5],
  ["miss_reason", "Razlog propuštanja", "Risk", 6],
  ["emotion", "Emocije", "Psychology", 7],
  ["discipline", "Disciplina", "Psychology", 8],
  ["mistake", "Greške", "Psychology", 9],
];

const ITEMS: Record<string, string[]> = {
  direction: ["Long", "Short"],
  htf_bias: ["Gore (bullish)", "Dole (bearish)", "Nema biasa", "Nisam odredio unapred"],
  entry_tf: ["30s", "1m", "2m", "5m", "15m", "1h"],
  technical_tag: [
    "Sweep likvidnosti", "MSS", "BOS", "FVG", "iFVG", "Order blok", "Breaker blok", "OTE",
    "SMT divergencija", "HTF odbijanje (1h/4h zatvaranje)", "Momentum sveće", "Ponoćni pojas",
    "Cilj: FVG", "Cilj: likvidnost",
  ],
  setup_grade: ["A+", "A", "B", "C"],
  exit_reason: [
    "Pogođen target", "Pogođen stop", "Na nuli", "Prateći stop", "Zatvoreno ranije",
    "Ručni izlaz: invalidacija", "Ručni izlaz: pre vesti", "Izlaz po vremenu (kraj prozora)",
    "Kraj dana (ravno)",
  ],
  miss_reason: [
    "Limit nije popunjen", "Oklevao", "Nisam bio za ekranom", "Preskočen po pravilima",
    "Vesti / događaj", "Video tek na snimku",
  ],
  emotion: [
    "Smiren", "FOMO", "Strah", "Osveta", "Nestrpljiv", "Previše samouveren", "Umoran", "Ometen",
    "Pohlepan",
  ],
  discipline: ["Ispoštovao rizik", "Vodio po planu"],
  mistake: [
    "Bez greške", "Bez biasa dana pre ulaza", "Ulaz bez setupa iz playbook-a", "Teza posle klika",
    "Rani ulaz", "Jurio cenu", "Ulaz van prozora", "Ulaz u crvenom prozoru", "Ulaz posle 2 SL",
    "Osvetnički ponovni ulaz", "Prevelika pozicija",
    "Stop postavio bracket, ne ja", "Pomerio stop", "Dodao protiv pozicije", "Cilj ispod 2R",
    "Rano zatvorio dobitak", "Dobitak pretvorio u gubitak", "Previše trejdova",
  ],
};

const FIELDS = [
  ["htf_bias", "Bias dana", "select", "htf_bias", "always", 0],
  ["entry_tf", "TF ulaza", "select", "entry_tf", "always", 1],
  ["technical_tags", "Tehnički tagovi", "tags", "technical_tag", "always", 2],
  ["exit_reason", "Razlog izlaza", "select", "exit_reason", "active", 3],
  ["mistake", "Greške", "tags", "mistake", "active", 4],
  ["psychology_tags", "Psihologija", "tags", "emotion", "active", 5],
  ["miss_reason", "Razlog propuštanja", "select", "miss_reason", "missed", 6],
];

const q = "'((?:[^']|'')*)'";
const unq = (s: string) => s.split("''").join("'");

describe("tj_seed_categories = the trader's book of 15.10.2026 (phase J)", () => {
  it("seeds the ten lists under their Serbian names", () => {
    const re = new RegExp(String.raw`\(${q},\s*${q},\s*${q},\s*(\d+)\)`, "g");
    const found = [...block("insert into public.tj_option_lists", "as v(key, label, category").matchAll(re)].map(
      (m) => [m[1], unq(m[2]), unq(m[3]), Number(m[4])],
    );
    expect(found).toEqual(LISTS);
  });

  it("seeds every item of every list, in the trader's order", () => {
    const re = new RegExp(String.raw`\(${q},\s*${q},\s*(\d+)\)`, "g");
    const found: Record<string, string[]> = {};
    for (const m of block("insert into public.tj_option_items", "as v(list_key, value, ord)").matchAll(re)) {
      const list = (found[m[1]] ??= []);
      expect(Number(m[3]), `${m[1]} ${m[2]}`).toBe(list.length);
      list.push(unq(m[2]));
    }
    expect(found).toEqual(ITEMS);
  });

  it("keeps every value the code reads by name", () => {
    const all = Object.values(ITEMS).flat();
    for (const v of [
      "Bez greške", "Ispoštovao rizik", "Vodio po planu", "Pogođen stop", "Pogođen target",
      "Na nuli", "Prateći stop", "Zatvoreno ranije",
    ]) {
      expect(all, v).toContain(v);
    }
    expect(ITEMS.htf_bias.some((v) => v.startsWith("Nisam odredio"))).toBe(true);
  });

  it("seeds the seven fields under their Serbian names", () => {
    const re = new RegExp(String.raw`\(${q},\s*${q},\s*${q},\s*${q},\s*${q},\s*(\d+)\)`, "g");
    const found = [...block("insert into public.tj_field_defs", "as v(key, label, field_type").matchAll(re)].map(
      (m) => [m[1], unq(m[2]), m[3], m[4], m[5], Number(m[6])],
    );
    expect(found).toEqual(FIELDS);
  });

  it("still leaves a book that already has lists alone", () => {
    expect(sql).toContain(
      "if not exists (select 1 from public.tj_option_lists where user_id = target) then",
    );
  });
});
