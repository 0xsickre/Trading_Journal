import { describe, expect, it } from "vitest";
import { imageDraftsToPayload } from "./trade-image-drafts";

describe("imageDraftsToPayload", () => {
  it("sends only the slots that were filled", () => {
    expect(
      imageDraftsToPayload({ htf_pre: "https://www.tradingview.com/x/AbC123/" }),
    ).toEqual([
      { kind: "htf_pre", image_url: "https://www.tradingview.com/x/AbC123/" },
    ]);
  });

  it("drops empty and whitespace-only slots", () => {
    // An untouched input is not an intent to attach a blank chart.
    expect(imageDraftsToPayload({ htf_pre: "", ltf_pre: "   " })).toEqual([]);
    expect(imageDraftsToPayload({})).toEqual([]);
  });

  it("trims what it keeps — a pasted link often carries a trailing space", () => {
    expect(
      imageDraftsToPayload({ ltf_pre: "  https://www.tradingview.com/x/Z9/  " }),
    ).toEqual([{ kind: "ltf_pre", image_url: "https://www.tradingview.com/x/Z9/" }]);
  });

  it("emits in display order, whatever order the keys were set in", () => {
    const out = imageDraftsToPayload({
      ltf_pre: "https://www.tradingview.com/x/two/",
      htf_pre: "https://www.tradingview.com/x/one/",
    });
    expect(out.map((i) => i.kind)).toEqual(["htf_pre", "ltf_pre"]);
  });

  it("ignores a key that is not a pre-entry slot", () => {
    // `ltf_post` is a screenshot of an exit that has not happened. Iterating the
    // known kinds rather than the object's own keys is what keeps it out.
    const out = imageDraftsToPayload({
      htf_pre: "https://www.tradingview.com/x/one/",
      ltf_post: "https://www.tradingview.com/x/post/",
    } as Parameters<typeof imageDraftsToPayload>[0]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("htf_pre");
  });
});
