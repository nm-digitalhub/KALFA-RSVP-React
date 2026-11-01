'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { zfd } from 'zod-form-data';

import {
  createExchangeConnection,
  createMyExchangeTestAppointment,
  deleteMyExchangeTestAppointment,
  listMyExchangeCalendars,
  revokeExchangeConnection,
  testMyExchangeConnection,
} from '@/lib/data/exchange-connections';
import { actionClient, returnUserError } from '@/lib/safe-action';
import {
  createExchangeConnectionSchema,
  exchangeConnectionIdSchema,
  exchangeTestAppointmentIdSchema,
} from '@/lib/validation/schemas';

// The form on /admin/settings has no password field (needsPassword={false}: Graph signs in with a certificate, and
// createExchangeConnection ignores a password). A field the form does not send reaches the schema as undefined (zfd),
// which its optional `password` accepts. A password, when a form does send one, is never echoed back in any result.
const createConnectionForm = zfd.formData(createExchangeConnectionSchema);

export const createExchangeConnectionAction = actionClient
  .inputSchema(createConnectionForm)
  .stateAction(async ({ parsedInput }) => {
    let result: Awaited<ReturnType<typeof createExchangeConnection>>;
    try {
      result = await createExchangeConnection(parsedInput);
      if (result.ok) revalidatePath('/admin/settings');
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('יצירת חיבור ה-Exchange נכשלה. נסו שוב.');
    }
    if (!result.ok) returnUserError(result.error);
    return { notice: 'החיבור נוצר. לחצו על "בדיקת חיבור" כדי לאמת אותו.' };
  });

export const testExchangeConnectionAction = actionClient
  .inputSchema(zfd.formData(exchangeConnectionIdSchema))
  .stateAction(async ({ parsedInput: { connectionId } }) => {
    let result: Awaited<ReturnType<typeof testMyExchangeConnection>>;
    try {
      result = await testMyExchangeConnection(connectionId);
      revalidatePath('/admin/settings');
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('בדיקת החיבור נכשלה. נסו שוב.');
    }
    if (!result.ok) returnUserError(result.message);
    return { notice: result.message };
  });

export const listExchangeCalendarsAction = actionClient
  .inputSchema(zfd.formData(exchangeConnectionIdSchema))
  .stateAction(async ({ parsedInput: { connectionId } }) => {
    let result: Awaited<ReturnType<typeof listMyExchangeCalendars>>;
    try {
      result = await listMyExchangeCalendars(connectionId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('טעינת רשימת היומנים נכשלה. נסו שוב.');
    }
    if (!result.ok) returnUserError(result.message);
    return { notice: result.message };
  });

export const revokeExchangeConnectionAction = actionClient
  .inputSchema(zfd.formData(exchangeConnectionIdSchema))
  .stateAction(async ({ parsedInput: { connectionId } }) => {
    try {
      await revokeExchangeConnection(connectionId);
      revalidatePath('/admin/settings');
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('ניתוק החיבור נכשל. נסו שוב.');
    }
    return { notice: 'החיבור נותק.' };
  });

// The create step hands the new appointmentId to the client (in its `data`) so
// the matching "מחק פגישת בדיקה" button can submit it — the id is never
// persisted server-side (Stage 1 has no column for it; the appointment is
// meant to be looked at once in OWA and removed, not tracked long-term).
export const createExchangeTestAppointmentAction = actionClient
  .inputSchema(zfd.formData(exchangeConnectionIdSchema))
  .stateAction(async ({ parsedInput: { connectionId } }) => {
    let result: Awaited<ReturnType<typeof createMyExchangeTestAppointment>>;
    try {
      result = await createMyExchangeTestAppointment(connectionId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('יצירת פגישת הבדיקה נכשלה. נסו שוב.');
    }
    if (!result.ok) returnUserError(result.message);
    return {
      notice: 'פגישת הבדיקה נוצרה. בדקו שהיא מופיעה ב-OWA, ואז מחקו אותה.',
      appointmentId: result.appointmentId,
    };
  });

export const deleteExchangeTestAppointmentAction = actionClient
  .inputSchema(zfd.formData(exchangeTestAppointmentIdSchema), {
    // One line for a bad connection id or a bad appointment id alike.
    handleValidationErrorsShape: async () => ({ formErrors: ['מזהה חיבור או פגישה לא תקין'], fieldErrors: {} }),
  })
  .stateAction(async ({ parsedInput: { connectionId, appointmentId } }) => {
    let result: Awaited<ReturnType<typeof deleteMyExchangeTestAppointment>>;
    try {
      result = await deleteMyExchangeTestAppointment(connectionId, appointmentId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('מחיקת פגישת הבדיקה נכשלה. נסו שוב.');
    }
    if (!result.ok) returnUserError(result.message);
    return { notice: 'פגישת הבדיקה נמחקה. ודאו שהיא נעלמה מ-OWA.' };
  });
