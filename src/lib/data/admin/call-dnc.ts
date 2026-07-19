import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { normalizePhone } from '@/lib/phone';

// Admin: Do-Not-Call list for the Voximplant AI-call channel. A phone on this
// list is skipped by the dispatcher's DNC gate (isDncListed,
// outreach-engine.ts) which matches on the SAME canonical form. The list is
// governed by the admin-only RLS policy `call_dnc_list_admin_all` (has_role
// admin), so writes go through the cookie-based server client (not
// service-role). The stored key MUST be the normalizePhone() E.164 form so the
// runtime gate finds it. Columns: normalized_phone (PK) / reason / added_by /
// created_at (added_by + created_at default at the DB — never client-supplied).

export type AddToCallDncInput = { phone: string; reason?: string };

export type AddToCallDncResult = { ok: true } | { ok: false; error: string };

export async function addToCallDnc({
  phone,
  reason,
}: AddToCallDncInput): Promise<AddToCallDncResult> {
  // requireAdmin returns the authenticated admin — recorded as `added_by` for
  // auditability (who blocked this number), per CLAUDE.md's admin-action audit
  // requirement. On re-add of an existing number the upsert refreshes added_by.
  const admin = await requirePlatformPermission('manage_voice');

  // normalizePhone returns the E.164 form or null for an unparseable/invalid
  // number — guard the null so we never write a non-canonical key the runtime
  // gate (which normalizes too) could never match.
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { ok: false, error: 'מספר טלפון לא תקין' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('call_dnc_list').upsert(
    { normalized_phone: normalized, reason: reason?.trim() || null, added_by: admin.id },
    { onConflict: 'normalized_phone' },
  );
  if (error) {
    return { ok: false, error: 'הוספה לרשימת ה-DNC נכשלה' };
  }
  return { ok: true };
}

export type CallDncEntry = {
  normalized_phone: string;
  reason: string | null;
  created_at: string;
};

// Read-only list for the admin surface (newest first, capped). requireAdmin +
// the admin-only RLS policy both gate the read.
export async function listCallDnc(): Promise<CallDncEntry[]> {
  await requirePlatformPermission('manage_voice');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('call_dnc_list')
    .select('normalized_phone, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    throw new Error('טעינת רשימת החסימה נכשלה');
  }
  return (data ?? []) as CallDncEntry[];
}
