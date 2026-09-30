import { describe, expect, it } from "vitest";
import { imageDraftsToPayload } from "./trade-image-drafts";

describe("imageDraftsToPayload", () => {
  it("sends the filled charts, in the order they were added", () => {
    expect(
      imageDraftsToPayload(["https://www.tradingview.com/x/one/", "storage:u/two.png"]),
    ).toEqual(["https://www.tradingview.com/x/one/", "storage:u/two.png"]);
  });

  it("drops empty and whitespace-only fields", () => {
    // A "+" pressed and left untouched is not an intent to attach a blank chart.
    expect(imageDraftsToPayload(["", "   "])).toEqual([]);
    expect(imageDraftsToPayload([])).toEqual([]);
  });

  it("trims what it keeps — a pasted link often carries a trailing space", () => {
    expect(imageDraftsToPayload(["  https://www.tradingview.com/x/Z9/  "])).toEqual([
      "https://www.tradingview.com/x/Z9/",
    ]);
  });
});
