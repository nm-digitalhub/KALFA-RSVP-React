// Loading fallback for the unauthenticated token surfaces (/r, /g, /ty, /rate,
// /join, /cb). These routes have no shared layout/chrome of their own (unlike
// (customer)/app), so this is a full-page centered skeleton rather than an
// in-dashboard one.
//
// Mounted by a one-line loading.tsx in EACH token segment — deliberately NOT at
// (public)/loading.tsx: that position also wraps the (site) marketing pages in
// a Suspense boundary, so they streamed as a "טוען…" skeleton whose reveal
// waits for requestAnimationFrame. A backgrounded or headless tab (an AI
// agent's browser) never fires rAF, and the marketing page stayed a skeleton.
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
