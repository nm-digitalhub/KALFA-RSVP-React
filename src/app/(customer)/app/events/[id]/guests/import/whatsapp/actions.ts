'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { requireEventAccess } from '@/lib/data/events';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  bulkInsertGuests,
  createGroup,
  listGroups,
  type BulkGuestInput,
} from '@/lib/data/guests';
import { buildContactsForEvent } from '@/lib/data/contacts';
import { logActivity } from '@/lib/data/activity';
import { normalizeGroupName } from '@/lib/data/guest-import-shared';
import type { StagedRow } from '@/lib/data/whatsapp-import';
import type { FormState } from '@/lib/validation/result';

// Confirm/discard a WhatsApp-staged guest list. Access = guests.create (the
// same permission that gates the screen import); reads ride the staging RLS.
// On confirm the rows run through the SAME insert pipeline as the screen
// import (groups resolved once, single bulk insert, contacts rebuild), and
// the staging row is purged of PII either way.

async function loadPendingStaging(eventId: string, stagingId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('guest_import_staging')
    .select('id, rows, status')
    .eq('id', stagingId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (error || !data || data.status !== 'pending') return null;
  return data;
}

async function resolveStaging(
  stagingId: string,
  status: 'confirmed' | 'discarded',
): Promise<void> {
  // PII hygiene: parsed rows are wiped the moment the decision lands.
  const admin = createAdminClient();
  await admin
    .from('guest_import_staging')
    .update({ status, rows: [], resolved_at: new Date().toISOString() })
    .eq('id', stagingId);
}

export async function confirmWhatsappImportAction(
  eventId: string,
  stagingId: string,
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await requireEventAccess(eventId, 'guests', 'create');
    const staging = await loadPendingStaging(eventId, stagingId);
    if (!staging) return { error: 'הרשימה כבר טופלה או שאינה זמינה.' };

    const rows = (staging.rows ?? []) as StagedRow[];
    if (rows.length === 0) {
      await resolveStaging(stagingId, 'discarded');
      return { error: 'אין שורות תקינות לייבוא.' };
    }

    const groups = await listGroups(eventId);
    const groupByName = new Map(
      groups.map((g) => [normalizeGroupName(g.name).toLowerCase(), g.id]),
    );
    for (const name of new Set(
      rows.map((r) => r.group.trim()).filter((n) => n !== ''),
    )) {
      if (!groupByName.has(normalizeGroupName(name).toLowerCase())) {
        const created = await createGroup(eventId, { name });
        groupByName.set(normalizeGroupName(name).toLowerCase(), created.id);
      }
    }

    const inserts: BulkGuestInput[] = rows.map((r) => ({
      full_name: r.full_name,
      phone: r.phone,
      expected_count: r.expected_count,
      group_id:
        r.group.trim() === ''
          ? null
          : groupByName.get(normalizeGroupName(r.group).toLowerCase()) ?? null,
    }));
    const imported = await bulkInsertGuests(eventId, inserts);

    try {
      await buildContactsForEvent(eventId);
    } catch (err) {
      unstable_rethrow(err);
    }
    await resolveStaging(stagingId, 'confirmed');
    await logActivity({
      eventId,
      action: 'guests.imported',
      meta: { importedCount: imported, source: 'whatsapp' },
    });
    revalidatePath(`/app/events/${eventId}/guests`);
    revalidatePath(`/app/events/${eventId}/guests/import/whatsapp`);
    return { notice: `יובאו ${imported} מוזמנים בהצלחה.` };
  } catch (err) {
    unstable_rethrow(err);
    // Duplicate phones vs existing guests surface here with the friendly text.
    return {
      error: err instanceof Error ? err.message : 'ייבוא הרשימה נכשל.',
    };
  }
}

export async function discardWhatsappImportAction(
  eventId: string,
  stagingId: string,
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await requireEventAccess(eventId, 'guests', 'create');
    const staging = await loadPendingStaging(eventId, stagingId);
    if (!staging) return { error: 'הרשימה כבר טופלה.' };
    await resolveStaging(stagingId, 'discarded');
    revalidatePath(`/app/events/${eventId}/guests/import/whatsapp`);
    return { notice: 'הרשימה נמחקה.' };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'המחיקה נכשלה.' };
  }
}
