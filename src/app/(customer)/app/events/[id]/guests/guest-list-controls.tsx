'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Constants } from '@/lib/supabase/types';
import { GUEST_STATUS_LABELS, CONTACT_STATUS_LABELS } from './labels';
import type { GuestGroup } from '@/lib/data/guests';

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm sm:w-auto';

interface Current {
  search: string;
  sort?: string;
  dir?: string;
  status?: string;
  contact?: string;
  group?: string;
  over?: string;
}

// URL-driven filters: changing a control pushes a new querystring, so the
// server page re-runs the scoped query. Search resets to page 1 on submit.
export function GuestListControls({
  eventId,
  groups,
  current,
  hasActiveFilters,
}: {
  eventId: string;
  groups: GuestGroup[];
  current: Current;
  hasActiveFilters: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const basePath = `/app/events/${eventId}/guests`;
  const [search, setSearch] = useState(current.search);
  // The component stays mounted across navigations (same route, new query
  // string), so browser back/forward changes `current.search` without a
  // remount. Adjust the state directly during render (React's documented
  // pattern for syncing state to a prop change — not an Effect, which would
  // render one frame of stale input first) rather than via useEffect.
  const [prevUrlSearch, setPrevUrlSearch] = useState(current.search);
  if (current.search !== prevUrlSearch) {
    setPrevUrlSearch(current.search);
    setSearch(current.search);
  }

  function navigate(next: Partial<Current> & { search?: string }) {
    const merged: Current = { ...current, ...next };
    const q = new URLSearchParams();
    if (merged.search) q.set('search', merged.search);
    if (merged.sort) q.set('sort', merged.sort);
    if (merged.dir) q.set('dir', merged.dir);
    if (merged.status) q.set('status', merged.status);
    if (merged.contact) q.set('contact', merged.contact);
    if (merged.group) q.set('group', merged.group);
    if (merged.over) q.set('over', merged.over);
    // Any control change returns to the first page.
    router.push(`${basePath}?${q.toString()}`);
  }

  // Reload (F5 / browser refresh) drops any active filters, so a refreshed
  // page reads as "start over" rather than replaying a stale search. A plain
  // client-side navigation (typed URL, shared link, back/forward) must NOT be
  // affected — Navigation Timing is the only reliable way to tell "reload"
  // apart from those. The ref guard makes this a true run-once regardless of
  // how often the effect's deps change afterward (hasActiveFilters flips back
  // to true the moment the visitor applies a new filter, and the navigation
  // entry's `type` stays "reload" for the rest of the tab's lifetime, so
  // re-running the check on every dep change would wrongly clear it again).
  // Caveat: the server still renders the filtered result for one frame before
  // this client-side replace fires.
  const didHandleReloadReset = useRef(false);
  useEffect(() => {
    if (didHandleReloadReset.current) return;
    didHandleReloadReset.current = true;

    const [entry] = performance.getEntriesByType('navigation');
    const isReload =
      entry instanceof PerformanceNavigationTiming && entry.type === 'reload';
    if (isReload && hasActiveFilters) {
      router.replace(pathname);
    }
  }, [hasActiveFilters, pathname, router]);

  return (
    <form
      className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        navigate({ search });
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="search" className="text-xs text-muted-foreground">
          חיפוש (שם או טלפון)
        </label>
        <input
          id="search"
          name="search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputClass}
          placeholder="חיפוש…"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="status" className="text-xs text-muted-foreground">
          סטטוס
        </label>
        <select
          id="status"
          className={inputClass}
          value={current.status ?? ''}
          onChange={(e) => {
            const status = e.target.value || undefined;
            // "חריגת כמות" only ever matches attending rows; switching to a
            // different status while it's active would silently zero the
            // list, so clear it instead of leaving a confusing empty result.
            const over = status && status !== 'attending' ? undefined : current.over;
            navigate({ status, over });
          }}
        >
          <option value="">הכל</option>
          {Constants.public.Enums.guest_status.map((s) => (
            <option key={s} value={s}>
              {GUEST_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="contact" className="text-xs text-muted-foreground">
          יצירת קשר
        </label>
        <select
          id="contact"
          className={inputClass}
          value={current.contact ?? ''}
          onChange={(e) => navigate({ contact: e.target.value })}
        >
          <option value="">הכל</option>
          {Constants.public.Enums.contact_status.map((s) => (
            <option key={s} value={s}>
              {CONTACT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {groups.length > 0 ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="group" className="text-xs text-muted-foreground">
            קבוצה
          </label>
          <select
            id="group"
            className={inputClass}
            value={current.group ?? ''}
            onChange={(e) => navigate({ group: e.target.value })}
          >
            <option value="">הכל</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="over" className="text-xs text-muted-foreground">
          חריגת כמות
        </label>
        <select
          id="over"
          className={inputClass}
          value={current.over ?? ''}
          onChange={(e) => {
            const over = e.target.value || undefined;
            // Same conflict from the other direction: turning the overage
            // filter on while a non-attending status is active would zero
            // the list, so clear the conflicting status.
            const status =
              over && current.status && current.status !== 'attending'
                ? undefined
                : current.status;
            navigate({ over, status });
          }}
        >
          <option value="">הכל</option>
          <option value="1">מעל הכמות שהוזמנה</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="sort" className="text-xs text-muted-foreground">
          מיון
        </label>
        <select
          id="sort"
          className={inputClass}
          value={current.sort ?? 'created'}
          onChange={(e) => navigate({ sort: e.target.value })}
        >
          <option value="created">תאריך הוספה</option>
          <option value="name">שם</option>
          <option value="status">סטטוס</option>
          <option value="contact">יצירת קשר</option>
        </select>
      </div>

      <button
        type="submit"
        className="w-full rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent sm:w-auto"
      >
        חיפוש
      </button>

      {hasActiveFilters ? (
        <Link
          href={basePath}
          className="w-full rounded-md border border-border px-4 py-2 text-center text-sm font-medium text-muted-foreground hover:bg-accent sm:w-auto"
        >
          איפוס מסננים
        </Link>
      ) : null}
    </form>
  );
}
