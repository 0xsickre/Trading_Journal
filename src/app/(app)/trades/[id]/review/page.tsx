import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOptionsMap } from "@/lib/journal/options";
import { getAccounts } from "@/lib/journal/accounts";
import { getPlaybooks } from "@/lib/journal/playbooks";
import { PageHeader } from "@/components/app/page-header";
import { QuickLogForm, type ReviewTrade } from "@/components/journal/quick-log-form";
import { stopStatus } from "@/lib/journal/stop-moved";
import type { TradeRow } from "@/lib/journal/types";

const nums = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * The review half only, for a trade whose fills came from the export — the
 * `/daily` "not reviewed" list links here. Nothing about the fills can change.
 */
export default async function ReviewTradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: pos }, { data: stats }, { data: images }, optionsMap, accounts, playbooks] = await Promise.all([
    supabase
      .from("tj_positions")
      .select(
        "id, trade_no, instrument, direction, account_id, stop_price, target_price, final_stop_price, max_drawdown_price, exit_reason, thesis, playbook_id, execution_rating, mistake, psychology_tags, trade_journal_notes",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("tj_position_stats")
      .select("avg_entry, avg_exit, entry_qty, net_pl, realized_r, tick_size, account_currency")
      .eq("position_id", id)
      .maybeSingle(),
    supabase.from("tj_trade_images").select("image_url").eq("position_id", id).order("sort_order").order("id"),
    getOptionsMap(true),
    getAccounts(),
    // Everything: this trade may name a setup since retired.
    getPlaybooks({ activeOnly: false, includeDeleted: true }),
  ]);
  if (!pos) notFound();

  // Was the stop moved? Read off the orders file's last stop, the entry and the MAE.
  const moved = stopStatus({ ...pos, stats: { avg_entry: nums(stats?.avg_entry) } } as unknown as TradeRow);

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
    finalStop: nums(pos.final_stop_price),
    stopNote:
      moved === "moved_be"
        ? "Poslednji stop u platformi je na ulazu ili u profitu — pomeren je. Upiši originalni sa snimka."
        : moved === "moved_mae"
          ? "Cena je otišla dalje od poslednjeg stopa, a trejd nije izbačen — stop je pomeren. Upiši originalni sa snimka."
          : null,
    thesis: pos.thesis,
    tickSize: nums(stats?.tick_size),
    netPl: nums(stats?.net_pl),
    realizedR: nums(stats?.realized_r),
    playbookId: pos.playbook_id,
    rating: nums(pos.execution_rating),
    mistake: strs(pos.mistake),
    psychology: strs(pos.psychology_tags),
    notes: pos.trade_journal_notes,
    images: (images ?? []).map((i) => i.image_url),
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Dopuna iz snimka"
        description="Stop i cilj kakvi su bili u platformi na ulazu, šta si rekao pre klika, setup i ocena — fill-ovi ostaju kako su uvezeni."
      />
      <QuickLogForm accounts={accounts} instruments={[]} playbooks={playbooks} optionsMap={optionsMap} review={review} />
    </div>
  );
}
