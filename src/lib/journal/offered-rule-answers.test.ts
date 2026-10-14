import { describe, expect, it } from "vitest";
import { offeredRuleAnswers } from "./offered-rule-answers";
import type { Playbook } from "./playbook-types";

type Rule = Playbook["rules"][number];
const rule = (id: string, over: Partial<Rule> = {}): Rule =>
  ({ id, text: id, show_when: "always", deleted_at: null, ...over }) as Rule;

describe("offeredRuleAnswers", () => {
  it("answers every offered rule: ticked is true, untouched is false", () => {
    const book = { rules: [rule("a"), rule("b")] };
    expect(offeredRuleAnswers(book, { a: true }, "win")).toEqual({ a: true, b: false });
  });

  it("leaves out a rule that does not apply to the outcome", () => {
    const book = { rules: [rule("a"), rule("w", { show_when: "winner" })] };
    expect(offeredRuleAnswers(book, { w: true }, "loss")).toEqual({ a: false });
  });

  it("leaves a retired rule unanswered unless it already has an answer", () => {
    const book = { rules: [rule("old", { deleted_at: "2026-10-09" }), rule("kept", { deleted_at: "2026-10-09" })] };
    expect(offeredRuleAnswers(book, { kept: false }, "win")).toEqual({ kept: false });
  });

  it("is empty without a playbook", () => {
    expect(offeredRuleAnswers(null, { a: true }, "win")).toEqual({});
  });
});
