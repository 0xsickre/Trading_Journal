import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownView } from "./markdown-view";

/**
 * `parseMarkdown`'s href allowlist is proven in `notes/markdown.test.ts`; this
 * file proves the ONE thing a lib test cannot — that a rejected scheme never
 * reaches the DOM as a clickable `<a>`. There is no `dangerouslySetInnerHTML`
 * anywhere in this renderer and there must never be one, so the real attack
 * surface is not injected HTML — it is a link that survives as an `<a href>`
 * when it should have been demoted to plain text.
 */
describe("MarkdownView — the allowlist holds on screen, not just in the parser", () => {
  it("a safe http(s) link renders as a real anchor with noopener/noreferrer", () => {
    render(<MarkdownView content="[read this](https://example.com/x)" />);
    const a = screen.getByRole("link", { name: "read this" });
    expect(a).toHaveAttribute("href", "https://example.com/x");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("a relative link renders as an anchor WITHOUT target/rel — no reason to open a new tab for its own page", () => {
    render(<MarkdownView content="[trade](/trades/42/edit)" />);
    const a = screen.getByRole("link", { name: "trade" });
    expect(a).toHaveAttribute("href", "/trades/42/edit");
    expect(a).not.toHaveAttribute("target");
    expect(a).not.toHaveAttribute("rel");
  });

  it("a javascript: link loses the link but keeps the raw markdown as visible text — no <a> reaches the DOM at all", () => {
    render(<MarkdownView content="[click me](javascript:alert(1))" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // The whole token, not just the label — the reader sees exactly what was
    // typed rather than a silently truncated sentence.
    expect(screen.getByText("[click me](javascript:alert(1))")).toBeInTheDocument();
  });

  it("a data: link is rejected the same way", () => {
    render(<MarkdownView content="[open](data:text/html,evil)" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("[open](data:text/html,evil)")).toBeInTheDocument();
  });

  it("markup typed into a note is displayed, never executed — React escapes it as text", () => {
    render(<MarkdownView content={"<img src=x onerror=alert(1)>"} />);
    expect(document.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });

  it("headings, lists, quotes and code blocks render as their own elements", () => {
    render(
      <MarkdownView
        content={"# Naslov\n\n- prvi\n- drugi\n\n> citat\n\n```\ncode line\n```"}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Naslov" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("citat").closest("blockquote")).toBeInTheDocument();
    expect(screen.getByText("code line").closest("pre")).toBeInTheDocument();
  });

  it("empty content shows the placeholder, not a blank card", () => {
    render(<MarkdownView content="" />);
    expect(screen.getByText(/Empty note/)).toBeInTheDocument();
  });
});
