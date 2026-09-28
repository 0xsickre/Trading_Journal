import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOptionsMap } from "@/lib/journal/options";
import { getAccounts } from "@/lib/journal/accounts";
import { getPlaybooks } from "@/lib/journal/playbooks";
import { PageHeader } from "@/components/app/page-header";
import { QuickLogForm, type ReviewTrade } from "@/components/journal/quick-log-form";

const nums = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * The review half only, for a trade whose fills came from the export — the
 * `/daily` "not reviewed" list links here. Nothing about the fills can change.
 */
export default async function ReviewTradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: pos }, { data: stats }, { data: image }, optionsMap, accounts, playbooks] = await Promise.all([
    supabase
      .from("tj_positions")
      .select(
        "id, trade_no, instrument, direction, account_id, stop_price, target_price, playbook_id, execution_rating, mistake, psychology_tags, trade_journal_notes",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("tj_position_stats")
      .select("avg_entry, avg_exit, entry_qty, net_pl, realized_r, tick_size, account_currency")
      .eq("position_id", id)
      .maybeSingle(),
    supabase.from("tj_trade_images").select("image_url").eq("position_id", id).eq("kind", "ltf_post").maybeSingle(),
    getOptionsMap(true),
    getAccounts(),
    // Everything: this trade may name a setup since retired.
    getPlaybooks({ activeOnly: false, includeDeleted: true }),
  ]);
  if (!pos) notFound();

  const review: ReviewTrade = {
    id: pos.id,
    label: `${pos.trade_no != null ? `#${pos.trade_no}` : pos.id.slice(0, 8)}${pos.instrument ? ` ${pos.instrument}` : ""}`,
    currency: stats?.account_currency ?? accounts.find((a) => a.id === pos.account_id)?.currency ?? "USD",
    direction: pos.direction,
    qty: nums(stats?.entry_qty),
    avgEntry: nums(stats?.avg_entry),
    avgExit: nums(stats?.avg_exit),
    stop: nums(pos.stop_price),
    target: nums(pos.target_price),
    tickSize: nums(stats?.tick_size),
    netPl: nums(stats?.net_pl),
    realizedR: nums(stats?.realized_r),
    playbookId: pos.playbook_id,
    rating: nums(pos.execution_rating),
    mistake: strs(pos.mistake),
    psychology: strs(pos.psychology_tags),
    notes: pos.trade_journal_notes,
    snapshot: image?.image_url ?? null,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Review Trade" description="Setup, grade and what went wrong — the fills stay as imported." />
      <QuickLogForm accounts={accounts} instruments={[]} playbooks={playbooks} optionsMap={optionsMap} review={review} />
    </div>
  );
}
