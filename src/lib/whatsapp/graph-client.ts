import 'server-only';

import createClient from 'openapi-fetch';

import type { paths } from '@/lib/whatsapp/generated/meta-schema';

/**
 * יוצר לקוח Meta Graph עבור טוקן שנשלף ממנגנון ההגדרות הקיים.
 *
 * אין לשמור כאן טוקן גלובלי ואין לקרוא אותו ישירות ממשתנה סביבה.
 * גרסת Graph מועברת בכל פעולה דרך פרמטר הנתיב Version.
 */
export function createMetaGraphClient(accessToken: string) {
  const normalizedAccessToken = accessToken.trim();
  if (!normalizedAccessToken) {
    throw new Error('Meta access token is required');
  }

  return createClient<paths>({
    baseUrl: 'https://graph.facebook.com',
    headers: {
      Authorization: `Bearer ${normalizedAccessToken}`,
      Accept: 'application/json',
    },
  });
}
