import 'server-only';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { parseFleetRoleRegistry, type FleetRoleInfo } from '@/lib/fleet/handoff';
import type { Database, Tables } from '@/lib/supabase/types';
import { resolvePage, type PageParams, type PageResult } from './shared';

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

type FleetRequestRow = Tables<'fleet_requests'>;

export type FleetRequestEntry = Pick<
  FleetRequestRow,
  | 'id'
  | 'role'
  | 'run_id'
  | 'kind'
  | 'tier'
  | 'title'
  | 'body'
  | 'payload'
  | 'status'
  | 'answer'
  | 'created_at'
  | 'answered_at'
  | 'expires_at'
>;

const FLEET_REQUEST_COLUMNS =
  'id, role, run_id, kind, tier, title, body, payload, status, answer, created_at, answered_at, expires_at';

// Single request for the detail page (/admin/fleet/[id]), plus the answering
// admin's display name when available. Returns null for unknown ids so the
// page can 404 instead of leaking errors.
export async function getFleetRequest(id: string): Promise<{
  request: FleetRequestEntry & { consumed_at: string | null };
  answeredByName: string | null;
} | null> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('fleet_requests')
    .select(`${FLEET_REQUEST_COLUMNS}, consumed_at, answered_by`)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error('טעינת הפנייה נכשלה');
  if (!data) return null;

  let answeredByName: string | null = null;
  if (data.answered_by) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', data.answered_by)
      .maybeSingle();
    answeredByName = profile?.full_name?.trim() || null;
  }

  const { answered_by: _answeredBy, ...request } = data;
  return { request, answeredByName };
}

export type FleetRequestThreadView = {
  /** Every other message in this same conversation (thread_root match, or the
   * root itself), chronological oldest-first, UNCAPPED at a small number —
   * a thread item must never silently fall off this list. */
  sameThread: FleetRequestEntry[];
  /** The role's other, unrelated recent activity — newest first, capped, and
   * guaranteed not to duplicate anything already in `sameThread`. */
  other: FleetRequestEntry[];
};

// The same role's other requests: split into "this conversation" (unbounded —
// see FleetRequestThreadView.sameThread) and "everything else" (capped, most
// recent first). Previously a single flat newest-first list capped at 10,
// which meant a still-pending thread reply could silently drop off the page
// if the role filed 10+ unrelated things since — the exact shape of bug this
// split exists to rule out.
export async function listFleetRequestsByRole(
  role: string,
  excludeId: string,
  threadRoot: string,
  otherLimit = 10,
): Promise<FleetRequestThreadView> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();

  const [threadResult, recentResult] = await Promise.all([
    supabase
      .from('fleet_requests')
      .select(FLEET_REQUEST_COLUMNS)
      .eq('role', role)
      .neq('id', excludeId)
      .or(`id.eq.${threadRoot},payload->>thread_root.eq.${threadRoot}`)
      .order('created_at', { ascending: true })
      .limit(200),
    // A modest buffer over otherLimit, not otherLimit itself: rows that turn
    // out to belong to the thread get filtered out below, so the DB limit has
    // to leave enough room for `otherLimit` real "other" rows to survive that.
    supabase
      .from('fleet_requests')
      .select(FLEET_REQUEST_COLUMNS)
      .eq('role', role)
      .neq('id', excludeId)
      .order('created_at', { ascending: false })
      .limit(otherLimit + 20),
  ]);

  if (threadResult.error || recentResult.error) throw new Error('טעינת פניות קשורות נכשלה');

  const sameThread = (threadResult.data ?? []) as FleetRequestEntry[];
  const threadIds = new Set(sameThread.map((r) => r.id));
  const other = ((recentResult.data ?? []) as FleetRequestEntry[])
    .filter((r) => !threadIds.has(r.id))
    .slice(0, otherLimit);

  return { sameThread, other };
}

