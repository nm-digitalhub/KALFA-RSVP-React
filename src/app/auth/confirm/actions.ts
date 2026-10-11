'use server';

import { redirect } from 'next/navigation';

import { isMarketingConsentEnabled } from '@/lib/data/marketing-consent';
import { enqueueMarketingContactSync } from '@/lib/data/marketing-contact-sync';
import { createClient } from '@/lib/supabase/server';
import { resolveAppRedirectPath } from '@/lib/url';
import { isConfirmOtpType } from './otp-types';

// POST-only OTP verification for the /auth/confirm interstitial. It runs when the
// user SUBMITS the confirm form, not on the GET that renders the page — which
// MITIGATES ordinary GET link prefetching (email security scanners / Safe Links
// that follow `<a href>` links), since those consume the single-use token on GET.
// It is NOT an absolute guarantee: an automated agent that submits forms could
// still trigger it. verifyOtp on the cookie client establishes the session
// server-side; the cookies then ride the redirect. `next` is re-validated here
// with the shared policy — the hidden form field is never trusted.
export async function confirmOtp(formData: FormData): Promise<void> {
  const tokenHash = String(formData.get('token_hash') ?? '');
  const type = String(formData.get('type') ?? '');
  const rawNext = String(formData.get('next') ?? '/app');

  if (!tokenHash || !isConfirmOtpType(type)) {
    redirect('/auth/login');
  }

  let next = '/app';
  try {
    next = await resolveAppRedirectPath(rawNext);
  } catch {
    // keep /app — an ambiguous / off-origin target is never an open redirect
  }

  const supabase = await createClient();
  // `type` is narrowed to ConfirmOtpType by isConfirmOtpType above — no cast.
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    // Expired / used / invalid link. /auth/login would tell the visitor nothing —
    // they would have no way to learn the link had simply aged out. `type`
    // travels so the page can offer the RIGHT recovery; it came from the link
    // the visitor already held, so it discloses nothing about them, and the page
    // itself stays enumeration-safe.
    redirect(`/auth/confirm/expired?type=${encodeURIComponent(type)}`);
  }

  // A proved address is what the marketing list waits for (openspec change marketing-email-consent, design D5): queue
  // the customer's contact sync. A signup confirmation may resubscribe — the grant was the customer's choice on the
  // form that created this address; an email change may not. Never blocks the redirect.
  if ((type === 'signup' || type === 'email_change') && data.user && (await isMarketingConsentEnabled())) {
    try {
      await enqueueMarketingContactSync({ userId: data.user.id, ...(type === 'signup' ? { resubscribe: true } : {}) });
    } catch (err) {
      console.error('[confirm] marketing contact sync was not queued', {
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  redirect(next);
}
