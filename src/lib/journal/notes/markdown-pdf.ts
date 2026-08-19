import { jsPDF } from "jspdf";
import { inlineText, type Block } from "./markdown";

/**
 * Renders a note's parsed markdown into a downloadable PDF.
 *
 * Walks the SAME tree `MarkdownView` renders into React elements
 * (`parseMarkdown()`, in `markdown.ts`) — this is the second consumer that
 * split parsing from rendering was for. No `html2canvas`: that would rasterize
 * the note into an image, losing selectable text and ballooning file size for
 * what is fundamentally a page of prose. jsPDF's own text layout — font size
 * per heading level, `splitTextToSize` for wrapping, a bullet glyph per list
 * item — produces a real text PDF from the same structure the screen shows.
 *
 * Inline styling (bold, italic, code, links) is flattened to plain text via
 * `inlineText`. jsPDF has no rich-text run API — mixing a bold word into a
 * line of normal text means tracking x-position per styled span by hand, and a
 * note's inline emphasis is not load-bearing information the way its headings
 * and list structure are. The words survive; the bolding does not.
 */

const MARGIN = 18;
const PAGE_WIDTH = 210; // A4, mm
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT = 6;

const HEADING_SIZE: Record<1 | 2 | 3 | 4, number> = {
  1: 20,
  2: 17,
  3: 14,
  4: 12,
};

export function renderNoteToPdf(title: string, blocks: readonly Block[]): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGIN;

  const ensureRoom = (needed: number) => {
    if (y + needed > 297 - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const writeLines = (text: string, size: number, style: "normal" | "italic" = "normal") => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, CONTENT_WIDTH) as string[];
    for (const line of lines) {
      ensureRoom(LINE_HEIGHT);
      doc.text(line, MARGIN, y);
      y += LINE_HEIGHT;
    }
  };

  // Title, then a rule of its own — set apart from the body the same way the
  // editor sets it apart from `content`.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(HEADING_SIZE[1]);
  const titleLines = doc.splitTextToSize(title || "Untitled", CONTENT_WIDTH) as string[];
  for (const line of titleLines) {
    doc.text(line, MARGIN, y);
    y += 8;
  }
  y += 2;

  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        y += 3;
        writeLines(inlineText(block.children), HEADING_SIZE[block.level]);
        y += 1;
        break;
      }
      case "paragraph": {
        writeLines(inlineText(block.children), 11);
        y += 3;
        break;
      }
      case "list": {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        block.items.forEach((item, i) => {
          const bullet = block.ordered ? `${i + 1}.` : "•";
          const text = inlineText(item);
          const lines = doc.splitTextToSize(text, CONTENT_WIDTH - 6) as string[];
          lines.forEach((line, li) => {
            ensureRoom(LINE_HEIGHT);
            if (li === 0) doc.text(bullet, MARGIN, y);
            doc.text(line, MARGIN + 6, y);
            y += LINE_HEIGHT;
          });
        });
        y += 2;
        break;
      }
      case "quote": {
        writeLines(inlineText(block.children), 11, "italic");
        y += 3;
        break;
      }
      case "code": {
        doc.setFont("courier", "normal");
        doc.setFontSize(9.5);
        const lines = block.value.split("\n");
        for (const line of lines) {
          ensureRoom(5);
          doc.text(line, MARGIN + 2, y);
          y += 5;
        }
        y += 3;
        break;
      }
      case "rule": {
        ensureRoom(6);
        doc.setDrawColor(180);
        doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
        y += 6;
        break;
      }
    }
  }

  return doc;
}
