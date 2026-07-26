'use server';

import { revalidatePath } from 'next/cache';

import { sendInquiryReply, updateContactStatus } from '@/lib/data/admin/contacts';
import { sendInquiryReplySchema, updateContactStatusSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

// Re-throw Next.js control-flow signals (e.g. a redirect thrown by the DAL
// permission gate); catching them would silently break the redirect.
function isNextRedirect(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

// Update a single contact message's status. Validates the closed status
// vocabulary server-side; authorization is enforced inside
// updateContactStatus (requirePlatformPermission).
export async function updateContactStatusAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateContactStatusSchema.safeParse({
    id: formData.get('id'),
    status: formData.get('status'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateContactStatus(parsed.data.id, parsed.data.status);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: 'עדכון הסטטוס נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/contacts');
  return { notice: 'הסטטוס עודכן' };
}

// Send an email reply to a contact message. Validates the body server-side;
// authorization + the send-then-persist flow live in sendInquiryReply. The
// error surfaced to the admin is the domain error's own message (e.g. "no email
// on this inquiry", or "sent but not saved") — those are safe, user-facing
// Hebrew strings, never provider/DB detail.
export async function sendInquiryReplyAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = sendInquiryReplySchema.safeParse({
    id: formData.get('id'),
    reply: formData.get('reply'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await sendInquiryReply(parsed.data.id, parsed.data.reply);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return {
      error: err instanceof Error ? err.message : 'שליחת המענה נכשלה. נסו שוב.',
    };
  }

  revalidatePath('/admin/contacts');
  return { notice: 'המענה נשלח ללקוח' };
}
