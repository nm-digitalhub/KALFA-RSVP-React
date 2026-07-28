import { requireUser, isAdmin, getOrgContext } from '@/lib/auth/dal';
import { can } from '@/lib/permissions';
import { getProfile } from '@/lib/data/profiles';
import { AppShell } from '@/components/app-shell';
import { GaFlagListener } from '@/components/consent/ga-flag-listener';
import { GoogleAnalyticsGated } from '@/components/consent/google-analytics-gated';
import { getCookieConsentPublicConfig } from '@/lib/consent/admin-config';

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
  // The /app/team route re-checks members.manage independently.
  const orgCtx = await getOrgContext();
  const showTeam = orgCtx.activeOrgId
    ? await can(orgCtx.activeOrgId, 'members', 'manage')
    : false;

  // Full name for the account menu; the shell falls back to email when empty.
  const profile = await getProfile();
  const userName = profile?.full_name?.trim() || undefined;

  // Deduped against the same call in the root layout via React `cache()`
  // (src/lib/consent/admin-config.ts) — not a second DB round trip.
  const cookieConsentAdminConfig = await getCookieConsentPublicConfig();

  return (
    <AppShell
      userEmail={user.email}
      userName={userName}
      isAdmin={admin}
      orgs={orgCtx.orgs.map((o) => ({ id: o.id, name: o.name }))}
      activeOrgId={orgCtx.activeOrgId}
      showTeam={showTeam}
    >
      {children}
      <GoogleAnalyticsGated mechanismEnabled={cookieConsentAdminConfig.enabled} />
      <GaFlagListener />
    </AppShell>
  );
}
