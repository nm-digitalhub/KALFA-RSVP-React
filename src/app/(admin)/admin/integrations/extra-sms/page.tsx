import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getExtraSmsConfig } from '@/lib/data/admin/settings';
import { getAuthKey, type ExtraKeyHealth } from '@/lib/sms/extra-client';

import { PageHeading } from '../../_components';
import { ExtraKeyStatus } from './extra-key-status';
import { ExtraSmsForm } from './extra-sms-form';
import { ExtraTestSms } from './extra-test-sms';

export const metadata: Metadata = { title: 'ExtrA SMS — אינטגרציות' };

const VERIFIED_IDS_URL = 'https://www.exm.co.il/my/verified-ids/';
const sectionClass = 'space-y-3';

// Everything about the SMS channel in one place: credentials, the switch, what the
// channel is actually used for, the key's remaining life, and a test send.
//
// ⚠️ ONE LIVE CALL PER RENDER, AND THAT IS A DELIBERATE EXCEPTION. The status card
// asks ExtrA GET /auth/key/ on every page load. That is the same shape of thing this
// branch refused to do for /admin/integrations/voximplant — but the situations differ
// in the way that matters: getVoicePlatformView() made THREE calls on a page that is
// RSC-prefetched from the sidebar of every other admin page, while this page is
// reached only by clicking its card and makes one ~0.7s call. The alternative is
// showing an expiry date read from nothing, since the daily queue's result is not
// persisted anywhere. A failure here degrades the card and never blocks the page.
//
export default async function ExtraSmsPage() {
  await requirePlatformPermission('manage_settings');

  const config = await getExtraSmsConfig();

  // The probe needs the token, and the config read above already has it. Skipping the
  // call when nothing is stored keeps a fresh install from showing "cannot reach
  // ExtrA" when the truth is "you have not entered a key yet".
  const health: ExtraKeyHealth | null = config.extra_sms_token
    ? await getAuthKey(config.extra_sms_token)
    : null;

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
        <PageHeading>ExtrA SMS</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          ערוץ ה-SMS של המערכת. אינו חלק ממתג הפנייה הראשי — הוא משרת הודעות שירות,
          לא פניות שיווקיות לאורחים.
        </p>
      </div>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">מצב המפתח</h2>
        {health ? (
          <ExtraKeyStatus health={health} />
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            לא הוזן מפתח API — אין מה לבדוק עדיין.
          </div>
        )}
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">פרטי חיבור</h2>
        <ExtraSmsForm
          values={{
            sms_enabled: config.sms_enabled,
            extra_sms_sender: config.extra_sms_sender,
            extra_sms_token: config.extra_sms_token,
          }}
        />
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">למה משמש ה-SMS</h2>
        <p className="text-sm text-muted-foreground">
          ארבעה מקורות בלבד, כולם הודעות שירות ליוזם הפעולה. הרשימה כתובה בקוד ולא
          נגזרת אוטומטית — אם נוסף מקור חמישי, מקומו כאן.
        </p>
        <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
          <li>קוד חד-פעמי להתחברות (OTP)</li>
          <li>הודעה על ביטול אירוע</li>
          <li>תיאום מועד לשיחה חוזרת</li>
          <li>קישור הרשמה שנשלח בתהליך מכירה</li>
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">בדיקה</h2>
        <ExtraTestSms />
        <p className="text-sm text-muted-foreground">
          זהות השולח וה-verified IDs מנוהלים בפורטל ExtrA בלבד — אין להם API, ולכן אין
          כאן כפתור להוספה או לאימות.{' '}
          <a
            href={VERIFIED_IDS_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            ניהול verified IDs בפורטל
          </a>
        </p>
      </section>
    </div>
  );
}
