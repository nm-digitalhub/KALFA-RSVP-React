'use client';

import Link from 'next/link';
import { useT } from 'next-i18next/client';
import type { ComponentProps } from 'react';

import { DEFAULT_LANGUAGE, hrefInLanguage } from '@/lib/i18n/site-language';

// next/link has no language in the App Router (its `locale` prop is Pages Router only), so a link on /en/about needs its
// target written as /en/faq. A client navigation also keeps the root layout, and with it <html lang dir> and the header
// and footer, so it only works between pages of one language. A link from a translated page to anything that has no
// translation (/auth, /app) is therefore a plain <a>: the full load gives that page its own language and direction.
export function SiteLink({ href, ...props }: ComponentProps<'a'> & { href: string }) {
  const { i18n } = useT('public');
  const target = hrefInLanguage(href, i18n.language);
  if (i18n.language !== DEFAULT_LANGUAGE && target === href) return <a href={href} {...props} />;
  return <Link href={target} {...props} />;
}
