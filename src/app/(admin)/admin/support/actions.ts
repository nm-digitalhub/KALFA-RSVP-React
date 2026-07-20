'use server';

import { unstable_rethrow } from 'next/navigation';

import {
  findEventsForSupport,
  getEventForSupportView,
  listGuestsForSupportView,
  type SupportEventLookupResult,
  type SupportEventView,
  type SupportGuestView,
} from '@/lib/data/admin/support';
import { supportFindSchema, supportViewSchema } from '@/lib/validation/admin';
import type { ActionResult } from '@/lib/validation/result';

// Server actions backing the /admin/support READ-ONLY customer-support surface.
// Both actions re-gate via the data layer (requirePlatformPermission —
// belt-and-suspenders on top of the page's own gate). Neither action ever
// calls .update()/.insert()/.delete() on a customer table — findEventsAction
// resolves candidates, viewEventAction is the audited, reason-required view.

function safeMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export async function findSupportEventsAction(input: {
  event_id?: string;
  owner_phone?: string;
  owner_email?: string;
  reason?: string;
}): Promise<ActionResult<SupportEventLookupResult[]>> {
  const parsed = supportFindSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'קלט לא תקין' };
  }
  try {
    const results = await findEventsForSupport(
      {
        eventId: parsed.data.event_id || undefined,
        ownerPhone: parsed.data.owner_phone || undefined,
        ownerEmail: parsed.data.owner_email || undefined,
      },
      parsed.data.reason,
    );
    return { ok: true, data: results };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, error: safeMessage(err, 'החיפוש נכשל') };
  }
}

export interface SupportEventDossier {
  event: SupportEventView;
  guests: SupportGuestView[];
}

export async function viewSupportEventAction(input: {
  event_id: string;
  reason: string;
}): Promise<ActionResult<SupportEventDossier>> {
  const parsed = supportViewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'קלט לא תקין' };
  }
  try {
    const event = await getEventForSupportView(parsed.data.event_id, parsed.data.reason);
    const guests = await listGuestsForSupportView(parsed.data.event_id, parsed.data.reason);
    return { ok: true, data: { event, guests } };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, error: safeMessage(err, 'הצפייה נכשלה') };
  }
}
