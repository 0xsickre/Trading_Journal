import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrackerStreakCard } from "./tracker-streak-card";
import type { DayCompliance, DayStatus } from "@/lib/journal/tracker/compliance";

/** The value under a `Stat` label — "Trenutni niz"/"Najduži niz" can share
 *  the same number, and "—" appears for more than one guard independently. */
function statValue(label: string): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? "";
}

const day = (date: string, status: DayStatus, pct: number | null): DayCompliance => ({
  date,
  applicable: pct == null ? 0 : 4,
  satisfied: pct == null ? 0 : Math.round((pct / 100) * 4),
  pct,
  status,
  missedRuleIds: [],
  unansweredRuleIds: [],
});

describe("TrackerStreakCard — real computeStreak/meanCompliance, on screen", () => {
  it("no rules set up shows the setup prompt, not a zeroed streak", () => {
    render(<TrackerStreakCard series={[]} endDay="2026-04-10" hasRules={false} />);
    expect(screen.getByText(/Nema pravila/)).toBeInTheDocument();
    expect(screen.queryByText("Trenutni niz")).not.toBeInTheDocument();
  });

  it("a skipped weekend neither breaks nor extends the streak", () => {
    const series = [
      day("2026-04-06", "compliant", 100), // Monday
      day("2026-04-07", "compliant", 100),
      day("2026-04-08", "compliant", 100),
      day("2026-04-09", "compliant", 100),
      day("2026-04-10", "compliant", 100), // Friday
      day("2026-04-11", "skipped", null), // Saturday, excluded
      day("2026-04-12", "skipped", null), // Sunday, excluded
    ];
    render(<TrackerStreakCard series={series} endDay="2026-04-12" hasRules />);
    expect(statValue("Trenutni niz")).toBe("5"); // steps over the weekend
  });

  it("a broken day resets the current streak and is recorded as the last break", () => {
    const series = [
      day("2026-04-06", "compliant", 100),
      day("2026-04-07", "broken", 25),
      day("2026-04-08", "compliant", 100),
    ];
    render(<TrackerStreakCard series={series} endDay="2026-04-08" hasRules />);
    expect(screen.getByText("2026-04-07")).toBeInTheDocument(); // last broken on
  });

  it("mean compliance is null with no scored days and reads as a dash, not 0%", () => {
    const series = [day("2026-04-06", "skipped", null)];
    render(<TrackerStreakCard series={series} endDay="2026-04-06" hasRules />);
    expect(statValue("Prosečna doslednost")).toBe("—");
    expect(screen.getByText("0 ocenjenih dana")).toBeInTheDocument();
  });
});
