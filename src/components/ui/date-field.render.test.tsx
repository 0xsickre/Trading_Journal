import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateField, MonthField } from "./date-field";

// The native inputs drew Cyrillic on a Serbian system (trader, 01.10.2026); these
// fields write dd/MM/yyyy and English names whatever the browser's language.
describe("DateField", () => {
  it("shows the day as dd/MM/yyyy and hands back a day key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateField aria-label="Day" value="2026-10-01" onChange={onChange} />);
    expect(screen.getByLabelText("Day")).toHaveTextContent("01/10/2026");
    await user.click(screen.getByLabelText("Day"));
    expect(screen.getByText("October 2026")).toBeInTheDocument();
    expect(screen.getByLabelText("01/10/2026")).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByLabelText("15/10/2026"));
    expect(onChange).toHaveBeenCalledWith("2026-10-15");
  });

  it("steps months across the year and only offers Clear when asked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<DateField aria-label="Day" value="2026-12-31" onChange={onChange} />);
    await user.click(screen.getByLabelText("Day"));
    await user.click(screen.getByLabelText("Next month"));
    expect(screen.getByText("January 2027")).toBeInTheDocument();
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    rerender(<DateField aria-label="Day" value="" clearable onChange={onChange} />);
    expect(screen.getByLabelText("Day")).toHaveTextContent("dd/mm/yyyy");
    await user.click(screen.getByLabelText("Day"));
    await user.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("can say something else for the picked day", () => {
    render(<DateField aria-label="Week" value="2026-09-28" display={(d) => `Week of ${d}`} onChange={() => {}} />);
    expect(screen.getByLabelText("Week")).toHaveTextContent("Week of 2026-09-28");
  });
});

describe("MonthField", () => {
  it("shows the month by name and hands back a month key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MonthField aria-label="Month" value="2026-10" onChange={onChange} />);
    expect(screen.getByLabelText("Month")).toHaveTextContent("October 2026");
    await user.click(screen.getByLabelText("Month"));
    await user.click(screen.getByLabelText("Previous year"));
    await user.click(screen.getByLabelText("March 2025"));
    expect(onChange).toHaveBeenCalledWith("2025-03");
  });
});
