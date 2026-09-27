// Who wrote each piece of a fleet_requests row. The row's `role` is only the
// agent the conversation belongs to — it is NOT the author of every field:
//
// - body: written by the agent, unless the owner opened the request from
//   /admin/fleet (fleet_owner_request stamps payload.origin = 'owner').
// - answer: the owner's verdict text, but agents append to it too —
//   `complete` appends "[הושלם] <summary>" after the verdict (the verdict stays
//   a verbatim prefix, DB-enforced), and `withdraw` replaces it with
//   "[withdraw] <reason>" on a still-pending row.

export type ContentAuthor = 'agent' | 'owner';

const COMPLETE_MARKER = '[הושלם]';
const WITHDRAW_MARKER = '[withdraw]';

// PostgREST `.or()` filter for "the agent filed this row" — the DB-side twin
// of requestBodyAuthor(...) === 'agent'. Agent rows carry NO payload.origin,
// so `payload->>origin` is NULL for them: a bare `neq.owner` would drop every
// one of them (NULL <> 'owner' is NULL, not true). Used by every "waiting for
// the owner" count so the nav badge, the conversation list and the priority
// sort agree on one predicate.
export const AGENT_ORIGIN_OR_FILTER = 'payload->>origin.is.null,payload->>origin.neq.owner';

export function requestBodyAuthor(payload: unknown): ContentAuthor {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    if ((payload as { origin?: unknown }).origin === 'owner') return 'owner';
  }
  return 'agent';
}

export type AnswerPart = { author: ContentAuthor; kind: 'verdict' | 'completion' | 'withdraw'; text: string };

// The `complete` verb writes "<verdict>\n\n[הושלם] <summary>" or, with no
// prior verdict, "[הושלם] <summary>" (lib/fleet/complete.ts). Only those two
// placements are a stamp: "[הושלם]" anywhere else is the owner's own words.
const COMPLETE_SEPARATOR = `\n\n${COMPLETE_MARKER} `;

// Splits `answer` by who wrote each part. Authorship comes from the stamp and
// its POSITION (plus the row status for withdraw), never from the column
// name: agents write into `answer` too.
//
// `status`, when given, gates the withdraw reading: `withdraw` moves a
// pending row to `expired`, so "[withdraw]" on any other status is not the
// agent's withdrawal. Omitted = legacy callers, no gate.
export function splitRequestAnswer(answer: string | null | undefined, status?: string): AnswerPart[] {
  const raw = (answer ?? '').trim();
  if (!raw) return [];
  if (raw.startsWith(WITHDRAW_MARKER) && (status === undefined || status === 'expired')) {
    return [{ author: 'agent', kind: 'withdraw', text: raw.slice(WITHDRAW_MARKER.length).trim() }];
  }
  if (raw.startsWith(COMPLETE_MARKER)) {
    const summary = raw.slice(COMPLETE_MARKER.length).trim();
    return summary ? [{ author: 'agent', kind: 'completion', text: summary }] : [];
  }
  // lastIndexOf: the verdict is a verbatim prefix and the completion is
  // appended once at the end, so the last separator is the agent's.
  const at = raw.lastIndexOf(COMPLETE_SEPARATOR);
  if (at === -1) return [{ author: 'owner', kind: 'verdict', text: raw }];
  const parts: AnswerPart[] = [];
  const verdict = raw.slice(0, at).trim();
  const summary = raw.slice(at + COMPLETE_SEPARATOR.length).trim();
  if (verdict) parts.push({ author: 'owner', kind: 'verdict', text: verdict });
  if (summary) parts.push({ author: 'agent', kind: 'completion', text: summary });
  return parts;
}
