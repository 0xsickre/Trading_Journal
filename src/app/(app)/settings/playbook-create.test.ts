import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Create Playbook" writes the book with its template (trader, 28.10.2026):
 * "Setup Grade" with four shared criteria and "Izlaz" with the exit review.
 * Rules already in the library are linked, missing ones created; the book is
 * taken back if any part cannot be written.
 */

const USER = "97edd6db-12db-4156-9f89-77d2dcaa66d7";
const BOOK = "b0000000-0000-4000-8000-000000000001";
let failOn: string | null = null;
let library: { id: string; text: string; show_when: string; deleted_at: string | null; sort_order: number }[] = [];
const inserted: { table: string; rows: Record<string, unknown>[] }[] = [];
const deleted: { table: string; id: unknown }[] = [];

function table(name: string) {
  const c: Record<string, unknown> = {};
  for (const m of ["order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data: null, error: null });
  // The library read: `select(...)` awaited directly.
  c.select = () => Object.assign(c, { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: library, error: null }).then(ok) });
  c.insert = (rows: Record<string, unknown> | Record<string, unknown>[]) => {
    const list = Array.isArray(rows) ? rows : [rows];
    inserted.push({ table: name, rows: list });
    const error = failOn === name ? { message: "denied" } : null;
    if (name === "tj_playbooks") return { select: () => ({ single: async () => ({ data: { id: BOOK }, error: null }) }) };
    if (name === "tj_playbook_rule_links") return Promise.resolve({ error });
    const data = error ? null : list.map((r, i) => ({ ...r, id: `${name === "tj_playbook_sections" ? "sec" : "new"}-${i}` }));
    return { select: async () => ({ data, error }) };
  };
  c.delete = () => ({
    eq: async (_col: string, id: unknown) => {
      deleted.push({ table: name, id });
      return { error: null };
    },
  });
  return c;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/journal/revalidate", () => ({ revalidateTrades: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => table(t) }) }));
vi.mock("@/lib/supabase/user", () => ({ getCurrentUser: async () => ({ id: USER }) }));

const { addPlaybook } = await import("./playbook-actions");
const rowsOf = (t: string) => inserted.find((i) => i.table === t)?.rows ?? [];

beforeEach(() => {
  failOn = null;
  library = [];
  inserted.length = 0;
  deleted.length = 0;
});

describe("addPlaybook", () => {
  it("starts the book with Setup Grade and Izlaz, in order", async () => {
    expect(await addPlaybook("ICT Silver Bullet")).toEqual({ ok: true, id: BOOK });
    expect(rowsOf("tj_playbook_sections")).toEqual([
      { user_id: USER, playbook_id: BOOK, label: "Setup Grade", sort_order: 0 },
      { user_id: USER, playbook_id: BOOK, label: "Izlaz", sort_order: 1 },
    ]);
  });

  it("an empty library: all nine rules are created, the four criteria grade the setup", async () => {
    await addPlaybook("ICT Silver Bullet");
    expect(rowsOf("tj_playbook_rules").map((r) => [r.text, r.show_when])).toEqual([
      ["Rizik izracunat pre ulaska", "always"],
      ["TP i SL jasno odredjeni", "always"],
      ["Structura Bias se slaze LTF do 15 min", "always"],
      ["Structura Bias se slaze HTF od 15m do 1D", "always"],
      ["Cut In lose", "loser"],
      ["Cut in profit", "winner"],
      ["TP Hit", "winner"],
      ["SL Hit", "loser"],
      ["BE", "breakeven"],
    ]);
    const links = rowsOf("tj_playbook_rule_links");
    expect(links.map((l) => [l.section_id, l.is_setup_criterion])).toEqual([
      ...Array(4).fill(["sec-0", true]),
      ...Array(5).fill(["sec-1", false]),
    ]);
    expect(links.map((l) => l.rule_id)).toEqual(Array.from({ length: 9 }, (_, i) => `new-${i}`));
  });

  it("a rule already in the library is linked, not copied — its statistics pool across books", async () => {
    library = [
      { id: "rizik", text: "rizik  izracunat pre ulaska", show_when: "always", deleted_at: null, sort_order: 4 },
      { id: "tp", text: "TP Hit", show_when: "winner", deleted_at: null, sort_order: 7 },
      // Retired, or the same words with another "when it shows": not the template's rule.
      { id: "be-old", text: "BE", show_when: "breakeven", deleted_at: "2026-10-01", sort_order: 1 },
      { id: "sl-always", text: "SL Hit", show_when: "always", deleted_at: null, sort_order: 2 },
    ];
    await addPlaybook("ICT Silver Bullet");
    const texts = rowsOf("tj_playbook_rules").map((r) => r.text);
    expect(texts).not.toContain("Rizik izracunat pre ulaska");
    expect(texts).not.toContain("TP Hit");
    expect(texts).toEqual(expect.arrayContaining(["BE", "SL Hit"]));
    expect(rowsOf("tj_playbook_rules")[0].sort_order).toBe(8);
    const links = rowsOf("tj_playbook_rule_links").map((l) => l.rule_id);
    expect(links[0]).toBe("rizik");
    expect(links[6]).toBe("tp");
    expect(links).not.toContain("be-old");
    expect(links).not.toContain("sl-always");
  });

  it.each(["tj_playbook_sections", "tj_playbook_rules", "tj_playbook_rule_links"])(
    "takes the book back when %s cannot be written",
    async (t) => {
      failOn = t;
      expect(await addPlaybook("ICT Silver Bullet")).toEqual({ ok: false, error: "denied" });
      expect(deleted).toEqual([{ table: "tj_playbooks", id: BOOK }]);
    },
  );

  it("refuses an empty name before touching the database", async () => {
    expect((await addPlaybook("  ")).ok).toBe(false);
    expect(inserted).toEqual([]);
  });
});
