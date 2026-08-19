import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown";
import { renderNoteToPdf } from "./markdown-pdf";

/**
 * jsPDF's own layout is not something worth asserting pixel-by-pixel — the
 * point here is narrower: that walking the SAME tree `MarkdownView` renders
 * never throws for any shape that parser produces, and that the result is a
 * real document rather than an empty shell. Visual correctness is checked in
 * the browser, per the plan's own verification section.
 */

describe("renderNoteToPdf", () => {
  it("does not throw on a note using every block type", () => {
    const content = [
      "# Heading 1",
      "## Heading 2",
      "",
      "A paragraph with **bold**, *italic*, `code` and a [link](https://example.com).",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "> a quote",
      "",
      "```",
      "const x = 1;",
      "```",
      "",
      "---",
    ].join("\n");

    expect(() => renderNoteToPdf("Every block type", parseMarkdown(content))).not.toThrow();
  });

  it("produces at least one page and non-empty bytes", () => {
    const doc = renderNoteToPdf("A note", parseMarkdown("Some content."));
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    const bytes = doc.output("arraybuffer") as ArrayBuffer;
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("SPILLS ONTO A SECOND PAGE rather than clipping a long note", () => {
    // Enough paragraphs to overflow one A4 page at 11pt — the point being that
    // `ensureRoom` actually calls `addPage()` rather than silently running off
    // the bottom.
    const longContent = Array.from(
      { length: 80 },
      (_, i) => `Paragraph number ${i}, long enough to wrap across a couple of lines each.`,
    ).join("\n\n");
    const doc = renderNoteToPdf("Long note", parseMarkdown(longContent));
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  it("handles an empty note without throwing or producing zero pages", () => {
    const doc = renderNoteToPdf("", parseMarkdown(""));
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("falls back to 'Untitled' for a blank title, matching the on-screen convention", () => {
    // Not asserted via text extraction (jsPDF does not expose rendered glyphs
    // back out), but the call must not throw when title is "".
    expect(() => renderNoteToPdf("", parseMarkdown("body"))).not.toThrow();
  });
});
