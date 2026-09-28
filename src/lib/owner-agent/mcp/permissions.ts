export function parsePermissionsEnv(raw: string | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  return new Set(raw.split(',').filter((key) => key.length > 0));
}
