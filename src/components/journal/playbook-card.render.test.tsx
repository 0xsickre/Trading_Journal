import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaybookCard } from "./playbook-card";
import { buildPlaybookLookup, RULE_SAMPLE } from "@/lib/journal/reports/playbook-dimensions";
import { enrich, metricCtx, type TradeSpec } from "@/lib/journal/reports/test-helpers";
import type { PositionRule, Playbook, PlaybookRule } from "@/lib/journal/playbook-types";
import type { ReportRow } from "@/lib/journal/reports/engine";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const actions = vi.hoisted(() => ({
  movePlaybookRule: vi.fn(async () => ({ ok: true as const })),
  updatePlaybookRule: vi.fn(async () => ({ ok: true as const })),
  updatePlaybook: vi.fn(async () => ({ ok: true as const })),
  addPlaybookRule: vi.fn(async () => ({ ok: true as const })),
  deletePlaybook: vi.fn(async () => ({ ok: true as const })),
  deletePlaybookRule: vi.fn(async () => ({ ok: true as const })),
  restorePlaybookRule: vi.fn(async () => ({ ok: true as const })),
  linkRule: vi.fn(async () => ({ ok: true as const })),
  unlinkRule: vi.fn(async () => ({ ok: true as const })),
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

function renderCard(
  rules: PlaybookRule[],
  rows: { id: string; net: number; ruleId: string; followed: boolean }[],
  bookOverrides: Partial<Playbook> = {},
  collapseOverrides: { collapsed?: boolean; onToggleCollapsed?: () => void } = {},
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
    <PlaybookCard
      book={b}
      library={[]}
      row={undefined}
      trades={trades}
      lookup={lookup}
      computeCtx={{ ...metricCtx, rules: lookup.rules }}
      currency="USD"
      collapsed={collapseOverrides.collapsed ?? false}
      onToggleCollapsed={collapseOverrides.onToggleCollapsed ?? vi.fn()}
    />,
  );
  return b;
}

/** The row a rule's editable text input lives in. */
const rowOf = (text: string) => screen.getByDisplayValue(text).closest("tr")!;

describe("PlaybookCard — the editor and the evidence share a row", () => {
  it("puts a rule's numbers in the SAME <tr> as the input that edits it", () => {
    // This single assertion is the whole point of merging the two tables. If
    // anyone ever splits statistics back out into a separate block, it fails.
    const M = RULE_SAMPLE.MIN;
    renderCard(
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
    renderCard(
      [rule({ id: "r1", text: "Waited for the sweep" })],
      [
        ...answers("f", "r1", M, M, true),
        ...answers("b", "r1", M, 0, false),
      ],
    );
    const cell = within(rowOf("Waited for the sweep")).getByText("+100 pp");
    expect(cell.className).toContain("var(--profit)");
  });
});

describe("PlaybookCard — expectancy under the win rate", () => {
  it("shows R for each side under its win rate, not as a separate column", () => {
    const M = RULE_SAMPLE.MIN;
    renderCard(
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
    renderCard(
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

describe("PlaybookCard — what it refuses to claim", () => {
  it("says `too few` when one side is thin, even though the total is not", () => {
    // The bug real data exposed: both sides under the floor, total over it. The
    // sides show counts rather than percentages, so the difference must not
    // appear either.
    renderCard(
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
    renderCard(
      [rule({ id: "r1", text: "Waited for the sweep" })],
      answers("f", "r1", RULE_SAMPLE.MIN, 20, true),
    );

    const row = rowOf("Waited for the sweep");
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(row).queryByText("too few")).toBeNull();
    expect(within(row).queryByText(/pp$/)).toBeNull();
  });
});

describe("PlaybookCard — the table is also the way you build a playbook", () => {
  it("offers an add-rule row for EVERY category, including the empty ones", () => {
    // `rulesByCategory` drops empty categories; the card puts them back on
    // purpose. An empty No-trade section is the prompt to write the rule that is
    // missing, and it is the one most books never get around to.
    renderCard([rule({ id: "r1", text: "Waited for the sweep" })], []);

    for (const label of ["Context", "Entry", "Management", "Exit", "No-trade"]) {
      expect(
        screen.getByRole("textbox", { name: `New ${label} rule` }),
      ).toBeInTheDocument();
    }
  });

  it("locks show_when once the rule has been answered", () => {
    renderCard(
      [rule({ id: "r1", text: "Waited for the sweep", answerCount: 4 })],
      [],
    );
    const trigger = within(rowOf("Waited for the sweep")).getByRole("combobox", {
      name: "When it shows",
    });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("title", expect.stringContaining("4 trades"));
  });
});

describe("PlaybookCard — reordering is scoped to the category", () => {
  const RULES = [
    rule({ id: "c1", text: "Daily bias marked", category: "context" }),
    rule({ id: "c2", text: "Session levels drawn", category: "context" }),
    rule({ id: "e1", text: "Waited for the sweep", category: "entry" }),
    rule({ id: "e2", text: "Entry confirmed on M5", category: "entry" }),
  ];

  it("disables Move up on the first rule of EACH category, not just the table", () => {
    // "Waited for the sweep" is third in the flat link order but first among
    // Entry rules, and the table groups by category — so its up-arrow is off.
    renderCard(RULES, []);

    const up = (t: string) =>
      within(rowOf(t)).getByRole("button", { name: "Move up" });
    const down = (t: string) =>
      within(rowOf(t)).getByRole("button", { name: "Move down" });

    expect(up("Daily bias marked")).toBeDisabled();
    expect(down("Daily bias marked")).toBeEnabled();
    expect(down("Session levels drawn")).toBeDisabled();

    expect(up("Waited for the sweep")).toBeDisabled(); // first of ITS category
    expect(down("Waited for the sweep")).toBeEnabled();
    expect(down("Entry confirmed on M5")).toBeDisabled();
  });

  it("sends the playbook, the rule and the direction to the action", async () => {
    const user = userEvent.setup({ delay: null });
    const b = renderCard(RULES, []);

    await user.click(
      within(rowOf("Waited for the sweep")).getByRole("button", { name: "Move down" }),
    );
    expect(actions.movePlaybookRule).toHaveBeenCalledWith(b.id, "e1", 1);
  });
});

describe("PlaybookCard — collapsing hides the body, never the header", () => {
  it("hides the rule table and the risk/A+ inputs when collapsed", () => {
    renderCard(
      [rule({ id: "r1", text: "Waited for the sweep" })],
      [],
      {},
      { collapsed: true },
    );

    expect(screen.queryByDisplayValue("Waited for the sweep")).toBeNull();
    expect(screen.queryByLabelText("Default risk %")).toBeNull();
    // The header survives — it is what a scan of a long, collapsed list reads.
    expect(screen.getByLabelText("Playbook name")).toBeInTheDocument();
  });

  it("shows the rule table when not collapsed", () => {
    renderCard([rule({ id: "r1", text: "Waited for the sweep" })], []);
    expect(screen.getByDisplayValue("Waited for the sweep")).toBeInTheDocument();
  });

  it("calls onToggleCollapsed, and does not also fire a save", async () => {
    // The name Input sits right next to the toggle button in the header. If the
    // toggle ever grew to wrap the whole row (a native <summary>, say) a click
    // meant for the input would also fire it — exactly the trap this component
    // avoids by using a plain button instead of `<details>`.
    const user = userEvent.setup({ delay: null });
    const onToggleCollapsed = vi.fn();
    renderCard([rule({ id: "r1" })], [], {}, { onToggleCollapsed });

    await user.click(screen.getByRole("button", { name: "Collapse playbook" }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
    expect(actions.updatePlaybook).not.toHaveBeenCalled();
  });

  it("reports its expanded state through aria-expanded, not just an icon", () => {
    renderCard([rule({ id: "r1" })], [], {}, { collapsed: true });
    expect(
      screen.getByRole("button", { name: "Expand playbook" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("summarises win rate and profit factor in the header, collapsed or not", () => {
    const row: ReportRow = {
      bucket: "London Reversal",
      n: 10,
      belowSample: false,
      trades: [],
      values: { win_rate: 62, profit_factor: 1.8 },
    };
    render(
      <PlaybookCard
        book={book([])}
        library={[]}
        row={row}
        trades={[]}
        lookup={buildPlaybookLookup([{ id: "pb", name: "London Reversal", rules: [] }])}
        computeCtx={metricCtx}
        currency="USD"
        collapsed
        onToggleCollapsed={vi.fn()}
      />,
    );
    // One header string, not a table — this is what a folded card is FOR.
    expect(screen.getByText(/62% win · 1\.80 PF/)).toBeInTheDocument();
  });

  it("omits the summary for a playbook with no trades yet, rather than showing 0%", () => {
    renderCard([rule({ id: "r1" })], [], {}, { collapsed: true });
    expect(screen.queryByText(/win ·/)).toBeNull();
  });
});
