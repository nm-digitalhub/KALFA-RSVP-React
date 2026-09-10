import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/supabase/types';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { getPhoneNumbers } from '@/lib/voximplant/core';
import { listWabaPhoneNumbers } from '@/lib/whatsapp/phone-numbers';
import {
  assignRoleSchema,
  upsertProviderNumberSchema,
  type NumberRole,
  type ProviderKey,
  type UpsertProviderNumberInput,
} from '@/lib/validation/provider-numbers';

// The admin side of the provider-numbers module: read every connected line, and
// wire a role to one of them.
//
// GATE. `manage_settings` for reads, because the list spans every provider and a
// reader holding only `manage_voice` would otherwise be REDIRECTED out of the admin
// area by requirePlatformPermission rather than shown a narrower list — the ejection
// bug fixed in Task 0.4. Writes that touch a single provider take their gate from
// that provider (see assignRole).
//
// Cookie client, not service-role: provider_numbers carries RLS gated on
// is_platform_staff(), and the whole point of that policy is that the caller stays
// the subject of the check. Service-role would bypass it and make the policy
// decorative.

export interface ProviderNumber {
  id: string;
  provider: ProviderKey;
  providerRef: string | null;
  e164: string | null;
  displayLabel: string | null;
  isActive: boolean;
  snapshot: Record<string, unknown> | null;
  snapshotAt: string | null;
  source: string;
  roles: NumberRole[];
}

// Roles are read through the embedded relationship rather than a second query, so a
// number and its roles cannot be observed a moment apart. The rows come back in
// insertion order, so they are sorted here — an unsorted chip list reorders itself
// between renders for no reason a reader can see.
export async function listProviderNumbers(): Promise<ProviderNumber[]> {
  await requirePlatformPermission('manage_settings');

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('provider_numbers')
    .select(
      'id, provider, provider_ref, e164, display_label, is_active, snapshot, snapshot_at, source, provider_number_roles(role)',
    )
    .order('provider', { ascending: true })
    .order('e164', { ascending: true, nullsFirst: false });

  if (error) {
    throw new Error('טעינת רשימת המספרים נכשלה');
  }

  return (data ?? []).map((row) => {
    const roleRows = (row.provider_number_roles ?? []) as Array<{ role: NumberRole }>;
    return {
      id: row.id,
      provider: row.provider,
      providerRef: row.provider_ref,
      e164: row.e164,
      displayLabel: row.display_label,
      isActive: row.is_active,
      snapshot: (row.snapshot as Record<string, unknown> | null) ?? null,
      snapshotAt: row.snapshot_at,
      source: row.source,
      roles: roleRows.map((r) => r.role).sort(),
    };
  });
}

// Which permission a role's assignment needs. Derived from what the role CONTROLS,
// not from who happens to hold what today: moving `voice_caller_id_rsvp` changes
// which number places calls, and that is voice configuration whoever is on staff.
// A role missing from this map is a compile error, not a silent fall-through to the
// weaker gate — the map is keyed by the generated enum.
const ROLE_PERMISSION: Record<NumberRole, 'manage_settings' | 'manage_voice'> = {
  whatsapp_rsvp_sender: 'manage_settings',
  whatsapp_import_sender: 'manage_settings',
  voice_caller_id_rsvp: 'manage_voice',
  voice_caller_id_meeting_confirm: 'manage_voice',
  voice_caller_id_sales: 'manage_voice',
  voice_caller_id_call_me_now: 'manage_voice',
  voice_inbound_did: 'manage_voice',
  sms_sender: 'manage_settings',
  company_contact: 'manage_settings',
  business_line_inbound: 'manage_settings',
};

/**
 * Apply the gate for one role.
 *
 * ⚠️ THE CALL SITES ARE WRITTEN OUT, NOT PASSED AS A VARIABLE, AND THAT IS THE
 * POINT. `admin-data-layer-coverage.test.ts` pins which permissions a module
 * enforces by reading `requirePlatformPermission('…')` as TEXT — it is a regression
 * guard, not a call-graph analysis. `requirePlatformPermission(ROLE_PERMISSION[r])`
 * gates correctly at runtime and is INVISIBLE to that check, so a later edit
 * flipping a voice role to the weaker key would ship green. Caught by that suite on
 * the first run of this file rather than in review.
 */
async function requireRolePermission(role: NumberRole): Promise<void> {
  if (ROLE_PERMISSION[role] === 'manage_voice') {
    await requirePlatformPermission('manage_voice');
    return;
  }
  await requirePlatformPermission('manage_settings');
}

