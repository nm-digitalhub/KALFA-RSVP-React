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
    // Expired / used / invalid link — generic, privacy-safe landing.
    redirect('/auth/login');
  }

  redirect(next);
}
