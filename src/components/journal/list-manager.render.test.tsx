import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListManager } from "./list-manager";
import { usageKey } from "@/lib/journal/option-usage";
import type { OptionItem, OptionList } from "@/lib/journal/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const countListUsage = vi.fn();
const countOptionUsage = vi.fn();
const deleteList = vi.fn();
const deleteOption = vi.fn();
const renameList = vi.fn();
const renameOption = vi.fn();
const moveOptionToList = vi.fn();
const setListColor = vi.fn();
const addOption = vi.fn();

vi.mock("@/app/(app)/settings/actions", () => ({
  addList: vi.fn(async () => ({ ok: true as const })),
  addOption: (...a: unknown[]) => addOption(...a),
  countListUsage: (...a: unknown[]) => countListUsage(...a),
  countOptionUsage: (...a: unknown[]) => countOptionUsage(...a),
  deleteList: (...a: unknown[]) => deleteList(...a),
  deleteOption: (...a: unknown[]) => deleteOption(...a),
  moveOptionToList: (...a: unknown[]) => moveOptionToList(...a),
  renameList: (...a: unknown[]) => renameList(...a),
  renameOption: (...a: unknown[]) => renameOption(...a),
  setListColor: (...a: unknown[]) => setListColor(...a),
  toggleOptionActive: vi.fn(async () => ({ ok: true as const })),
}));

/**
 * Settings → Categories, rebuilt to mirror TradeZella's "Tags management":
 * two tabs, each a flat table, rather than one screen of expanded cards.
 */

function item(over: Partial<OptionItem> = {}): OptionItem {
  return {
    id: "i1",
    value: "Bullish",
    label: "Bullish",
    color: null,
    is_active: true,
    sort_order: 0,
    ...over,
  };
}

function list(over: Partial<OptionList> = {}): OptionList {
  return {
    id: "l1",
    key: "cot_filter",
    label: "COT Filter",
    category: "Context",
    color: "#22c55e",
    sort_order: 0,
    items: [item()],
    ...over,
  };
}

const openTagsTab = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("tab", { name: "Tags" }));

beforeEach(() => {
  for (const m of [
    countListUsage,
    countOptionUsage,
    deleteList,
    deleteOption,
    renameList,
    renameOption,
    moveOptionToList,
    setListColor,
    addOption,
  ]) {
    m.mockReset();
  }
  countListUsage.mockResolvedValue({
    ok: true,
    usage: { trades: 0, builtIn: false, customFieldLabels: [] },
  });
  countOptionUsage.mockResolvedValue({ ok: true, trades: 0 });
});

describe("the two tabs", () => {
  it("lists categories in a table, and never shows the storage key", () => {
    render(<ListManager lists={[list()]} usage={{}} />);
    expect(
      screen.getByRole("columnheader", { name: "Category name" }),
    ).toBeInTheDocument();
    expect(screen.getByText("COT Filter")).toBeInTheDocument();
    // `cot_filter` is how the database finds the row, not something the trader
    // named — it used to be printed under every card heading.
    expect(screen.queryByText("cot_filter")).not.toBeInTheDocument();
  });

  it("puts tags in their own table, with the category they are filed under", async () => {
    const user = userEvent.setup();
    render(
      <ListManager
        lists={[
          list(),
          list({
            id: "l2",
            key: "mistake",
            label: "Mistake",
            items: [item({ id: "i2", value: "Chasing", label: "Chasing" })],
          }),
        ]}
        usage={{}}
      />,
    );
    await openTagsTab(user);

    const table = screen.getByRole("table");
    expect(within(table).getByText("Bullish")).toBeInTheDocument();
    expect(within(table).getByText("Chasing")).toBeInTheDocument();
    expect(within(table).getByText("COT Filter")).toBeInTheDocument();
    expect(within(table).getByText("Mistake")).toBeInTheDocument();
  });

  it("shows how many trades use each tag, straight away", async () => {
    // The count is on the page from the first paint — no click, no spinner.
    const user = userEvent.setup();
    render(
      <ListManager
        lists={[list()]}
        usage={{ [usageKey("cot_filter", "Bullish")]: 12 }}
      />,
    );
    await openTagsTab(user);

    const row = screen.getByText("Bullish").closest("tr")!;
    expect(within(row).getByText("12")).toBeInTheDocument();
  });

  it("reads zero for a tag no trade carries", async () => {
    const user = userEvent.setup();
    render(<ListManager lists={[list()]} usage={{}} />);
    await openTagsTab(user);

    const row = screen.getByText("Bullish").closest("tr")!;
    expect(within(row).getByText("0")).toBeInTheDocument();
  });

  it("drops the categories Settings hides", () => {
    render(
      <ListManager
        lists={[list(), list({ id: "l2", key: "setup_grade", label: "Setup Grade" })]}
        usage={{}}
      />,
    );
    expect(screen.getByText("COT Filter")).toBeInTheDocument();
    expect(screen.queryByText("Setup Grade")).not.toBeInTheDocument();
  });
});

