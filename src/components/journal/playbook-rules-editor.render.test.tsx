import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaybookRulesEditor } from "./playbook-rules-editor";
import { buildPlaybookLookup, RULE_SAMPLE } from "@/lib/journal/reports/playbook-dimensions";
import { enrich, metricCtx, type TradeSpec } from "@/lib/journal/reports/test-helpers";
import type {
  LinkedRule,
  Playbook,
  PlaybookSection,
  PositionRule,
} from "@/lib/journal/playbook-types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const actions = vi.hoisted(() => ({
  movePlaybookRule: vi.fn(async () => ({ ok: true as const })),
  reorderPlaybookRules: vi.fn(async () => ({ ok: true as const })),
  reorderPlaybookSections: vi.fn(async () => ({ ok: true as const })),
  updatePlaybookRule: vi.fn(async () => ({ ok: true as const })),
  updatePlaybook: vi.fn(async () => ({ ok: true as const })),
  updatePlaybookSection: vi.fn(async () => ({ ok: true as const })),
  addPlaybookRule: vi.fn(async () => ({ ok: true as const })),
  addPlaybookSection: vi.fn(async () => ({ ok: true as const, id: "x" })),
  deletePlaybookRule: vi.fn(async () => ({ ok: true as const })),
  restorePlaybookRule: vi.fn(async () => ({ ok: true as const })),
  linkRule: vi.fn(async () => ({ ok: true as const })),
  unlinkRule: vi.fn(async () => ({ ok: true as const })),
  movePlaybookSection: vi.fn(async () => ({ ok: true as const })),
  deletePlaybookSection: vi.fn(async () => ({ ok: true as const })),
  moveRuleToSection: vi.fn(async () => ({ ok: true as const })),
  setRuleCriterion: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("@/app/(app)/settings/playbook-actions", () => actions);

beforeEach(() => vi.clearAllMocks());

/**
 * Real `ruleScorecard` output, rendered — the same "paper → lib → screen" bridge
 * `report-table.render.test.tsx` uses. The numbers below are never hand-written
 * into the fixture; they are whatever the library computes from these trades.
 */

function rule(over: Partial<LinkedRule> & { id: string }): LinkedRule {
  return {
    text: over.id,
    show_when: "always",
    sort_order: 0,
    deleted_at: null,
    answerCount: 0,
    link_id: `link-${over.id}`,
    section_id: "sec-entry",
    is_setup_criterion: false,
    link_sort: 0,
    ...over,
  };
}

function book(rules: LinkedRule[], sections: PlaybookSection[]): Playbook {
  return {
    id: "pb",
    name: "London Reversal",
    description: null,
    color: null,
    icon: null,
    is_active: true,
    sort_order: 0,
    default_risk_pct: 1,
    a_plus_criteria: null,
    sections,
    rules,
  };
}

/** `n` trades answering `ruleId` the same way, `wins` of them winners. */
function answers(
  prefix: string,
  ruleId: string,
  n: number,
  wins: number,
  followed: boolean,
) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    net: i < wins ? 100 : -100,
    ruleId,
    followed,
  }));
}

/**
 * The sections THIS BOOK has.
 *
 * Two, not the old five, and they belong to the playbook rather than to the
 * account: that is the change these tests are about. A book shows the headings
 * its own owner wrote in it, and nothing else.
 */
const SECTIONS: PlaybookSection[] = [
  { id: "sec-entry", label: "Entry", description: null, sort_order: 0 },
  { id: "sec-exit", label: "Exit", description: null, sort_order: 1 },
];

