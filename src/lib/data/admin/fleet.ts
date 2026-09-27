import 'server-only';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cache } from 'react';
import { z } from 'zod';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { requestBodyAuthor } from '@/lib/fleet/content-author';
import {
  continuationTitle,
  summarizeConversations,
  threadRootOf,
  type ConversationRequestRow,
  type ConversationSummary,
  type HandoffOut,
} from '@/lib/fleet/conversation';
import { parseFleetRoleRegistry, type FleetRoleInfo } from '@/lib/fleet/handoff';
import type { Database, Tables } from '@/lib/supabase/types';

// Admin: the owner<->autonomous-fleet request ledger (public.fleet_requests).
// Fleet roles file approval/question/fyi requests via the service-role CLI;
// the owner reads and answers them here. Authorization: manage_settings (the
// fleet is platform configuration/operations surface, same axis as alerts),
// plus RLS (fleet_requests_admin_select) under the request-scoped cookie
// client as the second layer.
//
// Writes go EXCLUSIVELY through the fleet_answer_request RPC — authenticated
// has no UPDATE grant on the table, and the DB trigger enforces the state
// machine and field immutability regardless of what this module does.

// The role registry, read from the same fleet.json the scheduler reloads
// every tick. Read at request time (not persisted): fleet.json is owner-edited
// and a stale list would offer a role that no longer exists. cache() only
// dedupes the layout's and the page's read within ONE request.
//
// null = the file could not be read/parsed. The conversation list shows that
// as an error state, never as "no agents".
const loadFleetRoles = cache(async (): Promise<FleetRoleInfo[] | null> => {
  const path = join(process.cwd(), '.claude', 'fleet', 'fleet.json');
  try {
    return parseFleetRoleRegistry(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return null;
  }
});

export async function readFleetRoles(): Promise<FleetRoleInfo[] | null> {
  await requirePlatformPermission('manage_settings');
  return loadFleetRoles();
}

// ── Conversations (/admin/fleet as a messaging app) ─────────────────────────
// One conversation per role (plans/fleet-messaging-redesign-2026-09-27.md
// §2). The pure model lives in lib/fleet/conversation.ts; this section only
// fetches — bounded, a fixed number of queries per render, never per role.

const ROLE_RE = /^[a-z0-9][a-z0-9-]*$/;
const uuid = z.uuid();
const cursorSchema = z.iso.datetime({ offset: true });

// The list needs no body/attachments — only enough to find each role's last
// event and its preview. JSON paths instead of the whole payload keep the
// 300-row window lean.
const CONVERSATION_LIST_COLUMNS =
  'id, role, kind, tier, title, status, answer, created_at, answered_at, expires_at, consumed_at, origin:payload->>origin, thread_root:payload->>thread_root, handoff_from:payload->>handoff_from, handoff_from_role:payload->>handoff_from_role';

const CONVERSATION_ROW_COLUMNS =
  'id, role, kind, tier, title, body, payload, status, answer, created_at, answered_at, expires_at, consumed_at';

export const CONVERSATION_LIST_WINDOW = 300;
export const CONVERSATION_PAGE_SIZE = 50;

type LeanListRow = {
  id: string;
  role: string;
  kind: string;
  tier: number;
  title: string;
  status: string;
  answer: string | null;
  created_at: string;
  answered_at: string | null;
  expires_at: string;
  consumed_at: string | null;
  origin: string | null;
  thread_root: string | null;
  handoff_from: string | null;
  handoff_from_role: string | null;
};

function leanToRow(r: LeanListRow): ConversationRequestRow {
  const payload: Record<string, string> = {};
  if (r.origin) payload.origin = r.origin;
  if (r.thread_root) payload.thread_root = r.thread_root;
  if (r.handoff_from) payload.handoff_from = r.handoff_from;
  if (r.handoff_from_role) payload.handoff_from_role = r.handoff_from_role;
  return {
    id: r.id,
    role: r.role,
    kind: r.kind,
    tier: r.tier,
    title: r.title,
    body: '',
    payload,
    status: r.status,
    answer: r.answer,
    created_at: r.created_at,
    answered_at: r.answered_at,
    expires_at: r.expires_at,
    consumed_at: r.consumed_at,
  };
}

export type FleetConversationList = {
  conversations: ConversationSummary[];
  /** fleet.json could not be read — an error state, not an empty one. */
  rolesUnavailable: boolean;
};

// Three queries total, whatever the number of roles: the recent window
// (grouped in JS), every pending row (so a waiting item can never fall out of
// the window), and open goals.
export async function listFleetConversations(): Promise<FleetConversationList> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();

  const [roles, recentRes, pendingRes, goalsRes] = await Promise.all([
    loadFleetRoles(),
    supabase
      .from('fleet_requests')
      .select(CONVERSATION_LIST_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(CONVERSATION_LIST_WINDOW),
    supabase
      .from('fleet_requests')
      .select('id, role, status, origin:payload->>origin')
      .eq('status', 'pending'),
    supabase.from('fleet_goals').select('role, status').in('status', ['active', 'paused']),
  ]);

  if (recentRes.error || pendingRes.error || goalsRes.error) {
    throw new Error('טעינת השיחות נכשלה');
  }

  const rows = ((recentRes.data ?? []) as LeanListRow[]).map(leanToRow);
  const pending = (
    (pendingRes.data ?? []) as { id: string; role: string; status: string; origin: string | null }[]
  ).map((r) => ({ id: r.id, role: r.role, status: r.status, payload: r.origin ? { origin: r.origin } : {} }));

  return {
    conversations: summarizeConversations({
      rows,
      pending,
      goals: (goalsRes.data ?? []) as { role: string; status: string }[],
      roles: roles?.map((r) => ({ name: r.name, enabled: r.enabled })) ?? null,
      nowMs: Date.now(),
    }),
    rolesUnavailable: roles === null,
  };
}

export type FleetConversationCursor =
  | { kind: 'latest' }
  | { kind: 'before'; at: string }
  | { kind: 'after'; at: string };

export type FleetConversation = {
  role: string;
  /** Window rows + every pending row, oldest first. */
  rows: ConversationRequestRow[];
  goals: FleetGoalEntry[];
  rootTitles: Record<string, string>;
  handoffsOut: HandoffOut[];
  /** created_at of the oldest window row when older history exists. */
  olderCursor: string | null;
  /** created_at of the newest window row when newer history exists. */
  newerCursor: string | null;
  /** null = no focus requested; false = not found in this conversation. */
  focusFound: boolean | null;
  /** created_at of the oldest window row (goal events before it are off-screen). */
  windowStart: string | null;
  /** Server clock at read time — "now" for expiry countdowns and day labels. */
  generatedAt: number;
};

export function parseConversationCursor(before?: string, after?: string): FleetConversationCursor {
  if (before && cursorSchema.safeParse(before).success) return { kind: 'before', at: before };
  if (after && cursorSchema.safeParse(after).success) return { kind: 'after', at: after };
  return { kind: 'latest' };
}

// The role's latest window (or the page before/after a cursor). A `focus`
// outside the latest window re-anchors the window at the focused row, so an
// old Slack link still lands ON its message.
//
// Every value concatenated into a filter string (.in()) is re-validated as a
// uuid here even though it came from our own DB — `.or()`/`.in()` are string
// grammars, and nothing reaches them unchecked.
export async function getFleetConversation(
  role: string,
  opts: { cursor?: FleetConversationCursor; focus?: string | null } = {},
): Promise<FleetConversation> {
  await requirePlatformPermission('manage_settings');
  if (!ROLE_RE.test(role)) throw new Error('שם סוכן לא תקין');
  const supabase = await createClient();
  const n = CONVERSATION_PAGE_SIZE;
  let cursor = opts.cursor ?? { kind: 'latest' };
  const focus = opts.focus && uuid.safeParse(opts.focus).success ? opts.focus : null;

  const windowQuery = (c: FleetConversationCursor) => {
    const q = supabase.from('fleet_requests').select(CONVERSATION_ROW_COLUMNS).eq('role', role);
    if (c.kind === 'after') return q.gt('created_at', c.at).order('created_at', { ascending: true }).limit(n + 1);
    const base = c.kind === 'before' ? q.lt('created_at', c.at) : q;
    return base.order('created_at', { ascending: false }).limit(n + 1);
  };

  const [windowRes, pendingRes, goalsRes] = await Promise.all([
    windowQuery(cursor),
    supabase
      .from('fleet_requests')
      .select(CONVERSATION_ROW_COLUMNS)
      .eq('role', role)
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    supabase
      .from('fleet_goals')
      .select(FLEET_GOAL_COLUMNS)
      .eq('role', role)
      .order('created_at', { ascending: true }),
  ]);
  if (windowRes.error || pendingRes.error || goalsRes.error) {
    throw new Error('טעינת השיחה נכשלה');
  }

  let windowRows = (windowRes.data ?? []) as ConversationRequestRow[];
  let focusFound: boolean | null = focus ? windowRows.some((r) => r.id === focus) : null;

  if (focus && !focusFound && cursor.kind === 'latest') {
    const { data: focused, error } = await supabase
      .from('fleet_requests')
      .select('id, role, created_at')
      .eq('id', focus)
      .maybeSingle();
    if (error) throw new Error('טעינת השיחה נכשלה');
    if (focused && focused.role === role) {
      // Anchor: the focused row and the page of history right before it.
      const anchored = await supabase
        .from('fleet_requests')
        .select(CONVERSATION_ROW_COLUMNS)
        .eq('role', role)
        .lte('created_at', focused.created_at)
        .order('created_at', { ascending: false })
        .limit(n + 1);
      if (anchored.error) throw new Error('טעינת השיחה נכשלה');
      windowRows = (anchored.data ?? []) as ConversationRequestRow[];
      cursor = { kind: 'before', at: new Date(Date.parse(focused.created_at) + 1).toISOString() };
      focusFound = windowRows.some((r) => r.id === focus);
    } else {
      focusFound = false;
    }
  }

  // n+1 fetched: the extra row only tells us more exists in that direction.
  const hasMore = windowRows.length > n;
  if (hasMore) windowRows = windowRows.slice(0, n);
  if (cursor.kind !== 'after') windowRows = windowRows.reverse();
  const hasOlder = cursor.kind === 'after' ? true : hasMore;
  const hasNewer = cursor.kind === 'latest' ? false : cursor.kind === 'after' ? hasMore : true;

  const byId = new Map<string, ConversationRequestRow>();
  for (const r of windowRows) byId.set(r.id, r);
  for (const r of (pendingRes.data ?? []) as ConversationRequestRow[]) byId.set(r.id, r);
  const rows = [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  const ids = rows.map((r) => r.id).filter((id) => uuid.safeParse(id).success);
  const missingRoots = [
    ...new Set(
      rows
        .map((r) => threadRootOf(r))
        .filter((root): root is string => !!root && !byId.has(root) && uuid.safeParse(root).success),
    ),
  ];

  const [rootsRes, handoffRes] = await Promise.all([
    missingRoots.length
      ? supabase.from('fleet_requests').select('id, title').in('id', missingRoots)
      : Promise.resolve({ data: [] as { id: string; title: string }[], error: null }),
    ids.length
      ? supabase
          .from('fleet_requests')
          .select('id, role, created_at, handoff_from:payload->>handoff_from')
          .in('payload->>handoff_from', ids)
      : Promise.resolve({
          data: [] as { id: string; role: string; created_at: string; handoff_from: string | null }[],
          error: null,
        }),
  ]);
  if (rootsRes.error || handoffRes.error) throw new Error('טעינת השיחה נכשלה');

  const rootTitles: Record<string, string> = {};
  for (const r of rows) rootTitles[r.id] = r.title;
  for (const r of (rootsRes.data ?? []) as { id: string; title: string }[]) rootTitles[r.id] = r.title;

  const handoffsOut: HandoffOut[] = (
    (handoffRes.data ?? []) as { id: string; role: string; created_at: string; handoff_from: string | null }[]
  )
    .filter((h) => h.handoff_from)
    .map((h) => ({ fromId: h.handoff_from as string, toRole: h.role, toId: h.id, at: h.created_at }));

  const oldest = windowRows[0]?.created_at ?? null;
  const newest = windowRows[windowRows.length - 1]?.created_at ?? null;

  return {
    role,
    rows,
    goals: (goalsRes.data ?? []) as FleetGoalEntry[],
    rootTitles,
    handoffsOut,
    olderCursor: hasOlder ? oldest : null,
    newerCursor: hasNewer ? newest : null,
    focusFound,
    windowStart: hasOlder ? oldest : null,
    generatedAt: Date.now(),
  };
}

// Where an old link (/admin/fleet/<id>, ?id=, ?focus= without role) should
// land: the role whose conversation holds this request. null = not found.
export async function getFleetRequestRole(id: string): Promise<string | null> {
  await requirePlatformPermission('manage_settings');
  if (!uuid.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from('fleet_requests').select('role').eq('id', id).maybeSingle();
  if (error) throw new Error('טעינת הפנייה נכשלה');
  return data?.role ?? null;
}

export type OwnerRequestKind = 'approval' | 'question' | 'fyi';

// Open a conversation with a role from /admin/fleet.
//
// The INSERT itself is impossible from here by design — `authenticated` holds
// SELECT only and the single RLS policy is SELECT-only — so this goes through
// the fleet_owner_request SECURITY DEFINER function, the same shape as the
// answer path. The function re-checks admin membership itself, marks
// payload.origin='owner' (what the scheduler's owner_direct_request trigger
// counts) and derives a deterministic request_key.
//
// That key is the double-send guard: submitting the identical ask twice on the
// same day collides with the UNIQUE index and returns the EXISTING row instead
// of a duplicate. Callers get `deduplicated` so the UI can say so rather than
// pretending a second request was filed.
export async function createOwnerFleetRequest(input: {
  role: string;
  kind: OwnerRequestKind;
  tier: number;
  title: string;
  body: string;
  threadRoot?: string | null;
}): Promise<{ id: string; deduplicated: boolean }> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('fleet_owner_request', {
    p_role: input.role,
    p_kind: input.kind,
    p_tier: input.tier,
    p_title: input.title,
    p_body: input.body,
    p_thread_root: input.threadRoot ?? undefined,
  });

  if (error) {
    if (error.message.includes('admin only')) throw new Error('אין לך הרשאה לפתוח פנייה');
    if (error.message.includes('kind must be')) throw new Error('סוג פנייה לא תקין');
    if (error.message.includes('tier must be')) throw new Error('דרגה לא תקינה');
    if (error.message.includes('are required')) throw new Error('כותרת ותוכן הם שדות חובה');
    throw new Error('פתיחת הפנייה נכשלה');
  }

  const row = (Array.isArray(data) ? data[0] : data) as { id: string; created_at: string } | null;
  if (!row?.id) throw new Error('פתיחת הפנייה נכשלה');

  // A row whose created_at predates this request is the idempotent hit.
  const deduplicated = Date.now() - new Date(row.created_at).getTime() > 5_000;

  // Mirror of the agent-filed path: the ledger row is the source of truth and
  // Slack is best-effort, so a Slack outage must not fail the request.
  await sendSlackAlert({
    level: 'info',
    title: `פנייה ישירה מהבעלים ל-${input.role}: ${input.title}`,
    detail: deduplicated
      ? 'פנייה זהה כבר קיימת היום — לא נוצרה כפילות.'
      : 'הסוכן יקלוט אותה בהרצה הבאה שלו.',
    source: `fleet:${input.role}`,
    category: 'errors',
  });

  return { id: row.id, deduplicated };
}

// "השב" on a CLOSED message: a new owner message threaded on that message's
// conversation, so the CLI injects the thread root as context for the agent
// (scripts/fleet-agent-cli.ts, inbox thread context — root only).
//
// The browser sends ONLY the id it is replying to. role, tier, thread root and
// the title are all derived here from the stored row — never from hidden form
// fields — so a tampered form can neither retarget another role nor smuggle a
// value into a filter. The derived title ("המשך: <root title>") also keeps
// the request_key distinct per thread, so "כן" in two threads on the same day
// does not collide in the dedup index.
export async function createOwnerFleetContinuation(input: {
  continueFrom: string;
  body: string;
}): Promise<{ id: string; deduplicated: boolean; role: string }> {
  await requirePlatformPermission('manage_settings');
  if (!uuid.safeParse(input.continueFrom).success) throw new Error('מזהה הודעה לא תקין');
  const supabase = await createClient();

  const { data: source, error } = await supabase
    .from('fleet_requests')
    .select('id, role, tier, title, status, payload')
    .eq('id', input.continueFrom)
    .maybeSingle();
  if (error) throw new Error('פתיחת הפנייה נכשלה');
  if (!source) throw new Error('ההודעה שאליה משיבים לא נמצאה');
  if (source.status === 'pending' && requestBodyAuthor(source.payload) === 'agent') {
    // An open agent request is answered, not continued.
    throw new Error('הפנייה עדיין ממתינה למענה — השב עליה ישירות');
  }

  const root = threadRootOf(source);
  const threadRoot = root && uuid.safeParse(root).success ? root : source.id;
  let rootTitle = source.title;
  if (threadRoot !== source.id) {
    const { data: rootRow, error: rootError } = await supabase
      .from('fleet_requests')
      .select('title')
      .eq('id', threadRoot)
      .maybeSingle();
    if (rootError) throw new Error('פתיחת הפנייה נכשלה');
    if (rootRow?.title) rootTitle = rootRow.title;
  }

  const result = await createOwnerFleetRequest({
    role: source.role,
    kind: 'question',
    tier: source.tier,
    title: continuationTitle(rootTitle),
    body: input.body,
    threadRoot,
  });
  return { ...result, role: source.role };
}

export type FleetVerdict = 'approved' | 'denied' | 'answered';

// Record the owner's verdict via the fleet_answer_request RPC. The function
// re-checks admin membership itself (SECURITY DEFINER) and stamps
// answered_by/answered_at server-side; kind<->verdict validity, pending-only
// and not-expired are all enforced in the DB. DB errors are mapped to safe
// Hebrew messages — provider/DB details never reach the browser.
export async function answerFleetRequest(input: {
  id: string;
  verdict: FleetVerdict;
  answer: string | null;
}): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();

  // One pre-read, used twice: the self-answer guard below and the Slack
  // follow-up after the RPC.
  const { data: target, error: readError } = await supabase
    .from('fleet_requests')
    .select('role, title, payload')
    .eq('id', input.id)
    .maybeSingle();
  if (readError) throw new Error('שמירת המענה נכשלה');
  if (!target) throw new Error('הפנייה לא נמצאה');
  // B1: a request the owner opened (payload.origin='owner') is a task FOR the
  // agent, not a question to the owner. Answering it flips it to `answered`
  // and hands the agent a fake verdict (cmdVerdicts does not exclude
  // owner-origin rows). The RPC does not check origin (owner decision Q1 is
  // still open), so this app-layer guard is the enforcement for the UI path.
  if (requestBodyAuthor(target.payload) === 'owner') {
    throw new Error('לא ניתן להשיב לפנייה ששלחת');
  }

  const { error } = await supabase.rpc('fleet_answer_request', {
    p_id: input.id,
    p_verdict: input.verdict,
    p_answer: input.answer ?? undefined,
  });

  if (error) {
    if (error.message.includes('not pending')) {
      throw new Error('הפנייה כבר נענתה או פגה');
    }
    if (error.message.includes('expired')) {
      throw new Error('הפנייה פגת תוקף — הסוכן יגיש אותה מחדש אם היא עדיין רלוונטית');
    }
    if (error.message.includes('answer is required')) {
      throw new Error('לשאלה נדרשת תשובה בטקסט');
    }
    throw new Error('שמירת המענה נכשלה');
  }

  // Close the Slack side of the loop: the request-filed alert already went to
  // the channel, so the verdict must land there too or the thread looks
  // unanswered (real gap caught by the channel bot on the first smoke test).
  // Posted as a REPLY in the original request's thread when its ts was
  // captured (fleet_request_slack_threads); top-level otherwise. Title +
  // verdict only — the answer text stays out of Slack (non-PII rule).
  // sendSlackAlert is fail-safe; a Slack outage must not fail the answer.
  const { data: thread } = await supabase
    .from('fleet_request_slack_threads')
    .select('thread_ts')
    .eq('request_id', input.id)
    .maybeSingle();
  const verdictLabel =
    input.verdict === 'approved' ? 'אושר' : input.verdict === 'denied' ? 'נדחה' : 'נענה';
  await sendSlackAlert({
    level: 'info',
    title: `המענה נרשם (${verdictLabel}): ${target.title}`,
    detail: 'הסוכן יקלוט את התשובה בתחילת הריצה הבאה שלו.',
    source: `fleet:${target.role}`,
    category: 'errors',
    threadTs: thread?.thread_ts ?? undefined,
  });
}

// ── Fleet goals: persistent goal + self-scheduling ──────────────────────────
// Owner creates via fleet_goal_create (SECDEF, admin only); the role advances
// itself between runs via the CLI's goal-progress/goal-close (service_role
// only — no grant to authenticated, so neither is reachable from here or the
// browser). Reads go through the cookie client + fleet_goals_admin_select RLS,
// same second layer as fleet_requests above.

type FleetGoalRow = Tables<'fleet_goals'>;

export type FleetGoalEntry = Pick<
  FleetGoalRow,
  | 'id'
  | 'role'
  | 'title'
  | 'body'
  | 'status'
  | 'state'
  | 'next_wake_at'
  | 'step_count'
  | 'consecutive_failures'
  | 'last_error'
  | 'created_at'
  | 'closed_at'
>;

// One string literal, not a concatenation — supabase-js infers the exact
// column-literal type from `.select()` only when it sees one, same as
// CONVERSATION_ROW_COLUMNS above. A `+`-joined string loses that and the query
// resolves to GenericStringError instead of FleetGoalEntry.
const FLEET_GOAL_COLUMNS =
  'id, role, title, body, status, state, next_wake_at, step_count, consecutive_failures, last_error, created_at, closed_at';

// Single goal — only the legacy ?id=<goal>&type=goal link needs it now, to
// find which conversation to open. null for an unknown id.
export async function getFleetGoalById(id: string): Promise<FleetGoalEntry | null> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('fleet_goals')
    .select(FLEET_GOAL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('טעינת המטרה נכשלה');
  return (data ?? null) as FleetGoalEntry | null;
}

// INSERT is impossible from here: authenticated holds SELECT only and RLS is
// SELECT-only. The only path is the SECDEF — same shape as createOwnerFleetRequest.
export async function createFleetGoal(input: {
  role: string;
  title: string;
  body: string;
}): Promise<{ id: string }> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('fleet_goal_create', {
    p_role: input.role,
    p_title: input.title,
    p_body: input.body,
  });
  if (error) {
    if (error.message.includes('admin only')) throw new Error('אין לך הרשאה ליצור מטרה');
    if (error.message.includes('role ~')) throw new Error('שם סוכן לא תקין');
    throw new Error('יצירת המטרה נכשלה');
  }
  const row = (Array.isArray(data) ? data[0] : data) as { id: string } | null;
  if (!row?.id) throw new Error('יצירת המטרה נכשלה');
  return { id: row.id };
}

