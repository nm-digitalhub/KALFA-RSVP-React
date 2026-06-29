'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
}

// URL-driven filters: changing a control pushes a new querystring, so the
// server page re-runs the scoped query. Search resets to page 1 on submit.
export function GuestListControls({
  eventId,
  groups,
  current,
}: {
  eventId: string;
  groups: GuestGroup[];
  current: Current;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(current.search);

  function navigate(next: Partial<Current> & { search?: string }) {
    const merged: Current = { ...current, ...next };
    const q = new URLSearchParams();
    if (merged.search) q.set('search', merged.search);
    if (merged.sort) q.set('sort', merged.sort);
    if (merged.dir) q.set('dir', merged.dir);
    if (merged.status) q.set('status', merged.status);
    if (merged.contact) q.set('contact', merged.contact);
    if (merged.group) q.set('group', merged.group);
    // Any control change returns to the first page.
    router.push(`/app/events/${eventId}/guests?${q.toString()}`);
  }

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
          onChange={(e) => navigate({ status: e.target.value })}
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
    </form>
  );
}
