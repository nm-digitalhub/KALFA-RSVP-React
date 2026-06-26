import 'server-only';

import { createHash, randomInt } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import { getSmsSender } from '@/lib/sms/sender';
import { normalizePhone } from '@/lib/phone';

// OTP identity verification (used at agreement signing). The code itself is
// never stored — only sha256(code:phone). Short-lived (5 min), attempt-limited,
// and rate-limited per phone+purpose. All server-managed via the service-role
// client. Never log the code.

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_VERIFY_ATTEMPTS = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_MAX = 5; // codes per phone+purpose per window

function hashCode(code: string, phone: string): string {
  return createHash('sha256').update(`${code}:${phone}`).digest('hex');
}

export type OtpResult = { ok: boolean; error?: string };

// Generate + SMS a one-time code. Returns { ok:false, error } for user-facing
// failures (invalid phone, rate limit, SMS not configured) so the caller can
// surface a message without leaking internals.
export async function requestOtp(
  rawPhone: string,
  purpose: string,
): Promise<OtpResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: 'מספר טלפון לא תקין' };

  const admin = createAdminClient();

  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count, error: countErr } = await admin
    .from('otp_challenges')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('purpose', purpose)
    .gte('created_at', since);
  if (countErr) return { ok: false, error: 'יצירת קוד האימות נכשלה' };
  if ((count ?? 0) >= RATE_MAX) {
    return { ok: false, error: 'נשלחו יותר מדי קודים. נסו שוב מאוחר יותר.' };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const { error: insErr } = await admin.from('otp_challenges').insert({
    phone,
    purpose,
    code_hash: hashCode(code, phone),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (insErr) return { ok: false, error: 'יצירת קוד האימות נכשלה' };

  try {
    const sender = await getSmsSender();
    await sender.send({ to: phone, text: `קוד האימות שלך ל-KALFA: ${code}` });
  } catch (err) {
    // Surface a generic message to the user, but LOG the provider reason so a
    // real failure (bad token, unapproved sender, no balance, gateway down) is
    // diagnosable from server logs. Never log the code or the full phone number.
    console.error(
      `[otp] SMS send failed (purpose=${purpose}): ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    );
    return { ok: false, error: 'שליחת קוד האימות נכשלה' };
  }
  return { ok: true };
}

// Verify a submitted code against the latest unconsumed challenge. Consumes the
// challenge on success; increments attempts on failure. Returns true only on a
// fresh, in-window, attempt-allowed, matching code.
export async function verifyOtp(
  rawPhone: string,
  purpose: string,
  code: string,
): Promise<boolean> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return false;

  const admin = createAdminClient();
  const { data: challenge, error } = await admin
    .from('otp_challenges')
    .select('id, code_hash, expires_at, attempts, consumed_at')
    .eq('phone', phone)
    .eq('purpose', purpose)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !challenge) return false;
  if (new Date(challenge.expires_at).getTime() < Date.now()) return false;
  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) return false;

  if (challenge.code_hash !== hashCode(code, phone)) {
    await admin
      .from('otp_challenges')
      .update({ attempts: challenge.attempts + 1 })
      .eq('id', challenge.id);
    return false;
  }

  await admin
    .from('otp_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', challenge.id);
  return true;
}
