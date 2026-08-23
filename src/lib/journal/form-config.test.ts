import { describe, expect, it } from "vitest";
import {
  arrayFieldNames,
  buildFormTabs,
  getAllFormFields,
  numericFieldNames,
  positionFieldNames,
} from "./form-config";
import { TAGS_GROUP_ID } from "./form-config";
import type { FieldDef } from "./field-def-types";
import { SEEDED_FIELD_DEFS } from "./field-defs.fixture";

const def = (over: Partial<FieldDef> & { key: string }): FieldDef => ({
  id: over.key,
  label: over.key,
  field_type: "select",
  list_key: null,
  show_phase: "always",
  sort_order: 0,
  is_active: true,
  show_when: "always",
  ...over,
});

describe("form skeleton", () => {
  const tabs = buildFormTabs(SEEDED_FIELD_DEFS);

  it("delivers every user category to the form, in one flat group", () => {
    // The trap this replaced: `buildFormTabs` used to SKIP a definition whose
    // `group_id` named a group the skeleton did not declare, while the DB CHECK
    // happily stored it — the values stayed in `custom`, unreachable, with no
    // error anywhere. There is no group to name any more, so there is nothing
    // left to mismatch.
    const built = buildFormTabs([def({ key: "probe_a" }), def({ key: "probe_b" })]);
    const rendered = built
      .flatMap((t) => t.groups)
      .flatMap((g) => g.fields)
      .map((f) => f.name);
    expect(rendered).toContain("probe_a");
    expect(rendered).toContain("probe_b");
  });

  it("renders the categories group with no heading of its own", () => {
    // The four fixed headings were the only text on this form the trader could
    // not rename or delete. A category carries its own label; the block it sits
    // in needs none.
    const group = buildFormTabs([def({ key: "probe" })])
      .flatMap((t) => t.groups)
      .find((g) => g.id === TAGS_GROUP_ID)!;
    expect(group.title).toBeUndefined();
    expect(group.description).toBeUndefined();
  });

  it("orders categories by the trader's sort_order, not by key", () => {
    const built = buildFormTabs([
      def({ key: "zulu", sort_order: 0 }),
      def({ key: "alpha", sort_order: 1 }),
    ]);
    const names = built
      .flatMap((t) => t.groups)
      .find((g) => g.id === TAGS_GROUP_ID)!
      .fields.map((f) => f.name);
    expect(names.indexOf("zulu")).toBeLessThan(names.indexOf("alpha"));
  });

  it("filters by phase — and shows everything when no phase is given", () => {
    const defs = [
      def({ key: "everywhere", show_phase: "always" }),
      def({ key: "only_missed", show_phase: "missed" }),
    ];
    const namesIn = (phase?: "planned" | "active" | "missed") =>
      buildFormTabs(defs, phase)
        .flatMap((t) => t.groups)
        .flatMap((g) => g.fields)
        .map((f) => f.name);

    expect(namesIn("planned")).toContain("everywhere");
    expect(namesIn("planned")).not.toContain("only_missed");
    expect(namesIn("missed")).toContain("only_missed");
    // No phase is what the readers pass — the export and the report dimensions
    // describe trades across every phase at once, so nothing may be filtered.
    expect(namesIn()).toContain("only_missed");
  });

  it("drops a group that ends up empty rather than rendering a bare gap", () => {
    for (const g of tabs.flatMap((t) => t.groups)) {
      expect(g.fields.length).toBeGreaterThan(0);
    }
  });
});

describe("field inventory", () => {
  const names = positionFieldNames(SEEDED_FIELD_DEFS);

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
  const riskPlan = buildFormTabs(SEEDED_FIELD_DEFS)
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
    expect(arrayFieldNames(SEEDED_FIELD_DEFS)).toContain("mistake");
  });

  it("is one column wide, like every category beside it", () => {
    // It used to span both, from when it was declared in the form config and
    // sat in a group of its own. As an ordinary category it shares the grid,
    // and a single wide row among narrow ones is the thing that made
    // `technical_tags` look out of place before it moved too.
    const mistake = getAllFormFields(SEEDED_FIELD_DEFS).find((f) => f.name === "mistake")!;
    expect(mistake.type).toBe("tags");
    expect(mistake.colSpan).toBe(1);
  });
});

