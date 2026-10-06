import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

// Admin writes for the voice-purpose registry.
//
// ⚠️ COOKIE CLIENT, NOT THE SERVICE ROLE. `voice_purposes` carries RLS
// (`voice_purposes_admin_all`), and going through the caller's session means the
// policy is a second, independent check rather than something bypassed by every
// write. The permission gate below is the first. Same discipline as
// `admin/channel-catalog.ts`.
//
// ⚠️ AND `manage_voice`, NOT `manage_settings`. A row here decides which agent
// telephones a guest; it belongs with the other dialling controls, not with
// general configuration.

export type VoicePurposeAdminRow = {
  key: string;
  displayName: string;
  description: string | null;
  ruleId: string | null;
  enabled: boolean;
  isBuiltin: boolean;
  active: boolean;
  sortOrder: number;
};

const COLUMNS =
  'key, display_name, description, rule_id, enabled, is_builtin, active, sort_order';

export async function listVoicePurposesForAdmin(): Promise<VoicePurposeAdminRow[]> {
  await requirePlatformPermission('manage_voice');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('voice_purposes')
    .select(COLUMNS)
    .order('sort_order', { ascending: true });

  if (error) throw new Error('טעינת ייעודי השיחה נכשלה');
  return (data ?? []).map((r) => ({
    key: r.key,
    displayName: r.display_name,
    description: r.description,
    ruleId: r.rule_id,
    enabled: r.enabled,
    isBuiltin: r.is_builtin,
    active: r.active,
    sortOrder: r.sort_order,
  }));
}

export type CreateVoicePurposeInput = {
  key: string;
  displayName: string;
  description: string;
  ruleId: string;
};

/**
 * Declare a new voice purpose.
 *
 * ⚠️ IT IS CREATED SWITCHED OFF, ALWAYS, and the form does not offer otherwise.
 * A row carries a Voximplant rule id, and the moment it is enabled a workflow
 * step can start telephoning guests with it. Creating and arming in one submit
 * would make a typo in the rule id a live call to a real person; separating them
 * means somebody looks at the row once more before it can dial.
 */
export async function createVoicePurpose(input: CreateVoicePurposeInput): Promise<void> {
  await requirePlatformPermission('manage_voice');
  const supabase = await createClient();

  const { error } = await supabase.from('voice_purposes').insert({
    key: input.key,
    display_name: input.displayName,
    description: input.description || null,
    rule_id: input.ruleId || null,
    enabled: false,
    is_builtin: false,
  });

  if (error) {
    // 23505 = the primary key. A duplicate key is an ordinary mistake, not a
    // failure worth a stack trace.
    if (error.code === '23505') throw new Error('כבר קיים ייעוד עם המזהה הזה');
    if (error.code === '23514') throw new Error('המזהה חייב להיות באנגלית קטנה, ספרות וקו תחתון');
    throw new Error('יצירת הייעוד נכשלה');
  }
}

export type UpdateVoicePurposeInput = {
  key: string;
  displayName: string;
  description: string;
  ruleId: string;
  enabled: boolean;
  active: boolean;
};

/**
 * Edit a purpose.
 *
 * ⚠️ A BUILT-IN ROW IS DESCRIPTION ONLY. RSVP, meeting-confirm and sales dial
 * through their own dispatchers and read their rule ids from `app_settings`;
 * editing those fields here would change a label while the owner believed they
 * had changed a rule. `key` is immutable for every row — it is what a saved
 * workflow step stores.
 */
export async function updateVoicePurpose(input: UpdateVoicePurposeInput): Promise<void> {
  await requirePlatformPermission('manage_voice');
  const supabase = await createClient();

  const { data: existing, error: readErr } = await supabase
    .from('voice_purposes')
    .select('is_builtin')
    .eq('key', input.key)
    .maybeSingle();
  if (readErr || !existing) throw new Error('הייעוד לא נמצא');

  const patch = existing.is_builtin
    ? { display_name: input.displayName, description: input.description || null }
    : {
        display_name: input.displayName,
        description: input.description || null,
        rule_id: input.ruleId || null,
        enabled: input.enabled,
        active: input.active,
      };

  const { error } = await supabase.from('voice_purposes').update(patch).eq('key', input.key);
  if (error) throw new Error('עדכון הייעוד נכשל');
}
