import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Shared by the Meta status card and Embedded Signup (FB.init + code exchange),
// so the two can never disagree about which app they are talking to.

/**
 * The Meta app id. Not a secret (it is public in every OAuth URL), but it is
 * the one input `debug_token` needs that we do not already hold in
 * app_settings.
 *
 * Read from app_settings FIRST and from the environment only as a fallback.
 * The column does not exist yet — §4.4 of the consolidation plan adds
 * `whatsapp_app_id` in Phase 5 — so today this always resolves from env. The
 * order is written this way now, rather than after the migration, so landing
 * that column is a migration and nothing else: `select('*')` simply omits a
 * column that is not there, which is the same forward-compatible pattern
 * getWhatsAppConfig documents.
 */
export async function resolveMetaAppId(): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    const fromRow = (data as Record<string, unknown> | null)?.whatsapp_app_id;
    if (typeof fromRow === 'string' && fromRow.trim() !== '') return fromRow.trim();
  } catch {
    // Fall through to env — a settings read failure must not be reported as
    // "no app id configured".
  }
  const fromEnv = process.env.META_APP_ID_WA?.trim();
  return fromEnv ? fromEnv : null;
}
