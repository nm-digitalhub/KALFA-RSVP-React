'use client';

import { useRef } from 'react';

import type { FleetRoleInfo } from '@/lib/fleet/handoff';

const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: 'question', label: 'שאלה' },
  { value: 'approval', label: 'בקשת אישור' },
  { value: 'fyi', label: 'עדכון' },
];

const selectClass =
  'rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// Filter bar for the unified /admin/fleet feed — same job as ContactSearchBar,
// but native <select>s auto-submitting on change instead of a ButtonGroup +
// portaled DropdownMenu: there is no free-text field to search here (fleet
// activity has no name/email/phone equivalent), just two closed-vocabulary
// filters, so the simpler native-select pattern (no portal, no
// DirectionProvider dependency, no RTL pitfalls — same choice as
// ComposeActivityCard's role picker) is enough.
export function FleetSearchBar({
  basePath,
  roles,
  role,
  kind,
}: {
  basePath: string;
  roles: FleetRoleInfo[];
  role?: string;
  kind?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} method="get" action={basePath} className="flex flex-wrap gap-2">
      <label className="sr-only" htmlFor="fleet-filter-role">
        סינון לפי סוכן
      </label>
      <select
        id="fleet-filter-role"
        name="role"
        defaultValue={role ?? ''}
        onChange={() => formRef.current?.requestSubmit()}
        className={selectClass}
      >
        <option value="">כל הסוכנים</option>
        {roles.map((r) => (
          <option key={r.name} value={r.name}>
            {r.name}
            {r.enabled ? '' : ' (כבוי)'}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="fleet-filter-kind">
        סינון לפי סוג
      </label>
      <select
        id="fleet-filter-kind"
        name="kind"
        defaultValue={kind ?? ''}
        onChange={() => formRef.current?.requestSubmit()}
        className={selectClass}
      >
        <option value="">כל הסוגים</option>
        {KIND_OPTIONS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
    </form>
  );
}
