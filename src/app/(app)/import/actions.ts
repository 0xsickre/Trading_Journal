"use server";

import { after } from "next/server";
import { fillExcursionsFromFeed } from "@/lib/journal/excursion-fill";
import { revalidatePath } from "next/cache";
import { revalidateTrades } from "@/lib/journal/revalidate";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { selectAllPages } from "@/lib/supabase/paginate";

import { computeStatus } from "@/lib/journal/trade-lifecycle";
import { normalizeInstrumentSymbol } from "@/lib/journal/instrument-aliases";
import { planUndo } from "@/lib/journal/import-undo";
import { getInstrumentSpecs, instrumentSnapshot } from "@/lib/journal/instruments";
import { getAccountCurrency } from "@/lib/journal/accounts";
import {
  commitImportSchema,
  firstIssue,
  importItemSchema,
} from "@/lib/journal/trade-input-schema";

export type ImportExec = {
  side: "entry" | "exit";
  price: number;
  qty: number;
  executed_at: string; // UTC ISO
  fee: number;
  swap_funding: number;
};

/**
 * A fill as captured in `prev_executions` — the wizard's shape plus the
 * provenance the row already carried, which undo must give back unchanged.
 */
type SnapshotExec = ImportExec & { source?: string | null };

export type ImportItem = {
  decision: "create" | "merge" | "skip";
  /**
   * `suggested` is a match made without the time: the trade was typed by hand
   * while reading a backtest, so it carries the moment it was typed rather than
   * the moment it was traded. See `import-match.ts`.
   */
  match_status: "new" | "match" | "suggested" | "duplicate" | "ambiguous";
  matched_position_id: string | null;
  instrument: string | null;
  direction: string | null;
  executions: ImportExec[];
  /**
   * The gross result off the broker's statement, when a column carries it.
   *
   * `null` means "not mapped" and leaves the trade to compute from prices. A
   * zero is a real zero and gets written — that difference is why there is no
   * `?? 0` here.
   */
  gross_pnl_override: number | null;
  /**
   * The target off the file, written only onto a trade that has none.
   *
   * Never overwriting is the difference between a target and a stop, and the
   * reason there is no stop here at all: a statement states the levels AS THEY
   * STOOD AT THE END, and a stop pulled to breakeven mid-trade would replace the
   * stop the risk was taken with. A target that already exists is the trader's
   * plan; one that is missing is simply not recorded yet.
   */
  target_price: number | null;
  raw: Record<string, string>;
};

export type CommitInput = {
  account_id: string | null;
  filename: string;
  items: ImportItem[];
};

function statusOf(execs: ImportExec[]) {
  return computeStatus(execs);
}

