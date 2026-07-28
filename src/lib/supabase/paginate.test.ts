import { describe, expect, it } from "vitest";
import {
  chunkIds,
  IN_FILTER_CHUNK,
  PAGE_SIZE,
  selectAllByIds,
  selectAllPages,
} from "./paginate";

/** A fake PostgREST table that honours `.range(from, to)` semantics. */
function fakeTable(rowCount: number) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({ i }));
  const calls: [number, number][] = [];
  return {
    calls,
    page: (from: number, to: number) => {
      calls.push([from, to]);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
}

describe("selectAllPages", () => {
  it("returns everything when the table is larger than one page", async () => {
    const t = fakeTable(PAGE_SIZE * 2 + 7);
    const out = await selectAllPages(t.page);

    expect(out).toHaveLength(PAGE_SIZE * 2 + 7);
    // Three full requests: two saturated pages plus the short one that ends it.
    expect(t.calls).toHaveLength(3);
    expect(t.calls[0]).toEqual([0, PAGE_SIZE - 1]);
    expect(out[out.length - 1]).toEqual({ i: PAGE_SIZE * 2 + 6 });
  });

  it("stops after one request when the first page comes back short", async () => {
    const t = fakeTable(10);
    expect(await selectAllPages(t.page)).toHaveLength(10);
    expect(t.calls).toHaveLength(1);
  });

  it("makes a second request when the table is exactly one page", async () => {
    // A full page is indistinguishable from a truncated one, so it must ask
    // again rather than assume it has seen the end.
    const t = fakeTable(PAGE_SIZE);
    expect(await selectAllPages(t.page)).toHaveLength(PAGE_SIZE);
    expect(t.calls).toHaveLength(2);
  });

  it("throws rather than silently returning a partial set", async () => {
    await expect(
      selectAllPages(() =>
        Promise.resolve({ data: null, error: { message: "boom" } }),
      ),
    ).rejects.toThrow("boom");
  });

  it("treats a null page as the end", async () => {
    const out = await selectAllPages(() =>
      Promise.resolve({ data: null, error: null }),
    );
    expect(out).toEqual([]);
  });
});

describe("chunkIds", () => {
  it("splits at the .in() filter limit", () => {
    const ids = Array.from({ length: IN_FILTER_CHUNK * 2 + 1 }, (_, i) => i);
    const chunks = chunkIds(ids);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(IN_FILTER_CHUNK);
    expect(chunks[2]).toEqual([IN_FILTER_CHUNK * 2]);
    expect(chunks.flat()).toEqual(ids);
  });

  it("returns nothing for an empty list", () => {
    expect(chunkIds([])).toEqual([]);
  });
});

describe("selectAllByIds", () => {
  it("queries one chunk per id batch and concatenates", async () => {
    const ids = Array.from({ length: IN_FILTER_CHUNK + 3 }, (_, i) => `id${i}`);
    const seen: string[][] = [];

    const out = await selectAllByIds(ids, (chunk) => {
      seen.push(chunk);
      return Promise.resolve({ data: chunk.map((id) => ({ id })), error: null });
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toHaveLength(IN_FILTER_CHUNK);
    expect(out.map((r) => r.id)).toEqual(ids);
  });

  it("does not issue a request for an empty id list", async () => {
    let called = false;
    const out = await selectAllByIds([], () => {
      called = true;
      return Promise.resolve({ data: [], error: null });
    });
    expect(called).toBe(false);
    expect(out).toEqual([]);
  });
});
