import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionBriefCard } from "./session-brief-card";
import { parseSessionBrief } from "@/lib/journal/session-brief";

const brief = parseSessionBrief({
  trading_day: "2026-09-29",
  flat_by: "2026-09-29T20:10:00Z",
  day_note: null,
  red_windows: [
    { from: "2026-09-29T12:25:00Z", to: "2026-09-29T12:45:00Z", title: "CPI m/m", impact: "visok" },
    { from: "bad", to: "2026-09-29T12:45:00Z", title: "unreadable" },
  ],
  ranges: {
    NQ_ts: { pts: 312.4, pts_lo: 210, pts_hi: 450, pct: 1.2 },
    ES_rth: { pts: 48, pct: 0.7 },
  },
  source_url: "https://example.test/brief.html",
});

describe("SessionBriefCard", () => {
  it("shows the end of day, the windows and the ranges on the account's clock", () => {
    render(<SessionBriefCard day="2026-09-29" brief={brief} tz="America/New_York" />);
    expect(screen.getByText("Pred sesiju")).toBeInTheDocument();
    // 20:10 UTC = 16:10 New York (EDT).
    expect(screen.getByText("16:10")).toBeInTheDocument();
    expect(screen.getByText("08:25–08:45")).toBeInTheDocument();
    expect(screen.getByText("CPI m/m")).toBeInTheDocument();
    expect(screen.getByText("312 pts (80 %: 210–450)")).toBeInTheDocument();
    expect(screen.getByText("48 pts")).toBeInTheDocument();
    expect(screen.getByText(/1 prozor\(a\) iz brief-a nije moglo da se pročita/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ceo brief" })).toHaveAttribute("href", "https://example.test/brief.html");
  });

  it("without a brief says so and still gives the ordinary close", () => {
    render(<SessionBriefCard day="2026-09-30" brief={null} tz="America/New_York" />);
    expect(screen.getByText(/Brief za ovaj dan nije stigao/)).toBeInTheDocument();
    expect(screen.getByText("16:10")).toBeInTheDocument();
    expect(screen.getByText(/uobičajeno 15:10 CT/)).toBeInTheDocument();
    expect(screen.queryByText(/Crveni prozori/)).not.toBeInTheDocument();
  });

  it("a closed exchange is said, not shown as a time", () => {
    const xmas = parseSessionBrief({ trading_day: "2026-12-25", flat_by: null, red_windows: [], ranges: {}, day_note: "Božić — CME zatvoren" });
    render(<SessionBriefCard day="2026-12-25" brief={xmas} tz="America/New_York" />);
    expect(screen.getByText("berza zatvorena")).toBeInTheDocument();
    expect(screen.getByText("Božić — CME zatvoren")).toBeInTheDocument();
    expect(screen.getByText("Nema važnih vesti.")).toBeInTheDocument();
  });

  it("shows what is left of the DLL when given", () => {
    render(
      <SessionBriefCard day="2026-09-29" brief={brief} tz="America/New_York" dllLeft={{ amount: 700, of: 1000, currency: "USD" }} />,
    );
    expect(screen.getByText(/DLL danas/)).toBeInTheDocument();
    expect(screen.getByText(/700.*od.*1,000|700.*od.*1\.000/)).toBeInTheDocument();
  });
});
