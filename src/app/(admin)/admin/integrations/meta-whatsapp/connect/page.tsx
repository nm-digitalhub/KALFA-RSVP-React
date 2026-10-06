import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LocalDateTime } from '@/components/local-date-time';
import { requirePlatformOwner } from '@/lib/auth/dal';
import {
  getEsReadiness,
  listEsConnections,
  type SyncStatus,
} from '@/lib/data/admin/integrations/whatsapp-es';

import { EmptyState, PageHeading } from '../../../_components';
import { EmbeddedSignupLauncher } from './embedded-signup-launcher';

export const metadata: Metadata = { title: 'חיבור מספר WhatsApp Business — אינטגרציות' };

// Connect a number that already runs in the WhatsApp Business app to Cloud API
// as well ("Coexistence"), through Meta's Embedded Signup. The number is picked
// by the user INSIDE Meta's window; this page only launches it and reports.
//
// Nothing live changes: the current sender, its token and the number roles are
// untouched (see src/lib/data/admin/integrations/whatsapp-es.ts).
//
// Gated on the platform OWNER — the same gate the action enforces for itself,
// and the one registerNumberAction uses for the other irreversible number step.

// A failed or skipped sync must never read as done: the sync is one-shot.
const SYNC_LABEL: Record<SyncStatus, string> = {
  requested: 'הופעל',
  failed: 'נכשל',
  skipped: 'לא הופעל',
};

export default async function ConnectWhatsAppBusinessPage() {
  await requirePlatformOwner();

  const [readiness, connections] = await Promise.all([getEsReadiness(), listEsConnections()]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/integrations/meta-whatsapp"
          className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronRight className="size-4" aria-hidden />
          חזרה ל-Meta / WhatsApp
        </Link>
        <PageHeading>חיבור מספר WhatsApp Business קיים</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          מחבר מספר שכבר פעיל באפליקציית WhatsApp Business בטלפון גם ל-Cloud API. אחרי
          החיבור ממשיכים לכתוב מהטלפון כרגיל, ובמקביל המספר זמין דרך ה-API. את המספר
          בוחרים בתוך החלון של Meta.
        </p>
      </div>

      <section className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
        <h2 className="font-semibold">לפני שמתחילים</h2>
        <ul className="list-inside list-disc space-y-1 text-muted-foreground">
          <li>אפליקציית WhatsApp Business בגרסה 2.24.17 ומעלה, פתוחה בטלפון לאורך כל התהליך.</li>
          <li>אנשי הקשר וההיסטוריה מסונכרנים פעם אחת בלבד, מיד בסיום החיבור.</li>
          <li>מכשירים מקושרים מתנתקים בזמן החיבור, ואפשר לחבר אותם מחדש (לא WhatsApp ל-Windows).</li>
          <li>מספר שעובד בשני המקומות מוגבל ל-20 הודעות בשנייה דרך ה-API.</li>
          <li>ניתוק אפשרי רק מהטלפון: הגדרות › חשבון › Business Platform.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">חיבור</h2>
        {readiness.ready ? (
          <EmbeddedSignupLauncher appId={readiness.appId} configId={readiness.configId} />
        ) : (
          <Alert>
            <AlertTitle>החיבור עדיין לא זמין</AlertTitle>
            <AlertDescription>{readiness.reason}</AlertDescription>
          </Alert>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">מספרים שחוברו</h2>
        {connections.length === 0 ? (
          <EmptyState>עוד לא חובר מספר דרך העמוד הזה.</EmptyState>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {connections.map((c) => (
              <li
                key={`${c.label}-${c.createdAt}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
              >
                <div className="space-y-1">
                  <p className="font-medium">
                    <span dir="ltr">{c.label}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    חובר: <LocalDateTime iso={c.createdAt} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.sync
                      ? `סנכרון אנשי קשר: ${SYNC_LABEL[c.sync.contacts]} · היסטוריה: ${SYNC_LABEL[c.sync.history]}`
                      : 'סנכרון: לא הופעל'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={c.status === 'active' ? 'success' : 'warning'}>
                    {c.status === 'active' ? 'פעיל' : c.status}
                  </Badge>
                  {c.platformType ? <Badge variant="neutral">{c.platformType}</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
