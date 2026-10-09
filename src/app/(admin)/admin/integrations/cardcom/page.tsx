import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { readCardcomAdminConfig } from '@/lib/data/admin/integrations/cardcom-config';
import { getAppUrl } from '@/lib/url';

import { PageHeading } from '../../_components';
import { CardcomConfigForm } from './cardcom-config-form';
import { CardcomStatusCard } from './cardcom-status-card';

export const metadata: Metadata = { title: 'CardCom — אינטגרציות' };

const sectionClass = 'space-y-3';

// The CardCom connection (the pilot, docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md): what is saved, whether the
// pilot switch is on, and the form. SUMIT stays the active provider until the switch is turned on, and `payments_enabled`
// and the package-model switch stay in /admin/settings — "can we reach the provider" and "should we charge anyone" are
// different questions, and putting them on one page invites answering the second while meaning the first.
//
// The password is never read into this page: the status carries only "is one stored".
export default async function CardcomPage() {
  await requirePlatformPermission('integrations.manage');

  const config = await readCardcomAdminConfig();
  // The address CardCom posts each issued document to (its "כתובת URL לדיווח" field).
  const documentReportUrl = await getAppUrl('/api/cardcom/document-webhook');

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/integrations"
          className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronRight className="size-4" aria-hidden />
          חזרה לאינטגרציות
        </Link>
        <PageHeading>CardCom</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          ספק סליקה חלופי בבחינה: רכישת חבילה והחזר. כל עוד המתג כבוי, ספק הסליקה הקיים ממשיך לטפל בכל הרכישות.
        </p>
      </div>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">מצב</h2>
        <CardcomStatusCard config={config} />
        <p className="text-xs text-muted-foreground">
          אין כאן בדיקת חיבור: לא נבנתה פנייה קריאה-בלבד ל-CardCom. הבדיקה היחידה היא רכישה והחזר אמיתיים של ₪1.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">פרטי חיבור</h2>
        <CardcomConfigForm
          values={{
            terminal_number: config.terminalNumber === null ? '' : String(config.terminalNumber),
            api_name: config.apiName ?? '',
            enabled: config.enabled,
            has_password: config.hasPassword,
            has_document_report_secret: config.hasDocumentReportSecret,
            document_report_url: documentReportUrl,
          }}
        />
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">מה שאינו כאן</h2>
        <p className="text-sm text-muted-foreground">
          מתגי הכסף — הפעלת סליקה ומודל החבילה — נשארים בהגדרות המערכת.
        </p>
        <Link
          href="/admin/settings"
          className="inline-flex min-h-11 items-center text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          מעבר להגדרות › תשלומים
        </Link>
      </section>
    </div>
  );
}
