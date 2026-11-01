'use server';

import { z } from 'zod';
import { zfd } from 'zod-form-data';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { actionClient, returnUserError } from '@/lib/safe-action';
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
import { buildContactsForEvent, reconcileCampaignSetForContact } from '@/lib/data/contacts';
import { logActivity } from '@/lib/data/activity';
import { normalizeGroupName } from '@/lib/data/guest-import-shared';
import type { StagedRow } from '@/lib/data/whatsapp-import';

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
  //
  // ⚠️ THIS WIPE WAS REMOVED ON 2026-09-13 AND PUT BACK THE SAME DAY, so the
  // reasoning is worth stating rather than leaving as a bare line of code.
  //
  // It was removed under a flat "don't delete PII" rule, which was the wrong
  // rule for this spot. THIS TABLE IS A WORK QUEUE, not a record:
  //
  //   * On CONFIRM the rows are already in `guests` — the same names, the same
  //     phones. Keeping them here is a second copy of live data, not a record of
  //     anything.
  //   * On DISCARD the owner has just said, explicitly, that these people should
  //     NOT be in the event. Holding their phone numbers afterwards is the one
  //     case where minimisation is obviously right.
  //
  // What the removal was actually reaching for — "let me see what arrived" — is a
  // different need, and it is served properly by `workflow_run_steps.output`:
  // `action.import_guest_list` returns the rows, so a run log says what came in,
  // when, and what the automation did with it. That is a deliberate audit in one
  // place, rather than an undeleted work item in another.
  const admin = createAdminClient();
  await admin
    .from('guest_import_staging')
    .update({ status, rows: [], resolved_at: new Date().toISOString() })
    .eq('id', stagingId);
}

// Both actions check access first, before anything they were sent is read: a middleware that runs before the input
// is validated, given the bound event id as the client sent it (as before).
//
// The confirm form posts one checkbox per merge choice, named by the existing guest's id (`merge_<id>`,
// `field_<id>_<field>`), so it is read as the FormData it is, not through a fixed set of fields.
// A failure the data layer throws reaches the owner through the shared error policy (src/lib/safe-action.ts): its Hebrew
// message as is (duplicate phones vs existing guests surface this way, with the friendly text).
export const confirmWhatsappImportAction = actionClient
  .use(async ({ bindArgsClientInputs: [eventId], next }) => {
    await requireEventAccess(String(eventId), 'guests', 'create');
    return next();
  })
  .inputSchema(z.instanceof(FormData))
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ parsedInput: formData, bindArgsParsedInputs: [eventId, stagingId] }) => {
    const staging = await loadPendingStaging(eventId, stagingId);
    if (!staging) returnUserError('הרשימה כבר טופלה או שאינה זמינה.');

    const rows = (staging.rows ?? []) as StagedRow[];
    if (rows.length === 0) {
      await resolveStaging(stagingId, 'discarded');
      returnUserError('אין שורות תקינות לייבוא.');
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
      // Admit the imported contacts into an already-operational campaign's
      // authorized set, as import-actions.ts does. reconcileCampaignSetForContact
      // is itself best-effort/never-throws, so this cannot fail the import.
      const { contactIds } = await buildContactsForEvent(eventId);
      for (const contactId of contactIds) {
        await reconcileCampaignSetForContact(eventId, 'add', contactId);
      }
    } catch (err) {
      unstable_rethrow(err);
      // A derived step: it never fails a completed import, but it is logged, as import-actions.ts logs it (event id
      // and the error message only, no guest data), so a missed admission is visible; the worker's top-up repairs it.
      console.error(
        `[contacts] post-import contacts rebuild failed (event=${eventId}): ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
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
  });

// A one-button form: it posts no fields. Any failure on the way, the access check
// included, is 'המחיקה נכשלה.'; a list already handled answers with its own
// message, after the try (a returnUserError inside it would be caught and
// replaced).
export const discardWhatsappImportAction = actionClient
  .use(async ({ bindArgsClientInputs: [eventId], next }) => {
    try {
      await requireEventAccess(String(eventId), 'guests', 'create');
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('המחיקה נכשלה.');
    }
    return next();
  })
  .inputSchema(zfd.formData({}))
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ bindArgsParsedInputs: [eventId, stagingId] }) => {
    let pending: boolean;
    try {
      pending = (await loadPendingStaging(eventId, stagingId)) !== null;
      if (pending) {
        await resolveStaging(stagingId, 'discarded');
        revalidatePath(`/app/events/${eventId}/guests/import/whatsapp`);
      }
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('המחיקה נכשלה.');
    }
    if (!pending) returnUserError('הרשימה כבר טופלה.');
    return { notice: 'הרשימה נמחקה.' };
  });
