'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { sendSlackAlert } from '@/lib/alerts/slack';
import type { FormState } from '@/lib/validation/result';

// Bootstrap the FIRST administrator. Delegates entirely to the trusted
// claim_first_admin() RPC (SECURITY DEFINER), which atomically checks that NO
// admin exists yet and, only then, grants the calling user the admin role.
//
// RPC contract (verified against the live function definition):
//   - returns true  → the caller is now the first admin (success)
//   - returns false → an admin already exists; the claim is refused
//   - errors        → e.g. not authenticated (handled generically)
//
// Authorization is enforced inside the RPC; we never trust browser-supplied
// identifiers. No arguments are passed (Args: never).
export async function claimFirstAdminAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  // useActionState always supplies (state, formData); this action takes no form
  // input (the RPC has no args). Marked intentionally unused.
  void _prevState;
  void _formData;
  const user = await requireUser();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('claim_first_admin');

  if (error) {
    return { error: 'הפעולה נכשלה. נסו שוב מאוחר יותר.' };
  }

  if (data !== true) {
    // An admin already exists — refuse without leaking who/how many.
    return { error: 'כבר קיים מנהל במערכת. לא ניתן לתבוע גישת ניהול.' };
  }

  // Role changed — revalidate cached layouts that branch on admin status.
  revalidatePath('/app', 'layout');
  // Additive security ops alert. AWAITED (not fire-and-forget): this is a
  // once-ever bootstrap and redirect() throws immediately after, so awaiting
  // ensures the send is attempted. sendSlackAlert is fail-safe (never throws).
  // Non-PII: user id only.
  await sendSlackAlert({
    level: 'warn',
    category: 'security',
    source: 'admin-access',
    title: 'נתבעה גישת מנהל ראשונה',
    fields: { userId: user.id },
  });
  redirect('/admin');
}
