export type ExecutionInput = {
  side: "entry" | "exit";
  price: number;
  qty: number;
  executed_at: string; // UTC ISO
  fee: number;
  swap_funding: number;
};

/**
 * Where a fill came from. Mirrors the CHECK on `tj_executions.source`.
 *
 * It travels through the edit form because `tj_save_trade` deletes and
 * re-inserts every fill on each save: a fill the form did not carry the origin
 * of came back as `manual`, so opening an imported trade to add a note quietly
 * rewrote its provenance.
 */
export const FILL_SOURCES = ["manual", "import", "bot"] as const;
export type FillSource = (typeof FILL_SOURCES)[number];

export function asFillSource(v: unknown): FillSource {
  return FILL_SOURCES.includes(v as FillSource) ? (v as FillSource) : "manual";
}

/** A fill as the form holds it, for `validateFills`. */
export type FillCheck = {
  side: "entry" | "exit";
  qty: number;
  /** UTC ISO, or null when the time box is empty or unreadable. */
  executedAt: string | null;
};

/**
 * The sequence rules a set of fills must satisfy to describe one position.
 *
 * Checked on manual entry only. Before this the form saved an exit with no
 * entry (status `closed`, money from nothing), more exited than was entered,
 * and an exit timed before the first entry — and a fill with an empty time box
 * was saved at "now". Imports keep their own path: a broker statement is fixed
 * at the source, not refused row by row here.
 *
 * Returns the first problem as a sentence, or null. Fill numbers are 1-based,
 * matching the rows on screen.
 */
export function validateFills(fills: FillCheck[]): string | null {
  const missingTime = fills.findIndex((f) => f.executedAt == null);
  if (missingTime >= 0) return `Fill ${missingTime + 1} needs a valid time.`;

  const entries = fills.filter((f) => f.side === "entry");
  const exits = fills.filter((f) => f.side === "exit");
  if (exits.length === 0) return null;
  if (entries.length === 0) return "An exit fill needs an entry fill before it.";

  const over = overExitMessage(
    entries.reduce((s, f) => s + f.qty, 0),
    exits.reduce((s, f) => s + f.qty, 0),
  );
  if (over) return over;

  const firstEntry = Math.min(...entries.map((f) => Date.parse(f.executedAt!)));
  const early = fills.findIndex(
    (f) => f.side === "exit" && Date.parse(f.executedAt!) < firstEntry,
  );
  if (early >= 0) return `Fill ${early + 1} exits before the first entry.`;
  return null;
}

