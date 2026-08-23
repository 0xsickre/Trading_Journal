import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagMultiSelect } from "./tag-multi-select";
import type { OptionItem, OptionsMap } from "@/lib/journal/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/app/(app)/settings/actions", () => ({
  addOption: vi.fn(async () => ({ ok: true as const })),
}));

/**
 * A MULTI-select has to behave like one.
 *
 * It used to close on every pick, exactly like the single-select beside it, and
 * showed nothing about what was already chosen — so choosing three tags meant
 * opening the same list three times, and clicking one that was already on the
 * trade did nothing at all, silently. Both halves are asserted here because
 * both were wrong.
 */

const opt = (over: Partial<OptionItem> & { value: string }): OptionItem => ({
  id: over.value,
  label: over.value,
  color: null,
  description: null,
  is_active: true,
  sort_order: 0,
  ...over,
});

const MAP: OptionsMap = {
  technical_tag: [opt({ value: "FVG" }), opt({ value: "BOS" }), opt({ value: "CHoCH" })],
};

function draw(value: string[] = []) {
  const onChange = vi.fn();
  render(
    <TagMultiSelect
      value={value}
      onChange={onChange}
      optionsMap={MAP}
      listKey="technical_tag"
      placeholder="Type to search or add…"
    />,
  );
  return { onChange };
}

const openList = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByPlaceholderText("Type to search or add…"));

describe("picking several without reopening", () => {
  it("leaves the list open after a pick", async () => {
    const user = userEvent.setup();
    draw();
    await openList(user);

    await user.click(await screen.findByText("FVG"));
    // Still open — the next tag is one click away, not one click plus a reopen.
    expect(screen.getByText("BOS")).toBeInTheDocument();
  });

  it("reports each pick to the caller", async () => {
    const user = userEvent.setup();
    const { onChange } = draw();
    await openList(user);

    await user.click(await screen.findByText("FVG"));
    expect(onChange).toHaveBeenLastCalledWith(["FVG"]);
  });
});

describe("the list says what is already chosen", () => {
  it("ticks a chosen row and leaves the rest unticked", async () => {
    const user = userEvent.setup();
    draw(["FVG"]);
    await openList(user);

    const rowOf = (label: string) =>
      screen.getAllByRole("option").find((el) => el.textContent?.includes(label))!;

    // The tick is always in the DOM and only its opacity changes, so a row does
    // not shift sideways as the list is ticked through.
    const tickOf = (label: string) =>
      rowOf(label).querySelector("svg")!.getAttribute("class") ?? "";
    expect(tickOf("FVG")).toContain("opacity-100");
    expect(tickOf("BOS")).toContain("opacity-0");
  });

  it("un-picks a tag that is already on the trade", async () => {
    // This used to be the silent no-op: `addTag` returned early for a value
    // already selected, so clicking a chosen row did nothing whatsoever.
    const user = userEvent.setup();
    const { onChange } = draw(["FVG", "BOS"]);
    await openList(user);

    await user.click(
      screen.getAllByRole("option").find((el) => el.textContent?.includes("FVG"))!,
    );
    expect(onChange).toHaveBeenLastCalledWith(["BOS"]);
  });
});
