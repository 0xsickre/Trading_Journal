import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import type {
  LinkedRule,
  Playbook,
  PlaybookRule,
  PlaybookSection,
  PositionRule,
  ShowWhen,
} from "./playbook-types";

export type { Playbook, PositionRule } from "./playbook-types";

type RuleRow = {
  id: string;
  text: string;
  show_when: string;
  sort_order: number;
  deleted_at: string | null;
};

type LinkRow = {
  id: string;
  playbook_id: string;
  rule_id: string;
  section_id: string;
  is_setup_criterion: boolean;
  sort_order: number;
};

type SectionRow = {
  id: string;
  playbook_id: string;
  label: string;
  description: string | null;
  sort_order: number;
};

const RULE_COLUMNS = "id,text,show_when,sort_order,deleted_at";

/**
 * Playbooks with their groups and rules.
 *
 * `includeDeleted` is the difference between the two jobs this data does. The
 * checklist on the trade form must never offer a retired rule, so it passes
 * false. Anything that reads STATISTICS passes true, because a retired rule's
 * historical answers are still real observations and dropping them would move
 * numbers for trades that were logged years before the rule was retired.
 */
export async function getPlaybooks(
  {
    includeDeleted = false,
    activeOnly = false,
    positionRules,
  }: {
    includeDeleted?: boolean;
    activeOnly?: boolean;
    /**
     * Answers the caller has already loaded, or the promise of them.
     *
     * `tj_position_rules` holds one row per rule per trade and is the
     * fastest-growing table in the schema. `/reports` and the dashboard both
     * need the raw answers AND the per-rule counts, and used to drain the whole
     * table twice per render — once here and once through `getPositionRules`.
     * Handing the map in derives the counts from rows already in memory.
     *
     * A PROMISE is accepted so the caller does not have to await first. It used
     * to: the dashboard held `await getPositionRules()` alone above its
     * `Promise.all` purely to have a map to pass here, which bought the single
     * drain at the price of a serial round trip. Passing the unresolved promise
     * keeps the single drain and lets this function's own three reads start
     * immediately — the await lands inside the `Promise.all` below, where it
     * costs nothing.
     */
    positionRules?:
      | Map<string, PositionRule[]>
      | Promise<Map<string, PositionRule[]>>;
  } = {},
): Promise<Playbook[]> {
  const supabase = await createClient();

  const [{ data: books }, { data: links }, { data: sections }, rules, counts] =
    await Promise.all([
      supabase
        .from("tj_playbooks")
        .select(
          "id,name,description,color,icon,is_active,sort_order,default_risk_pct,a_plus_criteria",
        )
        .order("sort_order")
        .order("id"),
      supabase
        .from("tj_playbook_rule_links")
        .select("id,playbook_id,rule_id,section_id,is_setup_criterion,sort_order")
        .order("sort_order")
        .order("id"),
      // A fifth read rather than a join, and it costs no round trip: it lands in
      // the `Promise.all` that was already here. A book's sections have to come
      // back even when the book links no rule at all — a join through the links
      // would drop exactly the empty section that is a prompt to write one.
      supabase
        .from("tj_playbook_sections")
        .select("id,playbook_id,label,description,sort_order")
        .order("sort_order")
        .order("id"),
      // The LIBRARY, not one book's rules: every rule the user has written, so the
      // manager can offer them for linking and the lookup can name a retired one.
      selectAllPages<RuleRow>((from, to) =>
        supabase
          .from("tj_playbook_rules")
          .select(RULE_COLUMNS)
          .order("sort_order")
          .order("id")
          .range(from, to),
      ),
      positionRules
        ? Promise.resolve(positionRules).then(countAnswersByRule)
        : ruleAnswerCounts(),
    ]);

  const byId = new Map<string, PlaybookRule>();
  for (const r of rules) {
    if (!includeDeleted && r.deleted_at != null) continue;
    byId.set(r.id, toLibraryRule(r, counts));
  }

  const sectionsByBook = new Map<string, PlaybookSection[]>();
  for (const s of (sections ?? []) as SectionRow[]) {
    const bucket = sectionsByBook.get(s.playbook_id) ?? [];
    bucket.push({
      id: s.id,
      label: s.label,
      description: s.description,
      sort_order: s.sort_order,
    });
    sectionsByBook.set(s.playbook_id, bucket);
  }

  // A link to a rule filtered out above (retired, with includeDeleted false) is
  // skipped rather than left as a hole — the checklist must not offer it, and a
  // placeholder row would be a rule with no text.
  const rulesByBook = new Map<string, LinkedRule[]>();
  for (const l of (links ?? []) as LinkRow[]) {
    const rule = byId.get(l.rule_id);
    if (!rule) continue;
    const bucket = rulesByBook.get(l.playbook_id) ?? [];
    // The library row plus what the LINK says. Spread in this order on purpose:
    // the link owns `section_id` and `is_setup_criterion`, and the same library
    // row is shared by every book that links it, so it must never be mutated.
    bucket.push({
      ...rule,
      link_id: l.id,
      section_id: l.section_id,
      is_setup_criterion: l.is_setup_criterion,
      link_sort: l.sort_order,
    });
    rulesByBook.set(l.playbook_id, bucket);
  }

  return (books ?? [])
    .filter((b) => !activeOnly || b.is_active)
    .map((b) => ({
      ...b,
      sections: sectionsByBook.get(b.id) ?? [],
      rules: rulesByBook.get(b.id) ?? [],
    }));
}

