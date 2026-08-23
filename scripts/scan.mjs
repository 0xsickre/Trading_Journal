#!/usr/bin/env node
/**
 * The sweep `tsc`, `eslint` and `knip` do not do.
 *
 * Each of those answers a question about MEANING — does it type, does it follow
 * the rules, is it reachable. None of them looks at the bytes. This does, and it
 * exists because a literal NUL byte sat inside a template literal in
 * `option-usage.ts` for weeks: git classified the file as binary, `grep` skipped
 * it silently, and no compiler was ever going to say a word. A second one was
 * found in `dashboard-templates.ts` the day this script was written.
 *
 * Run with `npm run scan`. Exits non-zero on any finding, so it can gate CI
 * next to the other three.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, sep } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage"]);

const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".sql", ".css", ".yml", ".yaml", ".html",
]);

/** Where a byte-level rule applies: code, not prose or generated output. */
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql"]);

const findings = [];
const report = (what, file, line) =>
  findings.push({ what, file, line: line ?? null });

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

for (const path of walk(".")) {
  const ext = extname(path).toLowerCase();
  if (!TEXT_EXT.has(ext)) continue;

  const raw = readFileSync(path);
  const posix = path.split(sep).join("/");
  const isTest = /\.(test|spec)\.[jt]sx?$/.test(posix);

  // 1. Bytes that survive in source and break tooling without saying so.
  //
  // A NUL makes git call the file binary, which makes `grep` and every
  // repo-wide search skip it. Write it as the `\0` ESCAPE instead: same value
  // at runtime, still a text file.
  if (raw.includes(0)) report("NUL byte (write it as the \\0 escape)", path);
  if (raw.includes(0x0c)) report("form feed", path);

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    report("not valid UTF-8", path);
    continue;
  }

  // 2. Whitespace that is not whitespace. A non-breaking space between two
  //    tokens looks like a space and is a different character; the parser is
  //    fine with it in a string and not fine with it anywhere else.
  //
  //    Tests are exempt: NBSP is the thousands separator MT5 writes, and
  //    `parseImportNumber` exists to read it, so the fixtures carry it on
  //    purpose.
  if (CODE_EXT.has(ext) && !isTest) {
    // Written as ESCAPES, not as the characters themselves: spelled
    // literally, this file would report itself on this very line.
    for (const [ch, label] of [
      ["\u200b", "zero-width space"],
      ["\u00a0", "non-breaking space"],
    ]) {
      const i = text.indexOf(ch);
      if (i >= 0) report(label, path, lineOf(text, i));
    }
  }

  // 3. JSON that does not parse. `tsc` never opens these.
  if (ext === ".json") {
    try {
      JSON.parse(text);
    } catch (e) {
      report(`invalid JSON: ${e.message}`, path);
    }
  }

  // 4. Debug leftovers in shipped code.
  if ((ext === ".ts" || ext === ".tsx") && !isTest && !posix.includes("/test/")) {
    const re = /^[ \t]*(console\.(log|debug|dir)|debugger)\b/gm;
    for (const m of text.matchAll(re)) {
      report(m[1], path, lineOf(text, m.index));
    }
  }

  // 5. A conflict marker that survived a merge.
  const conflict = /^(<{7} |={7}$|>{7} )/m.exec(text);
  if (conflict) report("merge conflict marker", path, lineOf(text, conflict.index));

  // 6. `.only` silently skips the rest of its file; `.skip` silently keeps a
  //    test green by not running it. Both read as a passing suite.
  if (isTest) {
    for (const tag of ["only", "skip"]) {
      const re = new RegExp(`\\b(describe|it|test)\\.${tag}\\b`);
      const m = re.exec(text);
      if (m) report(`.${tag} left in a test`, path, lineOf(text, m.index));
    }
  }
}

if (findings.length === 0) {
  console.log(
    "scan: clean — no control bytes, no invalid JSON, no debug leftovers, no conflict markers, no .only/.skip",
  );
  process.exit(0);
}

for (const f of findings.sort((a, b) => a.file.localeCompare(b.file))) {
  console.log(`${f.file}${f.line ? `:${f.line}` : ""}  ${f.what}`);
}
console.log(`\n${findings.length} finding(s)`);
process.exit(1);