// Which permission it takes to write a number, by the provider that owns the line.
// Same principle as ROLE_PERMISSION: the gate describes the RESOURCE. Adding or
// re-syncing a Voximplant line changes voice configuration; the others are settings.
const PROVIDER_PERMISSION: Record<ProviderKey, 'manage_settings' | 'manage_voice'> = {
  meta_whatsapp: 'manage_settings',
  voximplant: 'manage_voice',
  extra_sms: 'manage_settings',
  company: 'manage_settings',
};

// Literal call sites, for the reason spelled out on requireRolePermission.
async function requireProviderPermission(provider: ProviderKey): Promise<void> {
  if (PROVIDER_PERMISSION[provider] === 'manage_voice') {
    await requirePlatformPermission('manage_voice');
    return;
  }
  await requirePlatformPermission('manage_settings');
}

/**
 * Insert or update one number, returning its id.
 *
 * ⚠️ GOES THROUGH AN RPC, NOT `.upsert()`, AND NOT BY PREFERENCE. The unique index
 * this table needs is PARTIAL — `(provider, provider_ref) WHERE provider_ref IS NOT
 * NULL` — and Postgres only uses a partial index for ON CONFLICT when the statement
 * repeats the predicate, which PostgREST cannot send. Measured live: the plain form
 * returns 42P10. `upsert_provider_number` also owns the rule that a sync carrying a
 * provider_ref ADOPTS the ref-less backfill row for the same E.164 instead of
 * splitting one phone line into two rows and stranding its roles on the orphan.
 *
 * NULLS ARE OMITTED RATHER THAN SENT. The generated Args type declares the optional
 * parameters as `string` (not `string | null`), and the function reads a missing
 * argument as "leave what is stored" via coalesce. Sending an explicit null would
 * both fail tsc and, if forced through, mean the opposite of what the caller wants:
 * a sync that does not carry a label would blank the one an admin typed.
 */
export async function upsertProviderNumber(
  input: UpsertProviderNumberInput,
): Promise<string> {
  const parsed = upsertProviderNumberSchema.parse(input);
  await requireProviderPermission(parsed.provider);

  const args: {
    p_provider: ProviderKey;
    p_is_active: boolean;
    p_source: string;
    p_provider_ref?: string;
    p_e164?: string;
    p_display_label?: string;
    p_snapshot?: Json;
  } = {
    p_provider: parsed.provider,
    p_is_active: parsed.isActive,
    p_source: parsed.source,
  };
  if (parsed.providerRef !== null) args.p_provider_ref = parsed.providerRef;
  if (parsed.e164 !== null) args.p_e164 = parsed.e164;
  if (parsed.displayLabel !== null) args.p_display_label = parsed.displayLabel;
  if (parsed.snapshot !== null) args.p_snapshot = parsed.snapshot;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('upsert_provider_number', args);

  if (error) {
    // 23514 is the E.164 CHECK and 22023 the function's own "needs an identifier".
    // Both are the caller's input and both have a field to point at; anything else
    // is ours.
    if (error.code === '23514') throw new Error('מספר לא תקין — נדרש פורמט E.164');
    if (error.code === '22023') throw new Error('צריך לפחות מזהה אצל הספק או מספר');
    throw new Error('שמירת המספר נכשלה');
  }
  if (!data) throw new Error('שמירת המספר נכשלה');
  return data;
}

/**
 * Point a role at a number. Reassignment, not accumulation: provider_number_roles'
 * PRIMARY KEY is `role`, so one role is held by exactly one number and this is an
 * upsert on that key — there is no state in which two numbers both claim to be the
 * RSVP sender, and no cleanup step that could be forgotten.
 */
export async function assignRole(role: NumberRole, numberId: string): Promise<void> {
  const parsed = assignRoleSchema.parse({ role, numberId });
  await requireRolePermission(parsed.role);

  const supabase = await createClient();
  const { error } = await supabase
    .from('provider_number_roles')
    .upsert(
      { role: parsed.role, number_id: parsed.numberId, updated_at: new Date().toISOString() },
      { onConflict: 'role' },
    );

  if (error) {
    // 23503 = the number id does not exist. Worth naming separately: it is the one
    // failure here a caller can actually fix, and "שמירה נכשלה" would send an admin
    // to check permissions instead of the id they passed.
    if (error.code === '23503') {
      throw new Error('המספר שנבחר אינו קיים');
    }
    throw new Error('שיוך התפקיד נכשל');
  }
}

/**
 * Detach a role from whatever number holds it. The role stops resolving at runtime
 * and the caller falls back to its pre-table default — which is why this is a
 * delete of one row rather than a flag: an unassigned role and a role assigned to a
 * deactivated number are different situations and the panel shows them differently.
 */
