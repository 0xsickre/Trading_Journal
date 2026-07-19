export type ExecutionInput = {
  side: "entry" | "exit";
  price: number;
  qty: number;
  executed_at: string; // UTC ISO
  fee: number;
  swap_funding: number;
};

export type ExecLike = Pick<ExecutionInput, "side" | "qty">;

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
      return "Plan trade — još nisi u poziciji.";
    case "missed":
      return "Setup propušten — nisi ušao.";
    case "open":
      return "Aktivan trade.";
    case "partial":
      return "Delimičan exit.";
    case "closed":
      return "Zatvoren trade.";
    default:
      return "";
  }
}
