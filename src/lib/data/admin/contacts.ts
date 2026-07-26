import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import type { Database } from '@/lib/supabase/types';
import type { CallbackStatus } from '@/lib/validation/admin';
import { resolvePage, type PageParams, type PageResult } from './shared';

// Admin: contact-form + in-app support submissions (the single inquiry entity).
// Access is authorized by the request-scoped session under the `cm_admin_all`
// RLS policy (has_role admin). We additionally gate with
// requirePlatformPermission() server-side so a non-admin never reaches the query.

type ContactMessageRow = Database['public']['Tables']['contact_messages']['Row'];

// DTO: exactly the columns the admin list needs. The select string IS the
// contract — rows are returned pass-through. `status`/`topic`/`user_id`/
// `handled_at` drive the workflow + source badge; `draft_reply` surfaces the
// support-drafter's proposed reply (draft only — never auto-sent).
export type ContactMessage = Pick<
  ContactMessageRow,
  | 'id'
  | 'name'
  | 'email'
  | 'phone'
  | 'message'
  | 'created_at'
  | 'status'
  | 'topic'
  | 'user_id'
  | 'handled_at'
  | 'draft_reply'
>;

export const CONTACT_COLUMNS =
  'id, name, email, phone, message, created_at, status, topic, user_id, handled_at, draft_reply';

// List contact messages, newest first, with exact total for pagination.
export async function listContactMessages(
  { page }: PageParams = {},
): Promise<PageResult<ContactMessage>> {
  await requirePlatformPermission('view_customer_data');

  const { page: safePage, pageSize, from, to } = resolvePage(page);

  const supabase = createAdminClient();
  const { data, error, count } = await supabase
    .from('contact_messages')
    .select(CONTACT_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    throw new Error('טעינת הפניות נכשלה');
  }

  return {
    items: data ?? [],
    total: count ?? 0,
    page: safePage,
    pageSize,
  };
}

// Update a single contact message's status. Same closed vocabulary as
// callbacks (validated by the caller's Server Action). handled_at is
// deterministic from the status: terminal (done/cancelled) → stamped now,
// non-terminal → cleared.
export async function updateContactStatus(
  id: string,
  status: CallbackStatus,
): Promise<void> {
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
  const { data: current, error: currentError } = await supabase
    .from('contact_messages')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  if (currentError) {
    throw new Error('עדכון הסטטוס נכשל');
  }

  const terminal = status === 'done' || status === 'cancelled';
  const { error } = await supabase
    .from('contact_messages')
    .update({ status, handled_at: terminal ? new Date().toISOString() : null })
    .eq('id', id);

  if (error) {
    throw new Error('עדכון הסטטוס נכשל');
  }

  await logActivity({
    action: 'contact.status_updated',
    meta: {
      contactMessageId: id,
      previousStatus: current?.status ?? null,
      status,
    },
  });
}
