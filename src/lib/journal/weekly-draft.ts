/**
 * The weekly review, as it is being typed, kept in this browser.
 *
 * WHY IT EXISTS. The week arrows are links and the page keys the form on the
 * week, so changing week remounts the form and everything typed was gone with
 * no word. A confirm before leaving stops that at the moment it happens; it
 * cannot help a closed tab, an expired session or a crash — and the weekly
 * review is five paragraphs written once a week, which is the most expensive
 * text in the application to lose.
 *
 * NOT autosave. A draft here is local and private; the stored review only ever
 * changes when Save is pressed, so `updated_at` keeps meaning "when the trader
 * decided this was the review" and a lock seals exactly what was chosen.
 *
 * Same shape as the other browser-side modules (`report-prefs.ts`,
 * `trade-form-prefs.ts`): guarded for SSR, guarded for a parse failure, and
 * silent when the write is refused (private mode, quota).
 */

const STORAGE_KEY = "tj:weekly-draft";

/** How long an unclaimed draft is kept before it is swept away. */
const MAX_AGE_DAYS = 30;

export type WeeklyDraftFields = {
  week_grade: number | null;
  went_well: string;
  went_badly: string;
  one_pattern: string;
  one_change: string;
  next_week_catalysts: string;
};

export type WeeklyDraft = {
  /** When it was last typed, as an ISO instant. */
  savedAt: string;
  fields: WeeklyDraftFields;
};

type Store = Record<string, WeeklyDraft>;

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed != null ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore quota / private mode
  }
}

export function readWeeklyDraft(weekStart: string): WeeklyDraft | null {
  const entry = readStore()[weekStart];
  return entry && entry.fields ? entry : null;
}

export function writeWeeklyDraft(weekStart: string, fields: WeeklyDraftFields, now = new Date()) {
  const store = pruned(readStore(), now);
  store[weekStart] = { savedAt: now.toISOString(), fields };
  writeStore(store);
}

export function clearWeeklyDraft(weekStart: string) {
  const store = readStore();
  if (!(weekStart in store)) return;
  delete store[weekStart];
  writeStore(store);
}

/**
 * Drops drafts older than `MAX_AGE_DAYS`. Pure so the sweep is testable, and
 * applied on every write rather than on a timer: a draft nobody came back for
 * in a month is a draft nobody is coming back for, and the key must not grow
 * for the lifetime of the browser profile.
 */
export function pruned(store: Store, now: Date): Store {
  const cutoff = now.getTime() - MAX_AGE_DAYS * 86_400_000;
  const out: Store = {};
  for (const [week, entry] of Object.entries(store)) {
    const at = Date.parse(entry?.savedAt ?? "");
    // An unparseable timestamp is kept rather than swept: losing text because
    // its clock reading was odd is the failure this module exists to prevent.
    if (!Number.isFinite(at) || at >= cutoff) out[week] = entry;
  }
  return out;
}

/**
 * Whether the draft says anything the stored review does not.
 *
 * Compared field by field against the row as it came from the server, so a
 * draft that is merely the saved review typed back in never raises a banner.
 * Text is trimmed for the comparison, because `emptyToNull` trims on the way
 * into the database and "  " there and "" here are the same answer.
 */
export function draftDiffers(saved: WeeklyDraftFields, draft: WeeklyDraftFields): boolean {
  if ((saved.week_grade ?? null) !== (draft.week_grade ?? null)) return true;
  const keys = ["went_well", "went_badly", "one_pattern", "one_change", "next_week_catalysts"] as const;
  return keys.some((k) => (saved[k] ?? "").trim() !== (draft[k] ?? "").trim());
}
