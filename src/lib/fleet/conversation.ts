// Pure model of /admin/fleet as a messaging app: one conversation per fleet
// role, built from fleet_requests (+ fleet_goals) rows with NO schema change
// (plans/fleet-messaging-redesign-2026-09-27.md §2, D3).
//
// No 'use client' / 'server-only': the data layer (server), the page (server)
// and the tests all import this. Nothing here touches the network or Date.now()
// — "now" is always a parameter.
//
// A row is up to five events, each placed at ITS OWN time — not the row's.
// A completion written today for a request filed last week must render after
// this week's messages, so the stream is sorted by event time, never by row.

import { formatIsraelDate, formatIsraelTime, ISRAEL_TIME_ZONE } from '@/lib/date';

import { requestBodyAuthor, splitRequestAnswer, type ContentAuthor } from './content-author';

export type ConversationRequestRow = {
  id: string;
  role: string;
  kind: string;
  tier: number;
  title: string;
  body: string;
  payload: unknown;
  status: string;
  answer: string | null;
  created_at: string;
  answered_at: string | null;
  expires_at: string;
  consumed_at: string | null;
};

export type ConversationGoalRow = {
  id: string;
  role: string;
  title: string;
  status: string;
  created_at: string;
  closed_at: string | null;
  last_error: string | null;
};

/** A row filed in ANOTHER role's conversation by `handoff` from one of ours. */
export type HandoffOut = { fromId: string; toRole: string; toId: string; at: string };

export type VerdictValue = 'approved' | 'denied' | 'answered';

export type MessageEvent = {
  type: 'message';
  key: string;
  at: string;
  author: ContentAuthor;
  row: ConversationRequestRow;
  /** Title of this message's thread root, when it is a reply in a thread. */
  replyToTitle: string | null;
};

export type VerdictEvent = {
  type: 'verdict';
  key: string;
  at: string;
  row: ConversationRequestRow;
  /** null once the row moved on (consumed/completed): the DB keeps no record
   * of WHICH verdict it was after that, so the UI must not guess. */
  verdict: VerdictValue | null;
  text: string;
  consumed: boolean;
};

export type CompletionEvent = {
  type: 'completion';
  key: string;
  at: string;
  row: ConversationRequestRow;
  text: string;
};

export type SystemKind =
  | 'withdraw'
  | 'self-answer'
  | 'handoff-in'
  | 'handoff-out'
  | 'goal-opened'
  | 'goal-closed';

export type SystemEvent = {
  type: 'system';
  key: string;
  at: string;
  kind: SystemKind;
  tone: 'neutral' | 'success' | 'destructive';
  text: string;
  link?: { role: string; focus?: string; label: string };
  /** Longer text shown on demand (a goal's closing summary). */
  detail?: string | null;
  /** The request row this line belongs to, when there is one. */
  rowId?: string;
};

export type ConversationEvent = MessageEvent | VerdictEvent | CompletionEvent | SystemEvent;
export type BubbleEvent = MessageEvent | VerdictEvent | CompletionEvent;

// Tie-break for events at the same instant: provenance before the message,
// the message before anything that answers it.
const RANK: Record<string, number> = {
  'handoff-in': 0,
  message: 1,
  withdraw: 2,
  'self-answer': 3,
  verdict: 3,
  completion: 4,
  'handoff-out': 5,
  'goal-opened': 6,
  'goal-closed': 6,
};

function rankOf(e: ConversationEvent): number {
  return e.type === 'system' ? RANK[e.kind] : RANK[e.type];
}

function payloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function threadRootOf(row: Pick<ConversationRequestRow, 'payload'>): string | null {
  return payloadString(row.payload, 'thread_root');
}

export function preparedCommandOf(row: Pick<ConversationRequestRow, 'payload'>): string | null {
  return payloadString(row.payload, 'prepared_command');
}

const VERDICTS: readonly string[] = ['approved', 'denied', 'answered'];

/** The owner still has to act on this row: an agent's request, still open. */
export function isWaitingOnOwner(row: Pick<ConversationRequestRow, 'status' | 'payload'>): boolean {
  return row.status === 'pending' && requestBodyAuthor(row.payload) === 'agent';
}

/** The ball is in the agent's court: the owner's own open message, or an
 * owner verdict the agent has not picked up yet. */
export function isWaitingOnAgent(row: Pick<ConversationRequestRow, 'status' | 'payload'>): boolean {
  const author = requestBodyAuthor(row.payload);
  if (row.status === 'pending') return author === 'owner';
  return VERDICTS.includes(row.status) && author === 'agent';
}

export type RowContext = {
  rootTitles?: ReadonlyMap<string, string>;
  handoffsOut?: readonly HandoffOut[];
};

