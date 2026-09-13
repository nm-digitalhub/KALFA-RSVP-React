import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import type { Tables } from '@/lib/supabase/types';
// Admin management surface for message_templates (/admin/templates). The
// request-free outreach template READERS (getTemplateByKey / resolveTemplateForEvent)
// live in @/lib/data/message-templates-resolve so the pg-boss worker can import
// them WITHOUT dragging this file's requireAdmin + request-scoped createClient
// (→ next/headers|navigation) into the worker bundle. message_templates is
// admin-only RLS; these wrappers gate on requireAdmin() before touching data.

type MessageTemplateRow = Tables<'message_templates'>;

// --- Admin management (/admin/templates) -----------------------------------

export type MessageTemplate = Pick<
  MessageTemplateRow,
  | 'id'
  | 'message_key'
  | 'channel'
  | 'label'
  | 'name'
  | 'language'
  | 'body'
  | 'active'
  | 'category'
  | 'requested_category'
  | 'quality_score'
  | 'meta_status'
  | 'rejected_reason'
  | 'pending_category_change_at'
  | 'pending_correct_category'
  | 'last_synced_at'
>;

const TEMPLATE_COLUMNS =
  'id, message_key, channel, label, name, language, body, active, category, requested_category, quality_score, meta_status, rejected_reason, pending_category_change_at, pending_correct_category, last_synced_at';

export async function listMessageTemplates(): Promise<MessageTemplate[]> {
  // `manage_settings`, not `requireAdmin()`. These are the message bodies sent to
// guests; editing one changes what every future campaign says.
  await requirePlatformPermission('manage_settings');
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
  await requirePlatformPermission('manage_settings');
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

/**
 * Accept Meta's category for a template that drifted from what we asked for.
 *
 * Closes D4. `isCategoryDowngraded` compares `requested_category` with the
 * `category` Meta reports, and the nightly sync raises a Slack alert on every
 * TRANSITION into a mismatched state. Three templates (gift, thankyou,
 * sales_signup_link) have been sitting mismatched since before that alert
 * existed: each asked for UTILITY and Meta classifies them MARKETING. There was
 * no way to say "we know, and we accept it" — so the red badge on the templates
 * page had become furniture, which is how the FOURTH one would go unnoticed.
 *
 * ACKNOWLEDGING IS NOT FIXING. Meta classifies by message BODY; nothing here
 * changes that, and the template goes on being billed as MARKETING and carrying
 * the marketing delivery limits. What it changes is the RECORD: `requested_category`
 * becomes what we actually expect, so the badge clears, the alert stops, and a
 * LATER move by Meta is a new transition that alerts again.
 *
 * Pinned to the category that was on screen. `.eq('category', observed)` means a
 * sync landing between the read and the click cannot cause a different value to be
 * accepted silently — no row matches, and the caller is told to look again.
 */
export async function acknowledgeTemplateCategory(
  id: string,
  observedCategory: string,
): Promise<{ ok: true; from: string; to: string } | { ok: false; reason: string }> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();

  const { data: row, error: readError } = await supabase
    .from('message_templates')
    .select('id, message_key, category, requested_category')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw new Error('טעינת התבנית נכשלה');
  if (!row) return { ok: false, reason: 'התבנית לא נמצאה' };
  if (!row.category) return { ok: false, reason: 'התבנית טרם סונכרנה מול Meta' };
  if (row.category === row.requested_category) {
    return { ok: false, reason: 'אין פער קטגוריה לאשר' };
  }
  if (row.category !== observedCategory) {
    return {
      ok: false,
      reason: 'הקטגוריה השתנתה מאז שהעמוד נטען. רעננו ובדקו שוב לפני האישור.',
    };
  }

  const { data: updated, error } = await supabase
    .from('message_templates')
    .update({ requested_category: row.category })
    .eq('id', id)
    .eq('category', observedCategory)
    .select('id');
  if (error) throw new Error('אישור הקטגוריה נכשל');
  if (!updated || updated.length === 0) {
    return {
      ok: false,
      reason: 'הקטגוריה השתנתה מאז שהעמוד נטען. רעננו ובדקו שוב לפני האישור.',
    };
  }

  await logActivity({
    action: 'admin.templates.category_acknowledged',
    meta: {
      message_key: row.message_key,
      from: row.requested_category,
      to: row.category,
    },
  });
  return { ok: true, from: row.requested_category, to: row.category };
}
