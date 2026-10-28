import { createHash } from 'node:crypto';

import { israelCalendarDay } from '@/lib/data/event-date';

// Deterministic idempotency key for fleet_requests inserts. A role retrying
// the same logical ask (same kind + title + body) after a crashed run derives
// the same key and hits the unique index instead of duplicating the request.
// The date component scopes dedup to a calendar day, so a monitor that
// legitimately re-raises the same question a week later is not silenced by a
// long-dead row.
//
// The day is the ISRAEL calendar day, the same day public.fleet_owner_request
// puts in its owner-filed keys (`to_char(timezone('Asia/Jerusalem', now()), …)`).
// It used to be the UTC day, so this side's day turned over at 02:00/03:00
// Israel time while the DB's turned over at midnight. (The digests still
// differ — sha256 here, md5 there — but owner keys carry an `owner:` prefix, so
// the two never meet in the unique index.)
export function deriveRequestKey(input: {
  role: string;
  kind: string;
  title: string;
  body: string;
  date?: Date;
}): string {
  const day = israelCalendarDay((input.date ?? new Date()).getTime());
  const digest = createHash('sha256')
    .update(`${input.kind}\n${input.title}\n${input.body}`)
    .digest('hex')
    .slice(0, 16);
  return `${input.role}:${day}:${digest}`;
}
