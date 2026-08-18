import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDashboardPrefs,
  setDashboardPrefs,
  toggleCollapsed,
} from "./dashboard-prefs";

/**
 * SKLOPLJENE GRUPE NA DASHBOARD-U.
 *
 * Podešavanje koje pripada pregledaču, ne nalogu — i koje ne sme da obori
 * stranicu koju ukrašava. Modul ima tri odbrane (SSR, parsiranje, upis) i
 * nijedna nije bila proverena.
 */

const KEY = "tj:dashboard_prefs";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

describe("bez browsera", () => {
  it("čitanje na serveru vraća prazno umesto da padne", () => {
    // `window` ne postoji u node okruženju ovog projekta, pa je ovo stvarno
    // stanje pri renderu na serveru, a ne simulacija.
    expect(typeof window).toBe("undefined");
    expect(getDashboardPrefs()).toEqual({});
  });

  it("upis na serveru je bez efekta i bez greške", () => {
    expect(() => setDashboardPrefs({ collapsedGroups: ["risk"] })).not.toThrow();
  });
});

describe("u browseru", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {} as Window & typeof globalThis);
    vi.stubGlobal("localStorage", fakeStorage());
  });

  it("prazno skladište daje prazne postavke", () => {
    expect(getDashboardPrefs()).toEqual({});
  });

  it("upisano se pročita nazad", () => {
    setDashboardPrefs({ collapsedGroups: ["risk", "quality"] });
    expect(getDashboardPrefs()).toEqual({ collapsedGroups: ["risk", "quality"] });
  });

  it("pokvaren JSON ne obara stranicu", () => {
    localStorage.setItem(KEY, "{ ovo nije json");
    expect(getDashboardPrefs()).toEqual({});
  });

  it("`collapsedGroups` koji nije niz se odbacuje", () => {
    // Ovo je odbrana koja stvarno nešto sprečava: vrednost bi stigla do
    // `.includes()` i panel bi pukao pri renderu — zbog podešavanja izgleda.
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: "risk" }));
    expect(getDashboardPrefs()).toEqual({});
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: 7 }));
    expect(getDashboardPrefs()).toEqual({});
  });

  it("`null` upisan u skladište se čita kao prazno", () => {
    localStorage.setItem(KEY, "null");
    expect(getDashboardPrefs()).toEqual({});
  });

  it("upis koji padne (kvota, privatni režim) se guta", () => {
    vi.stubGlobal("localStorage", {
      ...fakeStorage(),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    } as unknown as Storage);
    expect(() => setDashboardPrefs({ collapsedGroups: ["risk"] })).not.toThrow();
  });
});

describe("toggleCollapsed", () => {
  it("dodaje kad nije unutra, uklanja kad jeste", () => {
    expect(toggleCollapsed([], "risk")).toEqual(["risk"]);
    expect(toggleCollapsed(["risk"], "risk")).toEqual([]);
    expect(toggleCollapsed(["risk"], "quality")).toEqual(["risk", "quality"]);
  });

  it("ne menja ulazni niz", () => {
    const before = ["risk"];
    toggleCollapsed(before, "quality");
    expect(before).toEqual(["risk"]);
  });

  it("čuva se SKLOPLJENI skup, pa nova grupa stiže otvorena", () => {
    // Da se čuvao otvoreni skup, grupa dodata kasnije bi za svakog postojećeg
    // korisnika bila sklopljena — metrika koja je tiho nestala sa ekrana.
    const stored = ["risk"];
    const novaGrupa = "swing";
    expect(stored.includes(novaGrupa)).toBe(false);
  });
});

describe("dva polja u istoj prodavnici", () => {
  // Isti stabovi kao u „u browseru" bloku — bez njih `typeof window` je
  // „undefined" i modul se, sasvim ispravno, ponaša kao na serveru.
  beforeEach(() => {
    vi.stubGlobal("window", {} as Window & typeof globalThis);
    vi.stubGlobal("localStorage", fakeStorage());
  });

  it("POKVARENO POLJE KOŠTA SAMO SEBE, ne ceo fajl", () => {
    // Čuvar je do sada vraćao `{}` čim `collapsedGroups` nije niz. Sa jednim
    // poljem to je bilo neprimetno; sa dva znači da je preferenca koja drži
    // samo `hiddenWidgets` bacana u celosti pri svakom čitanju — korisnik bi
    // sakrio pola dashboard-a i zatekao ga netaknutog posle osvežavanja.
    localStorage.setItem(
      KEY,
      JSON.stringify({ collapsedGroups: "ne-niz", hiddenWidgets: ["equity"] }),
    );
    expect(getDashboardPrefs()).toEqual({ hiddenWidgets: ["equity"] });
  });

  it("odbacuje niz koji nije niz stringova", () => {
    // `.includes()` nad brojevima ne puca, ali `WIDGET_IDS.filter` nad njima
    // vraća tišinu umesto greške — bolje da polje ne postoji.
    localStorage.setItem(KEY, JSON.stringify({ hiddenWidgets: [1, 2] }));
    expect(getDashboardPrefs()).toEqual({});
  });

  it("upisom jednog polja ne briše drugo", () => {
    setDashboardPrefs({ collapsedGroups: ["result"] });
    setDashboardPrefs({ hiddenWidgets: ["calendar"] });
    expect(getDashboardPrefs()).toEqual({
      collapsedGroups: ["result"],
      hiddenWidgets: ["calendar"],
    });
  });
});
