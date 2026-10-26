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
    // The brief's ordinary 15:10 CT is not an early close: the account's 16:00 CT
    // stands (phase X) — 21:00 UTC, 17:00 New York (EDT).
    expect(screen.getByText("17:00")).toBeInTheDocument();
    expect(screen.getByText("08:25–08:45")).toBeInTheDocument();
    expect(screen.getByText("CPI m/m")).toBeInTheDocument();
    expect(screen.getByText("312 pts (80 %: 210–450)")).toBeInTheDocument();
    expect(screen.getByText("48 pts")).toBeInTheDocument();
    expect(screen.getByText(/1 prozor\(a\) iz brief-a nije moglo da se pročita/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ceo brief" })).toHaveAttribute("href", "https://example.test/brief.html");
  });

  it("without a brief says so and still gives the account's flat-by time", () => {
    render(<SessionBriefCard day="2026-09-30" brief={null} tz="America/New_York" flatBy="15:30" />);
    expect(screen.getByText(/Brief za ovaj dan nije stigao/)).toBeInTheDocument();
    expect(screen.getByText("16:30")).toBeInTheDocument();
    expect(screen.getByText(/tvoje vreme iz Settings/)).toBeInTheDocument();
    expect(screen.queryByText(/Crveni prozori/)).not.toBeInTheDocument();
  });

  it("a closed exchange is said, not shown as a time", () => {
    const xmas = parseSessionBrief({ trading_day: "2026-12-25", flat_by: null, red_windows: [], ranges: {}, day_note: "Božić — CME zatvoren" });
    render(<SessionBriefCard day="2026-12-25" brief={xmas} tz="America/New_York" />);
    expect(screen.getByText("berza zatvorena")).toBeInTheDocument();
    expect(screen.getByText("Božić — CME zatvoren")).toBeInTheDocument();
    expect(screen.getByText("Nema važnih vesti.")).toBeInTheDocument();
  });

  it("names no prop firm's limit (phase X)", () => {
    render(<SessionBriefCard day="2026-09-29" brief={brief} tz="America/New_York" />);
    expect(screen.queryByText(/DLL|Dnevni cilj/)).not.toBeInTheDocument();
  });
});
