import Link from 'next/link';
import { notFound } from 'next/navigation';

import { isPlatformOwner, requirePlatformPermission } from '@/lib/auth/dal';
import { getUserDetail } from '@/lib/data/admin/users';
import {
  getUserStaffRoleId,
  listPlatformRoles,
} from '@/lib/data/admin/platform-roles';

import { PageHeading } from '../../_components';
import { UserDetailView } from './user-detail-view';
import { UserDetailGate } from './user-detail-gate';

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePlatformPermission('manage_staff');

  // Staff-role management is owner-only. Fetch the role catalog + this user's
  // current staff role only when the viewer is a platform owner; otherwise the
  // selector is hidden entirely. These are staff-role reads (not customer PII),
  // so they sit OUTSIDE the break-glass reason gate.
  const owner = await isPlatformOwner();
  const platformStaff = owner
    ? {
        roles: (await listPlatformRoles()).map((r) => ({ id: r.id, label: r.label })),
        currentRoleId: await getUserStaffRoleId(id),
      }
    : null;

  const isSelf = id === actor.id;

  // Self-view is not a cross-customer break-glass access: render the detail
  // directly (getUserDetail skips the audit when subjectId === staffId).
  // For any OTHER user, render the reason gate — the PII is fetched and audited
  // only after a break-glass reason (≥10 chars) is supplied.
  const selfUser = isSelf ? await getUserDetail(id) : null;
  if (isSelf && !selfUser) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <PageHeading>
          {isSelf ? selfUser?.fullName || selfUser?.email || 'החשבון שלי' : 'פרטי משתמש'}
        </PageHeading>
        <Link
          href="/admin/users"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          חזרה לרשימה
        </Link>
      </div>

      {isSelf && selfUser ? (
        <UserDetailView user={selfUser} actorId={actor.id} platformStaff={platformStaff} />
      ) : (
        <UserDetailGate id={id} actorId={actor.id} platformStaff={platformStaff} />
      )}
    </div>
  );
}
