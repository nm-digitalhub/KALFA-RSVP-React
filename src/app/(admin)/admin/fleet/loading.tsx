import { Skeleton } from '@/components/ui/skeleton';

// Loading state of the CONVERSATION pane only — the list (layout) stays on
// screen, so switching conversations never blanks the whole page (plan L8, D8).
export default function FleetConversationLoading() {
  return (
    <div
      className="flex h-[calc(100dvh-var(--admin-header-h)-4rem)] flex-col gap-4 rounded-xl border border-border p-4 md:h-full"
      aria-busy="true"
      aria-live="polite"
    >
      <Skeleton className="h-8 w-48" />
      <div className="flex flex-1 flex-col justify-end gap-4">
        <Skeleton className="h-16 w-3/5 self-start rounded-xl" />
        <Skeleton className="h-12 w-2/5 self-end rounded-xl" />
        <Skeleton className="h-20 w-3/5 self-start rounded-xl" />
      </div>
      <Skeleton className="h-24" />
      <span className="sr-only">טוען את השיחה…</span>
    </div>
  );
}
