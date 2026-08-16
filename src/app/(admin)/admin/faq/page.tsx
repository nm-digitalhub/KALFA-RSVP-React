import type { Metadata } from 'next';

import { listAllFaqItems } from '@/lib/data/admin/faq';
import { getPublicBusinessFacts } from '@/lib/data/public-business-facts';
import { buildProtectedPricingMandatorySentence } from '@/lib/faq/page-model';
import { PageHeading } from '../_components';
import { FaqCatalogEditor } from './faq-catalog-editor';

export const metadata: Metadata = { title: 'שאלות נפוצות' };

// Admin: content editor for the public /faq page (scope-change 16.8.2026 —
// FAQ copy is admin-managed data, not hardcoded page-component strings, the
// same rule the project already applies to business facts).
// requirePlatformPermission('manage_settings') is enforced in the data layer
// (listAllFaqItems), same as /admin/channels and /admin/templates.
export default async function AdminFaqPage() {
  const [items, facts] = await Promise.all([listAllFaqItems(), getPublicBusinessFacts()]);
  // The exact live sentence the protected row's read-only preview shows,
  // computed ONCE here from the same BusinessFacts the public page's price
  // card uses — never a second copy of the legal wording.
  const protectedMandatorySentence = buildProtectedPricingMandatorySentence(facts);

  return (
    <div className="space-y-6">
      <PageHeading>שאלות נפוצות</PageHeading>
      <p className="max-w-prose text-sm text-muted-foreground">
        התוכן המוצג בעמוד הציבורי <code>/faq</code>. מחיר, כמות כלולה, תוספת וערוצי הפנייה בתוך
        תשובה מוזנים כטוקנים חיים — <code>{'{{base_price}}'}</code>,{' '}
        <code>{'{{included_reached}}'}</code>, <code>{'{{price_per_reached}}'}</code>,{' '}
        <code>{'{{channels_list}}'}</code> — ומוצבים אוטומטית מהחבילה הפעילה בכל טעינת עמוד; אין
        להקליד ספרות מחיר או שמות ערוצים בעצמכם.
      </p>
      <FaqCatalogEditor items={items} protectedMandatorySentence={protectedMandatorySentence} />
    </div>
  );
}
