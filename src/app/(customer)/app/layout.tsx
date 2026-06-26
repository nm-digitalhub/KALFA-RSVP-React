import { requireUser, isAdmin } from '@/lib/auth/dal';
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

  return (
    <AppShell userEmail={user.email} isAdmin={admin}>
      {children}
    </AppShell>
  );
}
