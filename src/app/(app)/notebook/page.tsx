import {
  getNoteFolders,
  getNoteTags,
  getNotes,
} from "@/lib/journal/notes/queries";
import { getTradesWithStats } from "@/lib/journal/trades";
import { NotebookWorkbench } from "@/components/journal/notebook-workbench";

export default async function NotebookPage() {
  const [folders, notes, tags, trades] = await Promise.all([
    getNoteFolders(),
    getNotes(),
    getNoteTags(),
    getTradesWithStats(),
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

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">Notebook</h1>
        <p className="text-muted-foreground">
          Duži zapisi — nedeljni pregled, zapažanje o tržištu, misao o jednom
          trejdu. Dnevni izveštaj ostaje forma sa fiksnim pitanjima; ovde pišeš
          slobodno.
        </p>
      </div>

      <NotebookWorkbench
        folders={folders}
        notes={notes}
        tags={tags}
        trades={tradeOptions}
      />
    </div>
  );
}
