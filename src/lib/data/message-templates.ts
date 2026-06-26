import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';

// Resolve a campaign outreach_schedule `message_key` to the Meta-approved
// WhatsApp template (name + language). Admin-managed (message_templates is
// admin-only RLS). Only ACTIVE templates resolve; unknown/inactive → null.

export type ResolvedTemplate = { name: string; language: string; channel: string };

export async function getTemplateByKey(
  messageKey: string,
): Promise<ResolvedTemplate | null> {
  // message_templates is created by a pending migration and is not in the
  // generated Database types yet. Cast to the un-generic client to query it. This
  // path is only reached behind getOutreachEnabled() (false until the migration
  // is applied), so it never runs against a missing table at runtime.
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin
    .from('message_templates')
    .select('name, language, channel')
    .eq('message_key', messageKey)
    .eq('active', true)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  if (
    typeof row.name !== 'string' ||
    typeof row.language !== 'string' ||
    typeof row.channel !== 'string'
  ) {
    return null;
  }
  return { name: row.name, language: row.language, channel: row.channel };
}
