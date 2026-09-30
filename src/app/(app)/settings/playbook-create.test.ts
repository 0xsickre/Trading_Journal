import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Create Playbook" writes the book and its three starting sections — why,
 * where in, where out — and takes the book back if the sections cannot be written.
 */

const USER = "97edd6db-12db-4156-9f89-77d2dcaa66d7";
const BOOK = "b0000000-0000-4000-8000-000000000001";
let sectionError: { message: string } | null = null;
const inserted: { table: string; rows: unknown }[] = [];
const deleted: { table: string; id: unknown }[] = [];

function table(name: string) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data: null, error: null });
  c.insert = (rows: unknown) => {
    inserted.push({ table: name, rows });
    if (name === "tj_playbook_sections") return Promise.resolve({ error: sectionError });
    return { select: () => ({ single: async () => ({ data: { id: BOOK }, error: null }) }) };
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

beforeEach(() => {
  sectionError = null;
  inserted.length = 0;
  deleted.length = 0;
});

describe("addPlaybook", () => {
  it("starts the book with its three sections, in order and empty", async () => {
    expect(await addPlaybook("ICT Silver Bullet")).toEqual({ ok: true, id: BOOK });
    const sections = inserted.find((i) => i.table === "tj_playbook_sections")?.rows;
    expect(sections).toEqual([
      { user_id: USER, playbook_id: BOOK, label: "Zašto ulazim?", sort_order: 0 },
      { user_id: USER, playbook_id: BOOK, label: "Gde ulazim?", sort_order: 1 },
      { user_id: USER, playbook_id: BOOK, label: "Gde izlazim?", sort_order: 2 },
    ]);
    expect(inserted.some((i) => i.table === "tj_playbook_rules")).toBe(false);
  });

  it("takes the book back when its sections cannot be written", async () => {
    sectionError = { message: "denied" };
    expect(await addPlaybook("ICT Silver Bullet")).toEqual({ ok: false, error: "denied" });
    expect(deleted).toEqual([{ table: "tj_playbooks", id: BOOK }]);
  });

  it("refuses an empty name before touching the database", async () => {
    expect((await addPlaybook("  ")).ok).toBe(false);
    expect(inserted).toEqual([]);
  });
});
