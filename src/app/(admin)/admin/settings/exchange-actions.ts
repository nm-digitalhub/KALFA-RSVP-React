'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import {
  createExchangeConnection,
  createMyExchangeTestAppointment,
  deleteMyExchangeTestAppointment,
  listMyExchangeCalendars,
  revokeExchangeConnection,
  testMyExchangeConnection,
} from '@/lib/data/exchange-connections';
import {
  createExchangeConnectionSchema,
  exchangeConnectionIdSchema,
  exchangeTestAppointmentIdSchema,
} from '@/lib/validation/schemas';
import type { FormState } from '@/lib/validation/result';

export async function createExchangeConnectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createExchangeConnectionSchema.safeParse({
    mailboxEmail: formData.get('mailboxEmail'),
    // The password is read once, right here, to build the encrypted row —
    // and is never echoed back in any returned state (plan §5.5).
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const result = await createExchangeConnection(parsed.data);
    if (!result.ok) {
      return { error: result.error };
    }
    revalidatePath('/admin/settings');
    return { notice: 'החיבור נוצר. לחצו על "בדיקת חיבור" כדי לאמת אותו.' };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'יצירת חיבור ה-Exchange נכשלה. נסו שוב.' };
  }
}

export async function testExchangeConnectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = exchangeConnectionIdSchema.safeParse({
    connectionId: formData.get('connectionId'),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const result = await testMyExchangeConnection(parsed.data.connectionId);
    revalidatePath('/admin/settings');
    return result.ok ? { notice: result.message } : { error: result.message };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'בדיקת החיבור נכשלה. נסו שוב.' };
  }
}

export async function listExchangeCalendarsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = exchangeConnectionIdSchema.safeParse({
    connectionId: formData.get('connectionId'),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const result = await listMyExchangeCalendars(parsed.data.connectionId);
    return result.ok ? { notice: result.message } : { error: result.message };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'טעינת רשימת היומנים נכשלה. נסו שוב.' };
  }
}

export async function revokeExchangeConnectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = exchangeConnectionIdSchema.safeParse({
    connectionId: formData.get('connectionId'),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await revokeExchangeConnection(parsed.data.connectionId);
    revalidatePath('/admin/settings');
    return { notice: 'החיבור נותק.' };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'ניתוק החיבור נכשל. נסו שוב.' };
  }
}

// A dedicated (non-FormState) result shape: the create step must hand the new
// appointmentId to the client so the matching "מחק פגישת בדיקה" button can
// submit it — the id is never persisted server-side (Stage 1 has no column
// for it; the appointment is meant to be looked at once in OWA and removed,
// not tracked long-term). FormNotice/FormError still work unchanged since
// they only need a `message` string, not this exact type.
export type TestAppointmentState =
  | { notice?: string; error?: string; appointmentId?: string }
  | null;

export async function createExchangeTestAppointmentAction(
  _prev: TestAppointmentState,
  formData: FormData,
): Promise<TestAppointmentState> {
  const parsed = exchangeConnectionIdSchema.safeParse({
    connectionId: formData.get('connectionId'),
  });
  if (!parsed.success) {
    return { error: 'מזהה חיבור לא תקין' };
  }

  try {
    const result = await createMyExchangeTestAppointment(parsed.data.connectionId);
    if (!result.ok) return { error: result.message };
    return {
      notice: 'פגישת הבדיקה נוצרה. בדקו שהיא מופיעה ב-OWA, ואז מחקו אותה.',
      appointmentId: result.appointmentId,
    };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'יצירת פגישת הבדיקה נכשלה. נסו שוב.' };
  }
}

export async function deleteExchangeTestAppointmentAction(
  _prev: TestAppointmentState,
  formData: FormData,
): Promise<TestAppointmentState> {
  const parsed = exchangeTestAppointmentIdSchema.safeParse({
    connectionId: formData.get('connectionId'),
    appointmentId: formData.get('appointmentId'),
  });
  if (!parsed.success) {
    return { error: 'מזהה חיבור או פגישה לא תקין' };
  }

  try {
    const result = await deleteMyExchangeTestAppointment(
      parsed.data.connectionId,
      parsed.data.appointmentId,
    );
    if (!result.ok) return { error: result.message };
    return { notice: 'פגישת הבדיקה נמחקה. ודאו שהיא נעלמה מ-OWA.' };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'מחיקת פגישת הבדיקה נכשלה. נסו שוב.' };
  }
}
