import { Skeleton } from '@/components/ui/skeleton';

// Skeleton matching the dashboard footprint (tile grid + chart + tables) so
// the first uncached GA4 fetch doesn't flash a blank page. Uses the shadcn
// Skeleton primitive.
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-8">
      <span className="sr-only">טוען נתוני אנליטיקה…</span>
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-8 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-lg lg:col-span-2" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-56 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