export function rowToEvents(row: ConversationRequestRow, ctx: RowContext = {}): ConversationEvent[] {
  const events: ConversationEvent[] = [];
  const author = requestBodyAuthor(row.payload);

  const fromId = payloadString(row.payload, 'handoff_from');
  const fromRole = payloadString(row.payload, 'handoff_from_role');
  if (fromId && fromRole) {
    events.push({
      type: 'system',
      key: `${row.id}:handoff-in`,
      at: row.created_at,
      kind: 'handoff-in',
      tone: 'neutral',
      text: `הועבר מ-${fromRole}`,
      link: { role: fromRole, focus: fromId, label: 'למקור' },
      rowId: row.id,
    });
  }

  const root = threadRootOf(row);
  events.push({
    type: 'message',
    key: `${row.id}:message`,
    at: row.created_at,
    author,
    row,
    replyToTitle: root && root !== row.id ? (ctx.rootTitles?.get(root) ?? null) : null,
  });

  const parts = splitRequestAnswer(row.answer, row.status);
  const verdictPart = parts.find((p) => p.kind === 'verdict');
  const completionPart = parts.find((p) => p.kind === 'completion');
  const withdrawPart = parts.find((p) => p.kind === 'withdraw');

  if (withdrawPart) {
    events.push({
      type: 'system',
      key: `${row.id}:withdraw`,
      at: row.created_at,
      kind: 'withdraw',
      tone: 'neutral',
      text: withdrawPart.text ? `הסוכן משך את הפנייה: ${withdrawPart.text}` : 'הסוכן משך את הפנייה',
      rowId: row.id,
    });
  }

  if (row.answered_at) {
    if (author === 'owner') {
      // Legacy B1 rows (2 live): the owner "answered" their own message. The
      // agent never got it as a task — say so instead of drawing a reply.
      events.push({
        type: 'system',
        key: `${row.id}:self-answer`,
        at: row.answered_at,
        kind: 'self-answer',
        tone: 'neutral',
        text: 'ענית לפנייה של עצמך — הסוכן לא קיבל אותה כמשימה',
        rowId: row.id,
      });
    } else {
      events.push({
        type: 'verdict',
        key: `${row.id}:verdict`,
        at: row.answered_at,
        row,
        verdict: VERDICTS.includes(row.status) ? (row.status as VerdictValue) : null,
        text: verdictPart?.text ?? '',
        consumed: row.consumed_at !== null,
      });
    }
  }

  if (completionPart) {
    events.push({
      type: 'completion',
      key: `${row.id}:completion`,
      // consumed_at doubles as the completion time on status=completed (DB CHECK).
      at: row.consumed_at ?? row.answered_at ?? row.created_at,
      row,
      text: completionPart.text,
    });
  }

  for (const h of ctx.handoffsOut ?? []) {
    if (h.fromId !== row.id) continue;
    events.push({
      type: 'system',
      key: `${row.id}:handoff-out:${h.toId}`,
      at: h.at,
      kind: 'handoff-out',
      tone: 'neutral',
      text: `הועבר ל-${h.toRole}`,
      link: { role: h.toRole, focus: h.toId, label: 'להמשך' },
      rowId: row.id,
    });
  }

  return events;
}

export function goalToEvents(goal: ConversationGoalRow): SystemEvent[] {
  const events: SystemEvent[] = [
    {
      type: 'system',
      key: `goal:${goal.id}:opened`,
      at: goal.created_at,
      kind: 'goal-opened',
      tone: 'neutral',
      text: `נפתחה מטרה: ${goal.title}`,
    },
  ];
  if (goal.closed_at && (goal.status === 'completed' || goal.status === 'failed')) {
    events.push({
      type: 'system',
      key: `goal:${goal.id}:closed`,
      at: goal.closed_at,
      kind: 'goal-closed',
      tone: goal.status === 'completed' ? 'success' : 'destructive',
      text: goal.status === 'completed' ? `המטרה הושלמה: ${goal.title}` : `המטרה נכשלה: ${goal.title}`,
      // last_error carries the closing note for BOTH outcomes (fleet_goal_close).
      detail: goal.last_error,
    });
  }
  return events;
}