export async function clearRole(role: NumberRole): Promise<void> {
  const parsed = assignRoleSchema.shape.role.parse(role);
  await requireRolePermission(parsed);

  const supabase = await createClient();
  const { error } = await supabase.from('provider_number_roles').delete().eq('role', parsed);
  if (error) throw new Error('ביטול שיוך התפקיד נכשל');
}

// ─── SYNC ─────────────────────────────────────────────────────────────────────
// Pull the numbers each provider believes it has, and write them into the table.
// Read-only against the provider: one GET each, nothing purchased, nothing bound,
// no message sent.

export interface SyncResult {
  /** How many numbers the provider reported. */
  count: number;
  /**
   * True when a provider answered, but with less than was asked for. Surfaced
   * rather than swallowed: "3 numbers, some columns blank" and "3 numbers" are
   * different facts, and only one of them explains an empty cell.
   */
  degraded: boolean;
}

/**
 * Sync from Meta. Every number on the WABA lands in the table — including ones with
 * no role, which is the point: the second number on this WABA has existed since
 * before the table did, and until an admin gives it `whatsapp_import_sender` it
 * shows as "ללא תפקיד" rather than being invisible.
 *
 * E.164 is derived from `display_phone_number`, which Meta returns formatted with
 * spaces ("+972 33 301505"). Stripping every non-digit and prefixing '+' is what
 * makes it match provider_numbers_e164_chk — and what lets the RPC recognise the
 * backfill row for the same line instead of inserting beside it.
 */
export async function syncMetaNumbers(): Promise<SyncResult> {
  await requirePlatformPermission('manage_settings');

  const cfg = await getWhatsAppConfig();
  if (!cfg?.wabaId || !cfg.accessToken) {
    throw new Error('חסרים פרטי חיבור ל-Meta (WABA ID או טוקן)');
  }

  const { numbers, degraded } = await listWabaPhoneNumbers({
    wabaId: cfg.wabaId,
    accessToken: cfg.accessToken,
  });

  for (const n of numbers) {
    const digits = (n.display_phone_number ?? '').replace(/\D/g, '');
    await upsertProviderNumber({
      provider: 'meta_whatsapp',
      providerRef: n.id,
      e164: digits ? `+${digits}` : null,
      // Meta's own display name, and only as a FALLBACK: the RPC coalesces, so a
      // label an admin typed survives every future sync.
      displayLabel: n.verified_name ?? null,
      snapshot: {
        verified_name: n.verified_name ?? null,
        status: n.status ?? null,
        quality_rating: n.quality_rating ?? null,
        code_verification_status: n.code_verification_status ?? null,
        name_status: n.name_status ?? null,
        messaging_limit_tier: n.messaging_limit_tier ?? null,
        throughput: n.throughput?.level ?? null,
        platform_type: n.platform_type ?? null,
        account_mode: n.account_mode ?? null,
        is_official_business_account: n.is_official_business_account ?? null,
      },
      source: 'sync',
    });
  }

  return { count: numbers.length, degraded };
}

/**
 * Sync from Voximplant. The backfill row for this provider carries no provider_ref
 * (app_settings stored a caller id, not a phone_id) and holds FIVE roles, so the
 * first run of this is exactly the adoption case the RPC exists for: same E.164,
 * ref filled in, roles intact. Verified in the migration's dry run.
 *
 * `deactivated` from the provider becomes `isActive`, so a number Voximplant has
 * turned off stops resolving at runtime without anyone editing the panel — and the
 * role assignment is KEPT, because it is still the admin's stated intent.
 */
export async function syncVoximplantNumbers(): Promise<SyncResult> {
  await requirePlatformPermission('manage_voice');

  const cfg = await getVoximplantConfig();
  if (!cfg) {
    throw new Error('חסרים פרטי חיבור ל-Voximplant');
  }

  const res = await getPhoneNumbers(cfg.auth);
  const numbers = res.result ?? [];

  for (const n of numbers) {
    const digits = String(n.phone_number ?? '').replace(/\D/g, '');
    await upsertProviderNumber({
      provider: 'voximplant',
      providerRef: String(n.phone_id),
      e164: digits ? `+${digits}` : null,
      displayLabel: n.phone_name ?? null,
      isActive: n.deactivated !== true,
      snapshot: {
        phone_name: n.phone_name ?? null,
        phone_country_code: n.phone_country_code ?? null,
        deactivated: n.deactivated ?? null,
        can_be_used: n.can_be_used ?? null,
        application_id: n.application_id ?? null,
        application_name: n.application_name ?? null,
        rule_id: n.rule_id ?? null,
        rule_name: n.rule_name ?? null,
      },
      source: 'sync',
    });
  }

  return { count: numbers.length, degraded: false };
}
