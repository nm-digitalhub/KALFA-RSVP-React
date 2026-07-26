import 'server-only';

import { createClient } from '@/lib/supabase/server';

// Admin-managed catalog of outreach channels (public.channels — Stage 1 of
// plans/channels-data-driven-plan.md). This is the source of truth for the
// package form's channel LIST + display labels + order, replacing the old
// hardcoded ['whatsapp','call'] + CHANNEL_LABELS literals.
//
// `key` MIRRORS the campaign_channel enum labels; the enum + validation remain
// the storable-value guard, so the form field type is a plain `string` here
// (catalog-driven) and the server (z.enum in validation/admin.ts) narrows it on
// submit. A catalog key outside the enum therefore renders but fails save — the
// documented Stage-1 limit (a genuinely new channel needs its own migration +
// code stack, not just a catalog row).
//
// Read via the cookie/session client: RLS policy channels_auth_read (using true)
// lets any signed-in admin surface read this non-sensitive display metadata
// without coupling to a specific platform permission or app_role.

export type ChannelCatalogEntry = {
  key: string;
  display_name: string;
  is_built: boolean;
};

export async function getChannelCatalog(): Promise<ChannelCatalogEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('channels')
    .select('key, display_name, is_built')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error('טעינת קטלוג הערוצים נכשלה');
  return (data ?? []).map((row) => ({
    key: row.key,
    display_name: row.display_name,
    is_built: row.is_built,
  }));
}
