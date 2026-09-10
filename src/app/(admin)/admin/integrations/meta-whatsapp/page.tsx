import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getWhatsAppChannelConfig } from '@/lib/data/admin/channels';
import { getOutreachMasterState } from '@/lib/data/admin/outreach-master';
import { getAppUrl } from '@/lib/url';

import { PageHeading } from '../../_components';
import { OutreachMasterSwitch } from '../_components/outreach-master-switch';
import { WhatsAppCredentialsForm } from './whatsapp-credentials-form';
import { WhatsAppConsentToggle } from './whatsapp-consent-toggle';
import { WhatsAppConnectionTest } from './whatsapp-connection-test';

export const metadata: Metadata = { title: 'Meta / WhatsApp — אינטגרציות' };

// Everything about the WhatsApp connection in one place: credentials, the webhook
// wiring to paste into Meta, the §30א consent gate, and an on-demand connection test.
//
// Gated on manage_settings, which is what the DAL behind every one of these enforces
// for itself — the page gate is defence in depth, not the boundary (see
// src/lib/auth/dal.ts).
//
// The old /admin/channels WhatsApp tab still exists and renders THE SAME components:
// they were lifted into files rather than copied, so there is one definition and the
// two surfaces cannot drift. The old page is retired in Task 0.6, as its own commit
// after a clean deploy — separating the redirect from the deletion is what keeps
// Phase 0 reversible by removing three lines rather than reverting a phase.

export default async function MetaWhatsAppPage() {
  await requirePlatformPermission('manage_settings');

  const [whatsapp, master, callbackUrl] = await Promise.all([
    getWhatsAppChannelConfig(),
    getOutreachMasterState(),
    getAppUrl('/api/webhooks/whatsapp'),
  ]);

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
        <PageHeading>Meta / WhatsApp Cloud API</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          {/* Moved verbatim from channels/page.tsx — the sentence that stops someone
              reading "מוגדר" as "ready to send". */}
          הפעלת ערוץ מתחילה שליחות חיות בתשלום. ההפעלה עצמה היא מתג הפנייה הראשי,
          ולא העמוד הזה.
        </p>
      </div>

      {/* The master switch heads this page as well as /admin/integrations/voximplant:
          it gates every outbound channel, not WhatsApp alone. It also has to be HERE
          rather than only on the index — WhatsAppCredentialsForm's status line says
          "הפעלה/כיבוי דרך מתג הפנייה הראשי שמעל", and until this was added that
          sentence pointed at nothing on this page. Its single writer is unchanged. */}
      <OutreachMasterSwitch enabled={master.enabled} anyChannelReady={master.anyChannelReady} />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">פרטי התחברות ו-Webhook</h2>
        <WhatsAppCredentialsForm
          whatsapp={whatsapp}
          callbackUrl={callbackUrl}
          outreachEnabled={master.enabled}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">דרישת הסכמה</h2>
        <WhatsAppConsentToggle consentRequired={whatsapp.consentRequired} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">בדיקת חיבור</h2>
        <p className="text-sm text-muted-foreground">
          קריאה חיה אחת ל-Meta שמאמתת את הטוקן ואת מזהה המספר. בדיקת הבריאות
          המתוזמנת רצה בנפרד כל שעה ומופיעה בכרטיס באינטגרציות.
        </p>
        <WhatsAppConnectionTest />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">תבניות</h2>
        <p className="text-sm text-muted-foreground">
          תוכן ההודעות נערך בעמוד התבניות. בריאות התבניות מול Meta — קטגוריה,
          דירוג איכות, סטטוס — מסונכרנת אוטומטית ותוצג כאן בהמשך.
        </p>
        <Link
          href="/admin/templates"
          className="inline-flex min-h-11 items-center text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          מעבר לתבניות פנייה
        </Link>
      </section>
    </div>
  );
}
