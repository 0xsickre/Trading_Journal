import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CalendarHeatmap } from "./calendar-heatmap";
import { ComplianceHeatmap } from "./compliance-heatmap";
import type { DayCompliance } from "@/lib/journal/tracker/compliance";

/**
 * DVE MAPE, DVE NAMERNO RAZLIČITE SKALE.
 *
 * `heatmap-grid.render.test.tsx` pokriva mrežu — koliko kolona, koji dan je
 * poslednji. Ono što nije bilo pokriveno su BOJA i TOOLTIP, a to su jedina dva
 * mesta na kojima ove komponente kažu broj.
 *
 * Razlika između njih je suština i lako se izgubi pri izmeni:
 *
 *   novac      — skala relativna na najveći potez u prozoru; pitanje je „koji
 *                dani su pomerili nalog", ne „koliko apsolutno";
 *   disciplina — fiksna 0–100; 60 % mora da izgleda isto u dobrom i u lošem
 *                mesecu, inače bi mesec šezdesetica bio tamnozelen samo zato
 *                što se ništa bolje nije desilo.
 *
 * Test čita `title` atribute, jer je to tekst koji korisnik zaista vidi kad
 * pređe mišem — isti broj koji knjiga računa.
 */

const END = "2026-03-06";

function cellsByTitle(container: HTMLElement) {
  const map = new Map<string, HTMLElement>();
  for (const el of container.querySelectorAll<HTMLElement>("[title]")) {
    map.set(el.getAttribute("title") ?? "", el);
  }
  return map;
}

function titleFor(container: HTMLElement, dayKey: string): string | null {
  for (const el of container.querySelectorAll<HTMLElement>("[title]")) {
    const t = el.getAttribute("title") ?? "";
    if (t === dayKey || t.startsWith(`${dayKey}:`)) return t;
  }
  return null;
}

function bgFor(container: HTMLElement, dayKey: string): string {
  for (const el of container.querySelectorAll<HTMLElement>("[title]")) {
    const t = el.getAttribute("title") ?? "";
    if (t === dayKey || t.startsWith(`${dayKey}:`)) return el.style.backgroundColor;
  }
  return "";
}

describe("CalendarHeatmap — novac", () => {
  const daily = new Map<string, number>([
    ["2026-03-02", 1200],
    ["2026-03-03", -400],
    ["2026-03-04", 0],
    ["2026-03-05", 150],
  ]);

  it("tooltip nosi iznos sa znakom i valutom naloga", () => {
    const { container } = render(
      <CalendarHeatmap daily={daily} endDay={END} weeks={2} currency="EUR" />,
    );
    expect(titleFor(container, "2026-03-02")).toBe("2026-03-02: +€1,200.00");
    expect(titleFor(container, "2026-03-03")).toBe("2026-03-03: -€400.00");
  });

  it("valuta nije zakucana na dolar", () => {
    // `analytics.ts` je nekad zakucavao `currency: "USD"`. Ova komponenta prima
    // valutu naloga, i to mora da ostane vidljivo u tekstu.
    const { container } = render(
      <CalendarHeatmap daily={daily} endDay={END} weeks={2} currency="USD" />,
    );
    expect(titleFor(container, "2026-03-02")).toBe("2026-03-02: +$1,200.00");
  });

  it("dan bez trgovanja nosi samo datum, ne nulu", () => {
    // Razlika između „nisam trgovao" i „trgovao sam i izašao na nuli" je
    // upravo ono što ceo projekat pazi da ne pomeša.
    const { container } = render(
      <CalendarHeatmap daily={daily} endDay={END} weeks={2} />,
    );
    expect(titleFor(container, "2026-03-01")).toBe("2026-03-01");
    // Trgovan dan koji je izašao na nuli NOSI iznos — i bez znaka, jer nula
    // nije ni dobitak ni gubitak. `+$0.00` bi je svrstao na jednu stranu.
    expect(titleFor(container, "2026-03-04")).toBe("2026-03-04: $0.00");
  });

  it("ravan dan je prigušen, ne zelen i ne crven", () => {
    const { container } = render(
      <CalendarHeatmap daily={daily} endDay={END} weeks={2} />,
    );
    expect(bgFor(container, "2026-03-04")).toContain("--muted");
    expect(bgFor(container, "2026-03-01")).toContain("--muted");
  });

  it("dobitak vuče na profit, gubitak na loss", () => {
    const { container } = render(
      <CalendarHeatmap daily={daily} endDay={END} weeks={2} />,
    );
    expect(bgFor(container, "2026-03-02")).toContain("--profit");
    expect(bgFor(container, "2026-03-03")).toContain("--loss");
  });

  it("skala je RELATIVNA na najveći potez u prozoru", () => {
    // Isti dan od +150 mora da bude tamniji kad je najveći potez manji. Da je
    // skala apsolutna, tih mesec bi izgledao prazno.
    const kroz = (max: number) =>
      bgFor(
        render(
          <CalendarHeatmap
            daily={new Map([["2026-03-05", 150], ["2026-03-02", max]])}
            endDay={END}
            weeks={2}
          />,
        ).container,
        "2026-03-05",
      );
    const uzGlasanMesec = kroz(3000);
    const uzTihMesec = kroz(200);
    expect(uzTihMesec).not.toBe(uzGlasanMesec);
  });
});

