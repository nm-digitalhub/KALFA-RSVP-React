import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import {
  assignRoleSchema,
  type NumberRole,
  type ProviderKey,
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
