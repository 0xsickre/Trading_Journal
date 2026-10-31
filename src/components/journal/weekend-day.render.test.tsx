import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeekendDay } from "./weekend-day";

describe("a weekend day on /daily asks for nothing", () => {
  // 2026-10-30 is a Friday; 31 and 01.11. are the weekend.
  it.each(["2026-10-31", "2026-11-01"])("%s has no form and links back to Friday", (day) => {
    render(<WeekendDay day={day} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sačuvaj/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Poslednji trgovački dan/ })).toHaveAttribute(
      "href",
      "/daily?date=2026-10-30",
    );
  });
});
