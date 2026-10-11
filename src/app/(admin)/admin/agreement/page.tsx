import { requirePlatformPermission } from '@/lib/auth/dal';
import { getCompanyLegal } from '@/lib/data/company';
import { getAgreementForAdmin } from '@/lib/data/admin/agreements';
import {
  getAgreementConfigTokens,
  getAgreementConfigForAdmin,
} from '@/lib/data/agreement-config';
import { AGREEMENT_CSS, agreementTokens, renderAgreementBody } from '@/lib/agreements/template';

import { PageHeading, Badge } from '../_components';
import { AgreementEditor } from './agreement-client';
import { AgreementConfigForm } from './agreement-config-form';

export const metadata = { title: 'חוזה' };

// Admin: manage + edit the package contract. Approve removes the draft marker; editing returns it to draft. The
// preview uses sample event data but reflects the saved version/status/body.
export default async function AdminAgreementPage() {
  await requirePlatformPermission('manage_settings');
  const [doc, company, configTokens, configValues] = await Promise.all([
    getAgreementForAdmin(),
    getCompanyLegal(),
    getAgreementConfigTokens(),
    getAgreementConfigForAdmin(),
  ]);

  // The contract has no in-code text: with an empty body there is nothing to preview.
  const previewHtml =
    (doc.bodyHtml ?? '').trim() === ''
      ? null
      : renderAgreementBody(
          {
            company: {
              name: company.name,
              id: company.id,
              address: company.address,
              contactPhone: company.contactPhone,
              contactEmail: company.contactEmail,
              privacyUrl: company.privacyUrl,
              termsUrl: company.termsUrl,
              warrantyText: company.warrantyText,
            },
            eventName: 'אירוע לדוגמה',
            channels: ['whatsapp', 'call'],
            windowText: '01/07/2026 – 15/07/2026',
            packagePrice: 150,
            contactQuota: 100,
          },
          { version: doc.version, status: doc.status, bodyHtml: doc.bodyHtml },
          configTokens,
        );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>חוזה</PageHeading>
        <div className="flex items-center gap-2">
          <Badge>{doc.status === 'approved' ? 'מאושר' : 'טיוטה'}</Badge>
          <Badge>גרסה {doc.version}</Badge>
        </div>
      </div>

      <AgreementEditor
        version={doc.version}
        bodyHtml={doc.bodyHtml}
        status={doc.status}
        tokens={agreementTokens(Object.keys(configTokens))}
      />

      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="text-lg font-semibold">פרמטרים של ההסכם</h2>
          <p className="text-sm text-muted-foreground">
            ערכים אלה משובצים בתנאים שהלקוח מאשר (חלון הפעלה, תוקף הצעה, תקרת
            אחריות ושמירת מידע). כל עדכון משתקף באישורים חדשים באופן מיידי. מומלץ שעו״ד יאשר את הנוסח לפני הפעלה מסחרית.
          </p>
        </div>
        <AgreementConfigForm values={configValues} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">תצוגה מקדימה</h2>
        <p className="text-sm text-muted-foreground">
          נתוני דוגמה (אירוע/מחיר/תאריכים); הסטטוס, הגרסה והנוסח משקפים את המסמך השמור.
        </p>
        {previewHtml === null ? (
          <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            עדיין אין נוסח לחוזה החבילה — כתבו אותו למעלה ושמרו כדי לראות תצוגה מקדימה.
          </p>
        ) : (
          <div className="rounded-lg border border-border bg-white p-6">
            <style dangerouslySetInnerHTML={{ __html: AGREEMENT_CSS }} />
            <div
              className="agreement-doc"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        )}
      </section>
    </div>
  );
}