// Three owner actions on an existing goal. Each returns the RPC's result
// string as an exact union — "nothing happened" must stay distinguishable
// from "failed", or the UI reports success on a no-op. Same principle as
// `written:false` in the CLI's cmdDraftReply.
//
// Do NOT align these with answerFleetRequest (returns Promise<void>) — that
// is the exception, not the norm: fleet_answer_request raises on races
// ('request not found' / 'is not pending' / 'has expired') that are not
// reader error, and those get swallowed as a red { error } in
// answerFleetRequestAction. fleet_goal_pause instead returns 'not_active'
// without raising, and the UI shows a notice.
export type GoalPauseOutcome = 'paused' | 'not_active';
export type GoalResumeOutcome = 'resumed' | 'not_paused';
export type GoalAbandonOutcome = 'abandoned' | 'already_closed';

// Machine-checked anchor against the DB: if a goal RPC is ever converted to
// `returns void`, `supabase gen types --linked` flips its Returns type to
// undefined and these three assertions fail to compile (TS2322) rather than
// silently accepting a Promise<void> that the callers below then compare
// against a string.
type ReturnsText<T, R> = [T] extends [R] ? true : never;
const _pauseReturnsText: ReturnsText<
  GoalPauseOutcome,
  Database['public']['Functions']['fleet_goal_pause']['Returns']
