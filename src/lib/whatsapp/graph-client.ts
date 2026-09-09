import 'server-only';

import createClient from 'openapi-fetch';

/**
 * יוצר לקוח Meta Graph עבור טוקן שנשלף ממנגנון ההגדרות הקיים.
 *
 * אין לשמור כאן טוקן גלובלי ואין לקרוא אותו ישירות ממשתנה סביבה.
 * גרסת Graph מועברת בכל פעולה דרך פרמטר הנתיב Version.
 *
 * הטיפוסים מגיעים מהקורא, לא מכאן: מטא מפרסמת מפרט OpenAPI נפרד לכל API ולכל
 * גרסה (`npm run meta:types` מוריד אותם לפי GRAPH_API_VERSION), ולכן כל מודול
 * מביא את `paths` של הממשק שהוא מדבר איתו. כך אין קובץ טיפוסים מונוליטי אחד
 * שמקבע גרסה לכולם.
 *
 *   const client = createMetaGraphClient<paths>(token);
 */
export function createMetaGraphClient<Paths extends object>(
  accessToken: string,
) {
  const normalizedAccessToken = accessToken.trim();
  if (!normalizedAccessToken) {
    throw new Error('Meta access token is required');
  }

  return createClient<Paths>({
    baseUrl: 'https://graph.facebook.com',
    headers: {
      Authorization: `Bearer ${normalizedAccessToken}`,
      Accept: 'application/json',
    },
  });
}
