import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { OpenPositionsCard, type OpenPositionView } from "./open-positions-card";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/app/(app)/daily/actions", () => ({
  savePositionCheckin: vi.fn(async () => ({ ok: true as const })),
}));

/**
 * DNEVNA PROVERA OTVORENIH POZICIJA.
 *
 * Broj koji ova kartica pokazuje je `daysInTrade` — koji dan drži poziciju i
 * koliko joj je vremenski stop. To je jedini brojač u aplikaciji koji je
 * 1-BAZAN (dan otvaranja se broji kao prvi), i Korak 5 je oko te konvencije
 * uklonio drugu IMPLEMENTACIJU zadržavši razliku. Ovde se tvrdi da razlika
 * stiže do ekrana u obliku koji čovek čita.
 *
 * Drugi deo je stanje bez odgovora. `null` u ovoj kartici znači „danas se nisam
 * javio", a ne „teza je netaknuta" — isto razlikovanje koje ceo projekat pazi
 * da ne pomeša, ovde na najvidljivijem mestu.
 */

const pos = (over: Partial<OpenPositionView> = {}): OpenPositionView => ({
  id: "p1",
  label: "ES Long",
  daysInTrade: 3,
  timeStopDays: null,
  pastTimeStop: false,
  thesis: null,
  invalidation: null,
  checkin: null,
  ...over,
});

const draw = (positions: OpenPositionView[], locked = false) =>
  render(
    <OpenPositionsCard
      positions={positions}
      reportDate="2026-03-04"
      locked={locked}
    />,
  );

describe("brojanje dana", () => {
  it("ispisuje koji je dan držanja", () => {
    draw([pos({ daysInTrade: 3 })]);
    expect(screen.getByText(/day 3/)).toBeInTheDocument();
  });

  it("sa vremenskim stopom kaze dan N od M", () => {
    draw([pos({ daysInTrade: 3, timeStopDays: 5 })]);
    expect(screen.getByText(/day 3 of 5/)).toBeInTheDocument();
  });

  it("bez vremenskog stopa ne izmišlja gornju granicu", () => {
    draw([pos({ daysInTrade: 3, timeStopDays: null })]);
    expect(screen.getByText(/day 3/).textContent).toBe("day 3");
  });

  it("prvi dan je 1, ne 0 — brojač je 1-bazan", () => {
    // `daysBetweenKeys` broji dan otvaranja kao prvu sesiju. Nula bi značila da
    // pozicija još nije ni otvorena.
    draw([pos({ daysInTrade: 1 })]);
    expect(screen.getByText(/day 1/)).toBeInTheDocument();
  });
});

describe("prekoračen vremenski stop", () => {
  it("nosi upozorenje i naglašen okvir", () => {
    const { container } = draw([
      pos({ daysInTrade: 7, timeStopDays: 5, pastTimeStop: true }),
    ]);
    expect(screen.getByText("Past time stop")).toBeInTheDocument();
    expect(container.querySelector(".border-amber-500\\/60")).toBeTruthy();
  });

  it("pozicija u roku nema ni upozorenje ni okvir", () => {
    draw([pos({ daysInTrade: 3, timeStopDays: 5, pastTimeStop: false })]);
    expect(screen.queryByText("Past time stop")).not.toBeInTheDocument();
  });
});

describe("odgovoreno naspram ćutanja", () => {
  it("pozicija bez odgovora nema kvačicu", () => {
    draw([pos({ checkin: null })]);
    expect(screen.queryByLabelText("Checked in")).not.toBeInTheDocument();
  });

  it("odgovorena pozicija nosi kvačicu", () => {
    draw([
      pos({
        checkin: {
          position_id: "p1",
          report_date: "2026-03-04",
          thesis_state: "intact",
          touched: null,
          note: null,
        } as OpenPositionView["checkin"],
      }),
    ]);
    expect(screen.getByLabelText("Checked in")).toBeInTheDocument();
  });

  it("sam `touched` bez teze NIJE odgovoreno", () => {
    // Kvačica prati tezu, ne dodir. „Pomerio sam stop" bez ocene teze je pola
    // odgovora, i kartica to ne sme da prikaže kao završen dan.
    draw([
      pos({
        checkin: {
          position_id: "p1",
          report_date: "2026-03-04",
          thesis_state: null,
          touched: "stop_moved",
          note: null,
        } as OpenPositionView["checkin"],
      }),
    ]);
    expect(screen.queryByLabelText("Checked in")).not.toBeInTheDocument();
  });
});

describe("više pozicija", () => {
  it("svaka nosi svoj broj dana", () => {
    const { container } = draw([
      pos({ id: "a", label: "ES Long", daysInTrade: 2 }),
      pos({ id: "b", label: "EURUSD Short", daysInTrade: 9, timeStopDays: 10 }),
    ]);
    const es = container.querySelector<HTMLElement>('a[href="/trades/a"]')
      ?.parentElement as HTMLElement;
    const fx = container.querySelector<HTMLElement>('a[href="/trades/b"]')
      ?.parentElement as HTMLElement;
    expect(within(es).getByText(/day 2/)).toBeInTheDocument();
    expect(within(fx).getByText(/day 9 of 10/)).toBeInTheDocument();
  });

  it("svaka vodi na svoj trejd", () => {
    const { container } = draw([
      pos({ id: "a", label: "ES Long" }),
      pos({ id: "b", label: "EURUSD Short" }),
    ]);
    expect(container.querySelector('a[href="/trades/a"]')).toBeTruthy();
    expect(container.querySelector('a[href="/trades/b"]')).toBeTruthy();
  });
});

describe("zaključan dan", () => {
  it("dugmad su onemogućena kad je dan zaključan", () => {
    const { container } = draw([pos()], true);
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.hasAttribute("disabled"))).toBe(true);
  });

  it("otključan dan ima upotrebljiva dugmad", () => {
    const { container } = draw([pos()], false);
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.some((b) => !b.hasAttribute("disabled"))).toBe(true);
  });
});
