"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { chunkIds, selectAllPages } from "@/lib/supabase/paginate";

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
  match_status: "new" | "match" | "duplicate" | "ambiguous";
  matched_position_id: string | null;
  instrument: string | null;
  direction: string | null;
  executions: ImportExec[];
  /**
   * Bruto rezultat sa brokerovog izvoda, kad ga kolona nosi.
   *
   * `null` znači „nije mapirano" i ostavlja trejd da računa iz cena. Nula je
   * stvarna nula i upisuje se — razlika je ono zbog čega ovde nema `?? 0`.
   */
  gross_pnl_override: number | null;
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
  // Jednom po uvozu, ne po redu: valuta naloga je ista za ceo batch.
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

  for (const [index, item] of input.items.entries()) {
    let matchedId = item.matched_position_id;
    // Set once a position exists, so a later failure can take it back out
    // instead of leaving an empty shell behind.
    let createdPositionId: string | null = null;
    // Fills this row displaced, kept so `undoImportBatch` can put them back.
    let replacedExecs: SnapshotExec[] | null = null;
    // Rezultat koji je merge prepisao, za undo.
    let prevOverride: number | null = null;
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

        // Rezultat koji je stajao pre uvoza, da ga undo može vratiti. Isti
        // razlog zbog kojeg `prev_executions` postoji od 20260727122000: merge
        // TRAJNO gazi ono što je čovek uneo, pa undo bez snimka nije povratak
        // nego druga izmena.
        const { data: prevPos } = await supabase
          .from("tj_positions")
          .select("gross_pnl_override")
          .eq("id", pid)
          .maybeSingle();
        prevOverride = prevPos?.gross_pnl_override ?? null;

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
            // Izvod je merodavan za novac. Kolona koja nije mapirana ostavlja
            // postojeću vrednost na miru umesto da je obriše — uvoz bez kolone
            // profita ne sme da poništi rezultat unet rukom.
            ...(item.gross_pnl_override != null
              ? { gross_pnl_override: item.gross_pnl_override }
              : {}),
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
      });
      if (auditErr) throw new Error(auditErr.message);

      if (outcome === "created") created++;
      else if (outcome === "merged") merged++;
      else skipped++;
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

  revalidatePath("/journal");
  revalidatePath("/", "layout");
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
      }>(
        (from, to) =>
          supabase
            .from("tj_import_rows")
            .select("matched_position_id, prev_executions, prev_gross_pnl_override, id")
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
   * Rezultat koji je merge prepisao, po poziciji.
   *
   * Ne kroz `planUndo`: ta funkcija je čista i testirana nad oblikom
   * `{ matched_position_id, prev_executions }`, pa bi proširivanje njenog tipa
   * značilo menjati potpis zbog podatka koji joj u odluci ne treba. Undo ionako
   * ovde već ima `rows` pri ruci.
   *
   * `undefined` znači „ovaj red nije bio merge" i takva pozicija se ne dira.
   * `null` znači „pre uvoza ovde nije bilo ničega" i to se VRAĆA kao null.
   */
  const prevOverrides = new Map<string, number | null>();
  for (const r of rows) {
    if (r.matched_position_id && !createdRows.some((c) => c.id === r.matched_position_id)) {
      prevOverrides.set(r.matched_position_id, r.prev_gross_pnl_override ?? null);
    }
  }

  for (const { positionId, executions } of plan.restore) {
    // Atomic: an undo that half-applied would leave the position with neither
    // the imported fills nor the ones it displaced.
    const { error: insErr } = await supabase.rpc("tj_replace_executions", {
      p_position_id: positionId,
      // `source` is carried back through. The snapshot captures it, and the RPC
      // coalesces a missing one to `manual` — so listing the other six fields by
      // hand quietly relabelled every restored fill as hand-entered, including
      // fills that an EARLIER import had put there. Undo has to give back what
      // it displaced, field for field, or the word means nothing.
      p_executions: executions.map((e) => ({
        side: e.side,
        price: e.price,
        qty: e.qty,
        executed_at: e.executed_at,
        fee: e.fee,
        swap_funding: e.swap_funding,
        source: e.source ?? "manual",
      })),
    });
    if (insErr) return { ok: false, error: insErr.message };

    // Reported, not swallowed — the same write `commitImport` throws on, for
    // the same reason, three hundred lines up: the fills have already been
    // replaced by the call above, so a failure here leaves the position holding
    // the restored fills under the status the IMPORT left behind. Closed fills
    // on a row still reading `open`, which every stat then treats as an
    // unfinished trade. One of the two paths threw and the other did not, on
    // identical statements.
    const { error: stErr } = await supabase
      .from("tj_positions")
      .update({
        status: statusOf(executions),
        needs_review: executions.length === 0,
        // Vraća se i kad je bio null: undo koji ostavi rezultat sa izvoda na
        // trejdu koji ga pre uvoza nije imao nije povratak nego pola izmene.
        ...(prevOverrides.has(positionId)
          ? { gross_pnl_override: prevOverrides.get(positionId) ?? null }
          : {}),
      })
      .eq("id", positionId);
    if (stErr) return { ok: false, error: stErr.message };
  }

  // Delete children before parents, explicitly, rather than relying on the FK
  // delete rules being cascades. Audit rows reference the positions and the
  // positions reference the batch, so removing them in any other order fails
  // on a restrictive constraint — and the base schema is not versioned in this
  // repo, so that is not something to assume.
  const { error: rowsDelErr } = await supabase
    .from("tj_import_rows")
    .delete()
    .eq("batch_id", batchId);
  if (rowsDelErr) return { ok: false, error: rowsDelErr.message };

  // Chunked for the same reason every `.in()` in this codebase is: PostgREST
  // takes the id list in the URL, and a batch that created a few thousand
  // positions builds a URL past the server's limit — which fails the delete
  // outright, after the audit rows above are already gone.
  for (const ids of chunkIds(plan.deleteIds)) {
    const { error: execDelErr } = await supabase
      .from("tj_executions")
      .delete()
      .in("position_id", ids);
    if (execDelErr) return { ok: false, error: execDelErr.message };

    await supabase.from("tj_trade_images").delete().in("position_id", ids);

    const { error: delErr } = await supabase
      .from("tj_positions")
      .delete()
      .in("id", ids);
    if (delErr) return { ok: false, error: delErr.message };
  }

  const { error: batchDelErr } = await supabase
    .from("tj_import_batches")
    .delete()
    .eq("id", batchId);
  if (batchDelErr) return { ok: false, error: batchDelErr.message };

  revalidatePath("/journal");
  revalidatePath("/import");
  revalidatePath("/", "layout");

  return {
    ok: true,
    deletedPositions: plan.deleteIds.length,
    restoredPositions: plan.restore.length,
    unrestorableMerges: plan.unrestorableIds.length,
  };
}
