import { I18nProvider } from 'next-i18next/client';

import { getResources, getT } from '@/i18n.server';
import { DEFAULT_LANGUAGE } from '@/lib/i18n/site-language';

// Client components on the public site read their strings through useT, which needs this provider. It lives here and
// not in the root layout so the customer app and admin never receive translation resources.
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const { i18n, lng } = await getT('public');
  return (
    <I18nProvider language={lng} resources={getResources(i18n, ['public'], [lng, DEFAULT_LANGUAGE])}>
      {children}
    </I18nProvider>
  );
}
