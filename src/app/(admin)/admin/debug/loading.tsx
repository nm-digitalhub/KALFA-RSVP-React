// Loading fallback for /admin/debug — the page is force-dynamic and fetches
// live sidecar + DB data on every request, so a dedicated skeleton (matching
// admin/analytics/loading.tsx's pattern) beats the generic admin/loading.tsx.
export default function DebugLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-8 w-40 animate-pulse rounded-md bg-border" />
      <div className="h-20 animate-pulse rounded-lg bg-border" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-48 animate-pulse rounded-lg bg-border" />
      ))}
      <span className="sr-only">טוען…</span>
    </div>
  );
}
