import { describe, expect, it } from "vitest";
import { offeredRuleAnswers } from "./offered-rule-answers";
import type { Playbook } from "./playbook-types";

type Rule = Playbook["rules"][number];
const rule = (id: string, over: Partial<Rule> = {}): Rule =>
  ({ id, text: id, show_when: "always", deleted_at: null, is_setup_criterion: true, ...over }) as Rule;

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

  it("offers only the setup criteria — „Zašto ulazim“ (phase B1)", () => {
    const book = { rules: [rule("why"), rule("where", { is_setup_criterion: false })] };
    expect(offeredRuleAnswers(book, {}, "win")).toEqual({ why: false });
  });

  it("keeps an old answer to a rule no longer asked, as it was", () => {
    // The save replaces every answer of the trade, so dropping it would delete history.
    const book = { rules: [rule("why"), rule("exit", { is_setup_criterion: false })] };
    expect(offeredRuleAnswers(book, { why: true, exit: false }, "loss")).toEqual({ why: true, exit: false });
    expect(offeredRuleAnswers(book, { exit: true }, null)).toEqual({ why: false, exit: true });
  });

  it("is empty without a playbook", () => {
    expect(offeredRuleAnswers(null, { a: true }, "win")).toEqual({});
  });
});