// The role registry the compose form offers, read from the same fleet.json the
// scheduler reloads every tick. Read at request time (not cached): fleet.json
// is owner-edited and a stale list would offer a role that no longer exists —
// which the CLI would reject as a dead letter anyway.
export async function listFleetRoles(): Promise<FleetRoleInfo[]> {
  await requirePlatformPermission('manage_settings');
  const path = join(process.cwd(), '.claude', 'fleet', 'fleet.json');
  try {
    return parseFleetRoleRegistry(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    // Fail-closed: an unreadable config means no roles to offer, not a crash.
    // The form renders its empty state and the owner keeps the rest of the page.
    return [];
  }
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
  const { data: answered } = await supabase
    .from('fleet_requests')
    .select('role, title')
    .eq('id', input.id)
    .maybeSingle();
  if (answered) {
    const { data: thread } = await supabase
      .from('fleet_request_slack_threads')
      .select('thread_ts')
      .eq('request_id', input.id)
      .maybeSingle();
    const verdictLabel =
      input.verdict === 'approved' ? 'אושר' : input.verdict === 'denied' ? 'נדחה' : 'נענה';
    await sendSlackAlert({
      level: 'info',
      title: `המענה נרשם (${verdictLabel}): ${answered.title}`,
      detail: 'הסוכן יקלוט את התשובה בתחילת הריצה הבאה שלו.',
      source: `fleet:${answered.role}`,
      category: 'errors',
      threadTs: thread?.thread_ts ?? undefined,
    });
  }
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
// FLEET_REQUEST_COLUMNS above. A `+`-joined string loses that and the query
// resolves to GenericStringError instead of FleetGoalEntry.
const FLEET_GOAL_COLUMNS =
  'id, role, title, body, status, state, next_wake_at, step_count, consecutive_failures, last_error, created_at, closed_at';

// A request or a goal, shaped identically enough for one unified list row and
// one unified detail-pane dispatch (/admin/fleet). `data` keeps the full,
// type-specific row for whichever renderer needs it; the flat id/role/title/
// status/displayAt fields exist so the shared list row never has to branch on
// entryKind just to read them. Two label maps stay separate downstream
// (fleet-client.tsx) rather than merging into this type — 'completed' takes a
// different Hebrew grammatical form for a בקשה vs a מטרה, and flattening that
// away would silently reintroduce the wrong gender agreement.
export type FleetActivityEntry =
  | { entryKind: 'request'; id: string; role: string; title: string; status: string; displayAt: string; data: FleetRequestEntry }
  | { entryKind: 'goal'; id: string; role: string; title: string; status: string; displayAt: string; data: FleetGoalEntry };

function toRequestActivityEntry(r: FleetRequestEntry, displayAt: string): FleetActivityEntry {
  return { entryKind: 'request', id: r.id, role: r.role, title: r.title, status: r.status, displayAt, data: r };
}

function toGoalActivityEntry(g: FleetGoalEntry, displayAt: string): FleetActivityEntry {
  return { entryKind: 'goal', id: g.id, role: g.role, title: g.title, status: g.status, displayAt, data: g };
}

// Everything the owner must act on or is watching right now: pending requests
// (blocking a role) ahead of active/paused goals — both already small by
// nature, so this stays unpaginated. Reuses the two existing list functions
// rather than a new query; the only new work here is shaping them into one
// list for /admin/fleet's unified "needs attention" section.
// `kind` stays a plain string (not the approval|question|fyi union) — it
// comes straight from an admin-typed ?kind= query param, and an unrecognized
// value should just match nothing (a plain .eq() against real rows), the same
// as /admin/contacts' own unvalidated ?status= filter — not get lied to via
// an `as` cast into a union it might not actually satisfy.
export type FleetActivityFilters = { role?: string; kind?: string };

// The unified /admin/fleet feed: ONE priority-first, paginated list — no
// separate "needs attention" section. "Priority" (pending requests +
// active/paused goals — always small by nature) is fetched in full and always
// sorts ahead of everything else, so in the common case it simply occupies
// the top of page 1; only if it ever exceeds a page's worth does it spill
// onto page 2, still first there too. "Rest" (resolved requests + finished
// goals) uses the same over-fetch-to-page-depth merge as a real cross-table
// UNION would give: each source is fetched to the SAME depth (page*pageSize
// rows, newest first) and merged here. That is exact, not approximate — the
// true top `page*pageSize` rows are guaranteed to be a subset of what was
// just fetched, because each source only ever contributes MORE recent rows
// nearer the top. Cost grows with page depth, not table size — the right
// trade for an internal ops list rarely paged more than a few pages deep.
//
// `kind` excludes goals entirely: kind (question/approval/fyi) is a
// request-only concept, so filtering by it means "requests of this kind",
// not "requests of this kind, plus every goal".
export async function listFleetActivity(
  params: PageParams & FleetActivityFilters = {},
): Promise<PageResult<FleetActivityEntry>> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { page, pageSize } = resolvePage(params.page);
  const upTo = page * pageSize;
  const { role, kind } = params;

  let pendingQuery = supabase
    .from('fleet_requests')
    .select(FLEET_REQUEST_COLUMNS)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (role) pendingQuery = pendingQuery.eq('role', role);
  if (kind) pendingQuery = pendingQuery.eq('kind', kind);

  let restReqQuery = supabase
    .from('fleet_requests')
    .select(FLEET_REQUEST_COLUMNS, { count: 'exact' })
    .neq('status', 'pending')
    .order('created_at', { ascending: false })
    .range(0, upTo - 1);
  if (role) restReqQuery = restReqQuery.eq('role', role);
  if (kind) restReqQuery = restReqQuery.eq('kind', kind);

  let goalsAttnQuery = supabase
    .from('fleet_goals')
    .select(FLEET_GOAL_COLUMNS)
    .in('status', ['active', 'paused']);
  if (role) goalsAttnQuery = goalsAttnQuery.eq('role', role);

  let restGoalQuery = supabase
    .from('fleet_goals')
    .select(FLEET_GOAL_COLUMNS, { count: 'exact' })
    .not('closed_at', 'is', null)
    .order('closed_at', { ascending: false })
    .range(0, upTo - 1);
  if (role) restGoalQuery = restGoalQuery.eq('role', role);

  const [pendingRes, restReqRes, goalsAttnRes, restGoalRes] = await Promise.all([
    pendingQuery,
    restReqQuery,
    goalsAttnQuery,
    restGoalQuery,
  ]);

  if (pendingRes.error || restReqRes.error || goalsAttnRes.error || restGoalRes.error) {
    throw new Error('טעינת פעילות הסוכנים נכשלה');
  }

  const pending = (pendingRes.data ?? []) as FleetRequestEntry[];
  const activeGoals = kind ? [] : ((goalsAttnRes.data ?? []) as FleetGoalEntry[]);
  const priority = [
    ...pending.map((r) => toRequestActivityEntry(r, r.created_at)),
    ...activeGoals.map((g) => toGoalActivityEntry(g, g.created_at)),
  ].sort((a, b) => (a.displayAt < b.displayAt ? 1 : a.displayAt > b.displayAt ? -1 : 0));

  const restRequests = (restReqRes.data ?? []) as FleetRequestEntry[];
  const restGoals = kind ? [] : ((restGoalRes.data ?? []) as FleetGoalEntry[]);
  const rest = [
    ...restRequests.map((r) => toRequestActivityEntry(r, r.answered_at ?? r.created_at)),
    ...restGoals.map((g) => toGoalActivityEntry(g, g.closed_at ?? g.created_at)),
  ].sort((a, b) => (a.displayAt < b.displayAt ? 1 : a.displayAt > b.displayAt ? -1 : 0));

  // Priority unconditionally ranks ahead of rest (not merged into one sort by
  // date) — that is the whole point: "needs attention" outranks recency.
  const merged = [...priority, ...rest];
  const from = (page - 1) * pageSize;
  const total = priority.length + (restReqRes.count ?? 0) + (kind ? 0 : (restGoalRes.count ?? 0));

  return {
    items: merged.slice(from, from + pageSize),
    total,
    page,
    pageSize,
  };
}

// Single goal for the unified detail pane (/admin/fleet?id=...&type=goal).
// Returns null for an unknown id — same "let the pane render an empty state,
// don't crash the page" contract as getFleetRequest above.
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