describe("ComplianceHeatmap — disciplina", () => {
  const series: DayCompliance[] = [
    { date: "2026-03-02", pct: 100, satisfied: 5, applicable: 5 } as DayCompliance,
    { date: "2026-03-03", pct: 60, satisfied: 3, applicable: 5 } as DayCompliance,
    { date: "2026-03-04", pct: 0, satisfied: 0, applicable: 4 } as DayCompliance,
    { date: "2026-03-05", pct: null, satisfied: 0, applicable: 0 } as DayCompliance,
  ];

  it("tooltip nosi procenat i razlomak iz kojeg je nastao", () => {
    const { container } = render(
      <ComplianceHeatmap series={series} endDay={END} weeks={2} />,
    );
    expect(titleFor(container, "2026-03-02")).toBe("2026-03-02: 100% (5/5)");
    expect(titleFor(container, "2026-03-03")).toBe("2026-03-03: 60% (3/5)");
  });

  it("dan bez ijednog pravila kaze no rules, ne 0 %", () => {
    const { container } = render(
      <ComplianceHeatmap series={series} endDay={END} weeks={2} />,
    );
    expect(titleFor(container, "2026-03-05")).toBe("2026-03-05: no rules");
    expect(titleFor(container, "2026-03-01")).toBe("2026-03-01: no rules");
  });

  it("SKALA JE FIKSNA — 60 % izgleda isto bez obzira na ostatak prozora", () => {
    // Ovo je razlika zbog koje mapa discipline ne deli skalu sa mapom novca.
    // Normalizacija bi mesec od samih šezdesetica prefarbala u tamno.
    const uzSavrsenDan = bgFor(
      render(<ComplianceHeatmap series={series} endDay={END} weeks={2} />)
        .container,
      "2026-03-03",
    );
    const bezSavrsenogDana = bgFor(
      render(
        <ComplianceHeatmap
          series={series.filter((d) => d.pct !== 100)}
          endDay={END}
          weeks={2}
        />,
      ).container,
      "2026-03-03",
    );
    expect(uzSavrsenDan).toBe(bezSavrsenogDana);
  });

  it("nula procenata je vidljiva, ne prigušena", () => {
    // Dan u kojem su prekršena sva pravila ne sme da izgleda kao slobodan dan.
    const { container } = render(
      <ComplianceHeatmap series={series} endDay={END} weeks={2} />,
    );
    const nula = bgFor(container, "2026-03-04");
    const bezPodataka = bgFor(container, "2026-03-05");
    expect(nula).toContain("--primary");
    expect(bezPodataka).toContain("--muted");
    expect(nula).not.toBe(bezPodataka);
  });

  it("ne koristi paletu novca — zeleno pored P&L kalendara bi se čitalo kao para", () => {
    const { container } = render(
      <ComplianceHeatmap series={series} endDay={END} weeks={2} />,
    );
    for (const [title, el] of cellsByTitle(container)) {
      expect(el.style.backgroundColor, title).not.toContain("--profit");
      expect(el.style.backgroundColor, title).not.toContain("--loss");
    }
  });
});
