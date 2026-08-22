import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FieldDefManager } from "./field-def-manager";
import type { FieldDef } from "@/lib/journal/field-def-types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const countFieldDefUsage = vi.fn();
const deleteFieldDef = vi.fn();

vi.mock("@/app/(app)/settings/actions", () => ({
  addFieldDef: vi.fn(async () => ({ ok: true as const })),
  countFieldDefUsage: (...args: unknown[]) => countFieldDefUsage(...args),
  deleteFieldDef: (...args: unknown[]) => deleteFieldDef(...args),
  moveFieldDef: vi.fn(async () => ({ ok: true as const })),
  toggleFieldDefActive: vi.fn(async () => ({ ok: true as const })),
  updateFieldDef: vi.fn(async () => ({ ok: true as const })),
}));

function def(over: Partial<FieldDef> = {}): FieldDef {
  return {
    id: "f1",
    key: "macro_align",
    label: "Macro Align",
    field_type: "select",
    list_key: "macro_align",
    group_id: "macro",
    sort_order: 0,
    is_active: true,
    show_when: "always",
    ...over,
  };
}

beforeEach(() => {
  countFieldDefUsage.mockReset();
  countFieldDefUsage.mockResolvedValue({ ok: true, trades: 0 });
  deleteFieldDef.mockReset();
});

describe("deleting a custom field", () => {
  it("keeps Delete disabled until the count lands", async () => {
    let resolveCount!: (v: unknown) => void;
    countFieldDefUsage.mockReturnValueOnce(
      new Promise((r) => {
        resolveCount = r;
      }),
    );
    const user = userEvent.setup();
    render(<FieldDefManager defs={[def()]} lists={[]} />);

    await user.click(screen.getByRole("button", { name: "More" }));
    const del = await screen.findByText("Delete");
    expect(del.closest('[role="menuitem"]')).toHaveAttribute("data-disabled");

    resolveCount({ ok: true, trades: 3 });
    await screen.findByText("Delete");
    expect(del.closest('[role="menuitem"]')).not.toHaveAttribute("data-disabled");
  });

  it("warns that recorded values become unreachable, not that they are kept", async () => {
    countFieldDefUsage.mockResolvedValueOnce({ ok: true, trades: 5 });
    const user = userEvent.setup();
    render(<FieldDefManager defs={[def()]} lists={[]} />);

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByText("Delete"));

    expect(await screen.findByText(/5 trades/)).toBeInTheDocument();
    expect(
      screen.getByText(/nothing in the app can find or label it again/),
    ).toBeInTheDocument();
    expect(screen.getByText(/archive it instead/)).toBeInTheDocument();
  });

  it("says plainly when nothing has recorded a value yet", async () => {
    countFieldDefUsage.mockResolvedValueOnce({ ok: true, trades: 0 });
    const user = userEvent.setup();
    render(<FieldDefManager defs={[def()]} lists={[]} />);

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByText("Delete"));

    expect(
      await screen.findByText("No trade has recorded a value here yet."),
    ).toBeInTheDocument();
  });

  it("calls deleteFieldDef only after the confirm button, not on the menu click", async () => {
    countFieldDefUsage.mockResolvedValueOnce({ ok: true, trades: 0 });
    deleteFieldDef.mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<FieldDefManager defs={[def()]} lists={[]} />);

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByText("Delete"));
    expect(deleteFieldDef).not.toHaveBeenCalled();

    await user.click(await screen.findByRole("button", { name: /^Delete$/ }));
    expect(deleteFieldDef).toHaveBeenCalledWith("f1");
  });
});
