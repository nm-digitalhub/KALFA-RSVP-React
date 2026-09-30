import type { Metadata } from 'next';
import { loadWhatsAppTemplateAdmin } from '@/lib/data/admin/whatsapp-templates';
import { listMessageTemplates } from '@/lib/data/message-templates';
import { PageHeading } from '../_components';
import { TemplatesClient } from './templates-client';
import { WhatsAppTemplatesSection } from './whatsapp-templates-section';

export const metadata: Metadata = { title: 'תבניות פנייה' };

// Admin: outreach send-content the engine resolves by key (WhatsApp = the
// Meta-approved template name; call = the script). requirePlatformPermission('manage_settings') in the data
// layer. Seeded FAIL-CLOSED (inactive) — a template sends only once it carries
// content AND is activated here.
export default async function AdminTemplatesPage() {
  const [templates, whatsapp] = await Promise.all([listMessageTemplates(), loadWhatsAppTemplateAdmin()]);

  return (
    <div className="space-y-6">
      <PageHeading>תבניות פנייה</PageHeading>

      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="text-lg font-semibold">תבניות WhatsApp לפי שלב</h2>
          <p className="text-sm text-muted-foreground">
            איזו תבנית מאושרת של Meta כל שלב שולח, לפי סוג האירוע ועם תמונת הזמנה או בלעדיה, ומה ממלא כל
            משתנה בתבנית. הקלידו {'{'} בשדה של משתנה כדי לבחור ערך.
          </p>
        </div>
        <WhatsAppTemplatesSection data={whatsapp} />
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="text-lg font-semibold">תוכן הפניות לאורחים</h2>
          <p className="text-sm text-muted-foreground">
            כל נקודת מגע במסע אישור-ההגעה. עבור WhatsApp הזינו את שם התבנית כפי
            שאושרה ב-Meta; עבור שיחת AI כתבו את הסקריפט. תבנית נשלחת רק לאחר מילוי
            תוכן והפעלה — עד אז היא כבויה ולא נשלחת.
          </p>
        </div>
        <TemplatesClient templates={templates} />
      </section>
    </div>
  );
}
