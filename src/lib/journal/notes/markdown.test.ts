import { describe, expect, it } from "vitest";
import {
  deriveTitle,
  parseInline,
  parseMarkdown,
  plainText,
  type Block,
} from "./markdown";

const text = (value: string) => ({ type: "text", value }) as const;

describe("inline parsing", () => {
  it("reads bold before italic, so ** is never two *", () => {
    expect(parseInline("**bold**")).toEqual([
      { type: "strong", children: [text("bold")] },
    ]);
    expect(parseInline("*italic*")).toEqual([
      { type: "em", children: [text("italic")] },
    ]);
  });

  it("keeps the text around a marker", () => {
    expect(parseInline("pre **mid** post")).toEqual([
      text("pre "),
      { type: "strong", children: [text("mid")] },
      text(" post"),
    ]);
  });

  it("treats code spans as literal, not as markup", () => {
    // Inside backticks nothing is a marker, or a note about markdown could not
    // show markdown.
    expect(parseInline("`**not bold**`")).toEqual([
      { type: "code", value: "**not bold**" },
    ]);
  });

  it("leaves an unmatched marker as plain text", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([text("2 * 3 = 6")]);
    expect(parseInline("a_b_c")).toEqual([
      text("a"),
      { type: "em", children: [text("b")] },
      text("c"),
    ]);
  });

  it("parses links and keeps relative and mailto targets", () => {
    expect(parseInline("[trade](/trades/1/edit)")).toEqual([
      { type: "link", href: "/trades/1/edit", children: [text("trade")] },
    ]);
    expect(parseInline("[mail](mailto:a@b.c)")).toEqual([
      { type: "link", href: "mailto:a@b.c", children: [text("mail")] },
    ]);
  });
});

describe("link scheme guard", () => {
  // The one place a note could become executable. An allowlist, because a
  // blocklist has to anticipate vbscript:, encoded forms, and whatever is next.
  const rejected = [
    "[x](javascript:alert(1))",
    "[x](JavaScript:alert(1))",
    "[x](data:text/html,<script>alert(1)</script>)",
    "[x](vbscript:msgbox)",
    "[x](file:///etc/passwd)",
  ];

  it("refuses a dangerous scheme and keeps the text visible", () => {
    for (const src of rejected) {
      const out = parseInline(src);
      expect(out).toEqual([text(src)]);
      expect(out.some((n) => n.type === "link")).toBe(false);
    }
  });

  it("still allows the ordinary ones", () => {
    for (const href of ["https://x.com", "http://x.com", "/journal", "#anchor"]) {
      const out = parseInline(`[x](${href})`);
      expect(out[0]).toMatchObject({ type: "link", href });
    }
  });

  it("drops a link with an empty target rather than linking to nothing", () => {
    expect(parseInline("[x]()")).toEqual([text("[x]()")]);
  });
});

describe("block parsing", () => {
  const kinds = (blocks: Block[]) => blocks.map((b) => b.type);

  it("parses the seeded weekly-review shape", () => {
    const blocks = parseMarkdown(
      "## Nedelja\n\n### Brojevi\n- Neto P&L:\n- Broj trejdova:\n\n### Šta je radilo\n",
    );
    expect(kinds(blocks)).toEqual(["heading", "heading", "list", "heading"]);
    expect(blocks[0]).toMatchObject({ level: 2 });
    expect(blocks[2]).toMatchObject({ ordered: false });
    if (blocks[2].type === "list") expect(blocks[2].items).toHaveLength(2);
  });

  it("groups a run of bullets into ONE list", () => {
    const blocks = parseMarkdown("- a\n- b\n- c");
    expect(blocks).toHaveLength(1);
    if (blocks[0].type === "list") expect(blocks[0].items).toHaveLength(3);
  });

  it("separates an ordered list from an unordered one", () => {
    const blocks = parseMarkdown("- a\n\n1. b");
    expect(kinds(blocks)).toEqual(["list", "list"]);
    expect(blocks[0]).toMatchObject({ ordered: false });
    expect(blocks[1]).toMatchObject({ ordered: true });
  });

  it("joins wrapped lines into one paragraph", () => {
    // Soft wrapping in a textarea must not become three paragraphs.
    const blocks = parseMarkdown("one\ntwo\nthree");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
  });

  it("keeps a fenced code block literal, including markers", () => {
    const blocks = parseMarkdown("```sql\nselect * from t\n```");
    expect(blocks[0]).toEqual({
      type: "code",
      value: "select * from t",
      lang: "sql",
    });
  });

  it("runs an unclosed fence to the end instead of throwing", () => {
    // Half-typed is a normal state while writing; the preview must not blow up.
    const blocks = parseMarkdown("```\nstill typing");
    expect(blocks[0]).toMatchObject({ type: "code", value: "still typing" });
  });

  it("does not read a heading marker inside a code fence", () => {
    const blocks = parseMarkdown("```\n# not a heading\n```");
    expect(kinds(blocks)).toEqual(["code"]);
  });

  it("merges consecutive quote lines", () => {
    const blocks = parseMarkdown("> one\n> two");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "quote" });
  });

  it("recognises a horizontal rule but not a bullet", () => {
    expect(parseMarkdown("---")[0]).toEqual({ type: "rule" });
    expect(parseMarkdown("- item")[0].type).toBe("list");
  });

  it("returns nothing for an empty note", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n   \n")).toEqual([]);
  });

  it("caps headings at four levels", () => {
    expect(parseMarkdown("#### four")[0]).toMatchObject({ level: 4 });
    // Five hashes is not a heading level this renderer has, so it stays text.
    expect(parseMarkdown("##### five")[0].type).toBe("paragraph");
  });
});

