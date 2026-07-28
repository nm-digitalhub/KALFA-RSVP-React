import Link from 'next/link';
import { ArrowLeft, MailOpen, PhoneCall } from 'lucide-react';

import { getUser } from '@/lib/auth/dal';
import { CallbackForm, ContactForm } from './inquiry-forms';

export const metadata = {
  title: 'יצירת קשר ותמיכה',
  alternates: { canonical: '/contact' },
};

// Session-aware (prefill for signed-in customers) → render per-request.
export const dynamic = 'force-dynamic';

// Public contact-and-support page. One page serves both audiences: anonymous
// prospects (pre-sales) and signed-in customers (support) — the audience is
// derived from the verified server session, never from the URL. `?t=support`
// only preselects the support topic (used by the in-app "עזרה ותמיכה" link).
export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { t } = await searchParams;
  const defaultTopic = t === 'support' ? 'תמיכה' : undefined;
  const user = await getUser();

  return (
    <div className="bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Link href="/" className="text-2xl font-extrabold tracking-tight">
            KALFA
          </Link>
          <Link
            href={user ? '/app' : '/'}
            className="inline-flex items-center gap-2 text-sm font-semibold hover:underline"
          >
            {user ? 'לאזור האישי' : 'לעמוד הבית'}
            <ArrowLeft className="size-4" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-10 px-6 py-12">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">יצירת קשר ותמיכה</h1>
          <p className="mt-2 text-muted-foreground">
            יש לכם שאלה, בקשה או תקלה? כתבו לנו או השאירו מספר — ונחזור אליכם.
          </p>
        </div>

        <section
          id="contact"
          aria-labelledby="contact-heading"
          className="rounded-xl border border-border p-6"
        >
          <h2 id="contact-heading" className="mb-4 flex items-center gap-2 text-xl font-bold">
            <MailOpen className="size-5 text-primary" />
            שליחת פנייה
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
          className="rounded-xl border border-border p-6"
        >
          <h2 id="callback-heading" className="mb-4 flex items-center gap-2 text-xl font-bold">
            <PhoneCall className="size-5 text-primary" />
            בקשת חזרה טלפונית
          </h2>
          <CallbackForm defaultTopic={defaultTopic} />
        </section>
      </main>
    </div>
  );
}
