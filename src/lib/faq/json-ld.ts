// Pure FAQPage JSON-LD builder. Walks the exact same flattened entry list the
// page renders (see flattenFaqEntries in page-model.ts) — there is no second,
// separately-maintained copy of the questions here, so the visible page and
// the structured data can never diverge.

import type { FaqEntry } from './page-model';

export type FaqPageJsonLd = {
  '@context': 'https://schema.org';
  '@type': 'FAQPage';
  mainEntity: Array<{
    '@type': 'Question';
    name: string;
    acceptedAnswer: { '@type': 'Answer'; text: string };
  }>;
};

export function buildFaqJsonLd(entries: FaqEntry[]): FaqPageJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries
      // Defensive only — the entries here are always non-empty in practice
      // (DB rows are `not null`, and the code-owned fallbacks are non-empty
      // strings), but structured data must never advertise a blank Q or A.
      .filter((entry) => entry.question.trim() !== '' && entry.answer.trim() !== '')
      .map((entry) => ({
        '@type': 'Question' as const,
        name: entry.question,
        acceptedAnswer: { '@type': 'Answer' as const, text: entry.answer },
      })),
  };
}

// Same `<` escape used by the home page's JSON-LD (src/app/(public)/(site)/page.tsx)
// — standard guard against a DB-sourced string closing the <script> tag early.
// Load-bearing here (not decorative): every FAQ answer is admin-editable text.
export function faqJsonLdScript(jsonLd: FaqPageJsonLd): string {
  return JSON.stringify(jsonLd).replace(/</g, '\\u003c');
}
