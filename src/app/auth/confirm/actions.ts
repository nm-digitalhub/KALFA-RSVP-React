'use server';

import { redirect } from 'next/navigation';

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
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    // Expired / used / invalid link. It used to land on /auth/login, which told
    // the visitor nothing — they had no way to learn the link had simply aged
    // out, and (before the email_not_confirmed fix) logging in then answered
    // "wrong email or password" forever. `type` travels so the page can offer
    // the RIGHT recovery; it came from the link the visitor already held, so it
    // discloses nothing about them, and the page itself stays enumeration-safe.
    redirect(`/auth/confirm/expired?type=${encodeURIComponent(type)}`);
  }

  redirect(next);
}
