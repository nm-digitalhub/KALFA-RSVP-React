// Loading fallback for /admin/relocation — the page is force-dynamic and reads
// the wizard state file on every request; a dedicated skeleton (matching
// admin/debug/loading.tsx's pattern) beats the generic admin/loading.tsx.
export default function RelocationLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-8 w-40 animate-pulse rounded-md bg-border" />
      <div className="h-28 animate-pulse rounded-lg bg-border" />
      <div className="h-16 animate-pulse rounded-lg bg-border" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg bg-border" />
      ))}
      <span className="sr-only">טוען…</span>
    </div>
  );
}
