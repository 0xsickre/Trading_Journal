/**
 * Duration formatting.
 *
 * This module used to carry a full unit-conversion layer — seven view modes
 * ($ / % / R / points / ticks / pips / privacy) with a `MetricValue` envelope,
 * `canRender` capability checks and per-instrument pip and tick maths. It was
 * complete and tested, but nothing ever rendered a mode switcher, so none of it
 * was ever called. It is in the git history if the switcher is ever built;
 * carrying ~190 lines of unreachable code in the meantime only made the module
 * look like it did something it did not.
 */

/** Humanised duration: "3d 4h", "5h 20m", "45m". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}
