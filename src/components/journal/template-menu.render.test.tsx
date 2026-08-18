import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplateMenu } from "./template-menu";
import type { DashboardTemplate } from "@/lib/journal/dashboard-templates";

/**
 * The menu that has to make "modified" survivable.
 *
 * The pure half — whether a layout still matches a template — is proved in
 * `dashboard-templates.test.ts`. What is left here is the part a reader
 * actually depends on: that drifting from a saved layout offers all three
 * things they might have meant, and that nothing they typed gets committed by
 * accident.
 */

const T: DashboardTemplate[] = [
  { id: "a", name: "Morning check", widgets: ["equity", "score"] },
  { id: "b", name: "Deep dive", widgets: ["equity", "drawdown"] },
];

const noop = () => {};
const base = {
  templates: T,
  selectedId: null as string | null,
  modified: false,
  onSelect: noop,
  onCreate: noop,
  onSave: noop,
  onRevert: noop,
  onRename: noop,
  onDelete: noop,
};

const open = async (label = /Layout|Morning check|Deep dive/) => {
  const user = userEvent.setup({ delay: null });
  await user.click(screen.getByRole("button", { name: label }));
  return user;
};

describe("TemplateMenu", () => {
  it("names the selected layout on the trigger", async () => {
    render(<TemplateMenu {...base} selectedId="a" />);
    expect(
      screen.getByRole("button", { name: /Morning check/ }),
    ).toBeInTheDocument();
  });

  it("says so when nothing is saved yet", async () => {
    render(<TemplateMenu {...base} templates={[]} />);
    await open();
    expect(screen.getByText(/None yet/)).toBeInTheDocument();
  });

  it("lists every layout, and offers rename/delete for the selected one", async () => {
    render(<TemplateMenu {...base} selectedId="b" />);
    await open();
    const items = screen.getAllByRole("menuitem").map((i) => i.textContent);
    // Both layouts are selectable…
    expect(items).toContain("Morning check");
    expect(items).toContain("Deep dive");
    // …and the management actions name the selected one, so a reader cannot
    // rename or delete a layout they are not looking at.
    expect(items.some((t) => t?.includes("Rename “Deep dive”"))).toBe(true);
    expect(items.some((t) => t?.includes("Delete “Deep dive”"))).toBe(true);
  });
});

describe("the modified state, which is the whole design", () => {
  it("OFFERS ALL THREE CHOICES rather than picking one silently", async () => {
    // Editing the saved layout in place destroys what the reader built;
    // forking it automatically leaves them unsure which one they are on.
    // Neither is undoable by someone who did not notice it happened.
    render(<TemplateMenu {...base} selectedId="a" modified />);
    await open();
    expect(screen.getByText(/Save to/)).toBeInTheDocument();
    expect(screen.getByText(/Save as new layout/)).toBeInTheDocument();
    expect(screen.getByText(/Discard changes/)).toBeInTheDocument();
  });

  it("badges the trigger so the drift is visible without opening anything", () => {
    render(<TemplateMenu {...base} selectedId="a" modified />);
    expect(screen.getByText("Modified")).toBeInTheDocument();
  });

  it("offers none of it while the layout still matches", async () => {
    render(<TemplateMenu {...base} selectedId="a" />);
    await open();
    expect(screen.queryByText(/Discard changes/)).not.toBeInTheDocument();
    expect(screen.queryByText("Modified")).not.toBeInTheDocument();
  });

  it("saves to the selected layout when asked", async () => {
    const onSave = vi.fn();
    render(<TemplateMenu {...base} selectedId="a" modified onSave={onSave} />);
    const user = await open();
    await user.click(screen.getByText(/Save to/));
    expect(onSave).toHaveBeenCalled();
  });

  it("reverts when asked", async () => {
    const onRevert = vi.fn();
    render(
      <TemplateMenu {...base} selectedId="a" modified onRevert={onRevert} />,
    );
    const user = await open();
    await user.click(screen.getByText(/Discard changes/));
    expect(onRevert).toHaveBeenCalled();
  });
});

describe("naming a layout", () => {
  it("creates one from what is on screen", async () => {
    const onCreate = vi.fn();
    render(<TemplateMenu {...base} templates={[]} onCreate={onCreate} />);
    const user = await open();
    await user.click(screen.getByText(/Save this layout/));
    await user.type(screen.getByPlaceholderText("Layout name"), "Swing{Enter}");
    expect(onCreate).toHaveBeenCalledWith("Swing");
  });

  it("REFUSES A BLANK NAME instead of creating an unnamed row", async () => {
    // The column's CHECK refuses it too; catching it here means the reader gets
    // nothing rather than a Postgres error.
    const onCreate = vi.fn();
    render(<TemplateMenu {...base} templates={[]} onCreate={onCreate} />);
    const user = await open();
    await user.click(screen.getByText(/Save this layout/));
    await user.type(screen.getByPlaceholderText("Layout name"), "   {Enter}");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("trims what was typed", async () => {
    const onCreate = vi.fn();
    render(<TemplateMenu {...base} templates={[]} onCreate={onCreate} />);
    const user = await open();
    await user.click(screen.getByText(/Save this layout/));
    await user.type(screen.getByPlaceholderText("Layout name"), "  Swing  {Enter}");
    expect(onCreate).toHaveBeenCalledWith("Swing");
  });

  it("abandons a half-typed name on Escape", async () => {
    const onCreate = vi.fn();
    render(<TemplateMenu {...base} templates={[]} onCreate={onCreate} />);
    const user = await open();
    await user.click(screen.getByText(/Save this layout/));
    await user.type(screen.getByPlaceholderText("Layout name"), "Swin{Escape}");
    expect(onCreate).not.toHaveBeenCalled();
  });
});
