import { describe, expect, it } from "vitest";
import {
  optionFieldTargets,
  optionUsageIsEmpty,
  optionUsageIsUnknown,
} from "./option-usage";
import { getAllFormFields } from "./form-config";

describe("optionUsageIsEmpty / optionUsageIsUnknown", () => {
  it("treats a failed count as NOT empty", () => {
    // The whole point of the sentinel: "we could not find out" must take the
    // careful path, never the one that offers a one-click delete.
    expect(optionUsageIsEmpty({ trades: -1 })).toBe(false);
    expect(optionUsageIsUnknown({ trades: -1 })).toBe(true);
  });

  it("treats a real zero as empty", () => {
    expect(optionUsageIsEmpty({ trades: 0 })).toBe(true);
    expect(optionUsageIsUnknown({ trades: 0 })).toBe(false);
  });
});

describe("optionFieldTargets — where a list's values land on a trade", () => {
  const fields = [
    { name: "exit_reason", type: "select", listKey: "exit_reason" },
    { name: "technical_tags", type: "tags", listKey: "technical_tag" },
    {
      name: "psychology_tags",
      type: "tags",
      listKeys: ["emotion", "discipline"],
    },
    { name: "macro_align", type: "select", listKey: "macro_align", custom: true },
    { name: "entry_price", type: "number" },
  ];

  it("finds a plain column and marks it scalar", () => {
    expect(optionFieldTargets(fields, "exit_reason")).toEqual([
      { key: "exit_reason", custom: false, array: false },
    ]);
  });

  it("marks a tag field as an array, because `@>` and `=` are different queries", () => {
    expect(optionFieldTargets(fields, "technical_tag")).toEqual([
      { key: "technical_tags", custom: false, array: true },
    ]);
  });

  it("follows `listKeys`, so a merged tag column is found from either list", () => {
    // Psychology draws from two lists into ONE column. A lookup that only read
    // `listKey` would report every emotion as unused.
    for (const key of ["emotion", "discipline"]) {
      expect(optionFieldTargets(fields, key)).toEqual([
        { key: "psychology_tags", custom: false, array: true },
      ]);
    }
  });

  it("marks a custom field, whose value lives in the jsonb bag", () => {
    expect(optionFieldTargets(fields, "macro_align")).toEqual([
      { key: "macro_align", custom: true, array: false },
    ]);
  });

  it("returns nothing for a list no field reads", () => {
    expect(optionFieldTargets(fields, "nothing_reads_this")).toEqual([]);
  });

  it("finds the real built-in fields, not just the fixture", () => {
    // Guards the mapping against `form-config.ts` drifting: if `exit_reason`
    // ever stops being a select on its own column, the usage count and the
    // rename cascade both go quietly blind and this is what notices.
    const real = getAllFormFields([]);
    expect(optionFieldTargets(real, "exit_reason")).toContainEqual({
      key: "exit_reason",
      custom: false,
      array: false,
    });
    expect(optionFieldTargets(real, "technical_tag")).toContainEqual({
      key: "technical_tags",
      custom: false,
      array: true,
    });
  });

  it("finds nothing for the lists Settings hides, which is why they are dead", () => {
    // `direction` is computed and `setup_grade` is derived; neither is read
    // from a list any more. If either comes back, `settings-lists.ts` is lying.
    const real = getAllFormFields([]);
    expect(optionFieldTargets(real, "direction")).toEqual([]);
    expect(optionFieldTargets(real, "setup_grade")).toEqual([]);
  });
});
