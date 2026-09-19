import {
  getNoteFolders,
  getNoteTags,
  getNotes,
  purgeExpiredNotes,
} from "@/lib/journal/notes/queries";
import { isExpiredNote } from "@/lib/journal/notes/note-types";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getAccounts } from "@/lib/journal/accounts";
import { todayInTz } from "@/lib/journal/daily-report";
import { DEFAULT_TZ } from "@/lib/journal/time";
import { NotebookWorkbench } from "@/components/journal/notebook-workbench";
import { PageHeader } from "@/components/app/page-header";

export default async function NotebookPage() {
  // Housekeeping runs WITH the reads, not before them: it used to be awaited
  // first, putting a DELETE's round trip in front of every visit. The page must
  // still show the state after the purge, so the notes it would delete are
  // dropped from what was read — same rule, `isExpiredNote`.
  const [, folders, allNotes, tags, trades, accounts] = await Promise.all([
    purgeExpiredNotes(),
    getNoteFolders(),
    getNotes(),
    getNoteTags(),
    getTradesWithStats(),
    getAccounts(),
  ]);
  const notes = allNotes.filter((n) => !isExpiredNote(n));

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
        description="Longer writing — a market observation, a thought about one trade, a plan for the month. The daily check-in and the weekly review stay forms with fixed questions; here you write freely."
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