export function compareEvents(a: ConversationEvent, b: ConversationEvent): number {
  const ta = Date.parse(a.at);
  const tb = Date.parse(b.at);
  if (ta !== tb) return ta - tb;
  const r = rankOf(a) - rankOf(b);
  if (r !== 0) return r;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export function buildConversationEvents(
  rows: readonly ConversationRequestRow[],
  goals: readonly ConversationGoalRow[] = [],
  ctx: RowContext & {
    /** Oldest instant the loaded window covers; goal events before it belong
     * to history that is not on screen. null = the window reaches the start. */
    windowStart?: string | null;
  } = {},
): ConversationEvent[] {
  const events = rows.flatMap((row) => rowToEvents(row, ctx));
  const startMs = ctx.windowStart ? Date.parse(ctx.windowStart) : null;
  for (const goal of goals) {
    for (const e of goalToEvents(goal)) {
      if (startMs === null || Date.parse(e.at) >= startMs) events.push(e);
    }
  }
  return events.sort(compareEvents);
}

// ── Stream layout: day separators, bubble groups, collapsed expiry runs ─────

export function bubbleAuthor(e: BubbleEvent): ContentAuthor {
  if (e.type === 'verdict') return 'owner';
  if (e.type === 'completion') return 'agent';
  return e.author;
}

/** An agent or owner message that ran out its 72h with no answer. A withdrawn
 * row is `expired` too, but the agent retracted it — that is not "no answer". */
export function isExpiredUnanswered(row: ConversationRequestRow): boolean {
  return row.status === 'expired' && splitRequestAnswer(row.answer, row.status).length === 0;
}

export type StreamItem =
  | { type: 'day'; key: string; label: string }
  | { type: 'group'; key: string; author: ContentAuthor; events: BubbleEvent[] }
  | { type: 'system'; key: string; event: SystemEvent }
  | { type: 'expired-run'; key: string; events: MessageEvent[] };

const GROUP_WINDOW_MS = 5 * 60_000;
export const EXPIRED_RUN_MIN = 3;

const dayKeyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: ISRAEL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY-MM-DD of an instant, in Israel. */
export function israelDayKey(iso: string | number): string {
  return dayKeyFormat.format(typeof iso === 'number' ? iso : Date.parse(iso));
}

export function shortStamp(iso: string, nowMs: number): string {
  const key = israelDayKey(iso);
  if (key === israelDayKey(nowMs)) return formatIsraelTime(iso);
  if (key === israelDayKey(nowMs - 86_400_000)) return 'אתמול';
  return formatIsraelDate(iso);
}

export function dayLabel(iso: string, nowMs: number): string {
  const key = israelDayKey(iso);
  if (key === israelDayKey(nowMs)) return 'היום';
  if (key === israelDayKey(nowMs - 86_400_000)) return 'אתמול';
  return formatIsraelDate(iso);
}

function isExpiredMessage(e: ConversationEvent): e is MessageEvent {
  return e.type === 'message' && isExpiredUnanswered(e.row);
}

export function layoutStream(events: readonly ConversationEvent[], nowMs: number): StreamItem[] {
  const items: StreamItem[] = [];
  let currentDay: string | null = null;
  let group: Extract<StreamItem, { type: 'group' }> | null = null;

  let i = 0;
  while (i < events.length) {
    const e = events[i];
    const day = israelDayKey(e.at);
    if (day !== currentDay) {
      currentDay = day;
      group = null;
      items.push({ type: 'day', key: `day:${day}`, label: dayLabel(e.at, nowMs) });
    }

    // A run of >= EXPIRED_RUN_MIN consecutive unanswered-expired messages on
    // the same day folds into one line (96 of 226 live rows are expired —
    // the common case, not an edge case).
    if (isExpiredMessage(e)) {
      let j = i;
      while (j < events.length && isExpiredMessage(events[j]) && israelDayKey(events[j].at) === day) j++;
      if (j - i >= EXPIRED_RUN_MIN) {
        const run = events.slice(i, j) as MessageEvent[];
        items.push({ type: 'expired-run', key: `expired:${run[0].key}`, events: run });
        group = null;
        i = j;
        continue;
      }
    }

    if (e.type === 'system') {
      items.push({ type: 'system', key: e.key, event: e });
      group = null;
      i++;
      continue;
    }

    const author = bubbleAuthor(e);
    const last = group?.events[group.events.length - 1];
    if (group && last && group.author === author && Date.parse(e.at) - Date.parse(last.at) <= GROUP_WINDOW_MS) {
      group.events.push(e);
    } else {
      group = { type: 'group', key: `group:${e.key}`, author, events: [e] };
      items.push(group);
    }
    i++;
  }
  return items;
}

// ── Conversation list (one row per role) ────────────────────────────────────

export type ConversationSummary = {
  role: string;
  /** From fleet.json; null when the role is not (or no longer) configured. */
  enabled: boolean | null;
  lastAt: string | null;
  /** Compact Israel-time stamp for the list: "17:30" today, "אתמול", or a date. */
  lastLabel: string | null;
  preview: string | null;
  previewFromOwner: boolean;
  waitingForYou: number;
  waitingForAgent: boolean;
  activeGoal: boolean;
};

/** Agents file near-identical titles ("🔴 פרסום בפועל: אינסטגרם — …"); the
 * part after the last " — " is what tells them apart. */
export function distinctiveTitle(title: string): string {
  const at = title.lastIndexOf(' — ');
  const tail = at === -1 ? '' : title.slice(at + 3).trim();
  return tail || title;
}

const VERDICT_PREVIEW: Record<VerdictValue, string> = {
  approved: 'אישרת',
  denied: 'דחית',
  answered: 'השבת',
};

export function previewOf(e: ConversationEvent): { text: string; fromOwner: boolean } {
  switch (e.type) {
    case 'message':
      return e.author === 'owner'
        ? { text: e.row.title, fromOwner: true }
        : { text: distinctiveTitle(e.row.title), fromOwner: false };
    case 'verdict':
      return { text: e.text || (e.verdict ? VERDICT_PREVIEW[e.verdict] : 'השבת'), fromOwner: true };
    case 'completion':
      return { text: `בוצע · ${e.text}`, fromOwner: false };
    default:
      return { text: e.text, fromOwner: false };
  }
}

export type RoleConfig = { name: string; enabled: boolean };

export function summarizeConversations(input: {
  /** Recent rows (bounded window), any role. */
  rows: readonly ConversationRequestRow[];
  /** Every pending row, fetched separately so none can fall out of the window. */
  pending: readonly Pick<ConversationRequestRow, 'id' | 'role' | 'status' | 'payload'>[];
  goals: readonly Pick<ConversationGoalRow, 'role' | 'status'>[];
  roles: readonly RoleConfig[] | null;
  nowMs: number;
}): ConversationSummary[] {
  const byRole = new Map<string, ConversationSummary>();
  const ensure = (role: string): ConversationSummary => {
    let s = byRole.get(role);
    if (!s) {
      s = {
        role,
        enabled: null,
        lastAt: null,
        lastLabel: null,
        preview: null,
        previewFromOwner: false,
        waitingForYou: 0,
        waitingForAgent: false,
        activeGoal: false,
      };
      byRole.set(role, s);
    }
    return s;
  };

  for (const r of input.roles ?? []) ensure(r.name).enabled = r.enabled;

  for (const row of input.rows) {
    const s = ensure(row.role);
    for (const e of rowToEvents(row)) {
      if (!s.lastAt || compareInstant(e.at, s.lastAt) >= 0) {
        const p = previewOf(e);
        s.lastAt = e.at;
        s.preview = p.text;
        s.previewFromOwner = p.fromOwner;
      }
    }
  }

  for (const row of input.pending) {
    const s = ensure(row.role);
    if (isWaitingOnOwner(row)) s.waitingForYou++;
    else if (isWaitingOnAgent(row)) s.waitingForAgent = true;
  }
  // Owner verdicts the agent has not consumed yet live outside `pending`.
  for (const row of input.rows) {
    if (row.status !== 'pending' && isWaitingOnAgent(row)) ensure(row.role).waitingForAgent = true;
  }
  for (const g of input.goals) {
    if (g.status === 'active' || g.status === 'paused') {
      const s = ensure(g.role);
      s.activeGoal = true;
      if (g.status === 'active') s.waitingForAgent = true;
    }
  }

  for (const summary of byRole.values()) {
    if (summary.lastAt) summary.lastLabel = shortStamp(summary.lastAt, input.nowMs);
  }

  return [...byRole.values()].sort((a, b) => {
    if ((a.waitingForYou > 0) !== (b.waitingForYou > 0)) return a.waitingForYou > 0 ? -1 : 1;
    if (a.lastAt && b.lastAt) return compareInstant(b.lastAt, a.lastAt);
    if (a.lastAt) return -1;
    if (b.lastAt) return 1;
    return a.role.localeCompare(b.role);
  });
}

function compareInstant(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b);
}

// ── Composer: subject + continuation titles ─────────────────────────────────

export const TITLE_MAX = 200;
export const TITLE_MIN = 3;
const CONTINUE_PREFIX = 'המשך: ';

/** First non-empty line of the draft, capped — the visible, editable subject. */
export function deriveSubject(body: string): string {
  const line = body.split('\n').find((l) => l.trim()) ?? '';
  return line.trim().slice(0, TITLE_MAX);
}

/** Server-side title for a new owner message: the given subject, or the first
 * line, or — when both are shorter than TITLE_MIN — a generic
 * "הודעה ל-<role>". */
export function resolveOwnerTitle(subject: string, body: string, role: string): string {
  const candidates = [subject.trim().slice(0, TITLE_MAX), deriveSubject(body)];
  return candidates.find((c) => c.length >= TITLE_MIN) ?? `הודעה ל-${role}`.slice(0, TITLE_MAX);
}

/** "המשך: <root title>", never "המשך: המשך: …", capped after the prefix. */
export function continuationTitle(rootTitle: string): string {
  const t = rootTitle.trim();
  return (t.startsWith(CONTINUE_PREFIX) ? t : `${CONTINUE_PREFIX}${t}`).slice(0, TITLE_MAX);
}
