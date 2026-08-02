import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import type {
  Playbook,
  PlaybookGroup,
  PlaybookRule,
  PositionRule,
  ShowWhen,
} from "./playbook-types";

export type {
  Playbook,
  PlaybookGroup,
  PlaybookRule,
  PositionRule,
} from "./playbook-types";

type RuleRow = {
  id: string;
  group_id: string;
  text: string;
  show_when: string;
  sort_order: number;
  deleted_at: string | null;
};

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
     * Answers the caller has already loaded.
     *
     * `tj_position_rules` holds one row per rule per trade and is the
     * fastest-growing table in the schema. `/reports` and the dashboard both
     * need the raw answers AND the per-rule counts, and used to drain the whole
     * table twice per render — once here and once through `getPositionRules`.
     * Handing the map in derives the counts from rows already in memory.
     */
    positionRules?: Map<string, PositionRule[]>;
  } = {},
): Promise<Playbook[]> {
  const supabase = await createClient();

  const [{ data: books }, { data: groups }, rules, counts] = await Promise.all([
    supabase
      .from("tj_playbooks")
      .select("id,name,description,color,icon,is_active,sort_order")
      .order("sort_order")
      .order("id"),
    supabase
      .from("tj_playbook_groups")
      .select("id,playbook_id,name,sort_order")
      .order("sort_order")
      .order("id"),
    // Rule count is unbounded in principle — a book with many groups and a few
    // years of iteration passes a page easily, and a short page would silently
    // drop rules from a checklist.
    selectAllPages<RuleRow>((from, to) =>
      supabase
        .from("tj_playbook_rules")
        .select("id,group_id,text,show_when,sort_order,deleted_at")
        .order("sort_order")
        .order("id")
        .range(from, to),
    ),
    positionRules ? countAnswersByRule(positionRules) : ruleAnswerCounts(),
  ]);

  const rulesByGroup = new Map<string, PlaybookRule[]>();
  for (const r of rules) {
    if (!includeDeleted && r.deleted_at != null) continue;
    const bucket = rulesByGroup.get(r.group_id) ?? [];
    bucket.push({
      id: r.id,
      group_id: r.group_id,
      text: r.text,
      show_when: r.show_when as ShowWhen,
      sort_order: r.sort_order,
      deleted_at: r.deleted_at,
      answerCount: counts.get(r.id) ?? 0,
    });
    rulesByGroup.set(r.group_id, bucket);
  }

  const groupsByBook = new Map<string, PlaybookGroup[]>();
  for (const g of groups ?? []) {
    const bucket = groupsByBook.get(g.playbook_id) ?? [];
    bucket.push({ ...g, rules: rulesByGroup.get(g.id) ?? [] });
    groupsByBook.set(g.playbook_id, bucket);
  }

  return (books ?? [])
    .filter((b) => !activeOnly || b.is_active)
    .map((b) => ({ ...b, groups: groupsByBook.get(b.id) ?? [] }));
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
