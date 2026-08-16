import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StatGroup } from "./stat-group";

/**
 * BLOK KPI PLOČICA — I INVARIJANTA KOJA ŠTITI SVE OSTALE TESTOVE.
 *
 * Komponenta izgleda kao ukras, ali nosi tvrdnju od koje zavisi pouzdanost
 * `dashboard.render.test.tsx`: BEZ SAČUVANOG PODEŠAVANJA GRUPA JE OTVORENA.
 *
 * Devet tvrdnji o KPI brojevima na dashboard-u traži tekst unutar ovih grupa.
 * Da je podrazumevano stanje sklopljeno — ili da se `localStorage` čitao pri
 * renderu umesto u efektu — headless render bi zatekao sklopljenu grupu i tiho
 * NE BI NAŠAO pločicu koja je zaista na stranici. Devet provera brojeva bi se
 * ugasilo bez ijednog crvenog testa.
 *
 * Zato ovaj fajl proverava upravo to, a ne izgled.
 */

const KEY = "tj:dashboard_prefs";

afterEach(() => {
  localStorage.clear();
});

const draw = (props: Partial<Parameters<typeof StatGroup>[0]> = {}) =>
  render(
    <StatGroup id="risk" title="Risk" count={3} {...props}>
      <div>Max DD</div>
      <div>Sharpe</div>
      <div>Sortino</div>
    </StatGroup>,
  );

describe("podrazumevano stanje je otvoreno", () => {
  it("bez ijednog sačuvanog podešavanja sadržaj je u dokumentu", () => {
    draw();
    expect(screen.getByText("Max DD")).toBeInTheDocument();
    expect(screen.getByText("Sortino")).toBeInTheDocument();
  });

  it("dugme prijavlja otvoreno stanje pomoćnim tehnologijama", () => {
    draw();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("PODEŠAVANJE ZA DRUGU GRUPU ne zatvara ovu", () => {
    // Ovo je stvarna zaštita testova dashboard-a: jedna sklopljena grupa ne sme
    // da povuče ostale sa sobom.
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: ["quality"] }));
    draw({ id: "risk" });
    expect(screen.getByText("Max DD")).toBeInTheDocument();
  });

  it("pokvareno podešavanje ostavlja grupu otvorenom", () => {
    // Odbrana iz `dashboard-prefs.ts` mora da se vidi i ovde: neispravna
    // vrednost ne sme da sakrije metriku.
    localStorage.setItem(KEY, "{ ovo nije json");
    draw();
    expect(screen.getByText("Max DD")).toBeInTheDocument();
  });

  it("naslov i broj pločica stoje i kad je grupa otvorena", () => {
    // Broj je tu da sklopljena grupa i dalje kaže šta drži. Ne sme da nestane
    // kad je otvorena, inače bi ga korisnik video samo u jednom od dva stanja.
    draw();
    expect(screen.getByText("Risk")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

describe("sačuvano sklapanje", () => {
  it("grupa zapamćena kao sklopljena se zatvori posle hidratacije", () => {
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: ["risk"] }));
    draw({ id: "risk" });
    expect(screen.queryByText("Max DD")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    // Naslov i broj ostaju — sklopljena grupa i dalje kaže šta drži.
    expect(screen.getByText("Risk")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("klik sklapa i UPISUJE podešavanje", () => {
    draw();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("Max DD")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toEqual({
      collapsedGroups: ["risk"],
    });
  });

  it("ponovni klik otvara i UKLANJA podešavanje", () => {
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: ["risk"] }));
    draw();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Max DD")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toEqual({
      collapsedGroups: [],
    });
  });

  it("sklapanje jedne grupe ne dira drugu u istom skladištu", () => {
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: ["quality"] }));
    draw({ id: "risk" });
    fireEvent.click(screen.getByRole("button"));
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}").collapsedGroups).toEqual(
      ["quality", "risk"],
    );
  });
});

describe("identitet grupe", () => {
  it("preimenovan `id` ponovo otvara grupu", () => {
    // Namerno: bolje otvorena nego pogrešno sklopljena pod tuđim ključem —
    // metrika koja se ne vidi je gora od grupe koja se vidi bez potrebe.
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: ["risk"] }));
    draw({ id: "risk-v2" });
    expect(screen.getByText("Max DD")).toBeInTheDocument();
  });

  it("nula pločica je dozvoljena i ne obara render", () => {
    render(
      <StatGroup id="prazna" title="Empty" count={0}>
        {null}
      </StatGroup>,
    );
    expect(screen.getByText("Empty")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
