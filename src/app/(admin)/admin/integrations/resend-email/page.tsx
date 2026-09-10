import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getEmailTransportConfig } from '@/lib/data/admin/settings';
import { probeEmailHealth } from '@/lib/email/run-health-check';
import { selectedEmailProvider } from '@/lib/email/sender';
import type { EmailHealth } from '@/lib/email/health';

import { Badge, PageHeading } from '../../_components';
import { EmailHealthCard } from './email-health-card';
import { EmailTransportForm } from './email-transport-form';

export const metadata: Metadata = { title: 'דואר יוצא — אינטגרציות' };

const sectionClass = 'space-y-3';

// Outgoing business mail: the signed agreement and the invoices. Two transports behind
// one env switch, credentials for both, and the verdict the hourly check produces.
//
// ⚠️ WHICH TRANSPORT IS LIVE IS AN ENV DECISION, NOT A DATABASE ONE, and the page says
// so out loud. EMAIL_PROVIDER lives in .env.local precisely so a rollback needs neither
// a deploy nor a reachable database (sender.ts). That means the panel cannot change it
// — and a page that let someone try would be lying about where the control is.
//
// One live probe per render, same exception and same reasoning as the ExtrA page: a
// single ~0.7s call on a page reached by clicking its card, versus printing a
// deliverability verdict read from nothing, since the daily queue's result is not
// persisted. probeEmailHealth() is the scheduled job's own probe with the ALERTING
// left out — one definition of "is the mail working", so the page and Slack cannot
// disagree, and a page render never fires an alert.

export default async function ResendEmailPage() {
  await requirePlatformPermission('manage_settings');

  const config = await getEmailTransportConfig();
  const provider = selectedEmailProvider();

  // Never blocks the page: the form below is what someone uses to FIX a dead transport.
  let health: EmailHealth | null = null;
  try {
    health = await probeEmailHealth();
  } catch {
    health = null;
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
        <PageHeading>דואר יוצא</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          הדואר העסקי — ההסכם החתום והחשבוניות. אינו כולל את מיילי ההתחברות ואיפוס
          הסיסמה, שנשלחים ע&quot;י Supabase מהגדרות SMTP נפרדות משלה.
        </p>
      </div>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">הטרנספורט הפעיל</h2>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-4">
          <Badge variant={provider === 'resend' ? 'success' : 'neutral'}>
            {provider === 'resend' ? 'Resend API' : 'SMTP'}
          </Badge>
          <span className="text-sm text-muted-foreground">
            נקבע ע&quot;י <code dir="ltr">EMAIL_PROVIDER</code> בקובץ הסביבה של השרת —
            לא מהפאנל. זה מכוון: מעבר חזרה ל-SMTP חייב לעבוד גם כשהמסד אינו זמין.
          </span>
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">מצב הדואר</h2>
        <EmailHealthCard health={health} />
        <p className="text-xs text-muted-foreground">
          אותה בדיקה רצה מתוזמנת כל שעה ומופיעה בכרטיס באינטגרציות. היא אינה שולחת
          הודעה — ב-Resend זו קריאת קריאה בלבד לרשם הדומיינים, וב-SMTP חיבור והזדהות
          בלבד.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">פרטי חיבור</h2>
        <EmailTransportForm
          values={{
            email_enabled: config.email_enabled,
            smtp_host: config.smtp_host,
            smtp_port: config.smtp_port,
            smtp_secure: config.smtp_secure,
            smtp_user: config.smtp_user,
            smtp_password: config.smtp_password,
            smtp_from: config.smtp_from,
          }}
          activeProvider={provider}
        />
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">מסלול שני, שאינו מנוהל כאן</h2>
        <p className="text-sm text-muted-foreground">
          מיילי ההתחברות, אימות ההרשמה ואיפוס הסיסמה נשלחים ע&quot;י Supabase Auth
          מהגדרות SMTP משלה, מאותה כתובת שולח. <code dir="ltr">EMAIL_PROVIDER</code>{' '}
          אינו משפיע עליהם, והם אינם נבדקים כאן — מה שקל לפספס בדיוק משום ששתי הדרכים
          נראות זהות לנמען.
        </p>
      </section>
    </div>
  );
}
