#!/usr/bin/env node
/**
 * How many human-readable strings in `src/` are Serbian, and how many there are
 * in total.
 *
 * README § "On language" states both numbers and calls them counted rather than
 * claimed. Until now the counting was done by hand, twice, and both times the
 * README had to be corrected afterwards ("about 46 of some 1,700", then "153 of
 * 1,663"). A claim that cannot be re-run is a claim nobody can check, so this is
 * the method the README describes, written down and runnable.
 *
 * METHOD, and its limits
 *
 * Every `.ts`/`.tsx` outside tests is lexed into comment / string / code
 * regions, character by character — a regex cannot do this, because an
 * apostrophe inside a comment and a quote inside a string look identical to it.
 * Only string regions are scored, and only those that read as prose: a string
 * with no letters, an import path, a CSS class, a `data-*` key or a single
 * lowercase identifier is not a sentence anyone reads.
 *
 * A string counts as Serbian when it carries one of the Latin diacritics this
 * project writes (č ć š ž đ) or one of the words below. A Serbian word without
 * a diacritic that is not on the list still slips through, so the Serbian count
 * is a FLOOR, not a ceiling — which is exactly how the README states it.
 *
 * Run with `npm run lang:count`. Prints totals and the per-file breakdown the
 * README's table is grouped from.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "src";
const SKIP = /\.(test|spec)\.tsx?$/;

const WORDS = [
  "ako", "ali", "bez", "broj", "cena", "dan", "dana", "dani", "gde", "ili",
  "jedan", "jeste", "kad", "kada", "kako", "koji", "koje", "koliko", "koristi",
  "mora", "nalog", "nema", "nije", "novi", "ostalo", "posle", "prikaz", "pre",
  "prvi", "rizik", "samo", "sve", "svi", "trejd", "trejda", "trejdova", "unos",
  "upisi", "vec", "vise", "za", "zato", "sto",
];
const DIACRITICS = /[čćšžđČĆŠŽĐ]/;
const WORD_RE = new RegExp(`(^|[^\\p{L}])(${WORDS.join("|")})([^\\p{L}]|$)`, "iu");

/** Files, newest-first order is irrelevant — sorted for a stable report. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name) && !SKIP.test(name)) out.push(p);
  }
  return out.sort();
}

/**
 * String literals of a source file, comments and code excluded.
 *
 * Template literals are read for their text only: `${}` holes are code, and a
 * variable name inside one is not something anyone reads on screen.
 */
function strings(src) {
  const found = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let buf = "";
      let depth = 0;
      i++;
      while (i < n) {
        const ch = src[i];
        if (ch === "\\") {
          buf += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (quote === "`" && ch === "$" && src[i + 1] === "{") {
          depth = 1;
          i += 2;
          // Skip the hole, braces balanced. Nested strings inside it are rare
          // and short; treating them as code loses nothing a reader sees.
          while (i < n && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            i++;
          }
          continue;
        }
        if (ch === quote) {
          i++;
          break;
        }
        buf += ch;
        i++;
      }
      found.push(buf);
      continue;
    }
    i++;
  }
  return found;
}

/** Does this string read as prose rather than as machinery? */
function isProse(s) {
  const t = s.trim();
  if (t.length < 3) return false;
  if (!/\p{L}/u.test(t)) return false;
  if (/^[@./#]/.test(t)) return false; // import paths, selectors, anchors
  if (/^[a-z0-9-]+(\/[a-z0-9-]+)+$/i.test(t)) return false; // paths, mime types
  if (/^[a-z][a-zA-Z0-9]*$/.test(t)) return false; // identifiers, keys
  if (/^[a-z0-9_]+$/.test(t)) return false; // snake_case keys
  if (/^(?:[a-z-]+:)?[a-z0-9-]+(?:\s+[a-z0-9:[\]/.()-]+)*$/.test(t) && !/\s[A-ZČĆŠŽĐ]/.test(t)) {
    // Tailwind class lists and other lowercase token soup.
    if (/(^|\s)(flex|grid|text|bg|border|p|px|py|m|mx|my|w|h|gap|rounded|absolute|relative|hidden|size)-/.test(t)) return false;
  }
  return true;
}

function isSerbian(s) {
  return DIACRITICS.test(s) || WORD_RE.test(s);
}

const files = walk(ROOT);
let total = 0;
let serbian = 0;
const perFile = [];

for (const f of files) {
  const src = readFileSync(f, "utf8");
  const lits = strings(src).filter(isProse);
  const sr = lits.filter(isSerbian);
  total += lits.length;
  serbian += sr.length;
  if (sr.length > 0) perFile.push([relative(ROOT, f), sr.length]);
}

perFile.sort((a, b) => b[1] - a[1]);
for (const [f, n] of perFile) console.log(String(n).padStart(4), f);
console.log(`\n${serbian} Serbian of ${total} human-readable strings in ${files.length} files`);
console.log("The Serbian figure is a floor: a Serbian word with no diacritic that is not on the word list is not counted.");
