import Link from 'next/link';

import type { CompanyLegal } from '@/lib/data/company';

// Shared shell for the public legal pages (privacy policy, terms). RTL Hebrew,
// reads the company identity from config so it stays in sync with the agreement.
// DRAFT content — a licensed Israeli lawyer must approve before go-live.

export function LegalShell({
  title,
  updatedText,
  company,
  children,
}: {
  title: string;
  updatedText: string;
  company: CompanyLegal;
  children: React.ReactNode;
}) {
  const todo = (v: string) =>
    v.trim() ? v.trim() : '[יושלם בהגדרות פרטי החברה]';

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← לדף הבית
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-xs text-muted-foreground">{updatedText}</p>

      <p
        role="note"
        className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800"
      >
        טיוטה — הנוסח ממתין לאישור עו״ד. אין לראות בו ייעוץ משפטי.
      </p>

      <div className="mt-6 space-y-6">{children}</div>

      <hr className="my-8 border-border" />
      <section className="space-y-1 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">פרטי החברה</p>
        <p>
          {todo(company.name)}
          {company.id ? ` · ח.פ./ע.מ. ${company.id}` : ''}
        </p>
        {company.address ? <p>{company.address}</p> : null}
        <p>
          {company.contactPhone ? `טלפון: ${company.contactPhone}` : ''}
          {company.contactPhone && company.contactEmail ? ' · ' : ''}
          {company.contactEmail ? `דוא״ל: ${company.contactEmail}` : ''}
        </p>
      </section>
    </div>
  );
}

export function LegalSection({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        {title}
        {badge}
      </h2>
      <div className="space-y-2 text-sm leading-7 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

// Live status pill for a cookie-consent category, sourced from
// src/lib/consent/admin-config.ts — the SAME config the banner itself reads,
// so /cookies and /privacy can never show a stale category status. The
// underlying legal text stays fixed in code regardless (plan
// plans/cookie-consent-admin-control.md §8) — this only reflects whether the
// admin currently offers the category, never a substitute for the text.
export function CategoryStatusBadge({
  active,
  label,
}: {
  active: boolean;
  label?: string;
}) {
  return (
    <span
      className={
        'rounded-full px-2 py-0.5 text-xs font-normal ' +
        (active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600')
      }
    >
      {label ? `${label}: ` : ''}
      {active ? 'פעיל' : 'מושבת זמנית'}
    </span>
  );
}
