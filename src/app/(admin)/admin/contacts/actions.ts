'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { zfd } from 'zod-form-data';

import { sendInquiryReply, updateContactStatus } from '@/lib/data/admin/contacts';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { sendInquiryReplySchema, updateContactStatusSchema } from '@/lib/validation/admin';

// Re-throw Next.js control-flow signals (e.g. a redirect thrown by the DAL
// permission gate); catching them would silently break the redirect.
// Update a single contact message's status. Validates the closed status
// vocabulary server-side; authorization is enforced inside
// updateContactStatus (requirePlatformPermission).
export const updateContactStatusAction = actionClient
  .inputSchema(zfd.formData(updateContactStatusSchema))
  .stateAction(async ({ parsedInput: { id, status } }) => {
    try {
      await updateContactStatus(id, status);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון הסטטוס נכשל. נסו שוב.');
    }

    revalidatePath('/admin/contacts');
    return { notice: 'הסטטוס עודכן' };
  });

// Send an email reply to a contact message. Validates the body server-side
// (the reply reaches the schema as posted, so an empty one gets the schema's own
// message); authorization + the send-then-persist flow live in sendInquiryReply.
// The error surfaced to the admin is the domain error's own message (e.g. "no
// email on this inquiry", or "sent but not saved") — those are safe, user-facing
// Hebrew strings, never provider/DB detail, and the action client passes them
// through.
export const sendInquiryReplyAction = actionClient
  .inputSchema(zfd.formData(sendInquiryReplySchema))
  .stateAction(async ({ parsedInput: { id, reply } }) => {
    await sendInquiryReply(id, reply);

    revalidatePath('/admin/contacts');
    return { notice: 'המענה נשלח ללקוח' };
  });
