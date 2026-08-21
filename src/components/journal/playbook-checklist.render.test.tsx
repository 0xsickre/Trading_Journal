import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaybookChecklist } from "./playbook-checklist";
import type { Playbook, PlaybookRule } from "@/lib/journal/playbook-types";

/**
 * The checklist, driven directly rather than through `TradeForm`.
 *
 * Deliberate: the form mounts one `PlaybookChecklist` per tab, so a test that
 * went through it would find two "Check remaining" buttons and have to
 * disambiguate — noise that says nothing about this component.
 */

function rule(over: Partial<PlaybookRule> & { id: string }): PlaybookRule {
  return {
    category: "entry",
    text: over.id,
    show_when: "always",
  is_setup_criterion: false,
    sort_order: 0,
    deleted_at: null,
    answerCount: 0,
    ...over,
  };
}

function book(rules: PlaybookRule[]): Playbook {
  return {
    id: "pb1",
    name: "London Reversal",
    description: null,
    color: null,
    icon: null,
    is_active: true,
    sort_order: 0,
    default_risk_pct: null,
    a_plus_criteria: null,
    rules,
  };
}

/** The two painted fills, in DOM order: [followed, broken]. */
function fills(): HTMLElement[] {
  const track = document.querySelector('[aria-hidden="true"].bg-muted')!;
  return Array.from(track.children) as HTMLElement[];
}

function renderChecklist(
  rules: PlaybookRule[],
  answers: Record<string, boolean>,
  opts: { netPl?: number | null } = {},
) {
  const onAnswerChange = vi.fn<(ruleId: string, followed: boolean | null) => void>();
  render(
    <PlaybookChecklist
      playbooks={[book(rules)]}
      playbookId="pb1"
      onPlaybookChange={vi.fn()}
      conviction={null}
      onConvictionChange={vi.fn()}
      answers={answers}
      onAnswerChange={onAnswerChange}
      netPl={opts.netPl ?? 100}
    />,
  );
  return onAnswerChange;
}

describe("PlaybookChecklist — the bar says only what was answered", () => {
  it("paints followed and broken, and nothing at all for unanswered", () => {
    // 3 followed, 1 broken, 4 untouched → denominator 8.
    renderChecklist(
      Array.from({ length: 8 }, (_, i) => rule({ id: `r${i}` })),
      { r0: true, r1: true, r2: true, r3: false },
    );

    const [green, red] = fills();
    // Exactly two fills. A third would mean somebody started drawing the
    // unanswered share, which is the one thing this bar must never do.
    expect(fills()).toHaveLength(2);
    expect(green).toHaveStyle({ width: "37.5%" }); // 3/8
    expect(red).toHaveStyle({ width: "12.5%" }); // 1/8
    // 50 % of the track is left bare — that is the unanswered half, and it is
    // the absence of paint rather than a colour.
  });

  it("an untouched checklist is an empty track, not a red one", () => {
    renderChecklist([rule({ id: "a" }), rule({ id: "b" })], {});

    for (const fill of fills()) expect(fill).toHaveStyle({ width: "0%" });
    expect(
      screen.getByText(/unanswered does not count toward the statistics/),
    ).toBeInTheDocument();
  });

  it("states all three counts in words", () => {
    renderChecklist(
      [rule({ id: "a" }), rule({ id: "b" }), rule({ id: "c" })],
      { a: true, b: false },
    );
    expect(screen.getByText(/Followed 1 of 2 answered/)).toBeInTheDocument();
    expect(screen.getByText(/1 not answered/)).toBeInTheDocument();
  });
});

describe("PlaybookChecklist — check remaining", () => {
  it("fills the unanswered and never overwrites an explicit ✗", async () => {
    const user = userEvent.setup({ delay: null });
    const onAnswerChange = renderChecklist(
      [rule({ id: "kept" }), rule({ id: "broken" }), rule({ id: "blank" })],
      { kept: true, broken: false },
    );

    await user.click(screen.getByRole("button", { name: /Check remaining \(1\)/ }));

    expect(onAnswerChange).toHaveBeenCalledTimes(1);
    expect(onAnswerChange).toHaveBeenCalledWith("blank", true);
    // The load-bearing assertion: the rule answered "broken" is not touched.
    expect(onAnswerChange).not.toHaveBeenCalledWith("broken", expect.anything());
  });

  it("is absent when there is nothing left to fill", () => {
    renderChecklist([rule({ id: "a" }), rule({ id: "b" })], { a: true, b: false });
    expect(screen.queryByRole("button", { name: /Check remaining/ })).toBeNull();
  });

  it("ignores a rule the outcome hides, rather than answering it unseen", async () => {
    const user = userEvent.setup({ delay: null });
    const onAnswerChange = renderChecklist(
      [rule({ id: "always" }), rule({ id: "onlyWinners", show_when: "winner" })],
      {},
      { netPl: -250 },
    );

    expect(screen.queryByText("onlyWinners")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Check remaining \(1\)/ }));
    expect(onAnswerChange).toHaveBeenCalledWith("always", true);
    expect(onAnswerChange).not.toHaveBeenCalledWith("onlyWinners", expect.anything());
  });

  it("skips a retired rule, and leaves it out of the bar it could never fill", async () => {
    const user = userEvent.setup({ delay: null });
    // The edit form loads retired rules, so they really do reach this screen.
    const onAnswerChange = renderChecklist(
      [
        rule({ id: "live" }),
        rule({ id: "retired", deleted_at: "2026-08-01T00:00:00Z" }),
      ],
      {},
    );

    await user.click(screen.getByRole("button", { name: /Check remaining \(1\)/ }));
    expect(onAnswerChange).toHaveBeenCalledTimes(1);
    expect(onAnswerChange).toHaveBeenCalledWith("live", true);
    expect(onAnswerChange).not.toHaveBeenCalledWith("retired", expect.anything());
  });

  it("counts a retired rule once it HAS been answered", () => {
    // Excluded only while unanswered: an observation already recorded is a fact,
    // and dropping it from the denominator would overstate the followed share.
    renderChecklist(
      [
        rule({ id: "live" }),
        rule({ id: "retired", deleted_at: "2026-08-01T00:00:00Z" }),
      ],
      { live: true, retired: true },
    );
    const [green] = fills();
    expect(green).toHaveStyle({ width: "100%" });
  });
});
