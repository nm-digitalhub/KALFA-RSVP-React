// Loading fallback for the admin area (wraps the page in Suspense).
export default function AdminLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-8 w-48 animate-pulse rounded-md bg-border" />
      <div className="h-24 animate-pulse rounded-lg bg-border" />
      <span className="sr-only">טוען…</span>
    </div>
  );
}
