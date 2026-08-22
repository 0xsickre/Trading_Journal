import { describe, expect, it } from "vitest";
import {
  fieldAppliesToPhase,
  FIELD_DEF_PHASE_LABELS,
  FIELD_DEF_PHASES,
  FIELD_DEF_TYPES,
  slugifyFieldKey,
} from "./field-def-types";

/**
 * The key this produces is written straight into `tj_field_defs.key`, which
 * carries `CHECK (key ~ '^[a-z][a-z0-9_]{0,48}$')`. A slug that misses that
 * pattern is not a cosmetic problem: the insert fails and the user is shown a
 * raw Postgres constraint error for a label they typed in their own language.
 *
 * The function had no test at all — 0% branch coverage on the only code in the
 * app that generates a database identifier from free text.
 */
const DB_KEY = /^[a-z][a-z0-9_]{0,48}$/;

describe("slugifyFieldKey produces a key the database will accept", () => {
  const LABELS = [
    "ATR at entry",
    "Čekirano",
    "Ćošak Šišmiš Žaba",
    "naslov—crtica",
    "9 lives",
    "123",
    "!!!",
    "___",
    "-",
    "   ",
    "",
    "a",
    "Z",
    "A".repeat(60),
    "1".repeat(60),
    `${"x".repeat(48)} y`,
    "Entry TF (15m / 1h)",
    "R:R planiran",
  ];

  it("satisfies the CHECK for every label, ordinary or hostile", () => {
    for (const label of LABELS) {
      expect(slugifyFieldKey(label), `label ${JSON.stringify(label)}`).toMatch(
        DB_KEY,
      );
    }
  });

  it("strips diacritics instead of dropping the letters under them", () => {
    // Naive `[^a-z0-9]` stripping on the composed form eats the base letter and
    // turns "Čekirano" into "ekirano". The NFD normalise is what prevents that.
    expect(slugifyFieldKey("Čekirano")).toBe("cekirano");
    expect(slugifyFieldKey("Ćošak Šišmiš Žaba")).toBe("cosak_sismis_zaba");
  });

  it("prefixes a key that would not start with a letter", () => {
    expect(slugifyFieldKey("9 lives")).toBe("f_9_lives");
    expect(slugifyFieldKey("123")).toBe("f_123");
  });

  it("never exceeds the 49 characters the column allows", () => {
    // Both paths can overrun: the plain slice, and the `f_` prefix added AFTER
    // slicing, which is why the prefixed branch slices a second time.
    expect(slugifyFieldKey("A".repeat(60))).toHaveLength(49);
    expect(slugifyFieldKey("1".repeat(60))).toHaveLength(49);
  });

  it("is stable — the same label always gives the same key", () => {
    // Keys address values inside the `custom` jsonb bag. A slug that drifted
    // between two saves would orphan everything written under the old one.
    for (const label of LABELS) {
      expect(slugifyFieldKey(label)).toBe(slugifyFieldKey(label));
    }
  });

  it("collapses a label with no usable characters to a bare 'f'", () => {
    // Recorded rather than fixed: "!!!", "___", "-" and whitespace all land on
    // the same key, so a second such field collides on the (user_id, key)
    // unique index. The right place to stop that is `addFieldDef`, which should
    // refuse a label that slugs to nothing meaningful — see step 6.
    for (const junk of ["!!!", "___", "-", "   ", ""]) {
      expect(slugifyFieldKey(junk)).toBe("f");
    }
  });
});

describe("phase metadata is complete", () => {
  it("labels every phase the DB CHECK allows", () => {
    // `tj_field_defs.show_phase` is checked against exactly these four. One
    // added to the constant without a label would render as `undefined` in the
    // Settings picker.
    for (const p of FIELD_DEF_PHASES) {
      expect(FIELD_DEF_PHASE_LABELS[p]).toBeTruthy();
    }
    expect(Object.keys(FIELD_DEF_PHASE_LABELS).sort()).toEqual(
      [...FIELD_DEF_PHASES].sort(),
    );
  });

  it("offers only field types the DB CHECK allows", () => {
    expect([...FIELD_DEF_TYPES].sort()).toEqual(
      ["number", "select", "tags", "text", "textarea", "url"].sort(),
    );
  });
});

describe("fieldAppliesToPhase", () => {
  const PHASES = ["planned", "active", "missed"] as const;

  it("shows an `always` category in every phase", () => {
    for (const p of PHASES) expect(fieldAppliesToPhase("always", p)).toBe(true);
  });

  it("shows a pinned category only in its own phase", () => {
    for (const pinned of PHASES) {
      for (const p of PHASES) {
        expect(
          fieldAppliesToPhase(pinned, p),
          `${pinned} in ${p}`,
        ).toBe(pinned === p);
      }
    }
  });
});
