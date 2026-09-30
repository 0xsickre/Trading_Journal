import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Delete all data" takes the chart image files with the rows: the reset's SQL
 * deletes `tj_trade_images`, and the files under the user's folder in the
 * `trade-images` bucket go through the Storage API after it.
 */

const USER = "97edd6db-12db-4156-9f89-77d2dcaa66d7";
const rpc = vi.fn(async (..._a: unknown[]) => ({ error: null as { message: string } | null }));
let folder: { id: string | null; name: string }[] = [];
const removed: string[][] = [];
let removeWorks = true;

const bucket = {
  list: vi.fn(async (_path: string, opts: { limit: number }) => ({ data: folder.slice(0, opts.limit), error: null })),
  remove: vi.fn(async (paths: string[]) => {
    removed.push(paths);
    if (!removeWorks) return { data: [], error: null };
    folder = folder.filter((f) => !paths.includes(`${USER}/${f.name}`));
    return { data: paths.map((name) => ({ name })), error: null };
  }),
};
const from = vi.fn((_b: string) => bucket);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/journal/revalidate", () => ({ revalidateOptions: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, storage: { from } }) }));
vi.mock("@/lib/supabase/user", () => ({ getCurrentUser: async () => ({ id: USER }) }));

const { resetAllData } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  removed.length = 0;
  removeWorks = true;
  folder = [];
});

const files = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, name: `img-${i}.png` }));

describe("resetAllData", () => {
  it("resets the rows, then deletes every image file in the user's folder, a page at a time", async () => {
    folder = files(150);
    const res = await resetAllData("RESET EVERYTHING");
    expect(res).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("tj_reset_my_data");
    expect(from).toHaveBeenCalledWith("trade-images");
    expect(bucket.list).toHaveBeenCalledWith(USER, { limit: 100 });
    expect(removed.map((p) => p.length)).toEqual([100, 50]);
    expect(removed[0][0]).toBe(`${USER}/img-0.png`);
    expect(folder).toEqual([]);
  });

  it("touches no file when the reset itself fails", async () => {
    folder = files(3);
    rpc.mockResolvedValueOnce({ error: { message: "boom" } });
    expect(await resetAllData("RESET EVERYTHING")).toEqual({ ok: false, error: "boom" });
    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it("skips folder placeholders and says so when files would not delete", async () => {
    folder = [{ id: null, name: "sub" }, ...files(2)];
    removeWorks = false;
    const res = await resetAllData("RESET EVERYTHING");
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ error: expect.stringContaining("chart image files were not all deleted") });
    expect(removed).toEqual([[`${USER}/img-0.png`, `${USER}/img-1.png`]]);
  });

  it("asks for the phrase before anything is deleted", async () => {
    expect((await resetAllData("reset")).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
