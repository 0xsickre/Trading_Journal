import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterBar } from "./filter-bar";
import { DIMENSIONS } from "@/lib/journal/reports/dimensions";
import { dimCtx, enrich } from "@/lib/journal/reports/test-helpers";

/**
 * The two ways adding a filter used to fail: an "is" filter vanished the moment
 * it was added (it went to the URL with no value and was dropped there), and a
 * number could not be typed through "-" or "1.".
 */

const BOOK = enrich([
  { instrument: "XAUUSD", net: 100 },
  { instrument: "NAS100", net: -40 },
]);

const bar = (onChange = vi.fn()) => {
  render(
    <FilterBar
      clauses={[]}
      onChange={onChange}
      trades={BOOK}
      dimensionContext={dimCtx()}
      dimensions={DIMENSIONS}
    />,
  );
  return onChange;
};

describe("FilterBar", () => {
  it("an 'is' filter is only added once it has a value", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = bar();
    await user.click(screen.getByRole("button", { name: /Filters/ }));
    // The first dimension is Instrument; nothing picked yet, nothing to add.
    expect(screen.getByRole("button", { name: /^Add$/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "XAUUSD" }));
    await user.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(onChange).toHaveBeenCalledWith([{ field: "instrument", op: "in", values: ["XAUUSD"] }]);
  });

  it("a range takes a negative decimal typed one key at a time", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = bar();
    await user.click(screen.getByRole("button", { name: /Filters/ }));
    await user.click(screen.getByRole("combobox", { name: "Filter field" }));
    await user.click(await screen.findByRole("option", { name: "R-multiple (range)" }));
    await user.type(screen.getByRole("textbox", { name: "Minimum" }), "-1.5");
    expect(screen.getByRole("textbox", { name: "Minimum" })).toHaveValue("-1.5");
    await user.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(onChange).toHaveBeenCalledWith([{ field: "r", op: "between", min: -1.5, max: undefined }]);
  });

  it("an active filter reads as a sentence and can be removed", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(
      <FilterBar
        clauses={[{ field: "instrument", op: "notIn", values: ["NAS100"] }]}
        onChange={onChange}
        trades={BOOK}
        dimensionContext={dimCtx()}
        dimensions={DIMENSIONS}
      />,
    );
    expect(screen.getByText("Instrument is not NAS100")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Remove filter/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
