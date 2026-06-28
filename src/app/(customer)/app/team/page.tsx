import { requireUser, requireActiveOrg } from '@/lib/auth/dal';
import { can, requirePermission } from '@/lib/permissions';
import { listMembers, listInvitations, listRoles } from '@/lib/data/orgs';

import { TeamClient } from './team-client';

export const metadata = { title: 'ניהול משתמשים' };

// User Management Area. Server-loads the org's members, pending invitations and
// the role catalog, plus the caller's manage permission. Read access is gated
// by members.view (every role has it); all mutations re-verify members.manage
// server-side in the actions/data layer.
export default async function TeamPage() {
  const user = await requireUser();
  const { orgId } = await requireActiveOrg();
  await requirePermission(orgId, 'members', 'view');

  const [members, invitations, roles, canManage] = await Promise.all([
    listMembers(orgId),
    listInvitations(orgId),
    listRoles(),
    can(orgId, 'members', 'manage'),
  ]);

  return (
    <TeamClient
      members={members}
      invitations={invitations}
      roles={roles}
      canManage={canManage}
      currentUserId={user.id}
    />
  );
}