function renderEditor(
  rules: LinkedRule[],
  rows: { id: string; net: number; ruleId: string; followed: boolean }[],
  bookOverrides: Partial<Playbook> = {},
  sectionOverrides?: PlaybookSection[],
) {
  const byTrade = new Map<string, PositionRule[]>();
  for (const r of rows) {
    const list = byTrade.get(r.id) ?? [];
    list.push({ position_id: r.id, rule_id: r.ruleId, followed: r.followed });
    byTrade.set(r.id, list);
  }
  const b = { ...book(rules, sectionOverrides ?? SECTIONS), ...bookOverrides };
  const lookup = buildPlaybookLookup([{ id: b.id, name: b.name, rules }], byTrade);
  const trades = enrich(
    rows.map((r): TradeSpec => ({ id: r.id, net: r.net, r: r.net / 100 })),
  );

  render(
    <PlaybookRulesEditor
      book={b}
      library={[]}
      trades={trades}
      lookup={lookup}
      computeCtx={{ ...metricCtx, rules: lookup.rules }}
    />,
  );
  return b;
}

/** The row a rule's text sits in. */
const rowOf = (text: string) =>
  screen.getByText(text).closest("[data-rule-row]") as HTMLElement;

/** Open a row's ⋮ menu and return the menu element. */
async function openRuleMenu(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(
    within(rowOf(text)).getByRole("button", { name: "Rule actions" }),
  );
  return screen.getByRole("menu");
}

describe("PlaybookRulesEditor — the rule and its evidence share a row", () => {
  it("puts a rule's numbers in the SAME row as the rule itself", () => {
    // This single assertion is the whole point of the layout. If anyone ever
    // splits statistics back out into a separate block, it fails.
    const M = RULE_SAMPLE.MIN;
    renderEditor(
      [rule({ id: "r1", text: "Waited for the sweep" })],
      [
        ...answers("f", "r1", M, Math.round(M * 0.7), true), // 70 %
        ...answers("b", "r1", M, Math.round(M * 0.4), false), // 40 %
      ],
    );

    const row = rowOf("Waited for the sweep");
    expect(within(row).getByText(String(M * 2))).toBeInTheDocument(); // n
    expect(within(row).getByText("70%")).toBeInTheDocument();
    expect(within(row).getByText("40%")).toBeInTheDocument();
    expect(within(row).getByText("+30 pp")).toBeInTheDocument();
  });

  it("colours the difference from the shared pnl helper, not a local palette", () => {
    const M = RULE_SAMPLE.MIN;
    renderEditor(
      [rule({ id: "r1", text: "Waited for the sweep" })],
      [
        ...answers("f", "r1", M, M, true),
        ...answers("b", "r1", M, 0, false),
      ],
    );
    const cell = within(rowOf("Waited for the sweep")).getByText("+100 pp");
    expect(cell.className).toContain("var(--profit)");
  });

  it("reads without a horizontal scroller — no min-width forcing one", () => {
    // The seven-column table this replaced carried `min-w-[68rem]`, which is
    // what pushed `When` permanently off the right edge. The controls that
    // needed those columns are in the row menu now, so nothing here may
    // reintroduce a minimum wider than the content area.
    renderEditor([rule({ id: "r1", text: "Waited for the sweep" })], []);
    const row = rowOf("Waited for the sweep");
    expect(row.className).not.toMatch(/min-w-\[\d+rem\]/);
  });
});

describe("PlaybookRulesEditor — expectancy under the win rate", () => {
  it("shows R for each side under its win rate, not as a separate column", () => {
    const M = RULE_SAMPLE.MIN;
    renderEditor(
      [rule({ id: "r1", text: "Waited for the sweep" })],
      [
        // net=100 → r=1 per `enrich`'s r:net/100, so a side of all-winners
        // reads +1.00R and a side of all-losers reads -1.00R.
        ...answers("f", "r1", M, M, true),
        ...answers("b", "r1", M, 0, false),
      ],
    );

    const row = rowOf("Waited for the sweep");
    expect(within(row).getByText("+1.00R")).toBeInTheDocument();
    expect(within(row).getByText("-1.00R")).toBeInTheDocument();
  });

  it("omits R (not a stray dash) when a side is too thin to trust", () => {
    renderEditor(
      [rule({ id: "r1", text: "Waited for the sweep" })],
      answers("f", "r1", 1, 1, true),
    );

    const row = rowOf("Waited for the sweep");
    // A single-observation side shows its count, not a win rate or an R line —
    // and with no broken side at all, the row has no R text anywhere. Asserted
    // through the title, which is unambiguous: the bare "1" also appears in the
    // Trades column.
    expect(
      within(row).getByTitle(`Answered 1 time — under ${RULE_SAMPLE.MIN}, too few for a win rate`),
    ).toBeInTheDocument();
    expect(within(row).queryByText(/R$/)).toBeNull();
  });
});

