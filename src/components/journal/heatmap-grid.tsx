"use client";

import { useMemo } from "react";
import { addDaysToDayKey, isoWeekdayOfDayKey } from "@/lib/journal/time";

export type HeatmapCell = { key: string; value: number | null };

/**
 * The calendar grid behind both heatmaps: 26 columns of 7 days, most recent on
 * the right.
 *
 * Extracted rather than copied because both copies had the same bug. The grid
 * used to end at `new Date()` read through `getFullYear/Month/Date`, which is
 * the BROWSER's day — while every key in the data is a day in the ACCOUNT's
 * timezone. For a trader in Belgrade on a New York account the last column was
 * routinely a day ahead, so "today" pointed at an empty cell and every value was
 * off by one column. `endDay` is passed in, computed on the server from
 * `todayInTz(account.timezone)`, and no `Date` is read in local time anywhere
 * below.
 *
 * Colour and tooltip are the caller's, on purpose: the two heatmaps differ in
 * scale (money normalizes to the window's largest move, compliance is fixed
 * 0–100), in palette, and in what the tooltip should say. A `mode` prop would
 * have been a switch in every one of those places.
 */
export function HeatmapGrid({
  values,
  endDay,
  weeks = 26,
  color,
  title,
}: {
  /** Day key → value. Days missing from the map render as "no data". */
  values: Map<string, number>;
  /** Last day to show, `yyyy-MM-dd` in the account's timezone. */
  endDay: string;
  weeks?: number;
  /** `max` is the largest absolute value in view; ignore it for a fixed scale. */
  color: (value: number | null, max: number) => string;
  title: (cell: HeatmapCell) => string;
}) {
  const { columns, max } = useMemo(() => {
    // Pad to the end of the week so the last column is full and every row is the
    // same weekday. ISO 7 = Sunday, and rows read Sun→Sat top to bottom.
    const endsOn = isoWeekdayOfDayKey(endDay);
    const end = addDaysToDayKey(endDay, endsOn === 7 ? 6 : 6 - endsOn);

    const total = weeks * 7;
    const start = addDaysToDayKey(end, -(total - 1));

    const days: HeatmapCell[] = [];
    let maxAbs = 0;
    for (let i = 0; i < total; i++) {
      const key = addDaysToDayKey(start, i);
      const value = values.get(key) ?? null;
      if (value != null) maxAbs = Math.max(maxAbs, Math.abs(value));
      days.push({ key, value });
    }

    const cols: HeatmapCell[][] = [];
    for (let w = 0; w < weeks; w++) cols.push(days.slice(w * 7, w * 7 + 7));
    return { columns: cols, max: maxAbs || 1 };
  }, [values, endDay, weeks]);

  return (
    <div className="min-w-0 max-w-full overflow-x-auto">
      <div className="flex w-max gap-1">
        {columns.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((cell) => (
              <div
                key={cell.key}
                className="size-3 rounded-[2px]"
                style={{ backgroundColor: color(cell.value, max) }}
                title={title(cell)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
