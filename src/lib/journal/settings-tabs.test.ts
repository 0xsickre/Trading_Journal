import { describe, expect, it } from "vitest";
import { parseCategorySubtab, parseSettingsTab, settingsSearch } from "./settings-tabs";

describe("parseSettingsTab", () => {
  it("reads a known tab and falls back to Categories", () => {
    expect(parseSettingsTab("accounts")).toBe("accounts");
    expect(parseSettingsTab(["deposits", "x"])).toBe("deposits");
    expect(parseSettingsTab("nope")).toBe("categories");
    expect(parseSettingsTab(undefined)).toBe("categories");
  });
  it("reads the sub-tab", () => {
    expect(parseCategorySubtab("tags")).toBe("tags");
    expect(parseCategorySubtab("other")).toBe("categories");
  });
});

describe("settingsSearch", () => {
  it("writes the tab and leaves the default out", () => {
    expect(settingsSearch("", { tab: "accounts" })).toBe("?tab=accounts");
    expect(settingsSearch("?tab=accounts", { tab: "categories" })).toBe("");
  });
  it("keeps sub only under Categories", () => {
    expect(settingsSearch("", { sub: "tags" })).toBe("?sub=tags");
    expect(settingsSearch("?sub=tags", { tab: "tracker" })).toBe("?tab=tracker");
    expect(settingsSearch("?sub=tags", { sub: "categories" })).toBe("");
  });
  it("leaves unrelated parameters alone", () => {
    expect(settingsSearch("?x=1", { tab: "instruments" })).toBe("?x=1&tab=instruments");
  });
});
