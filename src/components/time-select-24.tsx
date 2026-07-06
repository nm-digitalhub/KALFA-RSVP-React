'use client';

import { useState } from 'react';
import { compactSelectClass } from '@/components/forms';

// A native <input type="time"> renders per the BROWSER/OS hour-cycle
// preference — an English-UI Chrome shows "05:30 PM" — and no page attribute
// can force 24h display. This control guarantees the Israeli 24-hour standard
// in every browser: hour (00–23) and minutes (5-minute steps) selects that
// compose the same `HH:mm` string into a hidden input under the caller's
// field name, so the server contract (Zod event_time) is unchanged.

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, '0'),
);



export function TimeSelect24({
  id,
  name,
  defaultValue = '',
  disabled,
}: {
  id: string;
  // undefined (edit form after publish) keeps the field out of the POST,
  // exactly like the old input's conditional `name`.
  name?: string;
  // 'HH:mm' or '' (no time set).
  defaultValue?: string;
  disabled?: boolean;
}) {
  const [initialHour, initialMinute] = /^\d{2}:\d{2}$/.test(defaultValue)
    ? defaultValue.split(':')
    : ['', ''];
  const [hour, setHour] = useState(initialHour);
  const [minute, setMinute] = useState(initialMinute);

  // A stored minute off the 5-minute grid (e.g. 17:33) must stay selectable —
  // string sort is correct here because all values are 2-digit.
  const minuteOptions =
    minute !== '' && !MINUTES.includes(minute)
      ? [...MINUTES, minute].sort()
      : MINUTES;

  return (
    // LTR pair so it always reads "17 : 30" inside the RTL form.
    <div dir="ltr" className="flex w-fit items-center gap-1">
      <select
        id={id}
        aria-label="שעה"
        value={hour}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          setHour(next);
          // Picking an hour implies ":00" until minutes are chosen — never a
          // half-filled pair that would silently submit "no time at all".
          if (next !== '' && minute === '') setMinute('00');
          if (next === '') setMinute('');
        }}
        className={compactSelectClass}
      >
        <option value="">--</option>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span aria-hidden>:</span>
      <select
        aria-label="דקות"
        value={minute}
        disabled={disabled || hour === ''}
        onChange={(e) => setMinute(e.target.value)}
        className={compactSelectClass}
      >
        <option value="">--</option>
        {minuteOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {name ? (
        <input
          type="hidden"
          name={name}
          value={hour !== '' && minute !== '' ? `${hour}:${minute}` : ''}
        />
      ) : null}
    </div>
  );
}
