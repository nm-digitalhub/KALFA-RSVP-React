import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import type { Database } from '@/lib/supabase/types';
import { resolvePage, type PageParams, type PageResult } from './shared';

// Admin: contact-form submissions. Access is authorized by the request-scoped
// session under the `cm_admin_all` RLS policy (has_role admin). We additionally
// gate with requireAdmin() server-side so a non-admin never reaches the query.

type ContactMessageRow = Database['public']['Tables']['contact_messages']['Row'];

// DTO: exactly the columns the admin list needs. The select string IS the
// contract — rows are returned pass-through.
export type ContactMessage = Pick<
  ContactMessageRow,
  'id' | 'name' | 'email' | 'phone' | 'message' | 'created_at'
>;

export const CONTACT_COLUMNS = 'id, name, email, phone, message, created_at';

// List contact messages, newest first, with exact total for pagination.
export async function listContactMessages(
  { page }: PageParams = {},
): Promise<PageResult<ContactMessage>> {
  await requirePlatformPermission('view_customer_data');

  const { page: safePage, pageSize, from, to } = resolvePage(page);

  const supabase = await createClient();
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
