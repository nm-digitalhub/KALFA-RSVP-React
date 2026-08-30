// Loading fallback for every unauthenticated token surface (/r, /g, /ty,
// /rate, /join) that has no more specific loading.tsx. These routes have no
// shared layout/chrome of their own (unlike (customer)/app), so this is a
// full-page centered skeleton rather than an in-dashboard one.
export default function PublicLoading() {
  return (
    <div
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="h-8 w-40 animate-pulse rounded-md bg-border" />
      <div className="h-24 w-full animate-pulse rounded-lg bg-border" />
      <span className="sr-only">טוען…</span>
    </div>
  );
}
