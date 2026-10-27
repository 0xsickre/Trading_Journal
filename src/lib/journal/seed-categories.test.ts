import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Phase J: what "Delete all data" and a new account get is the trader's own
 * book of 15.10.2026, not the list of 30.09. Read from `tj_option_lists`,
 * `tj_option_items` and `tj_field_defs` that day (SELECT only), in order.
 * Phase E (27.10.2026) took "Bias dana" out: its list, its field and the
 * "Bez biasa dana pre ulaza" mistake.
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
  ["entry_tf", "TF ulaza", "Context", 1],
  ["technical_tag", "Tehnički tagovi", "ICT Setup", 2],
  ["setup_grade", "Ocena setupa", "ICT Setup", 3],
  ["exit_reason", "Razlog izlaza", "Risk", 4],
  ["miss_reason", "Razlog propuštanja", "Risk", 5],
  ["emotion", "Emocije", "Psychology", 6],
  ["discipline", "Disciplina", "Psychology", 7],
  ["mistake", "Greške", "Psychology", 8],
];

const ITEMS: Record<string, string[]> = {
  direction: ["Long", "Short"],
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
    "Bez greške", "Ulaz bez setupa iz playbook-a", "Teza posle klika",
    "Rani ulaz", "Jurio cenu", "Ulaz van prozora", "Ulaz u crvenom prozoru", "Ulaz posle 2 SL",
    "Osvetnički ponovni ulaz", "Prevelika pozicija",
    "Stop postavio bracket, ne ja", "Pomerio stop", "Dodao protiv pozicije", "Cilj ispod 2R",
    "Rano zatvorio dobitak", "Dobitak pretvorio u gubitak", "Previše trejdova",
  ],
};

const FIELDS = [
  ["entry_tf", "TF ulaza", "select", "entry_tf", "always", 0],
  ["technical_tags", "Tehnički tagovi", "tags", "technical_tag", "always", 1],
  ["exit_reason", "Razlog izlaza", "select", "exit_reason", "active", 2],
  ["mistake", "Greške", "tags", "mistake", "active", 3],
  ["psychology_tags", "Psihologija", "tags", "emotion", "active", 4],
  ["miss_reason", "Razlog propuštanja", "select", "miss_reason", "missed", 5],
];

const q = "'((?:[^']|'')*)'";
const unq = (s: string) => s.split("''").join("'");

describe("tj_seed_categories = the trader's book of 15.10.2026 (phase J)", () => {
  it("seeds the nine lists under their Serbian names", () => {
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
  });

  it("seeds the six fields under their Serbian names", () => {
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