> = true;
const _resumeReturnsText: ReturnsText<
  GoalResumeOutcome,
  Database['public']['Functions']['fleet_goal_resume']['Returns']
> = true;
const _abandonReturnsText: ReturnsText<
  GoalAbandonOutcome,
  Database['public']['Functions']['fleet_goal_abandon']['Returns']
> = true;

export async function pauseFleetGoal(id: string, note?: string): Promise<GoalPauseOutcome> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('fleet_goal_pause', {
    p_id: id,
    p_note: note ?? undefined,
  });
  if (error) {
    if (error.message.includes('admin only')) throw new Error('אין לך הרשאה להשהות מטרה');
    throw new Error('השהיית המטרה נכשלה');
  }
  return data as GoalPauseOutcome;
}

export async function resumeFleetGoal(
  id: string,
  nextWakeAt?: string,
): Promise<GoalResumeOutcome> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('fleet_goal_resume', {
    p_id: id,
    p_next_wake_at: nextWakeAt ?? undefined,
  });
  if (error) {
    if (error.message.includes('admin only')) throw new Error('אין לך הרשאה לשחרר מטרה');
    if (error.message.includes('next_wake_at must be within')) {
      throw new Error('מועד ההתעוררות חייב להיות בעתיד, ולא יותר מ-30 יום מהיום');
    }
    throw new Error('שחרור המטרה נכשל');
  }
  return data as GoalResumeOutcome;
}

// 'failed' not 'completed' — deliberately. 'completed' is a factual claim only
// the agent that did the work may make, so it is reachable only via
// fleet_goal_close in the CLI (service_role only).
export async function abandonFleetGoal(id: string, note: string): Promise<GoalAbandonOutcome> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('fleet_goal_abandon', {
    p_id: id,
    p_note: note,
  });
  if (error) {
    if (error.message.includes('admin only')) throw new Error('אין לך הרשאה לסגור מטרה');
    if (error.message.includes('note is required')) throw new Error('נדרשת סיבה לסגירה');
    throw new Error('סגירת המטרה נכשלה');
  }
  return data as GoalAbandonOutcome;
}
