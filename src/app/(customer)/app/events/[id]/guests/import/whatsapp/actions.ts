'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { requireEventAccess } from '@/lib/data/events';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  applyGuestMerge,
  bulkInsertGuests,
  createGroup,
  findImportMatches,
  listGroups,
  type BulkGuestInput,
  type ImportMatch,
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
  formData: FormData,
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

    // Merge detection on the review screen — the owner confirms every merge and
    // picks PER FIELD what to apply (never automatic). A merged/duplicate row is
    // SKIPPED from the insert. See docs/guest-name-merge-plan-2026-07-07.md §9.
    //  • name-match: `merge_<id>` (default on) → add the phone; unticked ⇒ import
    //    as a new guest. • phone-match: the row can't be inserted (unique index),
    //    so it's always dropped; ticked fields enrich the existing guest.
    // Field checkboxes: `field_<id>_<full_name|group|expected_count>`.
    const matches = await findImportMatches(eventId, rows);
    const groupIdFor = (group: string) =>
      group.trim() === ''
        ? null
        : groupByName.get(normalizeGroupName(group).toLowerCase()) ?? null;

    // The patch built from the field checkboxes the owner ticked for a match.
    const patchFrom = (m: ImportMatch) => {
      const row = rows[m.rowIndex];
      const p: {
        full_name?: string;
        group_id?: string | null;
        expected_count?: number | null;
      } = {};
      for (const f of m.fields) {
        if (formData.get(`field_${m.existingGuestId}_${f.field}`) == null) continue;
        if (f.field === 'full_name') p.full_name = row.full_name;
        else if (f.field === 'group') p.group_id = groupIdFor(row.group);
        else if (f.field === 'expected_count') p.expected_count = row.expected_count;
      }
      return p;
    };

    const skipRowIndex = new Set<number>();
    let mergedCount = 0; // name-match merged (phone added)
    let updatedCount = 0; // phone-match with ≥1 field update
    let skippedCount = 0; // phone-match dropped, no update

    for (const m of matches) {
      if (m.direction === 'name') {
        if (formData.get(`merge_${m.existingGuestId}`) == null) continue; // import as new
        await applyGuestMerge(eventId, m.existingGuestId, {
          phone: m.addsPhone ?? undefined,
          ...patchFrom(m),
        });
        skipRowIndex.add(m.rowIndex);
        mergedCount += 1;
      } else {
        skipRowIndex.add(m.rowIndex); // dup phone → never inserted
        const patch = patchFrom(m);
        if (Object.keys(patch).length > 0) {
          await applyGuestMerge(eventId, m.existingGuestId, patch);
          updatedCount += 1;
        } else {
          skippedCount += 1;
        }
      }
    }

    const inserts: BulkGuestInput[] = rows
      .map((r, i) => ({ r, i }))
      .filter(({ i }) => !skipRowIndex.has(i))
      .map(({ r }) => ({
        full_name: r.full_name,
        phone: r.phone,
        expected_count: r.expected_count,
        group_id: groupIdFor(r.group),
      }));
    const imported = inserts.length ? await bulkInsertGuests(eventId, inserts) : 0;

    try {
      await buildContactsForEvent(eventId);
    } catch (err) {
      unstable_rethrow(err);
    }
    await resolveStaging(stagingId, 'confirmed');
    await logActivity({
      eventId,
      action: 'guests.imported',
      meta: {
        importedCount: imported,
        mergedCount,
        updatedCount,
        skippedCount,
        source: 'whatsapp',
      },
    });
    revalidatePath(`/app/events/${eventId}/guests`);
    revalidatePath(`/app/events/${eventId}/guests/import/whatsapp`);
    const parts = [`יובאו ${imported} מוזמנים`];
    if (mergedCount) parts.push(`אוחדו ${mergedCount} לפי שם`);
    if (updatedCount) parts.push(`עודכנו ${updatedCount} לפי טלפון`);
    if (skippedCount) parts.push(`דולגו ${skippedCount} כפולים`);
    return { notice: `${parts.join(' · ')}.` };
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
