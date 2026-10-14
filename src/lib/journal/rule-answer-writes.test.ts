import { describe, expect, it } from "vitest";
import { ruleAnswerWrites } from "./rule-answer-writes";

const book = new Set(["r1", "r2", "r3"]);

describe("ruleAnswerWrites", () => {
  it("writes every answer the page sent for a rule of the chosen playbook", () => {
    const w = ruleAnswerWrites({
      bookRuleIds: book,
      sent: { r1: true, r2: false },
      previous: [],
      playbookChanged: false,
    });
    expect(w.upsert).toEqual([
      { rule_id: "r1", followed: true },
      { rule_id: "r2", followed: false },
    ]);
    expect(w.remove).toEqual([]);
  });

  it("drops an answer for a rule the playbook does not link", () => {
    const w = ruleAnswerWrites({
      bookRuleIds: book,
      sent: { r1: true, stranger: true },
      previous: [],
      playbookChanged: false,
    });
    expect(w.upsert).toEqual([{ rule_id: "r1", followed: true }]);
  });

  it("removes an answer the page no longer offers (outcome-scoped rule)", () => {
    const w = ruleAnswerWrites({
      bookRuleIds: book,
      sent: { r1: true },
      previous: ["r1", "r3"],
      playbookChanged: false,
    });
    expect(w.remove).toEqual(["r3"]);
  });

  it("keeps answers to rules outside the playbook when the playbook did not change (#1: retired rules)", () => {
    const retired = ["old1", "old2", "old3"];
    const w = ruleAnswerWrites({
      bookRuleIds: book,
      sent: { r1: true, r2: true, r3: false },
      previous: retired,
      playbookChanged: false,
    });
    expect(w.remove).toEqual([]);
    expect(w.upsert).toHaveLength(3);
  });

  it("removes the previous playbook's answers when the playbook changed (P-3)", () => {
    const w = ruleAnswerWrites({
      bookRuleIds: book,
      sent: { r1: true },
      previous: ["old1", "r1"],
      playbookChanged: true,
    });
    expect(w.remove).toEqual(["old1"]);
    expect(w.upsert).toEqual([{ rule_id: "r1", followed: true }]);
  });

  it("removes every answer when the playbook was cleared", () => {
    const w = ruleAnswerWrites({
      bookRuleIds: new Set(),
      sent: {},
      previous: ["r1", "old1"],
      playbookChanged: true,
    });
    expect(w.upsert).toEqual([]);
    expect(w.remove).toEqual(["r1", "old1"]);
  });
});
