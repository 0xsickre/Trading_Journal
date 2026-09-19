import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaybooksScreen } from "./playbooks-screen";
import { enrich } from "@/lib/journal/reports/test-helpers";
import { EXACT_ZERO_RANGE } from "@/lib/journal/breakeven";
import type { Playbook } from "@/lib/journal/playbook-types";
import { buildPlaybookLookup } from "@/lib/journal/reports/playbook-dimensions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const deleteMock = vi.fn();
vi.mock("@/app/(app)/settings/playbook-actions", () => ({
  addPlaybook: vi.fn(),
  updatePlaybook: vi.fn().mockResolvedValue({ ok: true }),
  deletePlaybook: (...a: unknown[]) => deleteMock(...a),
}));

const book = (id: string, name: string): Playbook =>
  ({
    id,
    name,
    description: null,
    color: null,
    icon: null,
    is_active: true,
    sort_order: 0,
    default_risk_pct: null,
    a_plus_criteria: null,
    sections: [],
    rules: [],
  }) as unknown as Playbook;

const BOOKS = [book("pb-1", "London Reversal")];
const LOOKUP = buildPlaybookLookup(BOOKS, new Map());

function draw(currency: string | null = "USD") {
  const trades = enrich([
    { id: "a", net: 200, r: 2, playbookId: "pb-1" },
    { id: "b", net: -100, r: -1, playbookId: "pb-1" },
    { id: "c", net: -50, r: -0.5, playbookId: null },
  ]);
  return render(
    <PlaybooksScreen
      playbooks={BOOKS}
      trades={trades}
      lookup={LOOKUP}
      currency={currency}
      breakevenRange={EXACT_ZERO_RANGE}
      missedByPlaybook={{}}
    />,
  );
}

beforeEach(() => deleteMock.mockReset().mockResolvedValue({ ok: true }));

describe("PlaybooksScreen", () => {
  it("shows profit factor and follow rate beside the old columns", () => {
    draw();
    expect(screen.getByRole("columnheader", { name: "Profit factor" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Followed" })).toBeInTheDocument();
    const row = screen.getByRole("link", { name: "London Reversal" }).closest("tr")!;
    // Columns: name, trades, net, win rate, PROFIT FACTOR, expectancy, followed.
    expect(row.children[4].textContent).toBe("2"); // 200 won / 100 lost
    expect(row.children[5].textContent).toBe("+0.50R");
  });

  it("adds a No playbook baseline row from the trades without one", () => {
    draw();
    const row = screen.getByText("No playbook").closest("tr")!;
    expect(within(row).getByText("1")).toBeInTheDocument();
  });

  it("does not sum money across currencies", () => {
    draw(null);
    expect(screen.getByText(/not summed/)).toBeInTheDocument();
  });

  it("asks before deleting a playbook", async () => {
    const user = userEvent.setup({ delay: null });
    draw();
    await user.click(screen.getByRole("button", { name: "Delete playbook" }));
    expect(deleteMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteMock).toHaveBeenCalledWith("pb-1"));
  });
});
