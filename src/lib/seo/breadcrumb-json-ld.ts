// BreadcrumbList JSON-LD for the public (site) pages. Pure — the caller passes
// the origin (getAppOrigin()) so this stays free of I/O and trivially testable.
//
// Every public marketing page sits one level under the home page, so the trail
// is always "home > this page". The last item carries no `item` URL: per
// Google's breadcrumb documentation the final crumb may omit it, and it is the
// page the reader is already on.

export type BreadcrumbJsonLd = {
  '@context': 'https://schema.org';
  '@type': 'BreadcrumbList';
  itemListElement: Array<{
    '@type': 'ListItem';
    position: number;
    name: string;
    item?: string;
  }>;
};

export function buildBreadcrumbJsonLd(origin: string, pageName: string): BreadcrumbJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'דף הבית', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: pageName },
    ],
  };
}

// Same `<` escape the FAQ and home-page JSON-LD use: a string can never close
// the surrounding <script> tag early.
export function jsonLdScript(jsonLd: object): string {
  return JSON.stringify(jsonLd).replace(/</g, '\\u003c');
}