function round(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/** A hair of tolerance: 0.1 + 0.2 lots must not read as an over-exit of 0.3. */
const QTY_EPSILON = 1e-9;

/**
 * Closing more than was opened, said once.
 *
 * Extracted from `validateFills` so the fills editor can say it WHILE the
 * quantity is being typed, in the same words the save refuses it with. Two
 * wordings for one rule would let the screen and the save path disagree about
 * what is wrong.
 *
 * Null when the fills are consistent — including when nothing has been exited.
 */
export function overExitMessage(
  entryQty: number,
  exitQty: number,
): string | null {
  if (exitQty <= entryQty + QTY_EPSILON) return null;
  return `Exits total ${round(exitQty)} but entries only ${round(entryQty)} — a position cannot close more than was opened.`;
}

/**
 * What is still open: entries minus exits, never below zero.
 *
 * An over-exit is a data-entry error, not a negative position — `computeStatus`
 * already calls it closed rather than blocking — so this clamps at 0 and leaves
 * the complaining to `overExitMessage`.
 */
export function openQty(entryQty: number, exitQty: number): number {
  return Math.max(0, entryQty - exitQty);
}

/**
 * Entry, exit and open quantity over a set of fills.
 *
 * The one definition. The same three lines lived in `validateFills`, in the
 * open-positions widget and in the import wizard, and a rounding rule fixed in
 * one of them stayed wrong in the other two.
 */
export function fillTotals(fills: ExecLike[]): {
  entryQty: number;
  exitQty: number;
  openQty: number;
} {
  let entry = 0;
  let exit = 0;
  for (const f of fills) {
    const qty = Number.isFinite(f.qty) ? f.qty : 0;
    if (f.side === "entry") entry += qty;
    else if (f.side === "exit") exit += qty;
  }
  return { entryQty: entry, exitQty: exit, openQty: openQty(entry, exit) };
}

/**
 * Whether an edit opens or enlarges a position.
 *
 * The FTMO freeze exists to stop new exposure on an account that broke a rule.
 * It used to refuse EVERY edit of a trade on such an account, so the trader
 * could not even write the post-mortem of the trade that breached it. What it
 * must refuse is narrower: a plan becoming a live trade, or more size going on.
 */
export function addsExposure(
  prev: { status: string | null; entryQty: number },
  next: { status: string; entryQty: number },
): boolean {
  const wasLive = statusToTradePhase(prev.status) === "active";
  const isLive = statusToTradePhase(next.status) === "active";
  if (!wasLive && isLive) return true;
  return next.entryQty > prev.entryQty + 1e-9;
}

export type ExecLike = Pick<ExecutionInput, "side" | "qty">;

/** The shape a fill must have to be worth storing. */
export type FillLike = {
  side: string;
  price: number | null;
  qty: number | null;
};

/**
 * Whether a fill is complete enough to save.
 *
 * The single definition, shared by the form's live preview, the form's submit
 * payload and the server's sanitizer. They previously used three different
 * predicates: the form accepted `qty = 0` while the server silently dropped
 * such rows — taking the fee and swap typed on them with it, so a user could
 * watch a commission disappear with no error.
 */
export function isValidFill(e: FillLike): boolean {
  return (
    (e.side === "entry" || e.side === "exit") &&
    e.price != null &&
    Number.isFinite(e.price) &&
    e.qty != null &&
    Number.isFinite(e.qty) &&
    e.qty > 0
  );
}

export type TradePhase = "planned" | "active";

export type PositionStatus =
  | "planned"
  | "missed"
  | "open"
  | "partial"
  | "closed";

/** UI Trade phase from stored status. */
export function statusToTradePhase(status?: string | null): TradePhase {
  if (
    status === "open" ||
    status === "partial" ||
    status === "closed"
  ) {
    return "active";
  }
  return "planned";
}

/**
 * Status: fills drive partial/closed; without fills, user picks planned vs active (open).
 */
export function computeStatus(
  execs: ExecLike[],
  manualStatus?: string | null,
): PositionStatus {
  if (execs.length === 0) {
    if (manualStatus === "missed") return "missed";
    if (manualStatus === "open") return "open";
    return "planned";
  }

  const entryQty = execs
    .filter((e) => e.side === "entry")
    .reduce((s, e) => s + (e.qty || 0), 0);
  const exitQty = execs
    .filter((e) => e.side === "exit")
    .reduce((s, e) => s + (e.qty || 0), 0);
  if (exitQty <= 0) return "open";
  if (exitQty < entryQty) return "partial";
  // exitQty >= entryQty → closed. An over-exit (exitQty > entryQty) is a data-entry
  // error; we still mark it closed rather than block, and surface it via stats.
  return "closed";
}

/** At least one entry fill with quantity (import / execution tab). */
export function hasEntryFill(execs: ExecLike[]): boolean {
  return execs.some((e) => e.side === "entry" && (e.qty || 0) > 0);
}

export function canMarkMissed(
  execCount: number,
  status?: string | null,
): boolean {
  return (
    execCount === 0 &&
    (status === "planned" || status === "open" || !status)
  );
}

export function canRestoreToPlanned(
  execCount: number,
  status?: string | null,
): boolean {
  return execCount === 0 && status === "missed";
}

export function formatLifecycleStatusLabel(status: string): string {
  switch (status) {
    case "planned":
      return "Planned";
    case "missed":
      return "Missed";
    case "open":
      return "Active";
    case "partial":
      return "Partial";
    case "closed":
      return "Closed";
    default:
      return status;
  }
}

export function lifecycleStatusHint(status: string): string {
  switch (status) {
    case "planned":
      return "A planned trade — you are not in the position yet.";
    case "missed":
      return "Setup missed — you never entered.";
    case "open":
      return "Active trade.";
    case "partial":
      return "Partial exit.";
    case "closed":
      // This used to read "Zatvoren trade." — the one Serbian sentence among
      // five, and on the most common status in the book. This text is the
      // `title` on every badge in the grid, so the user saw it more often than
      // any other message here.
      return "Closed trade — fully exited.";
    default:
      return "";
  }
}
