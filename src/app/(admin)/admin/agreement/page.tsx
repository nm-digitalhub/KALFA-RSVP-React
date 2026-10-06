import Link from 'next/link';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getCompanyLegal } from '@/lib/data/company';
import { getAgreementForAdmin } from '@/lib/data/admin/agreements';
import {
  getAgreementConfigTokens,
  getAgreementConfigForAdmin,
} from '@/lib/data/agreement-config';
import {
  AGREEMENT_CSS,
  AGREEMENT_MODELS,
  renderAgreementBody,
  tokensForModel,
  type AgreementContent,
  type AgreementModel,
} from '@/lib/agreements/template';

import { PageHeading, Badge } from '../_components';
import { AgreementEditor } from './agreement-client';
import { AgreementConfigForm } from './agreement-config-form';

export const metadata = { title: 'חוזה' };

const MODEL_LABELS: Record<AgreementModel, string> = {
  per_result: 'חיוב לפי תוצאה',
  package: 'חבילה במחיר קבוע',
};

function parseModel(value: string | string[] | undefined): AgreementModel {
  const one = Array.isArray(value) ? value[0] : value;
  return AGREEMENT_MODELS.find((m) => m === one) ?? 'per_result';
}

// Admin: manage + edit the campaign agreements (contracts) — one per pricing model. Approve removes the
// draft marker; editing returns it to draft. The preview uses sample event data
// but reflects the saved version/status/body.
export default async function AdminAgreementPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string | string[] }>;
}) {
  await requirePlatformPermission('manage_settings');
  const model = parseModel((await searchParams).model);
  const [doc, company, configTokens, configValues] = await Promise.all([
    getAgreementForAdmin(model),
    getCompanyLegal(),
    getAgreementConfigTokens(),
    getAgreementConfigForAdmin(),
  ]);

  // Sample figures for the preview: the package contract quotes only the package; the pay-per-result one only its own.
  const sample: Pick<
    AgreementContent,
    'pricePerReached' | 'maxContacts' | 'ceiling' | 'baseFee' | 'includedReached' | 'packagePrice' | 'contactQuota'
  > =
    model === 'package'
      ? { pricePerReached: 0, maxContacts: 0, ceiling: 0, baseFee: 0, includedReached: 0, packagePrice: 150, contactQuota: 100 }
      : { pricePerReached: 4, maxContacts: 100, ceiling: 400, baseFee: 200, includedReached: 200 };

  // A package document has no in-code text: with an empty body there is nothing to preview.
  const previewHtml =
    model === 'package' && (doc.bodyHtml ?? '').trim() === ''
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
            ...sample,
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
          {model === 'per_result' ? (
            doc.bodyHtml != null ? <Badge>נוסח מותאם</Badge> : <Badge>תבנית ברירת מחדל</Badge>
          ) : null}
        </div>
      </div>

      <nav aria-label="מודל תמחור" className="flex gap-1 border-b border-border">
        {AGREEMENT_MODELS.map((m) => (
          <Link
            key={m}
            href={m === 'per_result' ? '/admin/agreement' : `/admin/agreement?model=${m}`}
            aria-current={m === model ? 'page' : undefined}
            className={
              m === model
                ? 'border-b-2 border-primary px-3 py-2 text-sm font-semibold'
                : 'px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {MODEL_LABELS[m]}
          </Link>
        ))}
      </nav>

      <AgreementEditor
        key={model}
        model={model}
        version={doc.version}
        bodyHtml={doc.bodyHtml}
        status={doc.status}
        tokens={tokensForModel(model, Object.keys(configTokens))}
      />

      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="text-lg font-semibold">פרמטרים של ההסכם</h2>
          <p className="text-sm text-muted-foreground">
            ערכים אלה משובצים בהסכם שהלקוח חותם עליו (חלונות הפעלה וגבייה, תוקף
            הצעה, תקרת אחריות ושמירת מידע). כל עדכון משתקף בהסכמים חדשים באופן
            מיידי. מומלץ שעו״ד יאשר את הנוסח לפני הפעלה מסחרית.
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
