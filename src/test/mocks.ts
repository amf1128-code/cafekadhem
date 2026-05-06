/**
 * Shared Supabase mock helpers for component tests.
 *
 * The cinema components import `supabase` from `../../lib/supabase` (or
 * deeper paths). We use `vi.mock` in each test file to swap that module
 * out for a stub. The stub mirrors only the surface area each component
 * actually uses — chained .from(...).select(...).eq(...).single() etc.
 *
 * For most pages the surface is small enough to mock inline. This file
 * exposes a tiny query-builder factory that lets tests describe the
 * data shape Supabase should return without rewriting the chained API
 * each time.
 */

type Query = {
  data: unknown
  error: null | { message: string }
}

/**
 * Make a thenable that mirrors Supabase's PostgREST builder. Each call
 * to the chained methods (.eq / .order / .in / .limit / etc.) returns
 * the same builder, so test fixtures can stub:
 *
 *   const builder = makeQuery({ data: rows })
 *   supabase.from = vi.fn().mockReturnValue(builder)
 *
 * `await supabase.from('events').select('*').eq('id', x).single()`
 * resolves to `{ data: rows, error: null }`.
 */
export function makeQuery(result: Partial<Query>) {
  const final: Query = { data: null, error: null, ...result }
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    single: () => Promise.resolve(final),
    maybeSingle: () => Promise.resolve(final),
    then: (onFulfilled: (v: Query) => unknown) =>
      Promise.resolve(final).then(onFulfilled),
  }
  return builder
}

/**
 * Make a Supabase stub that routes table reads + RPC calls to the right
 * fixture. Pass a map of table name → query result and rpc name →
 * resolved value. Tables / rpcs not in the maps return `{ data: null,
 * error: null }` so loaders don't crash.
 */
export function makeSupabaseStub({
  tables = {},
  rpcs = {},
}: {
  tables?: Record<string, Partial<Query>>
  rpcs?: Record<string, unknown>
}) {
  return {
    from: (table: string) => makeQuery(tables[table] ?? {}),
    rpc: (name: string) =>
      Promise.resolve({ data: rpcs[name] ?? null, error: null }),
    functions: {
      invoke: () => Promise.resolve({ data: null, error: null }),
    },
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://example/img.png' } }),
      }),
    },
  }
}
