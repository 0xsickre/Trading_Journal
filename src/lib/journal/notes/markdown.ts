/**
 * A small markdown parser for note bodies.
 *
 * Produces a TREE, not an HTML string. That is the whole security design: the
 * renderer walks this tree into React elements, so there is no
 * `dangerouslySetInnerHTML` anywhere and a note can never inject markup no
 * matter what is typed into it. Sanitizing an HTML string after the fact is the
 * approach that keeps needing patches; not producing one needs none.
 *
 * The supported subset is deliberately small — headings, lists, quotes, rules,
 * code blocks, and inline bold/italic/code/links. It covers what a weekly review
 * or a trade note actually contains. Anything unrecognized stays literal text
 * rather than being silently swallowed, so a stray `#` in a sentence renders as
 * a `#`.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Inline[] }
  | { type: "code"; value: string; lang: string | null }
  | { type: "rule" };

/**
 * Schemes a link may use.
 *
 * `javascript:` and `data:` are the two that turn a link into script execution,
 * so the list is an allowlist rather than a blocklist — a blocklist would have to
 * anticipate `vbscript:`, encoded variants, and whatever comes next.
 */
const SAFE_SCHEME = /^(https?:|mailto:|#|\/)/i;

function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href === "") return null;
  // A bare domain or relative path has no scheme and is safe by construction.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return SAFE_SCHEME.test(href) || !href.includes(":") ? href : null;
  }
  return SAFE_SCHEME.test(href) ? href : null;
}

/** Inline markers, longest first so `**` is never read as two `*`. */
const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]*\]\([^)\s]*\))/;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;

  /**
   * Append text, merging into the previous node when that is text too.
   *
   * Adjacent text nodes render identically to one, but they show up whenever a
   * token is rejected and emitted literally — a `javascript:` link splits into
   * "[x](javascript:alert(1" and ")". Merging keeps the tree the shape a reader
   * expects and keeps the React output one text node instead of several.
   */
  const pushText = (value: string) => {
    if (value === "") return;
    const last = out[out.length - 1];
    if (last?.type === "text") last.value += value;
    else out.push({ type: "text", value });
  };

  while (rest.length > 0) {
    const m = INLINE_RE.exec(rest);
    if (!m || m.index === undefined) break;

    if (m.index > 0) pushText(rest.slice(0, m.index));
    const token = m[0];

    if (token.startsWith("`")) {
      out.push({ type: "code", value: token.slice(1, -1) });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      out.push({ type: "strong", children: parseInline(token.slice(2, -2)) });
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      // A rejected scheme keeps its text and loses only the link. Dropping the
      // whole token would delete the words the user wrote.
      if (href) out.push({ type: "link", href, children: parseInline(label) });
      else pushText(token);
    } else {
      out.push({ type: "em", children: parseInline(token.slice(1, -1)) });
    }

    rest = rest.slice(m.index + token.length);
  }

  pushText(rest);
  return out;
}

const HEADING_RE = /^(#{1,4})\s+(.*)$/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const RULE_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_RE = /^```\s*(\S*)\s*$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];

  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      i++;
      // An unclosed fence runs to the end of the note rather than throwing —
      // a half-typed code block is a normal state while writing.
      while (i < lines.length && !FENCE_RE.test(lines[i])) body.push(lines[i++]);
      blocks.push({
        type: "code",
        value: body.join("\n"),
        lang: fence[1] || null,
      });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    if (RULE_RE.test(line)) {
      flushParagraph();
      blocks.push({ type: "rule" });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4,
        children: parseInline(heading[2]),
      });
      continue;
    }

    const ordered = OL_RE.test(line);
    if (ordered || UL_RE.test(line)) {
      flushParagraph();
      const items: Inline[][] = [];
      // Consume the whole run so consecutive bullets are ONE list, not one list
      // per bullet — which is what makes the spacing look right.
      while (i < lines.length) {
        const re = ordered ? OL_RE : UL_RE;
        const m = re.exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[1]));
        i++;
      }
      i--;
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      flushParagraph();
      const body: string[] = [quote[1]];
      while (i + 1 < lines.length) {
        const next = QUOTE_RE.exec(lines[i + 1]);
        if (!next) break;
        body.push(next[1]);
        i++;
      }
      blocks.push({ type: "quote", children: parseInline(body.join(" ")) });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

/**
 * Visible text of a run of inline nodes.
 *
 * `code` carries its value verbatim — a code span is shown as typed, so its
 * text is searchable as typed. A rejected link is not a link node at all by the
 * time it gets here; it is literal text, and comes back as the literal text the
 * reader sees.
 */
export function inlineText(nodes: readonly Inline[]): string {
  let out = "";
  for (const n of nodes) {
    out += n.type === "text" || n.type === "code" ? n.value : inlineText(n.children);
  }
  return out;
}

function blockText(block: Block): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "quote":
      return inlineText(block.children);
    case "list":
      return block.items.map(inlineText).join(" ");
    // Fenced code is not prose. It is dropped from previews on purpose — a
    // preview of a pasted trade log tells the reader nothing about the note.
    case "code":
    case "rule":
      return "";
  }
}

/**
 * Plain text of a note, for search and for the list preview.
 *
 * Derived from the PARSE TREE, not from the source with a second set of regexes.
 * Two parsers over the same grammar is two answers to "what does this note say",
 * and the search box promises the rendered text: looking for `bold` must find a
 * note that wrote `**bold**`, and looking for `a**b` must find a note that wrote
 * it inside a code span, where the asterisks are literal and shown.
 */
export function plainText(content: string): string {
  return parseMarkdown(content)
    .map(blockText)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * First non-empty line, stripped of its marks — the fallback title for a note
 * saved without one.
 *
 * A note with no title is normal: you start typing and think about the title
 * later, and an untitled row in the list is useless for finding it again.
 *
 * Line-based rather than block-based on purpose: a paragraph joins its lines,
 * and a title made of three joined sentences truncated at 80 characters is
 * worse at finding the note than its first line. Only the BLOCK marks are
 * stripped here; the inline ones go through the parser, so a note opening with
 * `**Nedelja 31**` is titled `Nedelja 31` and not `**Nedelja 31**`.
 *
 * The block marks are stripped with the SAME regexes the block parser uses. A
 * hand-written `^[>\-*+]\s*` looks equivalent and is not: it has no `\s+` after
 * the bullet, so it ate the first asterisk of `**Nedelja 31**` and left the
 * title reading `Nedelja 31*`.
 */
export function deriveTitle(content: string, fallback = "Untitled"): string {
  for (const line of content.split("\n")) {
    const stripped = line
      .replace(HEADING_RE, "$2")
      .replace(UL_RE, "$1")
      .replace(OL_RE, "$1")
      .replace(QUOTE_RE, "$1");
    const text = inlineText(parseInline(stripped)).trim();
    if (text) return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  }
  return fallback;
}
