import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { normalizePhone } from '@/lib/phone';
import { rateLimit } from '@/lib/security/rate-limit';
import { checkRegistry, type RegistryCheck } from '@/lib/dnc/registry-check';

// Admin: Do-Not-Call — the local list, a check against the national registry, and the registry connection's state
// (/admin/dnc; openspec/changes/dnc-registry-dial-gate D9). Every function gates on manage_voice first.
//
// The local list (call_dnc_list) is the people who asked KALFA itself never to be called. A phone on it is skipped by
// every dial gate (isDncListed, outreach-engine.ts), matching on the SAME canonical form, so the stored key MUST be the
// normalizePhone() E.164 form. Its RLS needs manage_voice for each operation this module performs (select, insert,
// update; `call_dnc_list_<op>_permission`, staff-tables-permission-rls), so it is read and written through the
// cookie-based server client and the policy is a second check. Columns: normalized_phone (PK) / reason / added_by /
// created_at (added_by + created_at default at the DB — never client-supplied).
//
// The decision record (dnc_registry_checks) is server-only — no grant to authenticated — so it is read with the
// service-role client, after the permission check.

export type AddToCallDncInput = { phone: string; reason?: string };

export type AddToCallDncResult = { ok: true } | { ok: false; error: string };

export async function addToCallDnc({
  phone,
  reason,
}: AddToCallDncInput): Promise<AddToCallDncResult> {
  // requirePlatformPermission returns the authenticated admin — recorded as `added_by` for
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

export const CALL_DNC_PAGE_SIZE = 50;

/**
 * One page of the local list, newest first. `query` matches the phone in any written form: digits are compared with
 * the stored E.164 key, so "050-1234567", "0501234567" and "501234567" all find "+972501234567".
 */
export async function listCallDnc({
  page = 1,
  query,
}: { page?: number; query?: string } = {}): Promise<{
  entries: CallDncEntry[];
  total: number;
  page: number;
  pageSize: number;
}> {
  await requirePlatformPermission('manage_voice');
  const supabase = await createClient();
  let q = supabase
    .from('call_dnc_list')
    .select('normalized_phone, reason, created_at', { count: 'exact' })
    .order('created_at', { ascending: false });
  const digits = (query ?? '').replace(/\D/g, '').replace(/^0+/, '').replace(/^972/, '');
  if (digits) q = q.ilike('normalized_phone', `%${digits}%`);
  const from = (page - 1) * CALL_DNC_PAGE_SIZE;
  const { data, error, count } = await q.range(from, from + CALL_DNC_PAGE_SIZE - 1);
  if (error) {
    throw new Error('טעינת רשימת החסימה נכשלה');
  }
  return { entries: (data ?? []) as CallDncEntry[], total: count ?? 0, page, pageSize: CALL_DNC_PAGE_SIZE };
}

// A staff check is one registry request each; bounded so the screen cannot be used to sweep the registry.
const STAFF_CHECK_RATE = { limit: 20, windowMs: 10 * 60 * 1000 };

export type StaffRegistryCheckResult =
  | { ok: true; check: RegistryCheck }
  | { ok: false; error: string };

/**
 * Checks one number against the local list and the national registry, for staff. Never dials. The check is recorded in
 * dnc_registry_checks (purpose 'admin_check') so the connection status reflects it and the lookup is auditable.
 */
export async function checkNumberAsStaff(phone: string): Promise<StaffRegistryCheckResult> {
  const staff = await requirePlatformPermission('manage_voice');
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, error: 'מספר טלפון לא תקין' };

  if (!(await rateLimit(`dnc-staff-check:${staff.id}`, STAFF_CHECK_RATE)).allowed) {
    return { ok: false, error: 'יותר מדי בדיקות בזמן קצר. נסו שוב בעוד מספר דקות.' };
  }

  const check = await checkRegistry(normalized);
  const admin = createAdminClient();
  await admin.from('dnc_registry_checks').insert({
    phone_e164: normalized,
    checked_at: check.checkedAt,
    result: check.result,
    source: check.source,
    transaction_id: check.transactionId,
    error_code: check.errorCode,
    failure: check.failure,
    purpose: 'admin_check',
    dial_path: 'admin_dnc_screen',
  });
  return { ok: true, check };
}

export type RegistryConnectionStatus = {
  /** Whether DNC_API_NAME and DNC_API_TOKEN are set on the server. Never their values. */
  credentialsConfigured: boolean;
  /** call_compliance_settings.dnc_registry_gate_enabled. */
  gateEnabled: boolean;
  lastSuccess: { at: string; result: string } | null;
  lastError: { at: string; failure: string | null; errorCode: number | null } | null;
};

export async function getRegistryConnectionStatus(): Promise<RegistryConnectionStatus> {
  await requirePlatformPermission('manage_voice');
  const supabase = await createClient();
  const { data: settings, error: settingsError } = await supabase
    .from('call_compliance_settings')
    .select('dnc_registry_gate_enabled')
    .eq('id', true)
    .maybeSingle();
  if (settingsError) throw new Error('טעינת מצב החיבור נכשלה');

  const admin = createAdminClient();
  const [success, failure] = await Promise.all([
    admin
      .from('dnc_registry_checks')
      .select('checked_at, result')
      .eq('source', 'national_registry')
      .in('result', ['registry_clear', 'registry_listed', 'registry_unchecked'])
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('dnc_registry_checks')
      .select('checked_at, failure, error_code')
      .eq('result', 'registry_unavailable')
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (success.error || failure.error) throw new Error('טעינת מצב החיבור נכשלה');

  return {
    credentialsConfigured: Boolean(process.env.DNC_API_NAME && process.env.DNC_API_TOKEN),
    gateEnabled: settings?.dnc_registry_gate_enabled === true,
    lastSuccess: success.data ? { at: success.data.checked_at, result: success.data.result } : null,
    lastError: failure.data
      ? { at: failure.data.checked_at, failure: failure.data.failure, errorCode: failure.data.error_code }
      : null,
  };
}

/** Turns the national-registry dial gate on or off (call_compliance_settings; its RLS needs manage_voice). */
export async function setRegistryGateEnabled(enabled: boolean): Promise<void> {
  await requirePlatformPermission('manage_voice');
  const supabase = await createClient();
  const { error } = await supabase
    .from('call_compliance_settings')
    .update({ dnc_registry_gate_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('id', true);
  if (error) throw new Error('עדכון מתג הבדיקה מול המאגר נכשל');
}
