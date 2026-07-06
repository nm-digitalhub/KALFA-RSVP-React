'use client';

import { useState } from 'react';

import { todayIL } from '@/lib/data/event-date';
import { compactSelectClass } from '@/components/forms';

// A native <input type="date"> renders per the BROWSER/OS locale — an
// English-UI Chrome shows mm/dd/yyyy ("07/12/2026" for July 12th), which an
// Israeli user reads as a reversed date — and no page attribute can force the
// dd/mm order. This control guarantees the Israeli day/month/year standard in
// every browser: three selects composing the same ISO 'YYYY-MM-DD' into a
// hidden input under the caller's field name, so server contracts (Zod
// schemas, GET filter params) are unchanged. Range/coupling rules (future
// date, deadline before event) stay where they are authoritative: the server
// and the DB triggers, which return per-field Hebrew errors.



function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function daysInMonth(year: number, month: number): number {
  // month is 1-12; day 0 of the NEXT month is this month's last day.
  return new Date(year, month, 0).getDate();
}

const MONTHS = Array.from({ length: 12 }, (_, i) => pad2(i + 1));

export function DateSelectIL({
  id,
  name,
  defaultValue = '',
  disabled,
  required,
  fromYear,
  toYear,
}: {
  id: string;
  // undefined (edit form after publish) keeps the field out of the POST,
  // exactly like the old input's conditional `name`.
  name?: string;
  // ISO 'YYYY-MM-DD' or '' (not set).
  defaultValue?: string;
  disabled?: boolean;
  // Client-side must-pick guard (a native select with required blocks submit
  // while its value is ''). Mirrors the old `<input type="date" required>` —
  // the create form promises a date (asterisk) even though the SCHEMA keeps a
  // date-less draft legal by design (R2).
  required?: boolean;
  fromYear?: number;
  toYear?: number;
}) {
  const [initialY, initialM, initialD] = /^\d{4}-\d{2}-\d{2}$/.test(defaultValue)
    ? defaultValue.split('-')
    : ['', '', ''];
  const [year, setYear] = useState(initialY);
  const [month, setMonth] = useState(initialM);
  const [day, setDay] = useState(initialD);
  // Israel "today", fixed at mount (lazy initializer — Date.now() is impure
  // during render): the anchor for the year range and for part auto-fill.
  const [todayParts] = useState(() => todayIL().split('-'));

  const currentYear = Number(todayParts[0]);
  const years: string[] = [];
  for (let y = fromYear ?? currentYear - 2; y <= (toYear ?? currentYear + 3); y++) {
    years.push(String(y));
  }
  // A stored year outside the range (legacy data) must stay selectable.
  if (year !== '' && !years.includes(year)) years.unshift(year);

  // Day list follows the selected month/year (Feb → 28/29). Unknown month →
  // the full 31 so the user can pick parts in any order.
  const maxDay =
    year !== '' && month !== ''
      ? daysInMonth(Number(year), Number(month))
      : 31;
  const days = Array.from({ length: maxDay }, (_, i) => pad2(i + 1));

  // One part changed: '' clears the whole date; a real value auto-fills the
  // missing parts from today (Israel) so a single pick is already a full,
  // submittable date. The day is clamped when the month/year shrink it.
  function update(part: 'day' | 'month' | 'year', value: string) {
    if (value === '') {
      setDay('');
      setMonth('');
      setYear('');
      return;
    }
    let d = part === 'day' ? value : day || todayParts[2];
    const m = part === 'month' ? value : month || todayParts[1];
    const y = part === 'year' ? value : year || todayParts[0];
    const cap = daysInMonth(Number(y), Number(m));
    if (Number(d) > cap) d = pad2(cap);
    setDay(d);
    setMonth(m);
    setYear(y);
  }

  const complete = day !== '' && month !== '' && year !== '';

  return (
    // LTR row so it always reads "12 / 07 / 2026" inside the RTL form.
    <div dir="ltr" className="flex w-fit items-center gap-1">
      <select
        id={id}
        aria-label="יום"
        value={day}
        disabled={disabled}
        required={required}
        onChange={(e) => update('day', e.target.value)}
        className={compactSelectClass}
      >
        <option value="">--</option>
        {days.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <span aria-hidden>/</span>
      <select
        aria-label="חודש"
        value={month}
        disabled={disabled}
        onChange={(e) => update('month', e.target.value)}
        className={compactSelectClass}
      >
        <option value="">--</option>
        {MONTHS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <span aria-hidden>/</span>
      <select
        aria-label="שנה"
        value={year}
        disabled={disabled}
        onChange={(e) => update('year', e.target.value)}
        className={compactSelectClass}
      >
        <option value="">--</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      {name ? (
        <input
          type="hidden"
          name={name}
          value={complete ? `${year}-${month}-${day}` : ''}
        />
      ) : null}
    </div>
  );
}
