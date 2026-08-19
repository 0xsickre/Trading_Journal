import {
  getNoteFolders,
  getNoteTags,
  getNotes,
  purgeExpiredNotes,
} from "@/lib/journal/notes/queries";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getAccounts } from "@/lib/journal/accounts";
import { todayInTz } from "@/lib/journal/daily-report";
import { DEFAULT_TZ } from "@/lib/journal/time";
import { NotebookWorkbench } from "@/components/journal/notebook-workbench";
import { PageHeader } from "@/components/app/page-header";

export default async function NotebookPage() {
  // Before the read, not inside it: getNotes() must see the state AFTER
  // housekeeping, the same ordering ensureDefaults() needs on the dashboard.
  await purgeExpiredNotes();

  const [folders, notes, tags, trades, accounts] = await Promise.all([
    getNoteFolders(),
    getNotes(),
    getNoteTags(),
    getTradesWithStats(),
    getAccounts(),
  ]);

  // Only what the "attach to trade" picker needs. Sending whole trade rows here
  // would put the entire journal on the wire for a dropdown.
  const tradeOptions = trades
    .map((t) => ({
      id: t.id,
      label:
        t.trade_no != null ? `#${t.trade_no}` : t.id.slice(0, 8),
      symbol: typeof t.symbol === "string" ? t.symbol : null,
      openedAt: t.stats?.opened_at ?? null,
    }))
    .slice(0, 500);

  // The account's day, not the browser's — so a note's default title matches
  // the same calendar date every other screen would call "today".
  const primary = accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
  const todayKey = todayInTz(primary?.timezone ?? DEFAULT_TZ);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notebook"
        description="Longer writing — a weekly review, a market observation, a thought about one trade. The daily report stays a form with fixed questions; here you write freely."
      />

      <NotebookWorkbench
        folders={folders}
        notes={notes}
        tags={tags}
        trades={tradeOptions}
        todayKey={todayKey}
      />
    </div>
  );
}