export async function commitImport(input: CommitInput) {
  const envelope = commitImportSchema.safeParse(input);
  if (!envelope.success) {
    return { ok: false as const, error: firstIssue(envelope.error) };
  }

  const supabase = await createClient();

  const { data: batch, error: batchErr } = await supabase
    .from("tj_import_batches")
    .insert({
      account_id: input.account_id,
      filename: input.filename,
      summary: { total: input.items.length },
    })
    .select("id")
    .single();
  if (batchErr || !batch)
    return { ok: false as const, error: batchErr?.message ?? "Batch failed" };

  // One lookup for the whole batch — the snapshot is per-position but the specs
  // are shared, and a per-row query would be a round trip per imported trade.
  // Once per import, not per row: the account's currency is the same for the whole batch.
  const accountCurrency = await getAccountCurrency(input.account_id);
  const specs = await getInstrumentSpecs(
    input.items.map((i) => normalizeInstrumentSymbol(i.instrument)),
  );

  let created = 0,
    merged = 0,
    skipped = 0,
    failed = 0;
  // Why each row failed. Swallowing the message left the user staring at
  // "3 failed" with nothing to act on.
  const errors: { row: number; instrument: string | null; error: string }[] = [];
  // Positions this import wrote fills onto — their MAE/MFE is filled afterwards.
  const touched: string[] = [];

  for (const [index, item] of input.items.entries()) {
    let matchedId = item.matched_position_id;
    // Set once a position exists, so a later failure can take it back out
    // instead of leaving an empty shell behind.
    let createdPositionId: string | null = null;
    // Fills this row displaced, kept so `undoImportBatch` can put them back.
    let replacedExecs: SnapshotExec[] | null = null;
    // The result the merge overwrote, kept for undo.
    let prevOverride: number | null = null;
    // Whether this row filled in an empty target, which undo has to empty again.
    let targetWritten = false;
    // Counted only once the audit row has landed too. The counters used to be
    // bumped inline, which was harmless while the audit insert could not fail —
    // now that it throws, an inline bump would count the same row as merged AND
    // as failed, and the four totals would no longer sum to the batch.
    let outcome: "created" | "merged" | "skipped" | null = null;

    try {
      // Per row, inside the try, so a bad cell costs that row and not the file.
      // Until now nothing checked the numbers on this path at all: a mapping
      // that lands the P&L column on `price` produces negative fills, and the
      // view then prices them into a confident wrong figure. `tj_executions`
      // now carries `price > 0` as a CHECK too — this is the copy that names
      // the row.
      const parsed = importItemSchema.safeParse(item);
      if (!parsed.success) throw new Error(firstIssue(parsed.error));

      if (item.decision === "create") {
        const instrument = normalizeInstrumentSymbol(item.instrument);
        const { data: pos, error } = await supabase
          .from("tj_positions")
          .insert({
            instrument,
            direction: item.direction,
            account_id: input.account_id,
            source: "import",
            import_batch_id: batch.id,
            needs_review: item.executions.length === 0,
            status: statusOf(item.executions),
            gross_pnl_override: item.gross_pnl_override,
            ...(item.target_price != null ? { target_price: item.target_price } : {}),
            ...instrumentSnapshot(instrument, specs, accountCurrency),
          })
          .select("id")
          .single();
        if (error || !pos) {
          throw new Error(error?.message ?? "Could not create the position.");
        }
        matchedId = pos.id;
        createdPositionId = pos.id;
        if (item.executions.length > 0) {
          const { error: exErr } = await supabase.rpc("tj_replace_executions", {
            p_position_id: pos.id,
            p_executions: item.executions.map((e) => ({ ...e, source: "import" })),
          });
          if (exErr) throw new Error(exErr.message);
        }
        outcome = "created";
      } else if (item.decision === "merge" && matchedId) {
        const pid: string = matchedId;
        // Replace ONLY the objective fills; subjective position fields untouched.
        // The snapshot is still taken, but for undo (see undoImportBatch) — the
        // replacement itself is atomic now, so it needs no rollback of its own.
        const { data: prevExecs } = await supabase
          .from("tj_executions")
          .select("side,price,qty,executed_at,fee,swap_funding,source")
          .eq("position_id", pid);
        replacedExecs = (prevExecs ?? []) as unknown as SnapshotExec[];

        // The result that stood before the import, so undo can put it back. The
        // same reason `prev_executions` has existed since 20260727122000: a
        // merge PERMANENTLY overwrites what a human entered, so an undo without
        // a snapshot is not a restore but a second edit.
        const { data: prevPos } = await supabase
          .from("tj_positions")
          .select("gross_pnl_override, target_price")
          .eq("id", pid)
          .maybeSingle();
        prevOverride = prevPos?.gross_pnl_override ?? null;
        // Only onto an empty target, and recorded so undo can empty it again.
        targetWritten = item.target_price != null && prevPos?.target_price == null;

        const { error: exErr } = await supabase.rpc("tj_replace_executions", {
          p_position_id: pid,
          p_executions: item.executions.map((e) => ({ ...e, source: "import" })),
        });
        if (exErr) throw new Error(exErr.message);
        const { error: stErr } = await supabase
          .from("tj_positions")
          .update({
            status: statusOf(item.executions),
            needs_review: item.executions.length === 0,
            // The statement is authoritative for money. A column that is not mapped
            // leaves the existing value alone rather than clearing it — an
            // import with no profit column must not wipe a hand-entered result.
            ...(item.gross_pnl_override != null
              ? { gross_pnl_override: item.gross_pnl_override }
              : {}),
            ...(targetWritten ? { target_price: item.target_price } : {}),
          })
          .eq("id", pid);
        // Thrown, not ignored: the fills have already been replaced by the line
        // above, so a swallowed failure here leaves the position carrying new
        // fills under its old status — closed fills on a row still reading
        // `open`, which every stat then reads as an unfinished trade.
        if (stErr) throw new Error(stErr.message);
        outcome = "merged";
      } else {
        outcome = "skipped";
      }

      // The audit row is the serious one. `prev_executions` is the ONLY record
      // of the fills a merge displaced, and by this point they are already
      // gone from `tj_executions`. Swallowing this error made undo permanently
      // impossible for that row — `undoImportBatch` would report it under
      // `unrestorableMerges` with nothing to say the cause was a failed write
      // rather than a batch predating the snapshot column.
      const { error: auditErr } = await supabase.from("tj_import_rows").insert({
        batch_id: batch.id,
        raw: item.raw,
        parsed: {
          instrument: item.instrument,
          direction: item.direction,
          executions: item.executions,
        },
        match_status: item.match_status,
        matched_position_id: matchedId,
        prev_executions: replacedExecs,
        prev_gross_pnl_override: prevOverride,
        target_written: targetWritten,
      });
      if (auditErr) throw new Error(auditErr.message);

      if (outcome === "created") created++;
      else if (outcome === "merged") merged++;
      else skipped++;
      if ((outcome === "created" || outcome === "merged") && matchedId) touched.push(matchedId);
    } catch (e) {
      failed++;
      // A position inserted moments ago whose fills then failed is not a trade,
      // it is debris. createTrade already rolls this back; this path did not,
      // and the orphan would survive as a phantom row in the journal.
      if (createdPositionId) {
        await supabase.from("tj_positions").delete().eq("id", createdPositionId);
      }
      errors.push({
        row: index + 1,
        instrument: item.instrument,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await supabase
    .from("tj_import_batches")
    .update({
      summary: {
        total: input.items.length,
        created,
        merged,
        skipped,
        failed,
        // Kept on the batch so a failure stays diagnosable after the toast.
        errors: errors.slice(0, 50),
      },
    })
    .eq("id", batch.id);

  // MAE/MFE for the backtest trades this import wrote, after the response: an
  // import of a hundred trades must not wait on a public feed to say it is done.
  if (touched.length > 0) {
    after(async () => {
      try {
        await fillExcursionsFromFeed({ positionIds: touched });
        revalidateTrades();
      } catch {
        // The feed being down costs the automatic MAE/MFE, never the import.
      }
    });
  }

  revalidatePath("/journal");
  revalidateTrades();
  return { ok: true as const, created, merged, skipped, failed, errors };
}

export type UndoResult =
  | {
      ok: true;
      deletedPositions: number;
      restoredPositions: number;
      /** Merges whose pre-import fills were never captured (batches predating
       *  the snapshot column) — these could not be put back. */
      unrestorableMerges: number;
    }
  | { ok: false; error: string };

/**
 * Roll a batch back: delete the positions it created, restore the fills it
 * replaced, then drop the batch and its audit rows.
 *
 * Only objective fills are touched. A position that existed before the import
 * keeps its plan, psychology and notes — the import never owned those.
 */
export async function undoImportBatch(batchId: string): Promise<UndoResult> {
  // A non-uuid used to reach PostgREST and come back as a Postgres type error.
  // "Import batch not found." is the same answer this function already gives
  // for an id that is well-formed but gone.
  if (!z.uuid().safeParse(batchId).success) {
    return { ok: false, error: "Import batch not found." };
  }

  const supabase = await createClient();

  const { data: batch } = await supabase
    .from("tj_import_batches")
    .select("id")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return { ok: false, error: "Import batch not found." };

  // BOTH reads are paged, and here that is not the usual "a number would come
  // out wrong" — it is data loss. A CSV of more than 1000 rows is ordinary for a
  // year of trading, and PostgREST truncates at 1000 with HTTP 200 and no error.
  //
  //   - a short `tj_positions` page leaves the positions past 1000 undeleted,
  //     still carrying an `import_batch_id` whose batch this function deletes at
  //     the end. There is no FK on that column to cascade or to refuse, so they
  //     survive as trades no undo can ever reach again.
  //   - a short `tj_import_rows` page leaves those merges unrestored, and the
  //     delete further down then removes every audit row — including the
  //     `prev_executions` snapshots that were the only copy of the fills the
  //     import displaced.
  //
  // Both end with the user reading `ok` and a count that understates what was
  // actually left behind.
  let createdRows: { id: string }[];
  let rows: {
    matched_position_id: string | null;
    prev_executions: unknown;
    prev_gross_pnl_override?: number | null;
    target_written?: boolean | null;
  }[];
  try {
    [createdRows, rows] = await Promise.all([
      selectAllPages<{ id: string }>((from, to) =>
        supabase
          .from("tj_positions")
          .select("id")
          .eq("import_batch_id", batchId)
          .order("id")
          .range(from, to),
      ),
      selectAllPages<{
        matched_position_id: string | null;
        prev_executions: unknown;
        prev_gross_pnl_override: number | null;
        target_written: boolean | null;
      }>(
        (from, to) =>
          supabase
            .from("tj_import_rows")
            .select(
              "matched_position_id, prev_executions, prev_gross_pnl_override, target_written, id",
            )
            .eq("batch_id", batchId)
            .order("id")
            .range(from, to),
      ),
    ]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const plan = planUndo<SnapshotExec>(rows, new Set(createdRows.map((p) => p.id)));

  /**
   * The result a merge overwrote, per position.
   *
   * Not through `planUndo`: that function is pure and tested against the shape
   * `{ matched_position_id, prev_executions }`, so widening its type would mean
   * changing a signature for data its decision does not need. Undo already has
   * `rows` to hand here anyway.
   *
   * `undefined` means "this row was not a merge" and such a position is left
   * alone. `null` means "there was nothing here before the import", and that is
   * RESTORED as null.
   */
  const prevOverrides = new Map<string, number | null>();
  for (const r of rows) {
    if (r.matched_position_id && !createdRows.some((c) => c.id === r.matched_position_id)) {
      prevOverrides.set(r.matched_position_id, r.prev_gross_pnl_override ?? null);
    }
  }

  // ONE CALL, ONE TRANSACTION.
  //
  // This used to be five groups of separate deletes over PostgREST — fills,
  // images, positions (all three in chunks), then audit rows, then the batch —
  // and each one is a network call that can fail. An undo that stops halfway
  // leaves the book in a state nobody chose, and the user reads an error over
  // an import that is partly undone.
  //
  // The hand-written order was justified by a comment saying another one
  // "fails on a restrictive constraint". MEASURED: not one foreign key to
  // `tj_positions` or to `tj_import_batches` is restrictive — they are all
  // CASCADE or SET NULL. The database was deleting all of it itself anyway,
  // more accurately, without chunks and without an order.
  //
  // `planUndo` stays here: it decides WHAT is restored and has its own test.
  // The database function only carries that decision out.
  const { error: undoErr } = await supabase.rpc("tj_undo_import_batch", {
    p_batch_id: batchId,
    p_restore: plan.restore.map(({ positionId, executions, clearTarget }) => ({
      position_id: positionId,
      // `source` is carried back. The snapshot holds it, and the function
      // collapses an absent one to `manual` — so listing the other six fields by
      // hand would quietly rename every restored fill as hand-entered,
      // including the ones an EARLIER import left there.
      executions: executions.map((e) => ({
        side: e.side,
        price: e.price,
        qty: e.qty,
        executed_at: e.executed_at,
        fee: e.fee,
        swap_funding: e.swap_funding,
        source: e.source ?? "manual",
      })),
      status: statusOf(executions),
      needs_review: executions.length === 0,
      restore_override: prevOverrides.has(positionId),
      gross_pnl_override: prevOverrides.get(positionId) ?? null,
      // Decided in `planUndo`, like everything else about what an undo puts
      // back — this function only carries the decision out.
      clear_target: clearTarget,
    })) as unknown as Json,
    p_delete_ids: plan.deleteIds,
  });
  if (undoErr) return { ok: false, error: undoErr.message };

  revalidatePath("/journal");
  revalidatePath("/import");
  revalidateTrades();

  return {
    ok: true,
    deletedPositions: plan.deleteIds.length,
    restoredPositions: plan.restore.length,
    unrestorableMerges: plan.unrestorableIds.length,
  };
}
