/**
 * A setup seen and not taken, written from the recording (phase O, 08.10.2026).
 *
 * The plan-first form was the only way a missed setup reached the journal: a
 * plan typed before the entry and then marked missed. With the journal on
 * import only, the trader writes it after the session, off the OBS recording —
 * where price was, where the stop and the target would have gone, and when. The
 * row is `status = 'missed'` with no fills, the same as before, so the R2 walk
 * in futures-trading (`tools/journal_mae.py`) prices it and every screen that
 * counts missed setups reads it unchanged.
 */

export type MissedSetupInput = {
  accountId: string | null;
  instrument: string | null;
  direction: "Long" | "Short";
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** When the setup was there, ISO UTC. */
  seenAt: string | null;
  playbookId: string | null;
  reason: string | null;
  note: string;
};

/** Why the setup cannot be saved as written; null when it can. */
export function missedSetupProblem(m: MissedSetupInput): string | null {
  if (!m.accountId) return "Pick the account.";
  if (!m.instrument) return "Pick the instrument.";
  if (m.entry == null || !(m.entry > 0)) return "The entry the setup offered is needed.";
  if (m.stop == null || !(m.stop > 0)) return "The stop is needed — without it the miss has no R.";
  // The R2 walk prices a miss only with a target: without one it never knows
  // whether the setup paid (futures-trading `journal_mae.py`).
  if (m.target == null || !(m.target > 0)) return "The target is needed — without it the miss is never priced.";
  if (!m.seenAt) return "When was the setup there?";
  const dir = m.direction === "Long" ? 1 : -1;
  if (dir * (m.entry - m.stop) <= 0) {
    return `A ${m.direction.toLowerCase()} has its stop ${m.direction === "Long" ? "below" : "above"} the entry.`;
  }
  if (dir * (m.target - m.entry) <= 0) {
    return `A ${m.direction.toLowerCase()} has its target ${m.direction === "Long" ? "above" : "below"} the entry.`;
  }
  return null;
}
