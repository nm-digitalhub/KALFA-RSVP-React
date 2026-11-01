'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import { requirePlatformOwner } from '@/lib/auth/dal';
import {
  addOwnerAgentAllowlistEntry,
  addOwnerAgentExternalEntry,
  approveOwnerAgentUnverifiedStaff,
  relabelOwnerAgentAllowlistEntry,
  revokeOwnerAgentManualApproval,
  removeOwnerAgentAllowlistEntry,
  setOwnerAgentAllowlistEnabled,
  setOwnerAgentDailyCap,
  setOwnerAgentEnabled,
  setOwnerAgentPhoneNumber,
} from '@/lib/data/admin/owner-agent';
import {
  addAllowlistEntrySchema,
  addExternalAllowlistEntrySchema,
  agentNumberSchema,
  approveUnverifiedStaffSchema,
  dailyCapSchema,
  isOwnerAgentUserError,
  relabelAllowlistEntrySchema,
} from '@/lib/validation/owner-agent';
import { actionClient, returnUserError } from '@/lib/safe-action';

// Thin by design: validate → owner gate → DAL → a safe Hebrew result.
//
// The owner gate is checked HERE as well as in the DAL. A Server Action is its own
// endpoint — reachable by a POST that never rendered the page — so "the page checked"
// is never the answer, and for this screen the answer is not a permission key at all:
// owner decision 9.4 (2026-09-24). It runs outside the try so its redirect is never
// caught and turned into a form error; everything after it goes through
// unstable_rethrow for the same reason. The input schema runs before the body, so a bad
// form is refused before the gate, as it always was.
//
// Activity rows are written by the DAL, once, for every caller.

const OWNER_AGENT = '/admin/integrations/owner-agent';
const INDEX = '/admin/integrations';

function revalidate(): void {
  revalidatePath(OWNER_AGENT);
  // The index card prints this screen's switch and "number selected" state.
  revalidatePath(INDEX);
}

/**
 * Only a message the DAL wrote for the owner (OWNER_AGENT_ERRORS) reaches the screen.
 * An exact match, not "contains Hebrew": a ZodError's message is the JSON of its
 * issues, which carries these very Hebrew strings alongside paths and codes. Stricter
 * than the action client's own policy, so every catch below keeps it.
 */
function safeMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : '';
  return isOwnerAgentUserError(message) ? message : fallback;
}

// The input schemas. A typed field is read as `formData.get(name) ?? ''` (`.prefault('')`):
// an absent field is '', which the shared schema answers with its own Hebrew message. The
// hidden id and target-state fields are typed by no one: a bad one is answered with one
// sentence, which the row shows as its form message.
const BAD_REQUEST = 'בקשה לא תקינה';
const hiddenEntryId = z.uuid({ error: BAD_REQUEST });

export const setOwnerAgentEnabledAction = actionClient
  // A checkbox posts 'on' when ticked and nothing when not.
  .inputSchema(zfd.formData({ owner_agent_enabled: zfd.checkbox() }))
  .stateAction(async ({ parsedInput: { owner_agent_enabled: enabled } }) => {
    await requirePlatformOwner();
    try {
      await setOwnerAgentEnabled(enabled);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(safeMessage(err, 'עדכון מתג הסוכן נכשל'));
    }

    revalidate();
    return { notice: enabled ? 'הסוכן הופעל' : 'הסוכן כובה' };
  });

