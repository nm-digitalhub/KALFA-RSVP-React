import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import type { Database } from '@/lib/supabase/types';

// Admin management surface for message_templates (/admin/templates). The
// request-free outreach template READERS (getTemplateByKey / resolveTemplateForEvent)
// live in @/lib/data/message-templates-resolve so the pg-boss worker can import
// them WITHOUT dragging this file's requireAdmin + request-scoped createClient
// (→ next/headers|navigation) into the worker bundle. message_templates is
// admin-only RLS; these wrappers gate on requireAdmin() before touching data.

type MessageTemplateRow = Database['public']['Tables']['message_templates']['Row'];

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