describe("editing a category", () => {
  it("opens a dialog with the name in an ENABLED field", async () => {
    // The rename used to be an inline input that Radix's focus-restore raced,
    // and that shared a transition with the usage count so it rendered
    // disabled. A dialog has neither problem, and matches the real screen.
    const user = userEvent.setup();
    render(<ListManager lists={[list()]} usage={{}} />);

    await user.click(screen.getByRole("button", { name: "Options for COT Filter" }));
    await user.click(await screen.findByText("Edit"));

    const input = await screen.findByDisplayValue("COT Filter");
    expect(input).toBeEnabled();
  });

  it("saves the new name", async () => {
    renameList.mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<ListManager lists={[list()]} usage={{}} />);

    await user.click(screen.getByRole("button", { name: "Options for COT Filter" }));
    await user.click(await screen.findByText("Edit"));
    const input = await screen.findByDisplayValue("COT Filter");
    await user.clear(input);
    await user.type(input, "COT Report");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(renameList).toHaveBeenCalledWith("l1", "COT Report");
  });
});

describe("deleting a category", () => {
  it("refuses outright when a built-in field reads it", async () => {
    countListUsage.mockResolvedValueOnce({
      ok: true,
      usage: { trades: 12, builtIn: true, customFieldLabels: [] },
    });
    const user = userEvent.setup();
    render(
      <ListManager
        lists={[list({ key: "exit_reason", label: "Exit Reason" })]}
        usage={{}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Options for Exit Reason" }));
    await user.click(await screen.findByText("Delete"));

    expect(
      await screen.findByText('"Exit Reason" can\'t be deleted'),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(deleteList).not.toHaveBeenCalled();
  });

  it("names the custom field that would go with it", async () => {
    countListUsage.mockResolvedValueOnce({
      ok: true,
      usage: { trades: 7, builtIn: false, customFieldLabels: ["Macro Align"] },
    });
    const user = userEvent.setup();
    render(
      <ListManager
        lists={[list({ key: "macro_align", label: "Macro Align" })]}
        usage={{}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Options for Macro Align" }));
    await user.click(await screen.findByText("Delete"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/7 trades/)).toBeInTheDocument();
    expect(within(dialog).getByText(/deleted along with it/)).toBeInTheDocument();
  });

  it("stays disabled until the check comes back, then deletes on confirm", async () => {
    let resolve!: (v: unknown) => void;
    countListUsage.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    deleteList.mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<ListManager lists={[list()]} usage={{}} />);

    await user.click(screen.getByRole("button", { name: "Options for COT Filter" }));
    await user.click(await screen.findByText("Delete"));

    const confirm = await screen.findByRole("button", { name: "Delete" });
    expect(confirm).toBeDisabled();

    resolve({ ok: true, usage: { trades: 0, builtIn: false, customFieldLabels: [] } });
    await vi.waitFor(() => expect(confirm).toBeEnabled());

    await user.click(confirm);
    expect(deleteList).toHaveBeenCalledWith("l1");
  });
});

describe("editing a tag", () => {
  it("can move it to another category", async () => {
    moveOptionToList.mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(
      <ListManager
        lists={[
          list(),
          list({ id: "l2", key: "mistake", label: "Mistake", items: [] }),
        ]}
        usage={{}}
      />,
    );
    await openTagsTab(user);

    await user.click(screen.getByRole("button", { name: "Options for Bullish" }));
    await user.click(await screen.findByText("Edit"));

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Mistake" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(moveOptionToList).toHaveBeenCalledWith("i1", "l2");
  });

  it("warns that a rename rewrites the trades already carrying it", async () => {
    const user = userEvent.setup();
    render(
      <ListManager
        lists={[list()]}
        usage={{ [usageKey("cot_filter", "Bullish")]: 4 }}
      />,
    );
    await openTagsTab(user);

    await user.click(screen.getByRole("button", { name: "Options for Bullish" }));
    await user.click(await screen.findByText("Edit"));

    expect(
      await screen.findByText(/Renaming also rewrites this on/),
    ).toHaveTextContent("4 trades");
  });
});
