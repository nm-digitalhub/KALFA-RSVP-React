import { requireAdmin } from '@/lib/auth/dal';
import { getProfile } from '@/lib/data/profiles';
import { AdminShell } from '@/components/admin-shell';

// Admin area layout. requireAdmin() enforces authentication AND the admin role
// server-side on every request (redirecting non-admins). This is the
// authorization boundary for the entire /admin subtree; the nav link in the
// customer shell is a convenience only.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();
  // Full name for the account menu (profile row is created at signup by the
  // handle_new_user trigger); falls back to the email in the shell when empty.
  const profile = await getProfile();
  const userName = profile?.full_name?.trim() || undefined;

  return (
    <AdminShell
      userEmail={user.email}
      userName={userName}
      jobsDashboardUrl={process.env.PGBOSS_DASHBOARD_URL}
    >
      {children}
    </AdminShell>
  );
}