describe("execution rating is a first-class form field, not a bespoke one", () => {
  it("SITS IN numericFieldNames, which is what coerces it for a smallint column", () => {
    // Going through the config buys write permission, coercion and export
    // ordering for free; this asserts the coercion half, without which "4"
    // reaches Postgres as text.
    expect(numericFieldNames(SEEDED_FIELD_DEFS)).toContain("execution_rating");
  });

  it("is writable to its own column", () => {
    expect(positionFieldNames(SEEDED_FIELD_DEFS)).toContain("execution_rating");
  });
});

describe("which tab a category is asked on", () => {
  const namesIn = (tabId: "plan" | "execution", phase?: "planned" | "active" | "missed") =>
    buildFormTabs(SEEDED_FIELD_DEFS, phase)
      .find((t) => t.id === tabId)
      ?.groups.find((g) => g.id === TAGS_GROUP_ID)
      ?.fields.map((f) => f.name) ?? [];

  it("asks the review questions on the review tab", () => {
    // `active` means "answerable only once you are in the trade", and that is
    // a review question. All three sat on Execution & Review before they became
    // ordinary categories; when every category landed on Plan & Setup instead,
    // the review tab asked for none of the things you review.
    expect(namesIn("execution", "active")).toEqual(
      expect.arrayContaining(["exit_reason", "mistake", "psychology_tags"]),
    );
    expect(namesIn("plan", "active")).not.toContain("exit_reason");
  });

  it("asks the setup questions on the setup tab", () => {
    expect(namesIn("plan", "active")).toContain("technical_tags");
    expect(namesIn("plan", "missed")).toContain("miss_reason");
  });

  it("never asks the same category twice", () => {
    // Two inputs bound to one value is a way to type into one and watch the
    // other. Asserted across every phase, since the split is phase-driven.
    for (const phase of ["planned", "active", "missed"] as const) {
      const all = [...namesIn("plan", phase), ...namesIn("execution", phase)];
      expect(new Set(all).size).toBe(all.length);
    }
  });
});

describe("the order the trader dragged the categories into", () => {
  // The categories group on the review tab, which holds three of the five
  // seeded categories: exit_reason, mistake, psychology_tags. `categoryOrder`
  // is keyed by the CATEGORY (the field's `listKey`), not by the field key.
  const reviewNames = (categoryOrder?: Record<string, number>) =>
    buildFormTabs(SEEDED_FIELD_DEFS, undefined, categoryOrder)
      .find((t) => t.id === "execution")!
      .groups.find((g) => g.id === TAGS_GROUP_ID)!
      .fields.map((f) => f.name);

  it("leaves the fields alone when no order is given", () => {
    // The readers that call this to ENUMERATE fields — the CSV export, the
    // report dimensions, the save allowlist — care about the set, not the
    // sequence, and pass nothing. They must get back the `sort_order` sequence
    // untouched rather than pay for a reordering they have no use for.
    expect(reviewNames()).toEqual(["exit_reason", "mistake", "psychology_tags"]);
  });

  it("puts the categories in the order the trader chose", () => {
    expect(
      reviewNames({ mistake: 0, emotion: 1, exit_reason: 2 }),
    ).toEqual(["mistake", "psychology_tags", "exit_reason"]);
  });

  it("sorts a category the order says nothing about to the END, not the front", () => {
    // A field this function knows nothing about belongs at the bottom: it is
    // the safer place for something unranked, and the alternative — a missing
    // key reading as ordinal 0 — would jump it above every category the trader
    // deliberately placed.
    expect(reviewNames({ emotion: 0, mistake: 1 })).toEqual([
      "psychology_tags",
      "mistake",
      "exit_reason",
    ]);
  });
});