describe("PlaybookRulesEditor — what it refuses to claim", () => {
  it("says `too few` when one side is thin, even though the total is not", () => {
    // The bug real data exposed: both sides under the floor, total over it. The
    // sides show counts rather than percentages, so the difference must not
    // appear either.
    renderEditor(
      [rule({ id: "r1", text: "Waited for the sweep" })],
      [
        ...answers("f", "r1", 14, 14, true),
        ...answers("b", "r1", 18, 0, false),
      ],
    );

    const row = rowOf("Waited for the sweep");
    expect(
      within(row).getByTitle(`Answered 14 times — under ${RULE_SAMPLE.MIN}, too few for a win rate`),
    ).toBeInTheDocument();
    expect(
      within(row).getByTitle(`Answered 18 times — under ${RULE_SAMPLE.MIN}, too few for a win rate`),
    ).toBeInTheDocument();
    // The count named is the THINNER side (14, not 18) — that's the one
    // actually holding the comparison back.
    expect(within(row).getByText(`too few (14/${RULE_SAMPLE.MIN})`)).toBeInTheDocument();
    expect(within(row).queryByText(/pp$/)).toBeNull();
  });

  it("shows a dash — not `0 pp`, not `too few` — for a rule never broken", () => {
    // An honest absence is different from a missing measurement, and the cell
    // has to tell them apart.
    renderEditor(
      [rule({ id: "r1", text: "Waited for the sweep" })],
      answers("f", "r1", RULE_SAMPLE.MIN, 20, true),
    );

    const row = rowOf("Waited for the sweep");
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(row).queryByText("too few")).toBeNull();
    expect(within(row).queryByText(/pp$/)).toBeNull();
  });
});

describe("PlaybookRulesEditor — the row menu holds what the columns used to", () => {
  it("locks `when it shows` once the rule has been answered", async () => {
    const user = userEvent.setup();
    renderEditor(
      [rule({ id: "r1", text: "Waited for the sweep", answerCount: 4 })],
      [],
    );

    const menu = await openRuleMenu(user, "Waited for the sweep");
    const trigger = within(menu).getByRole("menuitem", { name: "When it shows" });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveAttribute("title", expect.stringContaining("4 trades"));
  });

  it("shows the answered count on the row itself, so the lock is visible unopened", () => {
    // The badge is what explains a disabled menu item before you open the menu.
    renderEditor(
      [rule({ id: "r1", text: "Waited for the sweep", answerCount: 4 })],
      [],
    );
    expect(within(rowOf("Waited for the sweep")).getByText("4")).toBeInTheDocument();
  });

  it("opens the rule for editing on a click, without touching the server", async () => {
    const user = userEvent.setup();
    renderEditor([rule({ id: "r1", text: "Waited for the sweep" })], []);

    await user.click(screen.getByText("Waited for the sweep"));
    expect(screen.getByLabelText("Rule text")).toHaveValue("Waited for the sweep");
    // Opening an editor is not a change. A save here would bump `updated_at` on
    // every rule anyone merely looked at.
    expect(actions.updatePlaybookRule).not.toHaveBeenCalled();
  });

  it("saves an edited rule on blur, and only when the text actually changed", async () => {
    const user = userEvent.setup();
    renderEditor([rule({ id: "r1", text: "Waited for the sweep" })], []);

    await user.click(screen.getByText("Waited for the sweep"));
    const input = screen.getByLabelText("Rule text");
    await user.clear(input);
    await user.type(input, "Waited for the sweep, then MSS");
    await user.tab();

    expect(actions.updatePlaybookRule).toHaveBeenCalledWith("r1", {
      text: "Waited for the sweep, then MSS",
    });
  });

  it("discards an edit on Escape", async () => {
    const user = userEvent.setup();
    renderEditor([rule({ id: "r1", text: "Waited for the sweep" })], []);

    await user.click(screen.getByText("Waited for the sweep"));
    await user.type(screen.getByLabelText("Rule text"), " and more{Escape}");

    expect(actions.updatePlaybookRule).not.toHaveBeenCalled();
    expect(screen.getByText("Waited for the sweep")).toBeInTheDocument();
  });
});

