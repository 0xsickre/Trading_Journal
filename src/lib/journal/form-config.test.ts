import { describe, expect, it } from "vitest";
import {
  arrayFieldNames,
  buildFormTabs,
  getAllFormFields,
  numericFieldNames,
  positionFieldNames,
} from "./form-config";
import { FIELD_DEF_GROUPS, type FieldDef } from "./field-def-types";

const def = (over: Partial<FieldDef> & { key: string }): FieldDef => ({
  id: over.key,
  label: over.key,
  field_type: "select",
  list_key: null,
  group_id: "setup",
  sort_order: 0,
  is_active: true,
  show_when: "always",
  ...over,
});

describe("form skeleton", () => {
  const tabs = buildFormTabs();

  it("delivers a user field assigned to ANY legal group to the form", () => {
    // The trap this exists to catch: `buildFormTabs` SKIPS a definition whose
    // group does not exist, while the DB CHECK on group_id happily stores it.
    // Drop a group from the skeleton and every user field in it disappears from
    // the form with no error anywhere — the values stay in `custom`, unreachable.
    //
    // Tested WITH a field in each group rather than against the bare skeleton,
    // because an empty group is filtered out on purpose and would fail a naive
    // check for the wrong reason.
    for (const id of FIELD_DEF_GROUPS) {
      const built = buildFormTabs([def({ key: `probe_${id}`, group_id: id })]);
      const rendered = built
        .flatMap((t) => t.groups)
        .flatMap((g) => g.fields)
        .map((f) => f.name);
      expect(rendered).toContain(`probe_${id}`);
    }
  });

  it("keeps a user field even in a group with no fixed fields of its own", () => {
    // `execution_advanced` has no built-in fields any more. It must still carry
    // definitions assigned to it.
    const withDef = buildFormTabs([
      def({ key: "my_field", group_id: "execution_advanced" }),
    ]);
    expect(getAllFormFields([
      def({ key: "my_field", group_id: "execution_advanced" }),
    ]).map((f) => f.name)).toContain("my_field");
    expect(
      withDef
        .flatMap((t) => t.groups)
        .find((g) => g.id === "execution_advanced")?.fields,
    ).toHaveLength(1);
  });

  it("drops a group that ends up empty rather than rendering a bare heading", () => {
    const advanced = tabs
      .flatMap((t) => t.groups)
      .filter((g) => g.advanced);
    for (const g of advanced) expect(g.fields.length).toBeGreaterThan(0);
  });
});

describe("field inventory", () => {
  const names = positionFieldNames();

  it("still carries every field the save path and the export rely on", () => {
    // Reordering the form must never silently drop a column: `positionFieldNames`
    // is the allowlist the server saves by, so a field missing here stops being
    // written at all.
    //
    // `setup_grade` LEFT THIS LIST ON PURPOSE. It is no longer asked for — the
    // grade is derived from the playbook criteria in `setup-score.ts` — and the
    // column staying unwritten is the point rather than an oversight. It is
    // named here so the removal reads as a decision to the next person who
    // wonders where it went.
    for (const key of [
      "instrument",
      "entry_price",
      "stop_price",
      "direction",
      "risk_pct",
      "position_size",
      "target_price",
      "planned_rr",
      "technical_tags",
      "miss_reason",
      "exit_reason",
      "max_drawdown_price",
      "max_profit_price",
      "mistake",
      "psychology_tags",
      "trade_journal_notes",
    ]) {
      expect(names).toContain(key);
    }
  });

  it("no longer carries the manual result field", () => {
    // The outcome is derived, not declared: `classifyOutcome` reads net P&L
    // against the account's breakeven band. Re-adding a field named `result`
    // would start writing a second, hand-maintained answer to a question the
    // numbers already settle.
    expect(names).not.toContain("result");
    expect(names).toContain("exit_reason");
  });

  it("lists a field once even though the note appears on both tabs", () => {
    // `trade_journal_notes` is one column shown in two places. The save path and
    // the CSV export must see one field, not two columns with the same name.
    const notes = names.filter((n) => n === "trade_journal_notes");
    expect(notes).toHaveLength(1);
  });
});

describe("risk plan reads as the arithmetic", () => {
  const riskPlan = buildFormTabs()
    .find((t) => t.id === "plan")!
    .groups.find((g) => g.id === "risk_plan")!
    .fields.map((f) => f.name);

  const before = (a: string, b: string) =>
    riskPlan.indexOf(a) < riskPlan.indexOf(b);

  it("puts every computed field after the inputs it falls out of", () => {
    // Direction comes from entry vs stop; size from risk % and the stop
    // distance; R:R from the target. Reading top to bottom should read as the
    // calculation, which is the whole reason for the order.
    expect(before("entry_price", "direction")).toBe(true);
    expect(before("stop_price", "direction")).toBe(true);
    expect(before("risk_pct", "position_size")).toBe(true);
    expect(before("stop_price", "position_size")).toBe(true);
    expect(before("target_price", "planned_rr")).toBe(true);
  });
});

describe("mistake is a tags field, not a select", () => {
  it("SITS IN arrayFieldNames, which is what reroutes it to a text[] column", () => {
    // The whole Faza 2 change is one word in the field's `type`. Everything
    // downstream — `buildPositionPatch` trimming into an array, the reports
    // dimension splitting it, the grid searching it — follows from membership
    // in this set. Asserting the set is asserting the route.
    expect(arrayFieldNames()).toContain("mistake");
  });

  it("spans both columns so the picker has room for several chips", () => {
    const mistake = getAllFormFields().find((f) => f.name === "mistake")!;
    expect(mistake.type).toBe("tags");
    expect(mistake.colSpan).toBe(2);
  });
});

describe("execution rating is a first-class form field, not a bespoke one", () => {
  it("SITS IN numericFieldNames, which is what coerces it for a smallint column", () => {
    // `conviction` takes a bespoke path and pays for it — it is missing from the
    // mentor pack because it is not a form-config field. Going through the
    // config buys write permission, coercion and export ordering for free; this
    // asserts the coercion half, without which "4" reaches Postgres as text.
    expect(numericFieldNames()).toContain("execution_rating");
  });

  it("is writable to its own column", () => {
    expect(positionFieldNames()).toContain("execution_rating");
  });
});
