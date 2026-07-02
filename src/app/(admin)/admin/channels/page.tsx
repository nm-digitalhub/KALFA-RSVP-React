import { getWhatsAppChannelConfig } from '@/lib/data/admin/channels';
import { getAppUrl } from '@/lib/url';
import { PageHeading } from '../_components';
import { ChannelsClient } from './channels-client';

const sectionClass = 'space-y-4 rounded-lg border border-border bg-card p-5';

// Admin: guest-OUTREACH provider configuration (WhatsApp Cloud API; Voximplant
// ships with C2). requireAdmin() is enforced in the data layer. Enabling a
// channel turns on live, paid sends — the master switch is `outreach_enabled`.
export default async function AdminChannelsPage() {
  const whatsapp = await getWhatsAppChannelConfig();
  const callbackUrl = await getAppUrl('/api/webhooks/whatsapp');

  return (
    <div className="space-y-6">
      <PageHeading>ערוצי תקשורת</PageHeading>

      <section className={sectionClass}>
        <div>
          <h2 className="text-lg font-semibold">הגדרת ספקי הפנייה לאורחים</h2>
          <p className="text-sm text-muted-foreground">
            חיבור הספקים שדרכם נשלחות פניות אישור-הגעה. הסודות נשמרים בשרת בלבד.
            הפעלת ערוץ מתחילה שליחות חיות בתשלום — ודאו שהמתג הראשי דלוק והחיבור
            נבדק.
          </p>
        </div>
        <ChannelsClient whatsapp={whatsapp} callbackUrl={callbackUrl} />
      </section>
    </div>
  );
}
