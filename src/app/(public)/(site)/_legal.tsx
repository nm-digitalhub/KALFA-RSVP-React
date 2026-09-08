import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import type { CompanyLegal } from '@/lib/data/company';

// Shared shell for the public legal pages (privacy policy, terms). RTL Hebrew,
// reads the company identity from config so it stays in sync with the agreement.
// Legal wording reviewed and approved — no draft banner (removed 2026-08-30).
//
// Back link: a lucide ArrowRight, not the literal "←" glyph the responsive/RTL
// audit flagged (docs/design/responsive-rtl-audit.md §3). In RTL "back" points
// toward the reading START, i.e. right — the mirror of the ArrowLeft the
// marketing CTAs use for "forward". The glyph pointed the wrong way.

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
    // <main>, like every other (site) page: the header/footer come from the
    // layout, and the legal pages were the only ones without a main landmark.
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowRight className="size-4" aria-hidden />
        לדף הבית
      </Link>

      {/* Same heading scale + rhythm as /faq and /contact (they were a smaller
          text-2xl with no responsive step). */}
      <h1 className="mt-2 text-balance text-display font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 text-xs text-muted-foreground">{updatedText}</p>

      <div className="mt-8 space-y-8">{children}</div>

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
    </main>
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
