/**
 * Relocation wizard — one reader for the DB-resident settings the wizard
 * needs (app_settings singleton) via the Supabase REST endpoint with the
 * service key from env. A plain fetch, no server-only import chain (this runs
 * under tsx). Values are returned to the caller and never printed.
 */
export async function readAppSettings<T extends Record<string, unknown>>(
  env: Record<string, string>,
  columns: readonly (keyof T & string)[],
): Promise<T | null> {
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;
  try {
    const res = await fetch(
      `${base}/rest/v1/app_settings?id=eq.true&select=${columns.join(",")}`,
      {
        headers: { apikey: key, authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as T[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
