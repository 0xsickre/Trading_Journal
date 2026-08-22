import { notFound } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAccounts } from "@/lib/journal/accounts";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getOptionsMap } from "@/lib/journal/options";
import {
  getPlaybooks,
  getPositionRules,
  getRuleLibrary,
  type Playbook,
  type PositionRule,
} from "@/lib/journal/playbooks";
import { getNotesForPlaybook } from "@/lib/journal/notes/queries";
import { toRealized } from "@/lib/journal/analytics";
import { enrichTrades } from "@/lib/journal/enriched-trade";
import { buildPlaybookLookup } from "@/lib/journal/reports/playbook-dimensions";
import { sharedBreakevenRange } from "@/lib/journal/breakeven";
import { accountTimezoneResolver, DEFAULT_TZ } from "@/lib/journal/time";
import { todayInTz } from "@/lib/journal/daily-report";
import { stringFieldValue } from "@/lib/journal/field-values";
import type { RealizedTrade } from "@/lib/journal/analytics";
import type { TradeRow } from "@/lib/journal/types";
import { JournalGrid } from "@/components/journal/journal-grid";
import { PlaybookIdentityHeader } from "@/components/journal/playbook-identity-header";
import { PlaybookStatsTab } from "@/components/journal/playbook-stats-tab";
import { PlaybookRulesEditor } from "@/components/journal/playbook-rules-editor";
import { PlaybookNotesPanel } from "@/components/journal/playbook-notes-panel";

/**
 * One playbook: what it is, what it did, its checklist, its trades, and notes
 * about it. Replaces the expandable card that used to hold all of this at
 * once on `/playbooks` — every trader's setup now gets its own page instead of
 * sharing one long scroll with every other setup.
 */
export default async function PlaybookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Awaited first, same reason `/playbooks` does it: `getPlaybooks` accepts
  // the settled map or its promise, and this page needs the settled map on
  // its own too, to slice it down to just this book's trades below.
  const positionRules = await getPositionRules();

  const [accounts, trades, playbooks, library, optionsMap, fieldDefs, notes] =
    await Promise.all([
      getAccounts(),
      getTradesWithStats(),
      getPlaybooks({ includeDeleted: true, positionRules }),
      getRuleLibrary({ includeDeleted: true }),
      getOptionsMap(false),
      getFieldDefs(false),
      getNotesForPlaybook(id),
    ]);

  const book = playbooks.find((b) => b.id === id);
  if (!book) notFound();

  const primary = accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
  const currency = primary?.currency ?? "USD";
  const todayKey = todayInTz(primary?.timezone ?? DEFAULT_TZ);

  const tzFor = accountTimezoneResolver(accounts, primary?.timezone);
  const tzOf = (t: RealizedTrade) => tzFor(t.row.account_id);
  const breakevenRange = sharedBreakevenRange(accounts);

  const bookTrades = trades.filter(
    (t) => stringFieldValue(t, "playbook_id") === book.id,
  ) as TradeRow[];
  const enrichedBookTrades = enrichTrades(toRealized(bookTrades), {
    tzOf,
    range: breakevenRange,
  });
  const missedCount = bookTrades.filter((t) => t.status === "missed").length;

  // Only the answers this book's own trades recorded — a small map, not every
  // trade's, so the Rules tab does not ship the whole journal's answers to
  // score one playbook's checklist.
  const positionRulesForBook = new Map<string, PositionRule[]>();
  for (const t of bookTrades) {
    const answers = positionRules.get(t.id);
    if (answers) positionRulesForBook.set(t.id, answers);
  }

  // Only the library plus this one book — a per-playbook page has no use for
  // every other playbook's rules, and shipping them would just be a bigger
  // client payload for the same lookup.
  const lookup = buildPlaybookLookup(
    [{ id: "library", name: "library", rules: library }, book],
    positionRulesForBook,
  );

  const categories = optionsMap.rule_category ?? [];

  const computeCtx = {
    pnlBasis: "net" as const,
    range: breakevenRange,
    rules: lookup.rules,
  };

  return (
    <div className="space-y-5">
      <PlaybookIdentityHeader book={book} />

      <Tabs defaultValue="stats" className="space-y-4">
        <TabsList>
          <TabsTrigger value="stats">Stats</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="trades">Trades</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="stats">
          <PlaybookStatsTab
            trades={enrichedBookTrades}
            lookup={lookup}
            computeCtx={computeCtx}
            currency={currency}
            missedCount={missedCount}
          />
        </TabsContent>

        <TabsContent value="rules">
          <PlaybookRulesEditor
            book={book}
            library={library}
            trades={enrichedBookTrades}
            lookup={lookup}
            computeCtx={computeCtx}
            categories={categories}
          />
        </TabsContent>

        <TabsContent value="trades">
          <JournalGrid
            trades={bookTrades}
            accounts={accounts}
            fieldDefs={fieldDefs}
            optionsMap={optionsMap}
            playbooks={[book as Playbook]}
            positionRules={positionRulesForBook}
          />
        </TabsContent>

        <TabsContent value="notes">
          <PlaybookNotesPanel playbookId={book.id} notes={notes} todayKey={todayKey} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
