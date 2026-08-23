import { describe, expect, it } from "vitest";
import {
  rulesBySection,
  type LinkedRule,
  type PlaybookSection,
} from "./playbook-types";
import { buildPlaybookLookup } from "./reports/playbook-dimensions";

const section = (id: string, label: string, sort_order = 0): PlaybookSection => ({
  id,
  label,
  description: null,
  sort_order,
});

function rule(id: string, text: string, sectionId = "s-entry"): LinkedRule {
  return {
    id,
    text,
    show_when: "always",
    sort_order: 0,
    deleted_at: null,
    answerCount: 0,
    link_id: `link-${id}-${sectionId}`,
    section_id: sectionId,
    is_setup_criterion: false,
    link_sort: 0,
  };
}

describe("the rule library", () => {
  /**
   * The regression this whole change exists for.
   *
   * Before, a rule lived in one group in one playbook. Using "waited for the
   * sweep" in a second book meant retyping it, which created a SECOND rule id —
   * and every answer then split across two ids, so neither told the truth about
   * the rule.
   */
  it("keeps ONE id when the same rule is used by two playbooks", () => {
    const shared = rule("r-sweep", "Waited for the sweep");
    const lookup = buildPlaybookLookup([
      { id: "pb-ote", name: "OTE", rules: [shared, rule("r-ote", "Entry in OTE")] },
      { id: "pb-ob", name: "Order Block", rules: [shared, rule("r-ob", "OB respected")] },
    ]);

    expect(lookup.rules.text.get("r-sweep")).toBe("Waited for the sweep");
    // Three rules across two books, not four: the shared one is seen twice and
    // indexed once.
    expect(lookup.rules.text.size).toBe(3);
  });

  /**
   * The half the section move adds.
   *
   * One id, but a different filing in each book. The section is a property of
   * the LINK, so the shared rule can be an entry condition in one playbook and
   * an exit condition in another — and the id, and therefore the statistics,
   * stay single.
   */
  it("lets one rule sit in a different section in each playbook", () => {
    const shared = rule("r-sweep", "Waited for the sweep");
    const asEntry = { ...shared, section_id: "s-entry" };
    const asExit = { ...shared, section_id: "s-exit" };

    const ote = rulesBySection([section("s-entry", "Entry")], [asEntry]);
    const ob = rulesBySection([section("s-exit", "Exit")], [asExit]);

    expect(ote[0].section.label).toBe("Entry");
    expect(ob[0].section.label).toBe("Exit");
    expect(ote[0].rules[0].id).toBe(ob[0].rules[0].id);
  });

  it("indexes every rule it is handed, and does no filtering of its own", () => {
    // Deliberate division of labour: `getPlaybooks({ includeDeleted })` decides
    // which rules a caller sees, and the lookup names whatever arrives. A
    // retired rule's answers are real observations, so a statistics caller
    // passes it in and gets its name back rather than a uuid.
    const lookup = buildPlaybookLookup([
      { id: "pb", name: "Book", rules: [rule("r1", "Retired rule")] },
    ]);
    expect(lookup.rules.text.get("r1")).toBe("Retired rule");
  });

  it("carries show_when through to the lookup that scopes statistics", () => {
    const lookup = buildPlaybookLookup([
      {
        id: "pb",
        name: "Book",
        rules: [{ ...rule("r1", "Let it run"), show_when: "winner" }],
      },
    ]);
    expect(lookup.rules.showWhen.get("r1")).toBe("winner");
  });

  /**
   * The setup criterion is per playbook too, and the lookup already knew it.
   *
   * `criteriaByPlaybook` was keyed by book before this change and read a flag
   * that was global to the rule — so a rule grading the setup in one book
   * graded it in every book that linked it. The flag is on the link now, which
   * is what makes the per-book keying mean anything.
   */
  it("counts a rule as a criterion only in the playbook that says so", () => {
    const shared = rule("r-sweep", "Waited for the sweep");
    const lookup = buildPlaybookLookup([
      { id: "pb-swing", name: "Swing", rules: [{ ...shared, is_setup_criterion: true }] },
      { id: "pb-scalp", name: "Scalp", rules: [{ ...shared, is_setup_criterion: false }] },
    ]);

    expect(lookup.rules.criteriaByPlaybook.get("pb-swing")).toEqual(["r-sweep"]);
    expect(lookup.rules.criteriaByPlaybook.get("pb-scalp")).toBeUndefined();
  });
});

describe("rulesBySection", () => {
  const SECTIONS = [
    section("s-context", "Context", 0),
    section("s-entry", "Entry", 1),
    section("s-exit", "Exit", 2),
  ];

  it("orders the sections the way the trader put them in this book", () => {
    const out = rulesBySection(SECTIONS, [
      rule("a", "Exit at the draw", "s-exit"),
      rule("b", "Bias is clear", "s-context"),
      rule("c", "Waited for the sweep", "s-entry"),
    ]);
    expect(out.map((g) => g.section.label)).toEqual(["Context", "Entry", "Exit"]);
  });

  /**
   * The opposite of what `rulesByCategory` did, and deliberately so.
   *
   * It dropped empty sections, because the list was one per account: a book
   * using one heading would otherwise have drawn four cards over nothing, which
   * is exactly the "a new playbook gives me all the categories" complaint. A
   * section exists now only because someone created it IN THIS BOOK, so an
   * empty one is a prompt to write the rule that is missing.
   */
  it("KEEPS an empty section, because someone created it here on purpose", () => {
    const out = rulesBySection(SECTIONS, [rule("a", "Waited for the sweep", "s-entry")]);
    expect(out).toHaveLength(3);
    expect(out.find((g) => g.section.id === "s-entry")!.rules.map((r) => r.id)).toEqual([
      "a",
    ]);
    expect(out.find((g) => g.section.id === "s-exit")!.rules).toEqual([]);
  });

  it("is empty for a playbook with no sections at all", () => {
    // What a brand-new playbook looks like. Nothing is seeded into it.
    expect(rulesBySection([], [])).toEqual([]);
  });

  it("keeps every rule — no section silently swallows one", () => {
    const rules = SECTIONS.map((s, i) => rule(`r${i}`, `Rule ${i}`, s.id));
    const out = rulesBySection(SECTIONS, rules);
    expect(out.flatMap((g) => g.rules)).toHaveLength(rules.length);
  });

  /**
   * Unreachable through the UI — the link's FK cascades, so a rule cannot
   * outlive its section — and asserted anyway. Silently dropping a rule is the
   * wrong way to discover that the invariant broke.
   */
  it("surfaces a rule whose section is missing rather than dropping it", () => {
    const out = rulesBySection(SECTIONS, [rule("ghost", "Orphan", "s-gone")]);
    expect(out.flatMap((g) => g.rules).map((r) => r.id)).toContain("ghost");
  });
});
