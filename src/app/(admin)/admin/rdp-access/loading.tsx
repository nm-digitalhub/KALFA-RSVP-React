// Loading fallback for /admin/rdp-access: the heading row, the four-station track and one panel, in the same
// proportions as the loaded page so nothing jumps when it arrives.
export default function RdpAccessLoading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8" aria-busy="true" aria-live="polite">
      <div className="h-9 w-64 animate-pulse rounded-md bg-border" />
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="size-11 animate-pulse rounded-full bg-border sm:size-14" />
            <div className="h-4 w-14 animate-pulse rounded bg-border" />
          </div>
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-2xl bg-border" />
      <span className="sr-only">טוען…</span>
    </div>
  );
}
