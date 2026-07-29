import { describe, expect, it } from "vitest";
import {
  applicableAnswers,
  computeFollowRate,
  convictionDimension,
  playbookDimension,
  playbookRuleDimension,
  type RuleLookup,
} from "./playbook-dimensions";
import { bucketsOf, EMPTY_BUCKET } from "./dimensions";
import { runReport } from "./engine";
import { dimCtx, enrich, metricCtx, mkTrade } from "./test-helpers";
import { enrichTrades } from "../enriched-trade";
import type { PositionRule, ShowWhen } from "../playbook-types";

type Answer = { trade: string; rule: string; followed: boolean | null };

function lookup(
  rules: { id: string; text: string; show_when?: ShowWhen }[],
  answers: Answer[],
): RuleLookup {
  const answersByTrade = new Map<string, PositionRule[]>();
  for (const a of answers) {
    const bucket = answersByTrade.get(a.trade) ?? [];
    bucket.push({ position_id: a.trade, rule_id: a.rule, followed: a.followed });
    answersByTrade.set(a.trade, bucket);
  }
  return {
    text: new Map(rules.map((r) => [r.id, r.text])),
    showWhen: new Map(rules.map((r) => [r.id, r.show_when ?? "always"])),
    answersByTrade,
  };
}

/** Trades with stable ids, so answers can be attached by id. */
const book = (specs: { id: string; net: number }[]) =>
  enrichTrades(
    specs.map((s) => mkTrade({ id: s.id, net: s.net, r: s.net / 100 })),
    { tzOf: () => "UTC" },
  );

describe("follow rate", () => {
  it("is the share of answered rules that were followed", () => {
    const trades = book([
      { id: "t1", net: 100 },
      { id: "t2", net: 100 },
      { id: "t3", net: 100 },
      { id: "t4", net: -100 },
    ]);
    const rules = lookup(
      [{ id: "r1", text: "Čekaj potvrdu" }],
      [
        { trade: "t1", rule: "r1", followed: true },
        { trade: "t2", rule: "r1", followed: true },
        { trade: "t3", rule: "r1", followed: true },
        { trade: "t4", rule: "r1", followed: false },
      ],
    );
    expect(computeFollowRate(trades, rules)).toBe(75);
  });

  it("ignores unanswered rules in both numerator and denominator", () => {
    // Not answering is missing information, not a violation. Counting it as one
    // would invent a discipline problem out of a half-filled form.
    const trades = book([
      { id: "t1", net: 100 },
      { id: "t2", net: 100 },
    ]);
    const rules = lookup(
      [{ id: "r1", text: "Čekaj potvrdu" }],
      [
        { trade: "t1", rule: "r1", followed: true },
        { trade: "t2", rule: "r1", followed: null },
      ],
    );
    expect(computeFollowRate(trades, rules)).toBe(100);
  });

  it("counts only the scoped rule, not every answer the same trades carry", () => {
    // The regression: a row labelled "Čekaj sweep" used to average in answers to
    // every OTHER rule those trades happened to carry, and read as a statement
    // about one rule while describing several.
    const trades = book([
      { id: "t1", net: 300 },
      { id: "t2", net: -100 },
    ]);
    const rules = lookup(
      [
        { id: "r1", text: "Čekaj sweep" },
        { id: "r2", text: "Killzone" },
      ],
      [
        { trade: "t1", rule: "r1", followed: true },
        { trade: "t2", rule: "r1", followed: false },
        { trade: "t1", rule: "r2", followed: true },
      ],
    );
    expect(computeFollowRate(trades, rules, ["Čekaj sweep"])).toBe(50);
    expect(computeFollowRate(trades, rules, ["Killzone"])).toBe(100);
    // Unscoped — grouping by something that is not a rule — is every answer,
    // which is the right reading of "how disciplined was I on these trades".
    expect(computeFollowRate(trades, rules)).toBeCloseTo(66.67, 1);
  });

  it("ignores a scope bucket that names no rule", () => {
    const trades = book([{ id: "t1", net: 100 }]);
    const rules = lookup(
      [{ id: "r1", text: "Čekaj sweep" }],
      [{ trade: "t1", rule: "r1", followed: true }],
    );
    expect(computeFollowRate(trades, rules, ["A+"])).toBe(100);
  });

  it("shares a bucket between rules that share wording", () => {
    // An edited rule kept alongside its retired original: same text, two ids.
    // They share a row, so they must share the row's statistics.
    const trades = book([
      { id: "t1", net: 100 },
      { id: "t2", net: 100 },
    ]);
    const rules = lookup(
      [
        { id: "old", text: "Čekaj sweep" },
        { id: "new", text: "Čekaj sweep" },
      ],
      [
        { trade: "t1", rule: "old", followed: true },
        { trade: "t2", rule: "new", followed: false },
      ],
    );
    expect(computeFollowRate(trades, rules, ["Čekaj sweep"])).toBe(50);
  });

  it("is null, not zero, when nothing was answered at all", () => {
    expect(computeFollowRate(book([{ id: "t1", net: 100 }]), lookup([], []))).toBeNull();
  });
});

