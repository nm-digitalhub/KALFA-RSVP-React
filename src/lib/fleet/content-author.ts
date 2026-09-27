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

export function requestBodyAuthor(payload: unknown): ContentAuthor {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    if ((payload as { origin?: unknown }).origin === 'owner') return 'owner';
  }
  return 'agent';
}

export type AnswerPart = { author: ContentAuthor; kind: 'verdict' | 'completion' | 'withdraw'; text: string };

export function splitRequestAnswer(answer: string | null | undefined): AnswerPart[] {
  const raw = (answer ?? '').trim();
  if (!raw) return [];
  if (raw.startsWith(WITHDRAW_MARKER)) {
    return [{ author: 'agent', kind: 'withdraw', text: raw.slice(WITHDRAW_MARKER.length).trim() }];
  }
  const at = raw.indexOf(COMPLETE_MARKER);
  if (at === -1) return [{ author: 'owner', kind: 'verdict', text: raw }];
  const parts: AnswerPart[] = [];
  const verdict = raw.slice(0, at).trim();
  const summary = raw.slice(at + COMPLETE_MARKER.length).trim();
  if (verdict) parts.push({ author: 'owner', kind: 'verdict', text: verdict });
  if (summary) parts.push({ author: 'agent', kind: 'completion', text: summary });
  return parts;
}
