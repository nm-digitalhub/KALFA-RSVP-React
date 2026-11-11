import type { Metadata } from 'next';
import { SiteLink as Link } from '@/components/site/site-link';
import { MailOpen, PhoneCall } from 'lucide-react';
import { Trans } from 'react-i18next/TransWithoutContext';

import { getUser } from '@/lib/auth/dal';
import { getT } from '@/i18n.server';
import { CallbackForm, ContactForm } from './inquiry-forms';
import { pageOpenGraph } from '@/lib/seo/open-graph';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

// Title and description are declared once and reused for the Open Graph
// block — the share preview and the search snippet must not drift apart.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('public');
  const pageTitle = t('site.contact.meta.title', 'יצירת קשר ותמיכה');
  const pageDescription = t(
    'site.contact.meta.description',
    'יצירת קשר עם KALFA: שליחת פנייה לתמיכה או שאלה לפני הרשמה, או בקשת חזרה טלפונית מהצוות.',
  );
  return {
    title: pageTitle,
    description: pageDescription,
    // Nested metadata objects are REPLACED, not merged: a page that sets no
    // openGraph inherits the root layout's wholesale, so its share preview
    // would show the site-wide blurb instead of this page's.
    openGraph: pageOpenGraph(pageTitle, pageDescription, '/contact'),
    alternates: { canonical: '/contact' },
  };
}

// Session-aware (prefill for signed-in customers) → render per-request.

// Public contact-and-support page. One page serves both audiences: anonymous
// prospects (pre-sales) and signed-in customers (support) — the audience is
// derived from the verified server session, never from the URL. `?t=support`
// only preselects the support topic (used by the in-app "עזרה ותמיכה" link).
export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { t, i18n } = await getT('public');
  const { t: topicParam } = await searchParams;
  const defaultTopic = topicParam === 'support' ? 'תמיכה' : undefined;
  const user = await getUser();

  return (
    <div className="bg-background">
      {/* Header: the shared SiteHeader from the (site) layout. */}
      <main className="mx-auto max-w-3xl space-y-10 px-4 py-10 sm:px-6 sm:py-12">
        <div>
          <h1 className="text-balance text-display font-extrabold tracking-tight transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:translate-y-3">{t('site.contact.title', 'יצירת קשר ותמיכה')}</h1>
          <p className="mt-2 text-pretty text-lg text-muted-foreground transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:translate-y-3 k-delay-100">
            {t('site.contact.subtitle', 'יש לכם שאלה, בקשה או תקלה? כתבו לנו או השאירו מספר, ונחזור אליכם.')}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            <Trans
              t={t}
              i18n={i18n}
              i18nKey="site.contact.faqHint"
              defaults="לפני שפונים, כדאי לבדוק את <faq>השאלות הנפוצות</faq> — יכול להיות שהתשובה כבר שם."
              components={{ faq: <Link href="/faq" className="font-semibold text-primary hover:underline" /> }}
            />
          </p>
        </div>

        <section
          id="contact"
          aria-labelledby="contact-heading"
          className="@container/form scroll-mt-20 rounded-xl border border-border p-4 sm:p-6"
        >
          <h2 id="contact-heading" className="mb-4 flex items-center gap-2 text-xl font-bold">
            <MailOpen className="size-5 text-primary" />
            {t('site.contact.contactSection.title', 'שליחת פנייה')}
          </h2>
          <ContactForm
            defaultTopic={defaultTopic}
            defaultEmail={user?.email ?? undefined}
            defaultName={undefined}
          />
        </section>

        <section
          id="callback"
          aria-labelledby="callback-heading"
          className="@container/form scroll-mt-20 rounded-xl border border-border p-4 sm:p-6"
        >
          <h2 id="callback-heading" className="mb-4 flex items-center gap-2 text-xl font-bold">
            <PhoneCall className="size-5 text-primary" />
            {t('site.contact.callbackSection.title', 'בקשת חזרה טלפונית')}
          </h2>
          <CallbackForm defaultTopic={defaultTopic} />
        </section>
      </main>
    </div>
  );
}
