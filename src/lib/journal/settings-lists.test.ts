import { describe, expect, it } from "vitest";
import {
  editableLists,
  LISTS_HIDDEN_FROM_SETTINGS,
} from "./settings-lists";

describe("editableLists", () => {
  const lists = [
    { key: "exit_reason" },
    { key: "setup_grade" },
    { key: "rule_category" },
    { key: "direction" },
    { key: "technical_tag" },
  ];

  it("drops the three lists that have no working editor here", () => {
    expect(editableLists(lists).map((l) => l.key)).toEqual([
      "exit_reason",
      "technical_tag",
    ]);
  });

  it("keeps the original order of what is left", () => {
    const reversed = [...lists].reverse();
    expect(editableLists(reversed).map((l) => l.key)).toEqual([
      "technical_tag",
      "exit_reason",
    ]);
  });

  it("passes an unknown list through — hiding is opt-in, never a default", () => {
    expect(editableLists([{ key: "something_new" }])).toHaveLength(1);
  });

  it("gives every hidden list a reason, because a silent omission is a bug report", () => {
    for (const [key, reason] of Object.entries(LISTS_HIDDEN_FROM_SETTINGS)) {
      expect(reason.length, key).toBeGreaterThan(0);
    }
  });
});
