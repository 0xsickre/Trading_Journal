import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./page-header";

/**
 * The heading contract, so eight pages can stop repeating it.
 *
 * The assertion worth having is the LAST one: a component like this normally
 * grows a wrapper row that is always rendered, with an empty slot where the
 * action would be. Nothing looks wrong on the page with an action, and on the
 * six pages without one the heading silently stops filling its line. Checking
 * the markup shape — not just the text — is what catches that.
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

  it("renders the action beside the title when one is given", () => {
    render(<PageHeader title="Journal" action={<button>New Trade</button>} />);
    expect(
      screen.getByRole("button", { name: "New Trade" }),
    ).toBeInTheDocument();
  });

  it("renders NO action row at all when there is no action", () => {
    const { container } = render(<PageHeader title="Reports" />);
    // The bare heading is the root — not a justify-between row holding it and
    // an empty second child.
    const root = container.firstElementChild!;
    expect(root.className).not.toContain("justify-between");
    expect(root.children).toHaveLength(1); // the h1 only
  });

  it("keeps min-w-0 on the heading so a long title cannot push the action off", () => {
    const { container } = render(
      <PageHeader title="Journal" action={<button>New Trade</button>} />,
    );
    const heading = container.querySelector("h1")!.parentElement!;
    expect(heading.className).toContain("min-w-0");
  });
});
