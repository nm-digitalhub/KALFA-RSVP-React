import { getWhatsAppChannelConfig } from '@/lib/data/admin/channels';
import { getVoximplantChannelConfig } from '@/lib/data/admin/voximplant-channel';
import { getOutreachMasterState } from '@/lib/data/admin/outreach-master';
import { listAllChannels } from '@/lib/data/admin/channel-catalog';
import { getAppUrl } from '@/lib/url';
import { PageHeading } from '../_components';
import { ChannelsClient } from './channels-client';
import { ChannelCatalogEditor } from './channel-catalog-editor';

const sectionClass = 'space-y-4 rounded-lg border border-border bg-card p-5';

// Admin: guest-OUTREACH provider configuration (WhatsApp Cloud API; Voximplant
// ships with C2). requirePlatformPermission('manage_settings') is enforced in the data layer. Enabling a
// channel turns on live, paid sends — the master switch is `outreach_enabled`.
export default async function AdminChannelsPage() {
  const whatsapp = await getWhatsAppChannelConfig();
  const voximplant = await getVoximplantChannelConfig();
  const master = await getOutreachMasterState(); // the single global switch
  const catalogChannels = await listAllChannels(); // display metadata catalog
  const callbackUrl = await getAppUrl('/api/webhooks/whatsapp');
  const voxCtxBase = await getAppUrl('/api/voximplant/ctx'); // reference base — live URL appends a per-call signed token
  const voxCbBase = await getAppUrl('/api/voximplant/cb');

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
        <ChannelsClient
          whatsapp={whatsapp}
          callbackUrl={callbackUrl}
          voximplant={voximplant}
          voxCtxBase={voxCtxBase}
          voxCbBase={voxCbBase}
          outreachEnabled={master.enabled}
          anyChannelReady={master.anyChannelReady}
        />
      </section>

      <section className={sectionClass}>
        <div>
          <h2 className="text-lg font-semibold">קטלוג הערוצים (תצוגה)</h2>
          <p className="text-sm text-muted-foreground">
            שם התצוגה, הסדר, והצג/הסתר של הערוצים בטופס החבילה — נתונים הניתנים
            לעריכה כאן במקום בקוד. שינוי חל מיד על טופס החבילה, בלי פריסה. הוספת
            ערוץ חדש אינה עריכת-תצוגה אלא שינוי סכמה וקוד — אינה זמינה כאן.
          </p>
        </div>
        <ChannelCatalogEditor channels={catalogChannels} />
      </section>
    </div>
  );
}