/** One `tj_playbook_rules` row as the library sees it. */
function toLibraryRule(r: RuleRow, counts: Map<string, number>): PlaybookRule {
  return {
    id: r.id,
    text: r.text,
    show_when: r.show_when as ShowWhen,
    sort_order: r.sort_order,
    deleted_at: r.deleted_at,
    answerCount: counts.get(r.id) ?? 0,
  };
}

/**
 * Every rule the user has written, regardless of which playbooks use it.
 *
 * The manager needs this to offer existing rules for linking — the whole point
 * of the library being flat. Derived from the same read as `getPlaybooks` when
 * both are wanted; kept separate so a caller that only lists rules does not
 * also drain the links.
 */
export async function getRuleLibrary(
  { includeDeleted = false } = {},
): Promise<PlaybookRule[]> {
  const supabase = await createClient();
  const [rules, counts] = await Promise.all([
    selectAllPages<RuleRow>((from, to) =>
      supabase
        .from("tj_playbook_rules")
        .select(RULE_COLUMNS)
        .order("sort_order")
        .order("id")
        .range(from, to),
    ),
    ruleAnswerCounts(),
  ]);

  return rules
    .filter((r) => includeDeleted || r.deleted_at == null)
    .map((r) => toLibraryRule(r, counts));
}

/** Per-rule answer counts from answers already in hand. No query. */
function countAnswersByRule(
  byTrade: Map<string, PositionRule[]>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const answers of byTrade.values()) {
    for (const a of answers) {
      map.set(a.rule_id, (map.get(a.rule_id) ?? 0) + 1);
    }
  }
  return map;
}

/**
 * Trades answered per rule id — what makes `show_when` frozen and delete soft.
 *
 * The fallback for callers that do NOT already hold the answers (Settings, the
 * trade form). Anything that also needs `getPositionRules` should pass that map
 * in instead and skip this read entirely.
 */
async function ruleAnswerCounts(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const rows = await selectAllPages<{ rule_id: string }>((from, to) =>
    supabase
      .from("tj_position_rules")
      .select("rule_id, id")
      .order("rule_id")
      .order("id")
      .range(from, to),
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.rule_id, (map.get(r.rule_id) ?? 0) + 1);
  return map;
}

/**
 * Every recorded rule answer, indexed by trade.
 *
 * Paged for the same reason every other trade-scale read is: this is one row per
 * rule per trade, so it outgrows a single page faster than the trades do, and a
 * short page would under-count follow rates without any error.
 */
export async function getPositionRules(): Promise<Map<string, PositionRule[]>> {
  const supabase = await createClient();
  const rows = await selectAllPages<{
    position_id: string;
    rule_id: string;
    followed: boolean | null;
  }>((from, to) =>
    supabase
      .from("tj_position_rules")
      .select("position_id, rule_id, followed, id")
      .order("position_id")
      .order("id")
      .range(from, to),
  );

  const map = new Map<string, PositionRule[]>();
  for (const r of rows) {
    const bucket = map.get(r.position_id) ?? [];
    bucket.push({
      position_id: r.position_id,
      rule_id: r.rule_id,
      followed: r.followed,
    });
    map.set(r.position_id, bucket);
  }
  return map;
}

/** Answers for one trade, for the edit form. */
export async function getTradeRuleAnswers(
  positionId: string,
): Promise<Record<string, boolean>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_position_rules")
    .select("rule_id, followed")
    .eq("position_id", positionId);

  const out: Record<string, boolean> = {};
  for (const r of data ?? []) {
    if (r.followed != null) out[r.rule_id] = r.followed;
  }
  return out;
}
