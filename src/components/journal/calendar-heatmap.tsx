"use client";

import { useMemo } from "react";
import { fmtMoney } from "@/lib/journal/format";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function CalendarHeatmap({
  daily,
  weeks = 26,
  currency = "USD",
}: {
  daily: Map<string, number>;
  weeks?: number;
  currency?: string;
}) {
  const { columns, max } = useMemo(() => {
    const today = new Date();
    // align end to the end of current week (Saturday)
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay()));
    const totalDays = weeks * 7;
    const start = new Date(end);
    start.setDate(start.getDate() - (totalDays - 1));

    const days: { key: string; value: number | null }[] = [];
    let maxAbs = 0;
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = ymd(d);
      const v = daily.has(key) ? daily.get(key)! : null;
      if (v != null) maxAbs = Math.max(maxAbs, Math.abs(v));
      days.push({ key, value: v });
    }
    const cols: { key: string; value: number | null }[][] = [];
    for (let w = 0; w < weeks; w++) cols.push(days.slice(w * 7, w * 7 + 7));
    return { columns: cols, max: maxAbs || 1 };
  }, [daily, weeks]);

  function color(v: number | null): string {
    if (v == null) return "var(--muted)";
    if (v === 0) return "var(--muted)";
    const intensity = Math.min(1, Math.abs(v) / max) * 0.75 + 0.25;
    return v > 0
      ? `color-mix(in oklch, var(--profit) ${intensity * 100}%, transparent)`
      : `color-mix(in oklch, var(--loss) ${intensity * 100}%, transparent)`;
  }

  return (
    <div className="min-w-0 max-w-full overflow-x-auto">
      <div className="flex w-max gap-1">
        {columns.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((day) => (
              <div
                key={day.key}
                className="size-3 rounded-[2px]"
                style={{ backgroundColor: color(day.value) }}
                title={
                  day.value == null
                    ? day.key
                    : `${day.key}: ${fmtMoney(day.value, currency, { sign: true })}`
                }
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
