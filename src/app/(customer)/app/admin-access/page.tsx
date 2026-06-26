import Link from 'next/link';

import { isAdmin } from '@/lib/auth/dal';
import { ClaimAdminForm } from './claim-admin-form';

// Admin bootstrap page. If the current user is already an admin, point them to
// the admin area. Otherwise offer to claim the FIRST-admin role — the
// claim_first_admin() RPC enforces that this only succeeds when no admin yet
// exists, so exposing the button to everyone is safe (the server refuses
// subsequent claims).
export default async function AdminAccessPage() {
  const already = await isAdmin();

  return (
    <div className="mx-auto max-w-md space-y-6 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">גישת ניהול</h1>
        <p className="text-muted-foreground">
          אזור הניהול מיועד למנהלי המערכת בלבד.
        </p>
      </div>

      {already ? (
        <div className="space-y-3">
          <p>יש לך גישת ניהול.</p>
          <Link
            href="/admin"
            className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            מעבר לאזור הניהול
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            אם עדיין לא הוגדר מנהל במערכת, ניתן לתבוע את גישת המנהל הראשונה.
          </p>
          <ClaimAdminForm />
        </div>
      )}
    </div>
  );
}
