import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaybookChecklist } from "./playbook-checklist";
import type { Playbook, PlaybookRule } from "@/lib/journal/playbook-types";

/**
 * The checklist, driven directly rather than through `TradeForm`.
 *
 * Deliberate: the form mounts one `PlaybookChecklist` per tab, so a test that
 * went through it would find two "Check all" buttons and have to disambiguate —
 * noise that says nothing about this component.
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
      answers={answers}
      onAnswerChange={onAnswerChange}
      netPl={opts.netPl ?? 100}
    />,
  );
  return onAnswerChange;
}

describe("PlaybookChecklist — one tick is the whole answer", () => {
  it("measures adherence against EVERY rule that applied, not just the ticked ones", () => {
    // The bug this replaced: with one box ticked and seven untouched, the old
    // followed-over-answered ratio read 100 %. One of eight kept is 13 %.
    renderChecklist(
      Array.from({ length: 8 }, (_, i) => rule({ id: `r${i}` })),
      { r0: true },
    );

    expect(screen.getByText("13%")).toBeInTheDocument();
    expect(screen.getByTitle("1 of 8 rules followed")).toBeInTheDocument();
  });

  it("paints the unticked share red instead of leaving it bare", () => {
    // There is no third quantity any more, so the two fills cover the track.
    renderChecklist(
      Array.from({ length: 8 }, (_, i) => rule({ id: `r${i}` })),
      { r0: true, r1: true, r2: true },
    );

    const [green, red] = fills();
    expect(green).toHaveStyle({ width: "37.5%" }); // 3/8 kept
    expect(red).toHaveStyle({ width: "62.5%" }); // 5/8 not kept
  });

  it("reads 0 % on an untouched checklist, because nothing was kept", () => {
    renderChecklist([rule({ id: "a" }), rule({ id: "b" })], {});
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText(/Followed 0 of 2/)).toBeInTheDocument();
  });

  it("states both counts in words", () => {
    renderChecklist(
      [rule({ id: "a" }), rule({ id: "b" }), rule({ id: "c" })],
      { a: true },
    );
    expect(screen.getByText(/Followed 1 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/2 not followed/)).toBeInTheDocument();
  });

  it("offers one checkbox per rule — no third state to reach for", async () => {
    const user = userEvent.setup({ delay: null });
    const onAnswerChange = renderChecklist([rule({ id: "a", text: "Waited" })], {});

    const box = screen.getByRole("checkbox");
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(onAnswerChange).toHaveBeenCalledWith("a", true);
  });

  it("unticking answers `not followed` rather than clearing the answer", async () => {
    // A boolean, never null: with one box per rule, unticking IS an answer.
    const user = userEvent.setup({ delay: null });
    const onAnswerChange = renderChecklist([rule({ id: "a", text: "Waited" })], {
      a: true,
    });

    await user.click(screen.getByRole("checkbox"));
    expect(onAnswerChange).toHaveBeenCalledWith("a", false);
  });
});

describe("PlaybookChecklist — check all", () => {
  it("ticks everything that is not ticked yet", async () => {
    const user = userEvent.setup({ delay: null });
    const onAnswerChange = renderChecklist(
      [rule({ id: "kept" }), rule({ id: "notKept" }), rule({ id: "blank" })],
      { kept: true, notKept: false },
    );

    await user.click(screen.getByRole("button", { name: /Check all \(2\)/ }));

    expect(onAnswerChange).toHaveBeenCalledWith("notKept", true);
    expect(onAnswerChange).toHaveBeenCalledWith("blank", true);
    // The one already ticked is left alone — nothing to do to it.
    expect(onAnswerChange).not.toHaveBeenCalledWith("kept", expect.anything());
  });

  it("is absent when everything is already ticked", () => {
    renderChecklist([rule({ id: "a" }), rule({ id: "b" })], { a: true, b: true });
    expect(screen.queryByRole("button", { name: /Check all/ })).toBeNull();
  });

  it("ignores a rule the outcome hides, rather than answering it unseen", async () => {
    // A winner-only rule ticked on a losing trade is an observation from a
    // population it was never asked about.
    const user = userEvent.setup({ delay: null });
    const onAnswerChange = renderChecklist(
      [rule({ id: "always" }), rule({ id: "onlyWinners", show_when: "winner" })],
      {},
      { netPl: -250 },
    );

    expect(screen.queryByText("onlyWinners")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Check all \(1\)/ }));
    expect(onAnswerChange).toHaveBeenCalledWith("always", true);
    expect(onAnswerChange).not.toHaveBeenCalledWith("onlyWinners", expect.anything());
  });
});

describe("PlaybookChecklist — a retired rule is not judged", () => {
  it("leaves an unanswered retired rule out of the denominator entirely", () => {
    // The edit form loads retired rules, so they really do reach this screen.
    // Counting one as "not kept" would mint a fresh observation for a rule
    // retired precisely to stop collecting them.
    renderChecklist(
      [
        rule({ id: "live" }),
        rule({ id: "retired", deleted_at: "2026-08-01T00:00:00Z" }),
      ],
      { live: true },
    );

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText(/Followed 1 of 1/)).toBeInTheDocument();
  });

  it("never sweeps a retired rule into an answer", async () => {
    const user = userEvent.setup({ delay: null });
    const onAnswerChange = renderChecklist(
      [
        rule({ id: "live" }),
        rule({ id: "retired", deleted_at: "2026-08-01T00:00:00Z" }),
      ],
      {},
    );

    await user.click(screen.getByRole("button", { name: /Check all \(1\)/ }));
    expect(onAnswerChange).toHaveBeenCalledTimes(1);
    expect(onAnswerChange).toHaveBeenCalledWith("live", true);
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

describe("PlaybookChecklist — the setup grade", () => {
  it("grades on the criteria alone", () => {
    renderChecklist(
      [
        rule({ id: "c1", is_setup_criterion: true }),
        rule({ id: "c2", is_setup_criterion: true }),
        rule({ id: "plain" }),
      ],
      { c1: true, c2: true },
    );

    // The third rule is process, not setup quality, and must not move the grade.
    expect(screen.getByTitle("2 of 2 setup criteria met")).toBeInTheDocument();
  });

  it("needs no `all answered` gate — every box always has an answer now", () => {
    renderChecklist(
      [
        rule({ id: "c1", is_setup_criterion: true }),
        rule({ id: "c2", is_setup_criterion: true }),
      ],
      { c1: true },
    );

    // Half the criteria met, and the grade says so instead of holding out for
    // answers that can no longer be missing.
    expect(screen.getByTitle("1 of 2 setup criteria met")).toBeInTheDocument();
  });
});
