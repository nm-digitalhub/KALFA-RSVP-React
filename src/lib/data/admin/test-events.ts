import 'server-only';

import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';

// TEST-EVENT MARKING AND PURGE (plan: docs/superpowers/plans/2026-09-29-test-event-purge.md).
//
// An event counts as a test event only when a staff member marked it
// explicitly — never by its name or by who owns it. The marker lives in
// public.test_events, which has no grants for anon/authenticated, so customers
// never see it. Three keys, deliberately separate:
//   * 'view_events'       — read the marker state on the staff event page;
//   * 'events.mark_test'  — mark / unmark (marking alone deletes nothing);
//   * 'events.purge_test' — the irreversible purge of a marked event.
// Every mutation goes through a service_role-only SECURITY DEFINER function
// (mark_test_event / unmark_test_event / purge_test_event) that locks the event
// row, re-checks the actor is platform staff, and writes the activity_log row
// itself (event_id NULL, so the audit outlives the purged event).

const eventIdSchema = z.uuid();

// The functions return text; parsing it (instead of casting) turns an
// unexpected value into a thrown error rather than a silently wrong branch.
const markOutcomeSchema = z.enum(['marked', 'already_marked', 'not_staff', 'no_event']);
const unmarkOutcomeSchema = z.enum(['unmarked', 'not_marked', 'not_staff', 'no_event']);
const purgeOutcomeSchema = z.enum([
  'purged',
  'not_marked',
  'financial_activity',
  'not_staff',
  'no_event',
]);
export type MarkOutcome = z.infer<typeof markOutcomeSchema>;
export type UnmarkOutcome = z.infer<typeof unmarkOutcomeSchema>;
export type PurgeOutcome = z.infer<typeof purgeOutcomeSchema>;

export interface TestEventStatus {
  marked: boolean;
  markedAt: string | null;
  // 'financial_activity' when money touched the event (charge, open hold,
  // SUMIT document, cancellation charge…) — the purge would refuse.
  purgeBlocker: string | null;
}

function parseEventId(eventId: string): string {
  const parsed = eventIdSchema.safeParse(eventId);
  if (!parsed.success) throw new Error('מזהה אירוע אינו תקין');
  return parsed.data;
}

export async function getTestEventStatus(eventId: string): Promise<TestEventStatus> {
  await requirePlatformPermission('view_events');
  const id = parseEventId(eventId);
  const admin = createAdminClient();

  const [{ data: row, error: rowError }, { data: blocker, error: blockerError }] =
    await Promise.all([
      admin
        .from('test_events')
        .select('marked_at')
        .eq('event_id', id)
        .is('purged_at', null)
        .maybeSingle(),
      admin.rpc('test_event_purge_blocker', { p_event: id }),
    ]);
  if (rowError || blockerError) throw new Error('טעינת מצב אירוע הבדיקה נכשלה');

  return {
    marked: row !== null,
    markedAt: row?.marked_at ?? null,
    purgeBlocker: blocker ?? null,
  };
}

export async function markEventAsTest(eventId: string): Promise<MarkOutcome> {
  const user = await requirePlatformPermission('events.mark_test');
  const id = parseEventId(eventId);
  const { data, error } = await createAdminClient().rpc('mark_test_event', {
    p_event: id,
    p_actor: user.id,
  });
  if (error) throw new Error('סימון אירוע הבדיקה נכשל');
  return markOutcomeSchema.parse(data);
}

export async function unmarkEventAsTest(eventId: string): Promise<UnmarkOutcome> {
  const user = await requirePlatformPermission('events.mark_test');
  const id = parseEventId(eventId);
  const { data, error } = await createAdminClient().rpc('unmark_test_event', {
    p_event: id,
    p_actor: user.id,
  });
  if (error) throw new Error('ביטול סימון אירוע הבדיקה נכשל');
  return unmarkOutcomeSchema.parse(data);
}

export async function purgeTestEvent(eventId: string): Promise<PurgeOutcome> {
  const user = await requirePlatformPermission('events.purge_test');
  const id = parseEventId(eventId);
  const { data, error } = await createAdminClient().rpc('purge_test_event', {
    p_event: id,
    p_actor: user.id,
  });
  if (error) throw new Error('מחיקת אירוע הבדיקה נכשלה');
  return purgeOutcomeSchema.parse(data);
}