describe("deriveTitle", () => {
  it("takes the first non-empty line without its heading marks", () => {
    expect(deriveTitle("\n\n## Nedelja 31\n\ntekst")).toBe("Nedelja 31");
    expect(deriveTitle("- prva stavka")).toBe("prva stavka");
  });

  it("falls back when there is nothing to take", () => {
    expect(deriveTitle("")).toBe("Bez naslova");
    expect(deriveTitle("   \n\n")).toBe("Bez naslova");
    expect(deriveTitle("", "Prazna")).toBe("Prazna");
  });

  it("truncates rather than pushing the list layout", () => {
    const title = deriveTitle("x".repeat(200));
    expect(title).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("plainText", () => {
  it("strips markup for search and previews", () => {
    expect(plainText("## Naslov\n\n**bold** i `kod` i [link](https://x.com)")).toBe(
      "Naslov bold i kod i link",
    );
  });

  it("drops fenced code entirely — it is not prose", () => {
    expect(plainText("pre\n```\nselect 1\n```\npost")).toBe("pre post");
  });

  // `plainText` used to be a SECOND regex parser over the raw source, which is
  // two answers to "what does this note say". It now walks the same tree the
  // renderer walks. These are the cases where the two disagreed — each one is
  // text the reader can see on screen but could not previously search for.
  it("keeps a code span exactly as typed, markers and all", () => {
    // The old pass unwrapped the span and THEN stripped `*`, so a note showing
    // `a**b` was searchable only as `ab`.
    expect(plainText("radi `a**b` ovde")).toBe("radi a**b ovde");
    expect(plainText("`_x_`")).toBe("_x_");
  });

  it("drops the marker of an ordered list, not just a bullet", () => {
    // The old line-start strip listed `#>-*+` and no digits, so every numbered
    // item kept its "1." in the preview.
    expect(plainText("1. prvo\n2. drugo")).toBe("prvo drugo");
  });

  it("shows a refused link the way the note renders it — literally", () => {
    // A `javascript:` target is not a link, so the reader sees the raw text.
    // The old regex tore it into "x" plus a stray bracket, so the preview and
    // the note disagreed about what was written.
    expect(plainText("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))");
    expect(plainText("[x](https://a.example)")).toBe("x");
  });
});

describe("deriveTitle and plainText answer from the same parse", () => {
  it("strips inline marks from the title too", () => {
    expect(deriveTitle("**Nedelja 31**")).toBe("Nedelja 31");
    expect(deriveTitle("> `plan` za ponedeljak")).toBe("plan za ponedeljak");
  });

  it("still takes the first LINE, not the first paragraph", () => {
    // A paragraph joins its lines. A title of three joined sentences cut at 80
    // characters is worse at finding the note than its opening line.
    expect(deriveTitle("prva linija\ndruga linija\ntreća")).toBe("prva linija");
  });
});
