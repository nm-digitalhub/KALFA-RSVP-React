import { createHash } from 'node:crypto';

// Deterministic idempotency key for fleet_requests inserts. A role retrying
// the same logical ask (same kind + title + body) after a crashed run derives
// the same key and hits the unique index instead of duplicating the request.
// The date component scopes dedup to a calendar day, so a monitor that
// legitimately re-raises the same question a week later is not silenced by a
// long-dead row.
export function deriveRequestKey(input: {
  role: string;
  kind: string;
  title: string;
  body: string;
  date?: Date;
}): string {
  const day = (input.date ?? new Date()).toISOString().slice(0, 10);
  const digest = createHash('sha256')
    .update(`${input.kind}\n${input.title}\n${input.body}`)
    .digest('hex')
    .slice(0, 16);
  return `${input.role}:${day}:${digest}`;
}
