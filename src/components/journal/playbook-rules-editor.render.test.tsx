import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaybookRulesEditor } from "./playbook-rules-editor";
import { buildPlaybookLookup, RULE_SAMPLE } from "@/lib/journal/reports/playbook-dimensions";
import { enrich, metricCtx, type TradeSpec } from "@/lib/journal/reports/test-helpers";
import type { PositionRule, Playbook, PlaybookRule } from "@/lib/journal/playbook-types";
import type { OptionItem } from "@/lib/journal/types";

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
  addPlaybookSection: vi.fn(async () => ({ ok: true as const, value: "x", id: "x" })),
  deletePlaybookRule: vi.fn(async () => ({ ok: true as const })),
  restorePlaybookRule: vi.fn(async () => ({ ok: true as const })),
  linkRule: vi.fn(async () => ({ ok: true as const })),
  unlinkRule: vi.fn(async () => ({ ok: true as const })),
  movePlaybookSection: vi.fn(async () => ({ ok: true as const })),
  deletePlaybookSection: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("@/app/(app)/settings/playbook-actions", () => actions);

beforeEach(() => vi.clearAllMocks());

/**
 * Real `ruleScorecard` output, rendered — the same "paper → lib → screen" bridge
 * `report-table.render.test.tsx` uses. The numbers below are never hand-written
 * into the fixture; they are whatever the library computes from these trades.
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
    id: "pb",
    name: "London Reversal",
    description: null,
    color: null,
    icon: null,
    is_active: true,
    sort_order: 0,
    default_risk_pct: 1,
    a_plus_criteria: null,
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
 * The sections the trader has, as the option list gives them.
 *
 * Two, not the old five: the point of making them configurable is that a book
 * shows the headings its owner wrote, so the fixture exercises a shorter list
 * than the seeded default. Both use a SEEDED value (`entry`, `exit`) with a null
 * description, which is the combination the built-in hint fallback is for.
 */
const CATEGORIES: OptionItem[] = [
  {
    id: "oc1",
    value: "entry",
    label: "Entry",
    color: null,
    description: null,
    is_active: true,
    sort_order: 0,
  },
  {
    id: "oc2",
    value: "exit",
    label: "Exit",
    color: null,
    description: null,
    is_active: true,
    sort_order: 1,
  },
];

function renderEditor(
  rules: PlaybookRule[],
  rows: { id: string; net: number; ruleId: string; followed: boolean }[],
  bookOverrides: Partial<Playbook> = {},
  categoryOverrides?: OptionItem[],
) {
  const byTrade = new Map<string, PositionRule[]>();
  for (const r of rows) {
    const list = byTrade.get(r.id) ?? [];
    list.push({ position_id: r.id, rule_id: r.ruleId, followed: r.followed });
    byTrade.set(r.id, list);
  }
  const b = { ...book(rules), ...bookOverrides };
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
      categories={categoryOverrides ?? CATEGORIES}
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
    // and with no broken side at all, the row has no R text anywhere.
    expect(within(row).getByText("n=1")).toBeInTheDocument();
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
    expect(within(row).getByText("n=14")).toBeInTheDocument();
    expect(within(row).getByText("n=18")).toBeInTheDocument();
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

describe("PlaybookRulesEditor — reordering is scoped to the category", () => {
  const RULES = [
    rule({ id: "e1", text: "Waited for the sweep", category: "entry" }),
    rule({ id: "e2", text: "Entry confirmed on M5", category: "entry" }),
    rule({ id: "x1", text: "Out at the opposing level", category: "exit" }),
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
      // one per rule, plus one per listed section
      RULES.length + CATEGORIES.length,
    );
  });
});

describe("PlaybookRulesEditor — the line under a heading is the trader's", () => {
  it("falls back to the built-in hint for a seeded section nobody has edited", () => {
    renderEditor([rule({ id: "r1", text: "Waited for the sweep" })], []);
    expect(
      screen.getByText("What has to be true at the moment you take it."),
    ).toBeInTheDocument();
  });

  it("prefers the section's own description over the built-in text", () => {
    // The complaint this fixed: renaming "Context" to "Bias" left a sentence
    // written for a word the trader no longer uses, with no way to change it.
    renderEditor([rule({ id: "r1", text: "Waited for the sweep" })], [], {}, [
      { ...CATEGORIES[0], description: "Only what I can see on the daily." },
      CATEGORIES[1],
    ]);

    expect(screen.getByText("Only what I can see on the daily.")).toBeInTheDocument();
    expect(
      screen.queryByText("What has to be true at the moment you take it."),
    ).toBeNull();
  });

  it("shows no line at all for a section the trader invented and left blank", () => {
    // A sentence explaining what "Risk" means to the person who just typed
    // "Risk" is this journal lecturing them about their own method.
    renderEditor([rule({ id: "r1", text: "Sized to 1R", category: "risk" })], [], {}, [
      {
        id: "oc9",
        value: "risk",
        label: "Risk",
        color: null,
        description: null,
        is_active: true,
        sort_order: 0,
      },
    ]);

    expect(screen.getByText("Risk")).toBeInTheDocument();
    expect(screen.queryByText(/What has to be true/)).toBeNull();
  });
});

describe("PlaybookRulesEditor — sections the trader owns", () => {
  it("still draws a section that left the list while it holds rules", () => {
    // Data loss by presentation is the failure mode here: the heading is gone
    // from the list, the rules are not, and hiding them to tidy the table would
    // make them unreachable. Drawn — but with no controls, since there is no
    // row left to rename, move or delete.
    renderEditor(
      [
        rule({ id: "r1", text: "Waited for the sweep", category: "entry" }),
        rule({ id: "r2", text: "Trailed behind structure", category: "management" }),
      ],
      [],
    );

    expect(screen.getByText("Trailed behind structure")).toBeInTheDocument();
    expect(screen.getByText("Management")).toBeInTheDocument();
    // Two sections on the list, two sets of controls — the orphan gets none.
    expect(screen.getAllByRole("button", { name: "Section actions" })).toHaveLength(2);
  });

  it("deletes a section from its own menu", async () => {
    const user = userEvent.setup();
    renderEditor([rule({ id: "r1", text: "Waited for the sweep" })], []);

    await user.click(screen.getAllByRole("button", { name: "Section actions" })[0]);
    await user.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Delete section" }),
    );

    expect(actions.deletePlaybookSection).toHaveBeenCalledWith("oc1");
  });

  it("starts a book with no sections at all and says so", () => {
    renderEditor([], [], {}, []);

    expect(screen.getByText(/No groups yet/)).toBeInTheDocument();
    // The way out is on the screen, not in Settings.
    expect(
      screen.getByRole("button", { name: /Add rule group/ }),
    ).toBeInTheDocument();
  });
});