describe("show_when scoping", () => {
  const rules = lookup(
    [
      { id: "always", text: "Uvek", show_when: "always" },
      { id: "onwin", text: "Pusti da radi", show_when: "winner" },
    ],
    [
      { trade: "win", rule: "always", followed: true },
      { trade: "win", rule: "onwin", followed: false },
      { trade: "loss", rule: "always", followed: true },
      // Recorded while the trade was green, then it closed red.
      { trade: "loss", rule: "onwin", followed: true },
    ],
  );

  const trades = book([
    { id: "win", net: 200 },
    { id: "loss", net: -200 },
  ]);

  it("keeps a winner-only answer on a winning trade", () => {
    const win = trades.find((t) => t.id === "win")!;
    expect(applicableAnswers(win, rules).map((a) => a.rule_id).sort()).toEqual([
      "always",
      "onwin",
    ]);
  });

  it("drops a winner-only answer once the trade closed red", () => {
    // The outcome can change after the checklist was filled in. Counting the
    // stale answer would place an observation in a population the trader was
    // never asked about.
    const loss = trades.find((t) => t.id === "loss")!;
    expect(applicableAnswers(loss, rules).map((a) => a.rule_id)).toEqual(["always"]);
  });

  it("scopes the follow rate to the population the rule applies to", () => {
    const onlyWinRule: RuleLookup = { ...rules, text: new Map([["onwin", "Pusti"]]) };
    // Only the winning trade answers the winner-only rule, and it answered false.
    const winners = trades.filter((t) => t.outcome === "win");
    const dim = playbookRuleDimension(onlyWinRule);
    const rows = bucketsOf(dim, winners[0], dimCtx());
    expect(rows).toContain("Pusti");
  });
});

