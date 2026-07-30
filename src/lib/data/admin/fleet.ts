import 'server-only';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { parseFleetRoleRegistry, type FleetRoleInfo } from '@/lib/fleet/handoff';
import type { Database } from '@/lib/supabase/types';
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

type FleetRequestRow = Database['public']['Tables']['fleet_requests']['Row'];

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

// Open requests awaiting the owner, oldest first (answer in arrival order).
export async function listPendingFleetRequests(): Promise<FleetRequestEntry[]> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('fleet_requests')
    .select(FLEET_REQUEST_COLUMNS)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) throw new Error('טעינת פניות הסוכנים נכשלה');
  return (data ?? []) as FleetRequestEntry[];
}

// Everything that is no longer pending, newest first, server-paginated.
export async function listFleetRequestHistory(
  params: PageParams = {},
): Promise<PageResult<FleetRequestEntry>> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { page, pageSize, from, to } = resolvePage(params.page);

  const { data, error, count } = await supabase
    .from('fleet_requests')
    .select(FLEET_REQUEST_COLUMNS, { count: 'exact' })
    .neq('status', 'pending')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw new Error('טעינת היסטוריית הפניות נכשלה');

  return {
    items: (data ?? []) as FleetRequestEntry[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

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

// The same role's other requests, newest first — the "thread" view for
// follow-ups on the same topic (agents file follow-ups as new requests).
export async function listFleetRequestsByRole(
  role: string,
  excludeId: string,
  limit = 10,
): Promise<FleetRequestEntry[]> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('fleet_requests')
    .select(FLEET_REQUEST_COLUMNS)
    .eq('role', role)
    .neq('id', excludeId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error('טעינת פניות קשורות נכשלה');
  return (data ?? []) as FleetRequestEntry[];
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

type FleetGoalRow = Database['public']['Tables']['fleet_goals']['Row'];

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

export async function listFleetGoals(): Promise<FleetGoalEntry[]> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('fleet_goals')
    .select(FLEET_GOAL_COLUMNS)
    .order('closed_at', { ascending: true, nullsFirst: true }) // active first
    .order('next_wake_at', { ascending: true, nullsFirst: false });
  if (error) throw new Error('טעינת המטרות נכשלה');
  return (data ?? []) as FleetGoalEntry[];
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
