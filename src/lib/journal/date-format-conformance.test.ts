import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DATE, DATE_TIME, DAY_TIME } from "./time";

/**
 * Dates read day-first, and clocks read 24-hour, everywhere on screen.
 *
 * `MM/dd` is not a style, it is a different date: 03/07 is 7 March to the trader
 * reading it and 3 July to the format that wrote it, and nothing on screen says
 * which. The journal had four shapes at once — `MM/dd HH:mm`, `d MMM yyyy`,
 * `d. MMM yyyy.` and `yyyy-MM-dd HH:mm` — so this is both a fix and a fence.
 *
 * The fence matters more than the fix. One `format(d, "MM/dd")` added later
 * looks perfectly ordinary in a diff, and the wrong date it prints looks
 * perfectly ordinary on screen.
 */

const BANNED: [RegExp, string][] = [
  [/["'`]([^"'`]*\b)?MM\/dd/, "MM/dd is the American order — use DAY_TIME or DATE from lib/journal/time"],
  [/["'`]M\/d\//, "M/d/ is the American order — use DATE from lib/journal/time"],
  [/h:mm\s*a/, "12-hour clock — the journal is 24-hour"],
  [/hour12:\s*true/, "12-hour clock — the journal is 24-hour"],
  [/["']d\.? MMM/, "a month NAME reads differently by locale — use DATE or DATE_TIME"],
];

/** Day keys, input values and exports are machine-read and stay ISO. */
const ALLOWED_ISO = /yyyy-MM-dd/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("how a date is written on screen", () => {
  const files = walk("src");

  it("the three shapes are day-first and 24-hour", () => {
    expect(DATE).toBe("dd/MM/yyyy");
    expect(DATE_TIME).toBe("dd/MM/yyyy HH:mm");
    expect(DAY_TIME).toBe("dd/MM HH:mm");
  });

  it("no file writes a date in the American order or on a 12-hour clock", () => {
    const offenders: string[] = [];
    for (const file of files) {
      // This file quotes the patterns it forbids.
      if (file.endsWith("date-format-conformance.test.ts")) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (ALLOWED_ISO.test(line)) return;
        for (const [pattern, why] of BANNED) {
          if (pattern.test(line)) offenders.push(`${file}:${i + 1} — ${why}\n    ${line.trim()}`);
        }
      });
    }
    expect(offenders.join("\n")).toBe("");
  });
});
