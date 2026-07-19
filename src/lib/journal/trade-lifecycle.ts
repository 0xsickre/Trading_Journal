export type ExecutionInput = {
  side: "entry" | "exit";
  price: number;
  qty: number;
  executed_at: string; // UTC ISO
  fee: number;
  swap_funding: number;
};

export type ExecLike = Pick<ExecutionInput, "side" | "qty">;

export type PositionStatus =
  | "planned"
  | "missed"
  | "open"
  | "partial"
  | "closed";

/** Derive position status from fills and optional persisted lifecycle state. */
export function computeStatus(
  execs: ExecLike[],
  currentStatus?: string | null,
): PositionStatus {
  if (execs.length === 0) {
    if (currentStatus === "missed") return "missed";
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
  return "closed";
}

export function canMarkMissed(
  execCount: number,
  status?: string | null,
): boolean {
  return execCount === 0 && (status === "planned" || status === "open" || !status);
}

export function canRestoreToPlanned(
  execCount: number,
  status?: string | null,
): boolean {
  return execCount === 0 && status === "missed";
}

export function isPlanLifecycleStatus(status?: string | null): boolean {
  return status === "planned" || status === "missed";
}

/** UI label — planned ≠ open position. */
export function formatLifecycleStatusLabel(status: string): string {
  switch (status) {
    case "planned":
      return "Plan";
    case "missed":
      return "Miss";
    case "open":
      return "Open";
    case "partial":
      return "Partial";
    case "closed":
      return "Closed";
    default:
      return status;
  }
}

/** Short hint for traders — status follows fills, not planned entry_price. */
export function lifecycleStatusHint(status: string): string {
  switch (status) {
    case "planned":
      return "Setup sačuvan (entry/stop/target OK) — nema broker fill-a.";
    case "missed":
      return "Plan nikad nije otvoren (limit nije udario / setup propao).";
    case "open":
      return "Bar jedan entry fill logovan — pozicija je otvorena.";
    case "partial":
      return "Delimičan exit — još u poziciji.";
    case "closed":
      return "Pozicija zatvorena.";
    default:
      return "";
  }
}
