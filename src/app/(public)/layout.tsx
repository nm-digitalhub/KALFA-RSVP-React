import { I18nProvider } from 'next-i18next/client';

import i18nConfig from '@/i18n.config';
import { getResources, getT } from '@/i18n.server';
import { DEFAULT_LANGUAGE } from '@/lib/i18n/site-language';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

// Client components on the public site read their strings through useT, which needs this provider. It lives here and
// not in the root layout so the customer app and admin never receive translation resources. The client instance does
// not read the server config (next-i18next README), so the options that change the text are passed here as well.
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const { i18n, lng } = await getT('public');
  return (
    <I18nProvider
      language={lng}
      resources={getResources(i18n, ['public'], [lng, DEFAULT_LANGUAGE])}
      defaultNS={i18nConfig.defaultNS}
      fallbackLng={DEFAULT_LANGUAGE}
      i18nextOptions={i18nConfig.i18nextOptions}
    >
      {children}
    </I18nProvider>
  );
}
