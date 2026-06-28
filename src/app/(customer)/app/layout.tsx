import { requireUser, isAdmin, getOrgContext } from '@/lib/auth/dal';
import { can } from '@/lib/permissions';
import { AppShell } from '@/components/app-shell';

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defense-in-depth redirect; the data layer also enforces this per request.
  const user = await requireUser();
  // Role check is server-side and memoized; used only to reveal the admin nav
  // link. The /admin layout still enforces authorization independently.
  const admin = await isAdmin();

  // Org context for the switcher + whether to reveal the user-management link.
  // The /app/team route re-checks members.view independently.
  const orgCtx = await getOrgContext();
  const showTeam = orgCtx.activeOrgId
    ? await can(orgCtx.activeOrgId, 'members', 'view')
    : false;

  return (
    <AppShell
      userEmail={user.email}
      isAdmin={admin}
      orgs={orgCtx.orgs.map((o) => ({ id: o.id, name: o.name }))}
      activeOrgId={orgCtx.activeOrgId}
      showTeam={showTeam}
    >
      {children}
    </AppShell>
  );
}
