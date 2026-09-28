// From the Supabase UI Library `safe-next-path` block (registry dependency of
// `oauth-consent-nextjs`). Browser-side guard for a `next` redirect target:
// only a same-origin path survives, anything else becomes `fallback`. The
// server-side equivalent is resolveAppRedirectPath (src/lib/url.ts).
export const safeNextPath = (path: unknown, fallback = '/', origin?: string) => {
  if (typeof path !== 'string' || !path.startsWith('/')) return fallback;

  const currentOrigin = origin ?? window.location.origin;

  try {
    const url = new URL(path, currentOrigin);
    return url.origin === currentOrigin ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
};
