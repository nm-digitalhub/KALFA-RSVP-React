import { requireAdmin } from '@/lib/auth/dal';
import { getSumitPublicConfig } from '@/lib/data/payments';

import { SumitTestForm } from './sumit-test-form';

// Admin-only SUMIT POC. Verifies live REST behavior (J5/AuthorizeAmount/token)
// against an admin-chosen parameter set before we build the production flow.
export default async function SumitTestPage() {
  await requireAdmin();
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
        <>
          <SumitTestForm
            companyId={config.companyId}
            apiPublicKey={config.apiPublicKey}
          />

          {/* J4 on a saved token (route B close): no card tokenization needed —
              just the reusable CreditCard_Token from a prior J5. A plain form. */}
          <form
            action="/api/admin/sumit-test"
            method="post"
            className="max-w-xl space-y-4 rounded-lg border border-dashed border-border p-4"
          >
            <div>
              <h2 className="font-semibold">חיוב טוקן שמור (J4 — מסלול B)</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                הדביקו <code>CreditCard_Token</code> שהתקבל מ-J5 כדי לחייב אותו
                כעסקה חדשה (יוצר חשבונית). ⚠️ <strong>גבייה אמיתית.</strong>
              </p>
            </div>
            <div>
              <label htmlFor="saved_token" className="mb-1 block text-sm font-medium">
                CreditCard_Token
              </label>
              <input
                id="saved_token"
                name="saved_token"
                type="text"
                required
                dir="ltr"
                placeholder="beb90f6f-…"
                className="w-full rounded-md border border-border bg-transparent px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="amount2" className="mb-1 block text-sm font-medium">
                  סכום (₪)
                </label>
                <input
                  id="amount2"
                  name="amount"
                  type="text"
                  inputMode="decimal"
                  defaultValue="1"
                  dir="ltr"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2"
                />
              </div>
              <div>
                <label htmlFor="vat_rate2" className="mb-1 block text-sm font-medium">
                  VATRate
                </label>
                <input
                  id="vat_rate2"
                  name="vat_rate"
                  type="text"
                  inputMode="decimal"
                  defaultValue="18"
                  dir="ltr"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2"
                />
              </div>
              <div>
                <label htmlFor="auto_capture2" className="mb-1 block text-sm font-medium">
                  סוג
                </label>
                <select
                  id="auto_capture2"
                  name="auto_capture"
                  defaultValue="true"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2"
                >
                  <option value="true">J4 — חיוב</option>
                  <option value="false">J5 — אישור</option>
                </select>
              </div>
            </div>
            {/* No prevent_document_creation → J4 creates the invoice document. */}
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              חייב טוקן שמור
            </button>
          </form>
        </>
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
