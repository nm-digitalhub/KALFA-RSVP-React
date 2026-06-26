import { requireAdmin } from '@/lib/auth/dal';
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

  return <AdminShell userEmail={user.email}>{children}</AdminShell>;
}
