import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import type { Database } from '@/lib/supabase/types';

// Resolve a campaign outreach_schedule `message_key` to the send-content the
// engine uses (WhatsApp: the Meta-approved template name + language; call: the
// script). Admin-managed (message_templates is admin-only RLS); the outreach
// reader uses the service-role client (RLS-bypassing). Only ACTIVE templates
// resolve — fail-closed, so a not-yet-configured key sends nothing.

type MessageTemplateRow = Database['public']['Tables']['message_templates']['Row'];

export type ResolvedTemplate = Pick<MessageTemplateRow, 'name' | 'language' | 'channel'>;

export async function getTemplateByKey(
  messageKey: string,
): Promise<ResolvedTemplate | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('message_templates')
    .select('name, language, channel')
    .eq('message_key', messageKey)
    .eq('active', true)
    .maybeSingle();
  if (error || !data) return null;
  if (!data.name || !data.language || !data.channel) return null;
  return { name: data.name, language: data.language, channel: data.channel };
}

// --- Admin management (/admin/templates) -----------------------------------

export type MessageTemplate = Pick<
  MessageTemplateRow,
  'id' | 'message_key' | 'channel' | 'label' | 'name' | 'language' | 'body' | 'active'
>;

const TEMPLATE_COLUMNS =
  'id, message_key, channel, label, name, language, body, active';

export async function listMessageTemplates(): Promise<MessageTemplate[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('message_templates')
    .select(TEMPLATE_COLUMNS)
    .order('channel', { ascending: true })
    .order('message_key', { ascending: true });
  if (error) throw new Error('טעינת התבניות נכשלה');
  return (data ?? []) as MessageTemplate[];
}

export type UpdateMessageTemplateInput = {
  name: string;
  language: string;
  body: string;
  active: boolean;
};

// Admin edits the send-content + activation for one key (message_key/channel are
// fixed — they are referenced by the outreach schedule). Empty body → null.
export async function updateMessageTemplate(
  id: string,
  input: UpdateMessageTemplateInput,
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('message_templates')
    .update({
      name: input.name,
      language: input.language,
      body: input.body || null,
      active: input.active,
    })
    .eq('id', id);
  if (error) throw new Error('עדכון התבנית נכשל');
}