export const setOwnerAgentNumberAction = actionClient
  .inputSchema(zfd.formData({ phoneNumberId: agentNumberSchema.prefault('') }))
  .stateAction(async ({ parsedInput: { phoneNumberId } }) => {
    await requirePlatformOwner();
    try {
      await setOwnerAgentPhoneNumber(phoneNumberId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(safeMessage(err, 'שמירת המספר נכשלה'));
    }

    revalidate();
    return {
      notice: phoneNumberId === null ? 'לא נבחר מספר — אין הסטה לסוכן' : 'המספר נשמר',
    };
  });

export const setOwnerAgentDailyCapAction = actionClient
  .inputSchema(zfd.formData({ dailyCap: dailyCapSchema.prefault('') }))
  .stateAction(async ({ parsedInput: { dailyCap } }) => {
    await requirePlatformOwner();
    try {
      await setOwnerAgentDailyCap(dailyCap);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(safeMessage(err, 'שמירת התקרה היומית נכשלה'));
    }

    revalidate();
    return { notice: 'התקרה היומית נשמרה' };
  });

// The flattened validation errors carry MESSAGES, never the submitted value — a refused
// phone number is not echoed back into the response.
export const addAllowlistEntryAction = actionClient
  .inputSchema(
    zfd.formData({
      e164: addAllowlistEntrySchema.shape.e164.prefault(''),
      staffUserId: addAllowlistEntrySchema.shape.staffUserId.prefault(''),
      label: addAllowlistEntrySchema.shape.label.prefault(''),
    }),
  )
  .stateAction(async ({ parsedInput }) => {
    await requirePlatformOwner();
    try {
      // The DAL re-validates (it has callers other than this form), so it receives the
      // input shape: the normalised E.164, and '' rather than null for "no label".
      await addOwnerAgentAllowlistEntry({ ...parsedInput, label: parsedInput.label ?? '' });
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(safeMessage(err, 'הוספת המספר נכשלה'));
    }

    revalidate();
    return { notice: 'המספר נוסף לרשימת ההיתר' };
  });

export const setAllowlistEntryEnabledAction = actionClient
  .inputSchema(
    zfd.formData({
      id: hiddenEntryId,
      enabled: z.enum(['true', 'false'], { error: BAD_REQUEST }).transform((v) => v === 'true'),
    }),
  )
  .stateAction(async ({ parsedInput: { id, enabled } }) => {
    await requirePlatformOwner();
    try {
      await setOwnerAgentAllowlistEnabled(id, enabled);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(safeMessage(err, 'עדכון הרשומה נכשל'));
    }

    revalidate();
    return { notice: enabled ? 'הרשומה הופעלה' : 'הרשומה הושבתה' };
  });

export const relabelAllowlistEntryAction = actionClient
  .inputSchema(
    zfd.formData({
      id: relabelAllowlistEntrySchema.shape.id,
      label: relabelAllowlistEntrySchema.shape.label.prefault(''),
    }),
  )
  .stateAction(async ({ parsedInput: { id, label } }) => {
    await requirePlatformOwner();
    try {
      // The DAL re-parses the raw label, so the trimmed value is passed through as-is.
      await relabelOwnerAgentAllowlistEntry(id, label ?? '');
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(safeMessage(err, 'עדכון התווית נכשל'));
    }

    revalidate();
    return { notice: 'התווית נשמרה' };
  });

export const removeAllowlistEntryAction = actionClient
  .inputSchema(zfd.formData({ id: hiddenEntryId }))
  .stateAction(async ({ parsedInput: { id } }) => {
    await requirePlatformOwner();
    try {
      await removeOwnerAgentAllowlistEntry(id);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(safeMessage(err, 'הסרת המספר נכשלה'));
    }

    revalidate();
    return { notice: 'המספר הוסר מרשימת ההיתר' };
  });

// ─── Manual approval (plans/owner-agent-allowlist-override-plan.md) ──────────

export const approveUnverifiedStaffAction = actionClient
  .inputSchema(
    zfd.formData({
      id: approveUnverifiedStaffSchema.shape.id,
      note: approveUnverifiedStaffSchema.shape.note.prefault(''),
    }),
  )
  .stateAction(async ({ parsedInput: { id, note } }) => {
    await requirePlatformOwner();
    try {
      await approveOwnerAgentUnverifiedStaff(id, note);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(safeMessage(err, 'האישור הידני נכשל'));
    }

    revalidate();
    return { notice: 'אושר ידנית' };
  });

export const revokeManualApprovalAction = actionClient
  .inputSchema(zfd.formData({ id: hiddenEntryId }))
  .stateAction(async ({ parsedInput: { id } }) => {
    await requirePlatformOwner();
    try {
      await revokeOwnerAgentManualApproval(id);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(safeMessage(err, 'ביטול האישור הידני נכשל'));
    }

    revalidate();
    return { notice: 'האישור הידני בוטל' };
  });

// Messages only, never the submitted value (flattened validation errors).
export const addExternalAllowlistEntryAction = actionClient
  .inputSchema(
    zfd.formData({
      e164: addExternalAllowlistEntrySchema.shape.e164.prefault(''),
      name: addExternalAllowlistEntrySchema.shape.name.prefault(''),
      note: addExternalAllowlistEntrySchema.shape.note.prefault(''),
    }),
  )
  .stateAction(async ({ parsedInput }) => {
    await requirePlatformOwner();
    try {
      await addOwnerAgentExternalEntry(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(safeMessage(err, 'הוספת האדם החיצוני נכשלה'));
    }

    revalidate();
    return { notice: 'האדם החיצוני נוסף לרשימת ההיתר' };
  });
