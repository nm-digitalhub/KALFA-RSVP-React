import { requirePlatformPermission } from '@/lib/auth/dal';
import { getSumitPublicConfig } from '@/lib/data/payments';

import { SumitTestForm } from './sumit-test-form';

// Admin-only SUMIT POC. Verifies live REST behavior (J5/AuthorizeAmount/token)
// against an admin-chosen parameter set before we build the production flow.
export default async function SumitTestPage() {
  await requirePlatformPermission('manage_billing');
  const config = await getSumitPublicConfig();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">בדיקת SUMIT (POC)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          כלי אבחון: טוקניזציה של כרטיס ושליחת charge עם פרמטרים נבחרים, להצגת
          התגובה הגולמית מ-SUMIT (DocumentID, AuthNumber, טוקן שמור, וכו׳).
        </p>
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠️ הקריאה פוגעת ב-SUMIT <strong>החי</strong> — השתמשו בסכום קטן (₪1).
          J5 (אישור בלבד) לא גובה בפועל; J4 גובה מיד.
        </p>
      </div>

      {config ? (
        // The route-B (saved-token J4) form lives inside SumitTestForm itself —
        // a second, genuinely separate <form> with no data-og="form" so
        // payments.js never touches it (verified against its live source).
        // It collects the mandatory expiry + CitizenID that route.ts now
        // requires; an earlier, separate copy of this form lived here and was
        // removed for being redundant AND broken (missing those fields, so it
        // always failed the new mandatory-field check).
        <SumitTestForm
          companyId={config.companyId}
          apiPublicKey={config.apiPublicKey}
        />
      ) : (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          הגדרות SUMIT (company id / public key) חסרות. עדכנו ב-
          <a href="/admin/settings" className="underline">
            /admin/settings
          </a>
          .
        </p>
      )}
    </div>
  );
}
