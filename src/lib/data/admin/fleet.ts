import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
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
