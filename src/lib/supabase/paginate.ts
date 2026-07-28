/**
 * Draining PostgREST result sets.
 *
 * An unbounded `select()` does NOT return everything. PostgREST caps a response
 * at its configured `db-max-rows` (1000 by default) and returns the truncated
 * page with HTTP 200 and no error — so a journal past that many trades keeps
 * rendering a win rate, a net P&L and a drawdown computed on a partial set,
 * with no visible symptom. For financial data that is worse than an outright
 * failure, because the wrong number looks like a fact.
 *
 * Every read that can grow with the user's history must go through here.
 */

/** Rows requested per round trip. Must be >= the server's `db-max-rows`. */
export const PAGE_SIZE = 1000;

/**
 * PostgREST caps a URL's length, so an `.in()` filter cannot take an unbounded
 * id list. Chunk at half a page: comfortably under the limit for uuid keys.
 */
export const IN_FILTER_CHUNK = 500;

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/**
 * Call `build` with successive ranges until a page comes back short.
 *
 * `build` receives inclusive `from`/`to` row offsets and should apply them with
 * `.range(from, to)`. Order the query by something stable — an unordered
 * paginated read can repeat or skip rows between requests.
 */
export async function selectAllPages<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (data && data.length > 0) out.push(...data);
    if (!data || data.length < PAGE_SIZE) return out;
  }
}

/** Split ids into `.in()`-sized chunks. */
export function chunkIds<T>(ids: T[], size = IN_FILTER_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Run `build` once per id chunk and concatenate. Chunks are fetched in
 * parallel; each is itself drained page by page, since one chunk of 500
 * positions can still carry more than a page of child rows.
 */
export async function selectAllByIds<T, Id>(
  ids: Id[],
  build: (chunk: Id[], from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const pages = await Promise.all(
    chunkIds(ids).map((chunk) =>
      selectAllPages<T>((from, to) => build(chunk, from, to)),
    ),
  );
  return pages.flat();
}
