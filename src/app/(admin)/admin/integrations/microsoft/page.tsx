import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { checkMicrosoftHealth, type MicrosoftHealth } from '@/lib/microsoft/health';

import { PageHeading } from '../../_components';
import { MicrosoftStatusCard } from './microsoft-status-card';

export const metadata: Metadata = { title: 'Microsoft 365 — אינטגרציות' };

const sectionClass = 'space-y-3';

// The Microsoft 365 app identity: the tenant it belongs to, the mailbox it reads, and
// the certificate everything depends on.
//
// ⚠️ THIS PAGE ASKS MICROSOFT, NOT exchange_connections. Both readers of that table
// are wrong for a status surface — one returns only the caller's own connections
// (a card that says "not configured" because YOU have no mailbox while a colleague
// has three), and the org-wide one is owner-gated and REDIRECTS, ejecting every
// non-owner from the admin area. The app authenticates as itself with a certificate,
// so Graph reports the tenant's state rather than one admin's slice of it.
//
// NOTHING IS EDITABLE HERE, AND THAT IS DELIBERATE. The identity lives in env vars
// (MS_GRAPH_TENANT_ID / CLIENT_ID / CERT_PATH) and in the Azure app registration —
// a certificate is not a field a form can hold, and pretending otherwise would put a
// save button in front of something the panel cannot change. Per-mailbox connections
// stay in /admin/settings, which is where an admin connects their own.
//
// One live call set per render, the same exception the ExtrA, mail and SUMIT pages
// take. A failure degrades the card and never blocks the page.

export default async function MicrosoftPage() {
  await requirePlatformPermission('manage_settings');

  let health: MicrosoftHealth | null = null;
  try {
    health = await checkMicrosoftHealth();
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
        <PageHeading>Microsoft 365</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          זהות האפליקציה שדרכה רצים סנכרון היומן וקליטת הדואר הנכנס. הנתונים כאן
          נקראים מ-Microsoft Graph, לא מהטבלה שלנו — כך הם נכונים לכל הארגון ולא רק
          למי שצופה.
        </p>
      </div>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">מצב החיבור</h2>
        <MicrosoftStatusCard health={health} />
        <p className="text-xs text-muted-foreground">
          בדיקה קריאה-בלבד: שלוש פניות GET — הארגון שלנו, התיבה שאנחנו קוראים, ורישום
          האפליקציה שלנו. לא נשלח דואר, לא נגענו ביומן, ולא נקרא מידע של אף לקוח.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">מה שאינו כאן</h2>
        <p className="text-sm text-muted-foreground">
          זהות האפליקציה נקבעת במשתני הסביבה וברישום האפליקציה ב-Azure — תעודה אינה
          שדה שטופס יכול להחזיק, וכפתור שמירה מולה היה מבטיח משהו שהפאנל לא יכול
          לעשות. חיבור תיבת Exchange אישית נשאר בהגדרות המערכת.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/admin/settings"
            className="inline-flex min-h-11 items-center text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            חיבור יומן Exchange
          </Link>
          <Link
            href="/admin/integrations/resend-email"
            className="inline-flex min-h-11 items-center text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            דואר יוצא (Resend)
          </Link>
        </div>
      </section>
    </div>
  );
}
