'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { addToCallDnc, checkNumberAsStaff, setRegistryGateEnabled } from '@/lib/data/admin/call-dnc';
import { actionClient, returnUserError } from '@/lib/safe-action';

// Form-friendly: the phone is normalized (E.164) inside the DAL — validate only
// length here. reason is optional free text; '' is mapped to null in the DAL.
const addToCallDncInput = zfd.formData({
  phone: z.string().trim().min(6).max(32),
  reason: z.string().trim().max(200).default(''),
});

export const addToCallDncAction = actionClient
  .inputSchema(addToCallDncInput)
  .stateAction(async ({ parsedInput }) => {
    let result: Awaited<ReturnType<typeof addToCallDnc>>;
    try {
      result = await addToCallDnc(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('הוספה לרשימת ה-DNC נכשלה. נסו שוב.');
    }
    if (!result.ok) {
      return returnUserError(result.error);
    }

    revalidatePath('/admin/dnc');
    return { notice: 'נוסף לרשימת החסימה' };
  });

// What the "בדיקת מספר" tab shows. The phone itself is not echoed back: the operator typed it, and the answer is about
// the number, not a copy of it. Any invalid phone answers with the one form-level message.
const INVALID_PHONE = 'מספר טלפון לא תקין';

export const checkNumberAction = actionClient
  .inputSchema(
    zfd.formData({
      phone: z
        .string({ error: INVALID_PHONE })
        .trim()
        .min(6, { error: INVALID_PHONE })
        .max(32, { error: INVALID_PHONE }),
    }),
  )
  .stateAction(async ({ parsedInput: { phone } }) => {
    let r: Awaited<ReturnType<typeof checkNumberAsStaff>>;
    try {
      r = await checkNumberAsStaff(phone);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('הבדיקה נכשלה. נסו שוב.');
    }
    if (!r.ok) return returnUserError(r.error);
    return {
      result: r.check.result,
      checkedAt: r.check.checkedAt,
      source: r.check.source,
      transactionId: r.check.transactionId,
    };
  });

// Turning the gate on changes who may be called; turning it off removes a legal check. Both are audited to Slack,
// the same as the call-consent toggle (integrations/actions.ts).
export const setRegistryGateAction = actionClient
  .inputSchema(zfd.formData({ dnc_registry_gate_enabled: zfd.checkbox() }))
  .stateAction(async ({ parsedInput: { dnc_registry_gate_enabled: enabled } }) => {
    try {
      await setRegistryGateEnabled(enabled);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון מתג הבדיקה מול המאגר נכשל. נסו שוב.');
    }
    void sendSlackAlert({
      level: enabled ? 'info' : 'warn',
      category: 'security',
      source: 'dnc-registry-gate-toggle',
      title: enabled
        ? 'National DNC registry gate ENABLED — marketing dials are checked before the provider is called'
        : 'National DNC registry gate DISABLED — marketing dials are no longer checked against the registry',
      fields: { gate_enabled: String(enabled) },
    });
    revalidatePath('/admin/dnc');
    return { notice: enabled ? 'הבדיקה מול המאגר הופעלה' : 'הבדיקה מול המאגר כובתה' };
  });
