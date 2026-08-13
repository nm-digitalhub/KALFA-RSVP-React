import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { recordStaffAccess } from '@/lib/data/admin/access-log';
import { resolvePage, type PageResult } from '@/lib/data/admin/shared';
import { validateRecordingUrl } from '@/lib/voximplant/recording-url';

// Admin DAL for the browser call-center's history + recordings (plan stage 8).
// Mirrors voice-ops.ts house style exactly: service-role client under
// requirePlatformPermission, explicit non-PII column lists, batch name
// enrichment scoped to the visible page only. console_calls itself carries NO
// PII (caller_masked only — the full E.164 lives in console_call_pii, which
// this module never reads); the recording URL is the one deliberately
// PII-adjacent exception, gated separately below on view_recordings.

export interface ConsoleCallHistoryRow {
  id: string;
  direction: string;
  kind: string;
  status: string;
  callerMasked: string | null;
  eventId: string | null;
  eventName: string | null;
  agentId: string | null;
  agentName: string | null;
  transferredToAgentId: string | null;
  transferredToAgentName: string | null;
  hasRecording: boolean;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  endedReason: string | null;
}

export interface ListConsoleCallsFilter {
  page?: number;
  direction?: 'inbound' | 'outbound' | 'internal';
  status?: string;
}

export async function listConsoleCalls(
  filter: ListConsoleCallsFilter = {},
): Promise<PageResult<ConsoleCallHistoryRow>> {
  await requirePlatformPermission('manage_voice');
  const admin = createAdminClient();
  const { page, pageSize, from, to } = resolvePage(filter.page);

  let query = admin
    .from('console_calls')
    .select(
      'id, direction, kind, status, caller_masked, event_id, agent_id, transferred_to_agent_id, has_recording, started_at, answered_at, ended_at, duration_sec, ended_reason',
      { count: 'exact' },
    )
    .order('started_at', { ascending: false })
    .range(from, to);
  if (filter.direction) query = query.eq('direction', filter.direction);
  if (filter.status) query = query.eq('status', filter.status);

  const { data, count, error } = await query;
  if (error) throw new Error('טעינת היסטוריית השיחות נכשלה');
  const rows = (data ?? []) as Array<{
    id: string;
    direction: string;
    kind: string;
    status: string;
    caller_masked: string | null;
    event_id: string | null;
    agent_id: string | null;
    transferred_to_agent_id: string | null;
    has_recording: boolean;
    started_at: string;
    answered_at: string | null;
    ended_at: string | null;
    duration_sec: number | null;
    ended_reason: string | null;
  }>;

  // Batch-enrich event + agent display names for THIS PAGE only.
  const eventIds = [...new Set(rows.map((r) => r.event_id).filter((v): v is string => !!v))];
  const agentIds = [
    ...new Set(
      rows.flatMap((r) => [r.agent_id, r.transferred_to_agent_id]).filter((v): v is string => !!v),
    ),
  ];

  const eventNames = new Map<string, string>();
  if (eventIds.length > 0) {
    const { data: evRows } = await admin.from('events').select('id, name').in('id', eventIds);
    for (const e of (evRows ?? []) as Array<{ id: string; name: string }>) {
      eventNames.set(e.id, e.name);
    }
  }
  const agentNames = new Map<string, string>();
  if (agentIds.length > 0) {
    const { data: agentRows } = await admin
      .from('console_agents')
      .select('user_id, display_name')
      .in('user_id', agentIds);
    for (const a of (agentRows ?? []) as Array<{ user_id: string; display_name: string }>) {
      agentNames.set(a.user_id, a.display_name);
    }
  }

  const items: ConsoleCallHistoryRow[] = rows.map((r) => ({
    id: r.id,
    direction: r.direction,
    kind: r.kind,
    status: r.status,
    callerMasked: r.caller_masked,
    eventId: r.event_id,
    eventName: r.event_id ? (eventNames.get(r.event_id) ?? null) : null,
    agentId: r.agent_id,
    agentName: r.agent_id ? (agentNames.get(r.agent_id) ?? null) : null,
    transferredToAgentId: r.transferred_to_agent_id,
    transferredToAgentName: r.transferred_to_agent_id
      ? (agentNames.get(r.transferred_to_agent_id) ?? null)
      : null,
    hasRecording: r.has_recording,
    startedAt: r.started_at,
    answeredAt: r.answered_at,
    endedAt: r.ended_at,
    durationSec: r.duration_sec,
    endedReason: r.ended_reason,
  }));

  return { items, total: count ?? items.length, page, pageSize };
}

// Recording access — gated on view_recordings (owner-only, same as
// listCallRecordings) + a targeted-read audit, mirroring
// listCallAttemptsForEvent's "only when there's an identifiable owner" guard:
// a console call may have no linked event (internal, or an unidentified
// inbound caller), in which case there is no customer owner to attribute the
// read to and the audit is skipped — the permission check above still stands.
export async function getConsoleCallRecording(callId: string): Promise<string | null> {
  const staff = await requirePlatformPermission('view_recordings');
  const admin = createAdminClient();

  const { data: call } = await admin
    .from('console_calls')
    .select('event_id')
    .eq('id', callId)
    .maybeSingle();

  if (call?.event_id) {
    const { data: ownerRow } = await admin
      .from('events')
      .select('owner_id')
      .eq('id', call.event_id)
      .maybeSingle();
    // owner_id is nullable on events — recordStaffAccess REQUIRES a non-empty
    // ownerId (it throws otherwise, by design: an unaudited targeted read
    // must not silently proceed). Guard on the value itself, not just row
    // presence, so a genuinely owner-less event is treated the same as "no
    // identifiable owner to attribute the read to" rather than crashing this
    // recording's access — recordStaffAccess's own fail-closed throw is still
    // exactly what happens for every OTHER failure mode (a real audit-insert
    // error), which the caller (listConsoleCalls' consumer page) must catch
    // per-row so one row's audit failure degrades that row only.
    if (ownerRow?.owner_id) {
      await recordStaffAccess({
        staffId: staff.id,
        permission: 'view_recordings',
        subjectType: 'call_attempts',
        subjectId: callId,
        ownerId: ownerRow.owner_id,
        eventId: call.event_id,
      });
    }
  }

  const { data: pii } = await admin
    .from('console_call_pii')
    .select('recording_url')
    .eq('call_id', callId)
    .maybeSingle();
  const { url } = validateRecordingUrl(pii?.recording_url ?? null);
  return url;
}
