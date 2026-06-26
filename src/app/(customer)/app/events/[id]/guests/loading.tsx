// Loading fallback for the guests area (Suspense boundary).
export default function GuestsLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-8 w-40 animate-pulse rounded-md bg-border" />
      <div className="h-10 w-full animate-pulse rounded-md bg-border" />
      <div className="h-64 w-full animate-pulse rounded-lg bg-border" />
      <span className="sr-only">טוען מוזמנים…</span>
    </div>
  );
}
