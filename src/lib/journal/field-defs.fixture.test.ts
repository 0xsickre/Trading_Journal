import { describe, expect, it } from "vitest";
import { SEEDED_FIELD_DEFS } from "./field-defs.fixture";

describe("SEEDED_FIELD_DEFS (phase J)", () => {
  it("is the trader's book of 15.10.2026: seven fields, named in Serbian, in form order", () => {
    expect(SEEDED_FIELD_DEFS.map((d) => [d.key, d.label, d.list_key, d.show_phase])).toEqual([
      ["htf_bias", "Bias dana", "htf_bias", "always"],
      ["entry_tf", "TF ulaza", "entry_tf", "always"],
      ["technical_tags", "Tehnički tagovi", "technical_tag", "always"],
      ["exit_reason", "Razlog izlaza", "exit_reason", "active"],
      ["mistake", "Greške", "mistake", "active"],
      ["psychology_tags", "Psihologija", "emotion", "active"],
      ["miss_reason", "Razlog propuštanja", "miss_reason", "missed"],
    ]);
  });
});
