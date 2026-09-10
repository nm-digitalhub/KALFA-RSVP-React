import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getSumitCredentials } from '@/lib/data/admin/settings';
import { checkSumitHealth, type SumitHealth } from '@/lib/sumit/health';

import { PageHeading } from '../../_components';
import { SumitCredentialsForm } from './sumit-credentials-form';
import { SumitStatusCard } from './sumit-status-card';

export const metadata: Metadata = { title: 'SUMIT — אינטגרציות' };

const sectionClass = 'space-y-3';

// The payment connection: three credentials, whether they currently resolve, and where
// everything else about billing lives.
//
// ⚠️ THE MONEY SWITCHES ARE NOT HERE, DELIBERATELY. payments_enabled,
// close_charge_enabled, campaign_holds_enabled and billing_exposure_gate stay in
// /admin/settings (plan D8). "Can we reach the payment provider" and "should we charge
// anyone" are different questions, and putting them on one page invites answering the
// second while meaning the first.
//
// One live call per render, the same exception as the ExtrA and mail pages — and the
// cheapest of the three: measured at 0.10s, because getdetails takes nothing but the
// credentials. A failure degrades the card and never blocks the form beneath it.

export default async function SumitPage() {
  await requirePlatformPermission('manage_settings');

  const config = await getSumitCredentials();

  // Skipped entirely when nothing is stored: a fresh install must read "not set up",
  // never "SUMIT rejected you".
  let health: SumitHealth | null = null;
  if (config.sumit_company_id && config.sumit_api_key) {
    try {
      health = await checkSumitHealth({
        companyId: config.sumit_company_id,
        apiKey: config.sumit_api_key,
      });
    } catch {
      health = null;
    }
  }

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
        <PageHeading>SUMIT / OfficeGuy</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          ספק הסליקה והחשבוניות. הפרטים כאן מפעילים את חיוב סגירת הקמפיין, את תפיסת
          המסגרת ואת הזיכויים — שלושתם דרך אותו צמד הרשאה.
        </p>
      </div>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">מצב החיבור</h2>
        <SumitStatusCard health={health} />
        <p className="text-xs text-muted-foreground">
          בדיקה קריאה-בלבד: פנייה אחת ל-<code dir="ltr">website/companies/getdetails/</code>{' '}
          שמקבלת רק את הפרטים ומחזירה את פרטי החברה שלנו. לא נוצר מסמך, לא מבוצע חיוב,
          ולא נקרא מידע של אף לקוח. אותה בדיקה רצה מתוזמנת פעם ביום.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">פרטי חיבור</h2>
        <SumitCredentialsForm
          values={{
            sumit_company_id: config.sumit_company_id,
            sumit_api_public_key: config.sumit_api_public_key,
            sumit_api_key: config.sumit_api_key,
          }}
        />
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">מה שאינו כאן</h2>
        <p className="text-sm text-muted-foreground">
          מתגי הכסף — הפעלת סליקה, חיוב בסגירת קמפיין, תפיסת מסגרת ומודל החיוב —
          נשארים בהגדרות המערכת. &quot;האם ניתן להגיע לספק&quot; ו&quot;האם לחייב
          מישהו&quot; הן שתי שאלות נפרדות.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/admin/settings"
            className="inline-flex min-h-11 items-center text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            מעבר להגדרות › תשלומים
          </Link>
          <Link
            href="/admin/sumit-test"
            className="inline-flex min-h-11 items-center text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            כלי בדיקת סליקה
          </Link>
        </div>
      </section>
    </div>
  );
}
