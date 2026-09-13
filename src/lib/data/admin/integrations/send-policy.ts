import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import {
  DEFAULT_SEND_POLICY,
  parseSendPolicy,
  type SendPolicy,
} from '@/lib/outreach/send-policy';
import { createClient } from '@/lib/supabase/server';
import type { TablesUpdate } from '@/lib/supabase/types';

// Read/write for app_settings.whatsapp_send_policy — the send-timing policy every
// campaign send is scheduled against. Closes gap G9: the column was populated and
// load-bearing, and the only way to change it was SQL. The owner's standing rule
// is that a switch living in the database without an admin control is not done.
//
// THE CEILINGS ARE NOT REDEFINED HERE. parseSendPolicy owns them (09:00 floor,
// 20:30 weekday / 12:00 Friday ceiling, 21:00 hard cap, Saturday null, motzash
// ≥60min) and this module calls it on the way IN as well as on the way out. An
// admin may narrow the window; opening night or Shabbat sends stays a code change.
//
// Gated on manage_settings — the same key as the credentials form next to it. It
// uses the cookie client, so admin-only RLS on app_settings applies on top of the
// app gate rather than being bypassed by a service-role key.

const SETTINGS_ID = true;

export type AdminSendPolicy = {
  /** What the sender actually uses right now — never a value the worker rejects. */
  policy: SendPolicy;
  /**
   * Where `policy` came from. The third state is the one that has no other way to
   * be seen: a row value IS stored but does not survive parseSendPolicy, so the
   * runtime reader silently falls back to the default. Before this screen that was
   * invisible — the panel would show a policy nothing was obeying. "Could not
   * read" and "is not being used" are different problems with different fixes.
   */
  source: 'stored' | 'default' | 'invalid';
  /** Present only when source === 'invalid'. Safe to render; never a secret. */
  invalidReason: string | null;
};

export async function getSendPolicyForAdmin(): Promise<AdminSendPolicy> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select('whatsapp_send_policy')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error) throw new Error('טעינת מדיניות השליחה נכשלה');

  const raw = data?.whatsapp_send_policy ?? null;
  if (raw == null) {
    return { policy: DEFAULT_SEND_POLICY, source: 'default', invalidReason: null };
  }
  try {
    return { policy: parseSendPolicy(raw), source: 'stored', invalidReason: null };
  } catch (err) {
    return {
      policy: DEFAULT_SEND_POLICY,
      source: 'invalid',
      invalidReason: err instanceof Error ? err.message : 'ערך לא תקין',
    };
  }
}

/**
 * Persist a policy. Takes an already-typed SendPolicy and validates it AGAIN:
 * a Server Action is not the only caller a data-layer module can ever have, and
 * the ceilings must hold at the boundary that writes, not only at the one that
 * parsed a form.
 */
export async function updateSendPolicy(policy: SendPolicy): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const validated = parseSendPolicy(policy);

  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    // jsonb column, typed `Json` by the generated types. The policy is a plain
    // object of strings/numbers/null with no cycles, so it is structurally a Json
    // value; TypeScript cannot see that through the inferred object type, and the
    // narrowing goes through `unknown` only. Documented per the project's rule on
    // casts — nothing here weakens a runtime check, parseSendPolicy ran above.
    .update({
      whatsapp_send_policy: validated as unknown as TablesUpdate<'app_settings'>['whatsapp_send_policy'],
    })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('שמירת מדיניות השליחה נכשלה');

  // Audit what CHANGED in shape, never guest data. The window itself is business
  // configuration and is safe to record; it is also the thing someone will want to
  // reconstruct after a campaign goes out at an unexpected hour.
  await logActivity({
    action: 'admin.send_policy.updated',
    meta: {
      weekday: validated.weekday.map((w) => (w ? `${w.start}-${w.end}` : null)),
      hardCap: validated.hardCap,
      motzashPlusMin: validated.motzashPlusMin,
      spreadSpanMs: validated.spreadSpanMs,
      preferred: validated.preferredTimeByDaysBefore,
      defaultPreferred: validated.defaultPreferred,
    },
  });
}
