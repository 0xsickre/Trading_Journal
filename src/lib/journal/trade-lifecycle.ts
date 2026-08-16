export type ExecutionInput = {
  side: "entry" | "exit";
  price: number;
  qty: number;
  executed_at: string; // UTC ISO
  fee: number;
  swap_funding: number;
};

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
      // Bio je „Zatvoren trade." — jedina srpska rečenica među pet, i to na
      // najčešćem statusu u knjizi. Ovaj tekst je `title` na svakoj značci u
      // gridu, pa ga je korisnik viđao češće od bilo koje druge poruke ovde.
      return "Closed trade — fully exited.";
    default:
      return "";
  }
}
