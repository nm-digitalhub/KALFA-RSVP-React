// Loading fallback inside an app area that already has its shell around it (the
// admin and customer areas): a heading-and-card skeleton in the content column.
// The token surfaces, which have no shell, use public-token-loading.tsx instead.
export function SectionLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-8 w-48 animate-pulse rounded-md bg-border" />
      <div className="h-24 animate-pulse rounded-lg bg-border" />
      <span className="sr-only">טוען…</span>
    </div>
  );
}
