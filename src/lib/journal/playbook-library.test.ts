import { describe, expect, it } from "vitest";
import {
  RULE_CATEGORIES,
  RULE_CATEGORY_LABELS,
  rulesByCategory,
  type PlaybookRule,
  type RuleCategory,
} from "./playbook-types";
import { buildPlaybookLookup } from "./reports/playbook-dimensions";

function rule(
  id: string,
  text: string,
  category: RuleCategory = "entry",
): PlaybookRule {
  return {
    id,
    category,
    text,
    show_when: "always",
    sort_order: 0,
    deleted_at: null,
    answerCount: 0,
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
});

describe("rulesByCategory", () => {
  it("orders the sections the way a trade is thought through", () => {
    const out = rulesByCategory([
      rule("a", "Exit at the draw", "exit"),
      rule("b", "Bias is clear", "context"),
      rule("c", "Risk ≤ 1%", "management"),
      rule("d", "Waited for the sweep", "entry"),
      rule("e", "Outside my window", "no_trade"),
    ]);
    expect(out.map((g) => g.category)).toEqual([
      "context",
      "entry",
      "management",
      "exit",
      "no_trade",
    ]);
  });

  it("drops empty categories rather than drawing headings over nothing", () => {
    const out = rulesByCategory([rule("a", "Waited for the sweep", "entry")]);
    expect(out).toHaveLength(1);
    expect(out[0].rules.map((r) => r.id)).toEqual(["a"]);
  });

  it("is empty for a playbook with nothing linked", () => {
    expect(rulesByCategory([])).toEqual([]);
  });

  it("keeps every rule — no category silently swallows one", () => {
    const rules = RULE_CATEGORIES.map((c, i) => rule(`r${i}`, `Rule ${i}`, c));
    const out = rulesByCategory(rules);
    expect(out.flatMap((g) => g.rules)).toHaveLength(rules.length);
  });
});

describe("category labels", () => {
  it("names every category in the closed set", () => {
    // A missing label would render an empty heading rather than fail loudly.
    for (const c of RULE_CATEGORIES) {
      expect(RULE_CATEGORY_LABELS[c]).toBeTruthy();
    }
  });
});
