'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { addToCallDnc, checkNumberAsStaff, setRegistryGateEnabled } from '@/lib/data/admin/call-dnc';
import type { RegistryResult } from '@/lib/dnc/registry-check';
import type { FormState } from '@/lib/validation/result';

// Form-friendly: the phone is normalized (E.164) inside the DAL — validate only
// length here. reason is optional free text; '' is mapped to null in the DAL.
const addToCallDncSchema = z.object({
  phone: z.string().trim().min(6).max(32),
  reason: z.string().trim().max(200).default(''),
});

export async function addToCallDncAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = addToCallDncSchema.safeParse({
    phone: formData.get('phone') ?? '',
    reason: formData.get('reason') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  let result: Awaited<ReturnType<typeof addToCallDnc>>;
  try {
    result = await addToCallDnc(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'הוספה לרשימת ה-DNC נכשלה. נסו שוב.' };
  }
  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath('/admin/dnc');
  return { notice: 'נוסף לרשימת החסימה' };
}

// What the "בדיקת מספר" tab shows. The phone itself is not echoed back: the operator typed it, and the answer is about
// the number, not a copy of it.
export type CheckNumberState =
  | null
  | { error: string }
  | { result: RegistryResult; checkedAt: string; source: string; transactionId: string | null };

const checkNumberSchema = z.object({ phone: z.string().trim().min(6).max(32) });

export async function checkNumberAction(_prev: CheckNumberState, formData: FormData): Promise<CheckNumberState> {
  const parsed = checkNumberSchema.safeParse({ phone: formData.get('phone') ?? '' });
  if (!parsed.success) return { error: 'מספר טלפון לא תקין' };
  try {
    const r = await checkNumberAsStaff(parsed.data.phone);
    if (!r.ok) return { error: r.error };
    return {
      result: r.check.result,
      checkedAt: r.check.checkedAt,
      source: r.check.source,
      transactionId: r.check.transactionId,
    };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'הבדיקה נכשלה. נסו שוב.' };
  }
}

// Turning the gate on changes who may be called; turning it off removes a legal check. Both are audited to Slack,
// the same as the call-consent toggle (integrations/actions.ts).
export async function setRegistryGateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const enabled = formData.get('dnc_registry_gate_enabled') === 'on';
  try {
    await setRegistryGateEnabled(enabled);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון מתג הבדיקה מול המאגר נכשל. נסו שוב.' };
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
}
