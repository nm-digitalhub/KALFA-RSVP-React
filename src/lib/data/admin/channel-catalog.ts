import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import type { Database } from '@/lib/supabase/types';

// Admin editor DAL for the outreach-channel catalog (public.channels — Stage 1 of
// plans/channels-data-driven-plan.md). Reads/writes the DISPLAY metadata only:
// label, built-flag, active (show/hide in the package form), and order. Gated by
// manage_settings (the same permission the rest of /admin/channels uses); the
// admin-only RLS policy (has_role admin) is the second layer.
//
// `key` is NOT editable here and there is no create/delete: the key mirrors the
// campaign_channel enum, so adding or removing a channel is a schema + code
// concern (enum migration + a full provider/dispatcher/billing stack), not a
// metadata edit. This DAL only lets an admin rename / reorder / show-hide the
// channels that already exist.

export type AdminChannel = {
  key: string;
  display_name: string;
  is_built: boolean;
  active: boolean;
  sort_order: number;
};

// ALL rows (including inactive) so the editor can re-activate a hidden channel.
export async function listAllChannels(): Promise<AdminChannel[]> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('channels')
    .select('key, display_name, is_built, active, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw new Error('טעינת קטלוג הערוצים נכשלה');
  return (data ?? []) as AdminChannel[];
}

export type UpdateChannelMetadataInput = {
  key: string;
  display_name: string;
  is_built: boolean;
  active: boolean;
  sort_order: number;
};

// Update one existing channel's metadata by key. Never writes `key` (immutable).
export async function updateChannelMetadata(
  input: UpdateChannelMetadataInput,
): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const patch: Database['public']['Tables']['channels']['Update'] = {
    display_name: input.display_name,
    is_built: input.is_built,
    active: input.active,
    sort_order: input.sort_order,
  };
  const { error } = await supabase
    .from('channels')
    .update(patch)
    .eq('key', input.key);
  if (error) throw new Error('עדכון הערוץ נכשל');
}
