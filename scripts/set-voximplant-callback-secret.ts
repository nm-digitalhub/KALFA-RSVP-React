// Generate a strong random Voximplant CALLBACK SECRET and store it in
// app_settings.voximplant_callback_secret. This secret is the HMAC key KALFA uses
// to sign (and verify) the per-call ctx/cb URL tokens — it is KALFA-INTERNAL: the
// VoxEngine scenario never needs it (it just calls back the signed URLs it is
// handed). 32 random bytes, base64url-encoded.
//
// SECURITY: the generated secret is NEVER printed (only its length + a
// configured boolean). Write via createAdminClient (service-role, session-less).
//
// Write-once by default (won't clobber an existing secret); pass --rotate to
// replace an existing one (invalidates any in-flight ctx/cb tokens — expected).
//
// Run: npm run set:voximplant-callback-secret   [-- --rotate]

import { randomBytes } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';

async function main(): Promise<void> {
  const rotate = process.argv.includes('--rotate');
  const admin = createAdminClient();

  const { data, error: readErr } = await admin
    .from('app_settings')
    .select('voximplant_callback_secret')
    .eq('id', true)
    .maybeSingle();
  if (readErr) throw new Error(`read failed: ${readErr.message}`);

  const existing = data?.voximplant_callback_secret ?? '';
  if (existing.length > 0 && !rotate) {
    console.log(
      '[callback-secret] already set — pass --rotate to replace. No change made.',
    );
    return;
  }

  // 32 bytes → 43 URL-safe chars. base64url avoids '+'/'/'/'=' so it is safe to
  // carry in a ?k= query param without escaping if ever used that way.
  const secret = randomBytes(32).toString('base64url');

  const { error } = await admin
    .from('app_settings')
    .update({ voximplant_callback_secret: secret })
    .eq('id', true);
  if (error) throw new Error(`write failed: ${error.message}`);

  // Verify presence WITHOUT reading the value back into a log.
  const { data: v, error: vErr } = await admin
    .from('app_settings')
    .select('voximplant_callback_secret')
    .eq('id', true)
    .maybeSingle();
  if (vErr) throw new Error(`verify failed: ${vErr.message}`);
  const callbackSecretSet = (v?.voximplant_callback_secret ?? '').length > 0;

  console.log('[callback-secret] done', {
    action: rotate && existing.length > 0 ? 'rotated' : 'set',
    length: secret.length, // length only — NEVER the value
    callbackSecretSet,
  });
  if (!callbackSecretSet) {
    throw new Error('post-write verification found the column empty');
  }
}

main().catch((e) => {
  console.error(
    '[callback-secret] failed:',
    e instanceof Error ? e.message : 'unknown error',
  );
  process.exit(1);
});
