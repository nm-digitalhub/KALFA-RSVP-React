import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { resolvePage, type PageParams, type PageResult } from './shared';

// Read side of the staff data-access audit (support_access_log). Overseeing which
// staff member viewed which customer's data is an owner function — the table's RLS
// is is_platform_owner() and this reader is gated on manage_staff (owner-only in
// the role matrix). Reads via service_role like every admin reader; the gate is
// the authorization. Shows metadata only (the trail never stored the PII itself).

const HEBREW_SUBJECT: Record<string, string> = {
  event: 'אירוע',
  user: 'משתמש',
  guest_list: 'רשימת אורחים',
  call_attempts: 'שיחות',
  campaign: 'קמפיין',
};

export interface StaffAccessEntry {
  id: string;
  accessedAt: string;
  staffName: string;
  permission: string | null;
  subjectType: string | null;
  subjectLabel: string;
  ownerName: string;
  reason: string | null;
}

export async function listStaffAccessLog(
  { page }: PageParams = {},
): Promise<PageResult<StaffAccessEntry>> {
  await requirePlatformPermission('manage_staff');
  const { page: safePage, pageSize, from, to } = resolvePage(page);

  const admin = createAdminClient();
  const { data, error, count } = await admin
    .from('support_access_log')
    .select(
      'id, staff_id, owner_id, permission, subject_type, subject_id, reason, accessed_at',
      { count: 'exact' },
    )
    .order('accessed_at', { ascending: false })
    .range(from, to);
  if (error) {
    throw new Error('טעינת יומן הגישה נכשלה');
  }

  const rows = data ?? [];
  // Resolve staff + owner display names in one round-trip each (page-scoped ids).
  const ids = Array.from(
    new Set(
      rows.flatMap((r) => [r.staff_id, r.owner_id].filter((v): v is string => !!v)),
    ),
  );
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs } = await admin
      .from('profiles')
      .select('id, full_name')
      .in('id', ids);
    for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (p.full_name) names.set(p.id, p.full_name);
    }
  }

  const items: StaffAccessEntry[] = rows.map((r) => ({
    id: r.id,
    accessedAt: r.accessed_at,
    staffName: names.get(r.staff_id) ?? `#${r.staff_id.slice(0, 8)}`,
    permission: r.permission,
    subjectType: r.subject_type,
    subjectLabel: r.subject_type ? (HEBREW_SUBJECT[r.subject_type] ?? r.subject_type) : '—',
    ownerName: r.owner_id
      ? (names.get(r.owner_id) ?? `#${r.owner_id.slice(0, 8)}`)
      : '—',
    reason: r.reason,
  }));

  return { items, total: count ?? 0, page: safePage, pageSize };
}
