import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, plainText } from "./markdown";

/**
 * The one file in this repository where a bug is a security bug.
 *
 * `markdown.ts` returns a TREE and `markdown-view.tsx` walks it into React
 * elements with no `dangerouslySetInnerHTML` anywhere, so tag injection has no
 * sink at all. What is left is the link `href`, which React will happily render
 * as written — and a `javascript:` URL in an `<a>` is script execution on click.
 *
 * `markdown.test.ts` already covers the plain cases. This file is the evasion
 * battery: the forms a BLOCKLIST would have had to anticipate, which is the
 * argument for the allowlist actually in use.
 */

describe("no scheme outside the allowlist ever becomes a link", () => {
  const mustNotLink = [
    "[x](javascript:alert(1))",
    "[x]( javascript:alert(1))",
    "[x](  JaVaScRiPt:alert(1))",
    "[x](JAVASCRIPT:alert(1))",
    "[x](vbscript:msgbox)",
    "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "[x](blob:https://evil.example/uuid)",
    "[x](filesystem:https://evil.example/temporary/a)",
    "[x](jar:http://evil.example!/)",
    "[x](view-source:https://example.com)",
    "[x](chrome://settings)",
    "[x](about:blank)",
    "[x](ws://evil.example)",
    // Encoded forms. The parser must NOT decode these into a scheme — if it
    // ever starts decoding, the allowlist has to run AFTER the decode.
    "[x](%6Aavascript:alert(1))",
    "[x](&#106;avascript:alert(1))",
  ];

  it("produces no link node for any of them", () => {
    for (const src of mustNotLink) {
      const out = parseInline(src);
      expect(
        out.some((n) => n.type === "link"),
        src,
      ).toBe(false);
    }
  });

  it("keeps the words the user typed instead of deleting the token", () => {
    // A refused scheme loses the link, never the text. Silently dropping it
    // would make a note lose content with nothing to show for it.
    for (const src of mustNotLink) {
      expect(plainText(src).includes("x"), src).toBe(true);
    }
  });

  it("refuses a colon-bearing target even when it looks harmless", () => {
    // The guard asks "is there a scheme, and is it listed" — not "does this
    // look dangerous". That is what makes it hold for schemes nobody has
    // thought of yet.
    expect(
      parseInline("[x](weird:thing)").some((n) => n.type === "link"),
    ).toBe(false);
  });
});

describe("what the allowlist does let through, deliberately", () => {
  it("takes a protocol-relative link", () => {
    // `//host` matches the `^\/` arm. It navigates, it does not execute, and
    // the renderer gives it neither `target` nor `rel` — so it opens in the
    // same tab and cannot reverse-tabnab. Pinned so this is a decision on
    // record rather than an oversight nobody noticed.
    expect(parseInline("[x](//example.com)")[0]).toMatchObject({
      type: "link",
      href: "//example.com",
    });
  });

  it("takes a bare relative path, which carries no scheme at all", () => {
    expect(parseInline("[x](notes/2026)")[0]).toMatchObject({ type: "link" });
    expect(parseInline("[x](#anchor)")[0]).toMatchObject({ type: "link" });
  });
});

describe("the parser cannot be made to hang or blow the stack", () => {
  // With injection closed by construction, the remaining risk on a note the
  // user pasted is denial of service.
  const within = (ms: number, fn: () => void) => {
    const t0 = performance.now();
    fn();
    expect(performance.now() - t0).toBeLessThan(ms);
  };

  it("survives a long run of unmatched markers", () => {
    // Every alternative in INLINE_RE needs at least two characters, so a match
    // always shortens the remaining input — there is no zero-width match to
    // loop on. These inputs never match at all and must fall straight through.
    within(2000, () => parseInline("*".repeat(20_000)));
    within(2000, () => parseInline("[".repeat(20_000)));
    within(2000, () => parseInline("`".repeat(20_000)));
  });

  it("survives many complete tokens on one line", () => {
    within(2000, () => parseInline("**a** ".repeat(5_000)));
    within(2000, () => parseInline("[x](https://a.example) ".repeat(5_000)));
  });

  it("survives a large document", () => {
    const doc = ["# Title", "", "- item **bold**", "> quote", "```", "code", "```"]
      .join("\n")
      .repeat(2_000);
    within(4000, () => parseMarkdown(doc));
  });

  it("does not recurse without bound", () => {
    // `**` can never contain another `**`: the inner class excludes `*`. So
    // nesting depth is bounded by how many DIFFERENT marker types alternate,
    // not by the length of the input.
    expect(() => parseInline("**__*_`x`_*__**".repeat(50))).not.toThrow();
  });
});
