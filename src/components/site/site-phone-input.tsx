'use client';

import { useT } from 'next-i18next/client';
import type { ComponentProps } from 'react';

import { PhoneInput } from '@/components/ui/phone-input';

// PhoneInput in the language of the page, the way SiteLink is next/link in that language. The field itself stays free of
// i18next, because admin and the customer app render it outside the I18nProvider of (public)/layout.tsx and stay Hebrew.
export function SitePhoneInput(props: ComponentProps<typeof PhoneInput>) {
  const { t, i18n } = useT('public');
  return (
    <PhoneInput
      {...props}
      language={i18n.language}
      labels={{
        search: t('site.phoneInput.search', 'חיפוש מדינה…'),
        empty: t('site.phoneInput.empty', 'לא נמצאה מדינה'),
        unknownCountry: t('site.phoneInput.unknownCountry', 'מדינה לא מזוהה'),
        selectCountry: (country) => t('site.phoneInput.selectCountry', 'בחירת מדינה — כעת {{country}}', { country }),
      }}
    />
  );
}