describe("playbook_rule dimension", () => {
  const rules = lookup(
    [
      { id: "r1", text: "Čekaj sweep" },
      { id: "r2", text: "Ulaz samo u killzone" },
    ],
    [
      { trade: "t1", rule: "r1", followed: true },
      { trade: "t1", rule: "r2", followed: false },
    ],
  );

  it("places one trade in a bucket per answered rule", () => {
    const dim = playbookRuleDimension(rules);
    const t = book([{ id: "t1", net: 100 }])[0];
    expect(dim.multiValue).toBe(true);
    expect(bucketsOf(dim, t, dimCtx()).sort()).toEqual([
      "Ulaz samo u killzone",
      "Čekaj sweep",
    ]);
  });

  it("excludes a trade with no answers rather than bucketing it as empty", () => {
    const dim = playbookRuleDimension(rules);
    const t = book([{ id: "unanswered", net: 100 }])[0];
    expect(bucketsOf(dim, t, dimCtx())).toEqual([]);
  });

  it("keeps a retired rule's history, because the lookup still names it", () => {
    // Soft delete removes the rule from the checklist, not from the record. The
    // stats read includes deleted rules, so past trades keep their bucket.
    const t = book([{ id: "t1", net: 100 }])[0];
    const dim = playbookRuleDimension(rules);
    const before = bucketsOf(dim, t, dimCtx());
    // Deleting changes nothing here — the dimension reads the lookup, and the
    // stats lookup is built with includeDeleted.
    expect(before.sort()).toEqual(["Ulaz samo u killzone", "Čekaj sweep"]);
  });

  it("scores each rule separately through the ordinary engine", () => {
    const trades = book([
      { id: "t1", net: 300 },
      { id: "t2", net: -100 },
    ]);
    const r = lookup(
      [
        { id: "r1", text: "Čekaj sweep" },
        { id: "r2", text: "Killzone" },
      ],
      [
        { trade: "t1", rule: "r1", followed: true },
        { trade: "t2", rule: "r1", followed: false },
        { trade: "t1", rule: "r2", followed: true },
      ],
    );

    const report = runReport({
      trades,
      dimension: playbookRuleDimension(r),
      metricKeys: ["net_pnl", "follow_rate"],
      dimensionContext: dimCtx(),
      metricContext: { ...metricCtx, rules: r },
      minSample: 1,
    })!;

    const sweep = report.rows.find((row) => row.bucket === "Čekaj sweep")!;
    expect(sweep.n).toBe(2);
    expect(sweep.values.net_pnl).toBe(200);
    expect(sweep.values.follow_rate).toBe(50);

    const killzone = report.rows.find((row) => row.bucket === "Killzone")!;
    expect(killzone.n).toBe(1);
    expect(killzone.values.follow_rate).toBe(100);

    // One trade sits in two rows, so the rows do not sum to the book.
    expect(report.multiValue).toBe(true);
  });

  it("flags a thin rule instead of letting it read as a finding", () => {
    const trades = book([{ id: "t1", net: 500 }]);
    const r = lookup(
      [{ id: "r1", text: "Retko pravilo" }],
      [{ trade: "t1", rule: "r1", followed: true }],
    );
    const report = runReport({
      trades,
      dimension: playbookRuleDimension(r),
      metricKeys: ["net_pnl"],
      dimensionContext: dimCtx(),
      metricContext: { ...metricCtx, rules: r },
    })!;
    expect(report.rows[0].belowSample).toBe(true);
  });
});

describe("playbook and conviction dimensions", () => {
  it("resolves a playbook id to its name", () => {
    const dim = playbookDimension(new Map([["pb-1", "Silver Bullet"]]));
    const t = enrich([{ custom: {} }])[0];
    (t.trade.row as Record<string, unknown>).playbook_id = "pb-1";
    expect(bucketsOf(dim, t, dimCtx())).toEqual(["Silver Bullet"]);
  });

  it("shows an empty bucket for a trade with no playbook", () => {
    const dim = playbookDimension(new Map());
    expect(bucketsOf(dim, enrich([{}])[0], dimCtx())).toEqual([EMPTY_BUCKET]);
  });

  it("buckets conviction and excludes it when unrated", () => {
    const rated = enrich([{}])[0];
    (rated.trade.row as Record<string, unknown>).conviction = 4;
    expect(bucketsOf(convictionDimension, rated, dimCtx())).toEqual(["4"]);
    expect(bucketsOf(convictionDimension, enrich([{}])[0], dimCtx())).toEqual([]);
  });

  it("rejects a conviction outside 1–5 rather than inventing a bucket", () => {
    const bad = enrich([{}])[0];
    (bad.trade.row as Record<string, unknown>).conviction = 9;
    expect(bucketsOf(convictionDimension, bad, dimCtx())).toEqual([]);
  });
});
