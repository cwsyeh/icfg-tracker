// PostgREST silently truncates any result set at 1000 rows.
// Use fetchAll() for any table that could grow beyond that limit.

const PAGE_SIZE = 1000

/**
 * Fetches all rows from a Supabase query by paginating through 1000-row pages.
 * Pass a factory that accepts (from, to) range arguments and returns the query.
 *
 * Usage:
 *   const txs = await fetchAll<Transaction>((from, to) =>
 *     supabase.from('transactions').select('*').in('property_id', ids).range(from, to)
 *   )
 */
export async function fetchAll<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const all: T[] = []
  let page = 0
  while (true) {
    const { data } = await buildQuery(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    page++
  }
  return all
}