describe("PlaybookRulesEditor — the grade switch is on the row", () => {
  it("toggles straight from the row, without opening a menu", async () => {
    const user = userEvent.setup();
    renderEditor([rule({ id: "r1", text: "Waited for the sweep" })], []);

    await user.click(
      screen.getByRole("button", { name: "Counts toward the setup grade" }),
    );

    // The playbook is named, because the flag is per book: the same rule can
    // grade the setup here and be plain process in another playbook.
    expect(actions.setRuleCriterion).toHaveBeenCalledWith("pb", "r1", true);
  });

  it("reports its state through aria-pressed, not only through colour", () => {
    // The state has to survive a reader who cannot see green.
    renderEditor(
      [
        rule({ id: "r1", text: "Counted", is_setup_criterion: true }),
        rule({ id: "r2", text: "Not counted", is_setup_criterion: false }),
      ],
      [],
    );

    expect(
      within(rowOf("Counted")).getByRole("button", {
        name: "Counts toward the setup grade",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(rowOf("Not counted")).getByRole("button", {
        name: "Counts toward the setup grade",
      }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("refuses to grade a rule that does not show on every trade", () => {
    // A criterion asked only of winners would judge the setup already knowing
    // the outcome — the database refuses it, so the switch must not offer it.
    renderEditor(
      [rule({ id: "r1", text: "Let the winner run", show_when: "winner" })],
      [],
    );

    const toggle = within(rowOf("Let the winner run")).getByRole("button", {
      name: "Counts toward the setup grade",
    });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("title", expect.stringContaining("hindsight"));
  });
});

describe("PlaybookRulesEditor — reordering is scoped to the section", () => {
  const RULES = [
    rule({ id: "e1", text: "Waited for the sweep", section_id: "sec-entry" }),
    rule({ id: "e2", text: "Entry confirmed on M5", section_id: "sec-entry" }),
    rule({ id: "x1", text: "Out at the opposing level", section_id: "sec-exit" }),
  ];

  it("keeps Move up / Move down as the keyboard path, clamped per section", async () => {
    // Dragging cannot be done from a keyboard, so the menu must still offer the
    // equivalent — and clamp at the bounds of the rule's OWN section.
    const user = userEvent.setup();
    renderEditor(RULES, []);

    const first = await openRuleMenu(user, "Waited for the sweep");
    expect(within(first).getByRole("menuitem", { name: "Move up" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      within(first).getByRole("menuitem", { name: "Move down" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("sends the playbook, the rule and the direction to the action", async () => {
    const user = userEvent.setup();
    const b = renderEditor(RULES, []);

    const menu = await openRuleMenu(user, "Waited for the sweep");
    await user.click(within(menu).getByRole("menuitem", { name: "Move down" }));

    expect(actions.movePlaybookRule).toHaveBeenCalledWith(b.id, "e1", 1);
  });

  it("gives every rule a drag handle, and the section its own", () => {
    // The pointer path the arrows are the fallback for.
    renderEditor(RULES, []);
    expect(screen.getAllByTitle("Drag to reorder").length).toBe(
      // one per rule, plus one per section
      RULES.length + SECTIONS.length,
    );
  });
});

describe("PlaybookRulesEditor — the line under a heading is the trader's", () => {
  it("shows the section's own description", () => {
    renderEditor([rule({ id: "r1", text: "Waited for the sweep" })], [], {}, [
      { ...SECTIONS[0], description: "Only what I can see on the daily." },
      SECTIONS[1],
    ]);

    expect(screen.getByText("Only what I can see on the daily.")).toBeInTheDocument();
  });

  it("shows no line at all when the trader wrote none", () => {
    // There is no built-in text left to fall back to, and that is the point: a
    // sentence explaining what "Risk" means to the person who just typed "Risk"
    // is this journal lecturing them about their own method. The old constant
    // was keyed by the five values this repo used to seed, so an invented
    // section got nothing and a renamed one kept a sentence for a word its
    // owner no longer used.
    renderEditor([rule({ id: "r1", text: "Sized to 1R", section_id: "sec-risk" })], [], {}, [
      { id: "sec-risk", label: "Risk", description: null, sort_order: 0 },
    ]);

    const heading = screen.getByText("Risk");
    expect(heading).toBeInTheDocument();
    // The heading is alone in its row: nothing but the grip and the ⋮ beside it.
    expect(heading.parentElement!.textContent).toBe("Risk");
  });
});

describe("PlaybookRulesEditor — sections belong to THIS playbook", () => {
  /**
   * The complaint this whole change answers.
   *
   * The section list used to be one per ACCOUNT, so every playbook drew every
   * heading whether or not it used it — "a new playbook gives me all the
   * categories again". A book now shows its own sections and no others.
   */
  it("draws only the sections this book has", () => {
    renderEditor([rule({ id: "r1", text: "Waited for the sweep" })], [], {}, [
      SECTIONS[0],
    ]);

    expect(screen.getByText("Entry")).toBeInTheDocument();
    expect(screen.queryByText("Exit")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Section actions" })).toHaveLength(1);
  });

  it("KEEPS an empty section, because someone created it here", () => {
    // The opposite of the old behaviour, and correct for the same reason: an
    // empty heading used to be somebody else's, and is now the trader's own
    // prompt to write the rule that is missing.
    renderEditor([rule({ id: "r1", text: "Waited for the sweep" })], []);

    expect(screen.getByText("Exit")).toBeInTheDocument();
    expect(screen.getByText("No rules here yet.")).toBeInTheDocument();
  });

  it("asks before deleting a section, and says what leaves the playbook", async () => {
    // Never refused any more. The old action counted every rule in the ACCOUNT
    // under that heading — including ones in other playbooks, invisible from
    // this card — and used the number to refuse.
    const user = userEvent.setup();
    renderEditor([rule({ id: "r1", text: "Waited for the sweep" })], []);

    await user.click(screen.getAllByRole("button", { name: "Section actions" })[0]);
    await user.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Delete section" }),
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(/stay in your library/);
    await user.click(screen.getByRole("button", { name: "Delete section" }));
    expect(actions.deletePlaybookSection).toHaveBeenCalledWith("sec-entry");
  });

  it("moves a rule into another section of this book only", async () => {
    const user = userEvent.setup();
    renderEditor([rule({ id: "r1", text: "Waited for the sweep" })], []);

    const menu = await openRuleMenu(user, "Waited for the sweep");
    // Hovered, not clicked: a Radix submenu opens on pointer-enter, and a click
    // on the trigger alone leaves it closed in jsdom.
    await user.hover(within(menu).getByRole("menuitem", { name: "Move to section" }));
    // `fireEvent`, not `user.click`: Radix selects a radio item from the
    // pointerup it captures on the submenu, and userEvent's synthetic sequence
    // does not reach it through the portal in jsdom. Same reason the drag tests
    // in this repo use `fireEvent`.
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Exit" }));

    await vi.waitFor(() =>
      expect(actions.moveRuleToSection).toHaveBeenCalledWith("pb", "r1", "sec-exit"),
    );
  });

  it("starts a book with no sections at all and says so", () => {
    // What a brand-new playbook is: an empty page, not a form to fill.
    renderEditor([], [], {}, []);

    expect(screen.getByText(/this playbook starts empty/)).toBeInTheDocument();
    // The way out is on the screen, not in Settings.
    expect(
      screen.getByRole("button", { name: /Add rule group/ }),
    ).toBeInTheDocument();
  });
});
