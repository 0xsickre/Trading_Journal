import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./page-header";

/**
 * The heading contract, so eight pages can stop repeating it.
 *
 * The two action-slot cases this file used to carry are gone with the prop:
 * `New Trade` is the sidebar's and the mobile bar's primary action now, and the
 * page-level copy was the third on screen at once. What remains still checks
 * markup SHAPE and not only text — the last case is the one that catches a
 * heading quietly wrapped in an always-rendered row.
 */
describe("PageHeader", () => {
  it("renders the title as the page's h1", () => {
    render(<PageHeader title="Reports" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Reports" }),
    ).toBeInTheDocument();
  });

  it("renders a description when given one, and nothing when not", () => {
    const { rerender, container } = render(
      <PageHeader title="Reports" description="Group by anything." />,
    );
    expect(screen.getByText("Group by anything.")).toBeInTheDocument();

    rerender(<PageHeader title="Reports" />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("takes rich description content, not only a string", () => {
    // `/calendar` marks a word with <b>; a `string` prop would have kept that
    // page on its own hand-rolled copy.
    render(
      <PageHeader
        title="Calendar"
        description={
          <>
            Attributed to the day it <b>closed</b>.
          </>
        }
      />,
    );
    expect(screen.getByText("closed").tagName).toBe("B");
  });

  it("is the bare heading — no wrapper row, no empty slot", () => {
    const { container } = render(<PageHeader title="Reports" />);
    const root = container.firstElementChild!;
    expect(root.className).not.toContain("justify-between");
    expect(root.children).toHaveLength(1); // the h1 only
  });

  it("keeps min-w-0, so a long title cannot widen the row past its container", () => {
    const { container } = render(<PageHeader title="Journal" />);
    const heading = container.querySelector("h1")!.parentElement!;
    expect(heading.className).toContain("min-w-0");
  });
});
