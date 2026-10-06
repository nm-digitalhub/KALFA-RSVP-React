# WhatsApp Embedded Signup (Coexistence): תוכנית לעמוד החיבור

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** עמוד אדמין שבו מחברים מספר WhatsApp Business שכבר פעיל באפליקציה בטלפון גם ל-Cloud API (Coexistence), דרך חלון Embedded Signup של Meta. אחרי החיבור המספר ממשיך לעבוד בטלפון, ובמקביל אפשר לגשת אליו דרך ה-API.

**Architecture:** דף Server Component ב-`/admin/integrations/meta-whatsapp/connect`, עם רכיב לקוח אחד שטוען את ה-JS SDK של Meta ופותח את `FB.login`. הקוד החד-פעמי נשלח מיד ל-Server Action. ה-action עושה ארבעה דברים:
1. מחליף את הקוד בטוקן עסקי.
2. **גוזר בצד השרת** את מזהי ה-WABA מתוך הטוקן (`debug_token` ‏granular_scopes), ולא סומך על מזהים שהגיעו מהדפדפן.
3. מחבר את האפליקציה ל-webhooks של ה-WABA.
4. מפעיל פעם אחת את סנכרון אנשי הקשר וההיסטוריה.

הטוקן נשמר ב-Vault דרך `integrations_write_credential` הקיים. **שום דבר חי לא משתנה:** לא `app_settings.whatsapp_*`, לא `provider_numbers` ולא `provider_number_roles`.

**Tech Stack:** Next.js 16.3.6 App Router, React 19, Zod 4, Supabase (Vault + `integration_connections`), Vitest 5, Meta Graph `GRAPH_API_VERSION` (v25.0), Facebook JS SDK.

**Spec:** אין מסמך spec נפרד. התוכנית נשענת על שני מקורות:
- התיעוד של Meta, שנקרא ב-25.9.2026:
  - `embedded-signup/overview`, `implementation`, `onboarding-customers-as-a-tech-provider`, `onboarding-business-app-users`, `versions`, `version-4`, `errors`
  - `webhooks/reference/account_update`, `access-tokens`, `solution-providers/overview`, `app-review`
- הזיכרון `whatsapp-embedded-signup-coexistence`.

## Global Constraints

- **אין כתיבה להגדרות החיות.** אין כתיבה ל-`app_settings.whatsapp_*`, ל-`provider_numbers` או ל-`provider_number_roles`. בעל המוצר דחה במפורש את ההנחה שהחיבור מחליף את הקיים.
- **גרסת Graph.** לכל קריאה ל-Graph משתמשים ב-`GRAPH_API_VERSION` מ-`src/lib/whatsapp/graph-version.ts`, לא ב-v21.0 שמופיע בדוגמאות של Meta.
- **גרסת Embedded Signup.** v4. גרסה 2 נסגרת ב-15.10.2026. ה-Configuration ID הוא מה שקובע את הגרסה.
- **הפעלת Coexistence.** מופיע ב-Step 2 של `onboarding-business-app-users`. קובץ ה-.md של Meta משמיט את ה-Step הזה, ולכן הוא נקרא מה-HTML: "Add a `featureType` property set to `whatsapp_business_app_onboarding` to the `extras` object". קוד ההפעלה ב-HTML:
  `extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' }`
- **תוקף הקוד.** הקוד החד-פעמי תקף 30 שניות. ה-callback של `FB.login` קורא ל-Server Action מיד, בלי מסך אישור ביניים ובלי להמתין לאירוע ה-message.
- **בדיקת origin.** מקבלים הודעה רק אם `new URL(event.origin).hostname` שווה בדיוק ל-`www.facebook.com`, `web.facebook.com` או `facebook.com`. הבדיקה בתיעוד (`endsWith('facebook.com')`) מקבלת גם `evilfacebook.com`.
- **הרשאה.** `requirePlatformOwner()`, כמו ב-`registerNumberAction`. Server Action הוא endpoint עצמאי.
- **שמירת הטוקן.** `integrations_write_credential` עם `p_created_by` מפורש, כי `auth.uid()` מחזיר NULL תחת service role (נמדד ב-oauth-flow.ts).
  - `provider='meta_whatsapp_es'`
  - `credential_kind='business_token'`
- **סודות.** טוקן, קוד, App Secret ו-PIN לא נרשמים בלוג, לא נכנסים להודעת שגיאה ולא עוברים לדפדפן.
- **סנכרון SMB.** אפשר להריץ אותו פעם אחת בלבד, ותוך 24 שעות. אסור להפעיל אותו לפני שה-webhooks `history`, `smb_app_state_sync` ו-`smb_message_echoes` רשומים ונשמרים. אחרת הנתונים אובדים, וצריך לנתק ולעבור את כל התהליך מחדש.
- **שפה.** טקסט למשתמש בעברית ו-RTL. תגיות לוגיות (`ms-`/`me-`), מינימום 44px למטרות מגע.

## בחירת המספר

המשתמש בוחר את המספר בעצמו, בתוך החלון של Meta, כחלק מהתהליך. לכן העמוד לא מציע בחירת מספר, והשרת גוזר את המספר שנבחר מתוך הטוקן והחשבון (משימה 4).

## Owner prerequisites — שער חיצוני, לא משימת קוד

אף בדיקה בתוכנית לא תלויה בהם. בלעדיהם הכפתור בעמוד מושבת ומוצגת הסיבה.

- **P1. Tech Provider.** ב-App Dashboard ‹ Use cases ‹ WhatsApp ‹ Customize ‹ Tech Provider onboarding. Meta מציינת Tech Provider כדרישה ל-Coexistence. ה-App Review ל-`whatsapp_business_messaging` ו-`whatsapp_business_management` עדיין PENDING (הזיכרון `meta-app-review-whatsapp-workstream`).
  - **INFERRED:** עד לאישור Advanced access, רק משתמש עם תפקיד admin או developer באפליקציה יכול להשלים את התהליך (Standard access). לפי app-review.md: "Make sure your test users have a developer or admin role".
- **P2. Configuration ID.** ליצור ב-Facebook Login for Business ‹ Configurations תצורה מסוג "WhatsApp Embedded Signup" עם המוצר Cloud API, ואת ה-ID לשים ב-`.env.local` כ-`META_ES_CONFIG_ID`. זה לא סוד: ה-ID גלוי בכל קריאת `FB.login`.
- **P3. דומיינים והגדרות OAuth.**
  - להוסיף את `beta.kalfa.me` ל-Allowed domains ול-Valid OAuth redirect URIs.
  - להדליק את ששת המתגים: Client OAuth, Web OAuth, Enforce HTTPS, Embedded Browser OAuth, Strict Mode, Login with the JavaScript SDK.
- **P4. אפליקציית WhatsApp Business.** בגרסה 2.24.17 ומעלה, פתוחה בזמן הסנכרון.

## Facts verified in code (25.9.2026)

- **`route.ts:114-160`.** כל שדה webhook שלא מזוהה נשמר ב-`webhook_inbox` עם `event_kind` = שם השדה.
- **`webhook-processing.ts:191`.** ה-worker לא מטפל ב-kind שהוא לא מכיר, ורק מסמן אותו כמעובד. לכן `history`, `smb_*` ו-`account_update` בטוחים לחיוב.
- **הודעות למספר שאינו שלנו.** `classifyInboundChannel` מחזיר `'unknown'` לכל `phone_number_id` שהוא לא מספר ה-RSVP ולא מספר הייבוא. תפקיד `whatsapp_import_sender` משויך היום (נמדד ב-25.9 מול ה-DB החי), ולכן לא חל הנתיב הישן שבו כל הודעה נחשבת RSVP. במצב הנוכחי **כל הודעה של לקוח למספר המחובר תשלח התראת Slack** (`webhook-processing.ts:257-270`). משימה 5 מטפלת בזה.
- **`run-health-check.ts:80-125`.** בדיקת הבריאות השעתית רושמת מחדש את המנוי אם חסרים שדות, ושולחת התראת Slack. שינוי של `WHATSAPP_WEBHOOK_FIELDS` יגרום לרישום מחדש בהרצה הבאה, ולהתראה אחת.
- **`meta-status.ts:66`.** `resolveAppId()` פרטית. היא קוראת קודם `app_settings.whatsapp_app_id`, ואם אין, את `META_APP_ID_WA`.
- **App Secret.** `getWhatsAppConfig().appSecret` מחזיר את ה-App Secret, זה שמשמש לאימות חתימת ה-webhook.
- **`debug-token.ts`.** `debugToken()` לא מחזיר היום `granular_scopes`. משימה 2 מוסיפה את זה.
- **כותרות אבטחה.** ב-`/admin` אין כותרת COOP ואין CSP גלובלי (נבדק ב-curl ב-25.9). ה-CSP היחיד מוגדר ל-`/sw.js`.

## File structure

| קובץ | אחריות |
| --- | --- |
| `src/lib/whatsapp/subscriptions.ts` (שינוי) | רשימת השדות הנדרשים |
| `src/lib/whatsapp/meta-app-id.ts` (חדש) | `resolveMetaAppId()`, מועבר מ-meta-status |
| `src/lib/whatsapp/debug-token.ts` (שינוי) | החזרת `granularScopes` |
| `src/lib/whatsapp/embedded-signup/session-event.ts` (חדש, טהור) | פענוח אירוע ה-postMessage ובדיקת origin |
| `src/lib/whatsapp/embedded-signup/graph.ts` (חדש, server-only) | exchangeCode, subscribeApp, phone status, smbSync |
| `src/lib/data/admin/integrations/whatsapp-es.ts` (חדש, server-only) | תזמור החיבור, שמירה ב-Vault, רשימת חיבורים, זיהוי מספר מחובר |
| `src/app/(admin)/admin/integrations/meta-whatsapp/connect/page.tsx` | העמוד |
| `.../connect/actions.ts` | Server Action דק |
| `.../connect/embedded-signup-launcher.tsx` | רכיב לקוח: SDK, כפתור, מצבי תצוגה |
| `src/lib/data/webhook-processing.ts` (שינוי) | הודעה למספר מחובר עוברת בשקט, בלי התראה |
| `src/app/(admin)/admin/integrations/meta-whatsapp/page.tsx` (שינוי) | קישור לעמוד החיבור |

## Review Focus

1. **המשתמש סוגר את החלון באמצע.** מתקבל `CANCEL` עם `current_step` ולא מגיע קוד. העמוד צריך להציג "החיבור בוטל בשלב X" ולא להשאיר את הכפתור במצב טעינה. הבדיקה: משימה 6, ‏`session-event` + launcher state.
2. **ה-callback מגיע בלי `authResponse`.** לדוגמה, המשתמש דחה את ההרשאות. אסור לקרוא ל-action. הבדיקה: משימה 6.
3. **הטוקן לא מעניק גישה ל-WABA, או מעניק גישה לכמה WABAs.** ה-action נכשל עם הודעה בטוחה ולא שומר כלום. הבדיקה: משימה 4.
4. **הסנכרון נכשל אחרי שהטוקן כבר נשמר.** החיבור נשמר עם `metadata.sync` שמכיל שגיאה, והעמוד מציג כמה זמן נשאר מתוך 24 השעות. אין ניסיון חוזר אוטומטי. הבדיקה: משימה 4.
5. **ההודעה הגיעה מ-origin מזויף** (למשל `https://evilfacebook.com`). היא נדחית. הבדיקה: משימה 3.

---

### Task 1: להירשם לשדות ה-webhook של Coexistence

**Files:**
- Modify: `src/lib/whatsapp/subscriptions.ts` (הקבוע `WHATSAPP_WEBHOOK_FIELDS` וההערה שמעליו)
- Test: `src/lib/whatsapp/subscriptions.test.ts`

**Interfaces:**
- Produces: `WHATSAPP_WEBHOOK_FIELDS` כולל גם `'account_update'`, `'history'`, `'smb_app_state_sync'`, `'smb_message_echoes'`

- [ ] **Step 1: לכתוב את הבדיקה שנכשלת**

```ts
describe('Coexistence fields', () => {
  it('requires the four fields Embedded Signup / Coexistence depend on', () => {
    for (const f of ['account_update', 'history', 'smb_app_state_sync', 'smb_message_echoes']) {
      expect(WHATSAPP_WEBHOOK_FIELDS).toContain(f);
    }
  });

  it('reports missing_fields for the pre-Coexistence subscription', () => {
    const state = readWhatsAppSubscription([
      { topic: WHATSAPP_WEBHOOK_TOPIC, fields: ['messages', 'message_template_status_update'], active: true },
    ]);
    expect(state).toEqual({
      kind: 'missing_fields',
      fields: ['messages', 'message_template_status_update'],
      missing: ['account_update', 'history', 'smb_app_state_sync', 'smb_message_echoes'],
    });
  });
});
```

הבדיקה הקיימת בשורה 62 משתמשת ב-`'account_update'` כשדה עודף. להחליף אותו בשדה שאינו ברשימה, למשל `'phone_number_quality_update'`.

- [ ] **Step 2: להריץ ולראות שהבדיקה נכשלת**
Run: `npx vitest run src/lib/whatsapp/subscriptions.test.ts`
Expected: FAIL (`account_update` לא נמצא ברשימה)

- [ ] **Step 3: לממש**

```ts
export const WHATSAPP_WEBHOOK_FIELDS = [
  'messages',
  'message_template_status_update',
  // Embedded Signup: Meta requires it ("You must be subscribed to the
  // account_update webhook") — fires on PARTNER_ADDED / PARTNER_REMOVED.
  'account_update',
  // Coexistence (onboarding-business-app-users §Step 1). Subscribed BEFORE
  // anyone runs the flow: the smb_app_data sync is one-shot and 24h-bounded,
  // and a field not subscribed at that moment is data lost for good. No
  // handler exists yet — route.ts persists these generically and the worker
  // marks them processed untouched (webhook-processing.ts: unknown kind).
  'history',
  'smb_app_state_sync',
  'smb_message_echoes',
] as const;
```

צריך לעדכן גם את ההערה "Add one here when something starts handling it": החריגה מכוונת, ומוסברת בהערה שבתוך המערך.

- [ ] **Step 4: להריץ ולראות שהבדיקות עוברות**
Run: `npx vitest run src/lib/whatsapp/subscriptions.test.ts src/lib/whatsapp/run-health-check.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/lib/whatsapp/subscriptions.ts src/lib/whatsapp/subscriptions.test.ts
git commit -m "feat(whatsapp): subscribe to account_update and the Coexistence webhook fields"
```

**Operational note:** אחרי deploy, בדיקת הבריאות השעתית תרשום את המנוי מחדש ותשלח התראת Slack אחת ("נרשם מחדש"). ההתראה הזו צפויה ולא מעידה על תקלה. **שער לפני משימה 7:** לוודא ב-`getAppSubscriptions` ש-7 השדות מופיעים.

---

### Task 2: מזהה האפליקציה במקום אחד, ו-`granular_scopes` מ-debug_token

**Files:**
- Create: `src/lib/whatsapp/meta-app-id.ts`
- Modify: `src/lib/data/admin/integrations/meta-status.ts:52-84` (למחוק את `resolveAppId` ולייבא במקומו)
- Modify: `src/lib/whatsapp/debug-token.ts` (הטיפוס וה-return)
- Test: `src/lib/whatsapp/debug-token.test.ts`, `src/lib/data/admin/integrations/meta-status.test.ts` (צריך לעבור בלי שינוי)

**Interfaces:**
- Produces: `resolveMetaAppId(): Promise<string | null>`
- Produces: `DebugTokenResult.granularScopes: Array<{ scope: string; targetIds: string[] }>`

- [ ] **Step 1: לכתוב את הבדיקה שנכשלת** (ב-`debug-token.test.ts`)

```ts
it('returns granular_scopes with their target ids', async () => {
  fetchSpy.mockResolvedValueOnce(jsonResponse({
    data: {
      is_valid: true,
      scopes: ['whatsapp_business_management'],
      granular_scopes: [
        { scope: 'whatsapp_business_management', target_ids: ['111', '222'] },
        { scope: 'whatsapp_business_messaging' },
      ],
    },
  }));
  const r = await debugToken({ appId: 'A', appSecret: 'S', token: 'T' });
  expect(r.granularScopes).toEqual([
    { scope: 'whatsapp_business_management', targetIds: ['111', '222'] },
    { scope: 'whatsapp_business_messaging', targetIds: [] },
  ]);
});
```

- [ ] **Step 2: להריץ ולראות שהבדיקה נכשלת**
Run: `npx vitest run src/lib/whatsapp/debug-token.test.ts`
Expected: FAIL (`granularScopes` הוא undefined)

- [ ] **Step 3: לממש**

ב-`debug-token.ts`: להוסיף ל-`DebugTokenResponse.data` את השדה `granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>`, ולהוסיף ל-return:

```ts
    granularScopes: Array.isArray(data.granular_scopes)
      ? data.granular_scopes
          .filter((g): g is { scope: string; target_ids?: string[] } => typeof g?.scope === 'string')
          .map((g) => ({
            scope: g.scope,
            targetIds: Array.isArray(g.target_ids)
              ? g.target_ids.filter((t): t is string => typeof t === 'string')
              : [],
          }))
      : [],
```

`meta-app-id.ts`: להעביר לשם את גוף `resolveAppId` כמו שהוא, עם ההערה, תחת השם `resolveMetaAppId`, ולהוסיף בראש הקובץ `import 'server-only'`. ב-`meta-status.ts` לייבא אותה ולמחוק את העותק הפרטי.

- [ ] **Step 4: להריץ ולראות שהבדיקות עוברות**
Run: `npx vitest run src/lib/whatsapp/debug-token.test.ts src/lib/data/admin/integrations/meta-status.test.ts`
Expected: PASS

- [ ] **Step 5: Commit** (`refactor(whatsapp): shared resolveMetaAppId; debug_token returns granular scopes`)

---

### Task 3: פענוח אירוע ה-postMessage (מודול טהור)

**Files:**
- Create: `src/lib/whatsapp/embedded-signup/session-event.ts`
- Test: `src/lib/whatsapp/embedded-signup/session-event.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function isMetaOrigin(origin: string): boolean;
  export type SessionEvent =
    | { kind: 'finish'; event: FinishEvent; wabaId: string | null; phoneNumberId: string | null }
    | { kind: 'cancel'; currentStep: string | null }
    | { kind: 'error'; errorCode: string | null; sessionId: string | null; message: string | null };
  export type FinishEvent = 'FINISH' | 'FINISH_ONLY_WABA' | 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
  export function parseSessionEvent(raw: unknown): SessionEvent | null;
  ```

- [ ] **Step 1: לכתוב את הבדיקה שנכשלת**

```ts
import { describe, expect, it } from 'vitest';
import { isMetaOrigin, parseSessionEvent } from './session-event';

describe('isMetaOrigin', () => {
  it.each([
    ['https://www.facebook.com', true],
    ['https://web.facebook.com', true],
    ['https://facebook.com', true],
    ['https://evilfacebook.com', false],
    ['https://www.facebook.com.evil.io', false],
    ['http://www.facebook.com', false],
    ['not a url', false],
  ])('%s → %s', (origin, ok) => expect(isMetaOrigin(origin)).toBe(ok));
});

describe('parseSessionEvent', () => {
  it('parses a Coexistence finish (waba only, per Meta example)', () => {
    const raw = JSON.stringify({
      type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      version: 3, data: { waba_id: '524126980791429' },
    });
    expect(parseSessionEvent(raw)).toEqual({
      kind: 'finish', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      wabaId: '524126980791429', phoneNumberId: null,
    });
  });

  it('parses an abandoned flow', () => {
    const raw = JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { current_step: 'PHONE_NUMBER_SETUP' } });
    expect(parseSessionEvent(raw)).toEqual({ kind: 'cancel', currentStep: 'PHONE_NUMBER_SETUP' });
  });

  it('parses a user-reported error (also event CANCEL, has error_code)', () => {
    const raw = JSON.stringify({
      type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL',
      data: { error_message: 'x', error_code: '524126', session_id: 'f34b51dab5e0498', timestamp: '1746041036' },
    });
    expect(parseSessionEvent(raw)).toEqual({ kind: 'error', errorCode: '524126', sessionId: 'f34b51dab5e0498', message: 'x' });
  });

  it('ignores non-JSON, other types, and unknown events', () => {
    expect(parseSessionEvent('not json')).toBeNull();
    expect(parseSessionEvent(JSON.stringify({ type: 'OTHER' }))).toBeNull();
    expect(parseSessionEvent(JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_OBO_MIGRATION', data: {} }))).toBeNull();
  });

  it('rejects ids that are not numeric strings', () => {
    const raw = JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: '1; drop', phone_number_id: '9' } });
    expect(parseSessionEvent(raw)).toEqual({ kind: 'finish', event: 'FINISH', wabaId: null, phoneNumberId: '9' });
  });
});
```

- [ ] **Step 2: להריץ ולראות שהבדיקה נכשלת**
Run: `npx vitest run src/lib/whatsapp/embedded-signup/session-event.test.ts`
Expected: FAIL (המודול לא קיים)

- [ ] **Step 3: לממש**

```ts
import { z } from 'zod';

// Pure: runs in the browser (launcher) and in tests. No I/O.
// The IDs parsed here are DISPLAY HINTS ONLY — the server derives the WABA from
// the exchanged token (debug_token granular_scopes) and never trusts these.

const META_HOSTS = new Set(['www.facebook.com', 'web.facebook.com', 'facebook.com']);

// Meta's sample uses origin.endsWith('facebook.com'), which also accepts
// evilfacebook.com. Exact host + https only.
export function isMetaOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && META_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

const FINISH_EVENTS = ['FINISH', 'FINISH_ONLY_WABA', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'] as const;
export type FinishEvent = (typeof FINISH_EVENTS)[number];

export type SessionEvent =
  | { kind: 'finish'; event: FinishEvent; wabaId: string | null; phoneNumberId: string | null }
  | { kind: 'cancel'; currentStep: string | null }
  | { kind: 'error'; errorCode: string | null; sessionId: string | null; message: string | null };

const graphId = z.string().regex(/^\d{1,32}$/);
const optStr = z.string().max(500).optional();

const envelope = z.object({
  type: z.literal('WA_EMBEDDED_SIGNUP'),
  event: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

function idOrNull(v: unknown): string | null {
  const r = graphId.safeParse(v);
  return r.success ? r.data : null;
}
function strOrNull(v: unknown): string | null {
  const r = optStr.safeParse(v);
  return r.success && r.data !== undefined ? r.data : null;
}

export function parseSessionEvent(raw: unknown): SessionEvent | null {
  let json: unknown = raw;
  if (typeof raw === 'string') {
    try { json = JSON.parse(raw); } catch { return null; }
  }
  const env = envelope.safeParse(json);
  if (!env.success) return null;
  const data = env.data.data ?? {};

  if ((FINISH_EVENTS as readonly string[]).includes(env.data.event)) {
    return {
      kind: 'finish',
      event: env.data.event as FinishEvent,
      wabaId: idOrNull(data.waba_id),
      phoneNumberId: idOrNull(data.phone_number_id),
    };
  }
  if (env.data.event === 'CANCEL' || env.data.event === 'ERROR') {
    if (data.error_code !== undefined || data.error_message !== undefined) {
      return {
        kind: 'error',
        errorCode: strOrNull(data.error_code),
        sessionId: strOrNull(data.session_id),
        message: strOrNull(data.error_message),
      };
    }
    return { kind: 'cancel', currentStep: strOrNull(data.current_step) };
  }
  return null;
}
```

- [ ] **Step 4: להריץ ולראות שהבדיקות עוברות.** Expected: PASS
- [ ] **Step 5: Commit** (`feat(whatsapp): parse Embedded Signup session events with a strict origin check`)

---

### Task 4: קריאות ה-Graph והתזמור בצד השרת

**Files:**
- Create: `src/lib/whatsapp/embedded-signup/graph.ts`
- Create: `src/lib/data/admin/integrations/whatsapp-es.ts`
- Test: `src/lib/whatsapp/embedded-signup/graph.test.ts`, `src/lib/data/admin/integrations/whatsapp-es.test.ts`

**Interfaces:**
- Consumes: `resolveMetaAppId` ו-`debugToken().granularScopes` (משימה 2), `FinishEvent` (משימה 3), `getWhatsAppConfig`, `listWabaPhoneNumbers`, `createAdminClient`, `requirePlatformOwner`, `GRAPH_API_VERSION`.
- Produces:
  ```ts
  // graph.ts
  export async function exchangeCodeForBusinessToken(i: { appId: string; appSecret: string; code: string }): Promise<string>;
  export async function subscribeAppToWaba(i: { wabaId: string; token: string }): Promise<void>;
  export async function getCoexistenceStatus(i: { phoneNumberId: string; token: string }): Promise<{ isOnBizApp: boolean | null; platformType: string | null }>;
  export async function requestSmbSync(i: { phoneNumberId: string; token: string; syncType: 'smb_app_state_sync' | 'history' }): Promise<{ requestId: string }>;
  // whatsapp-es.ts
  export const ES_PROVIDER = 'meta_whatsapp_es';
  export const ES_KIND = 'business_token';
  export type EsConnectResult =
    | { ok: true; display: string; isOnBizApp: boolean | null; platformType: string | null; sync: { contacts: 'requested' | 'failed'; history: 'requested' | 'failed' } }
    | { ok: false; message: string };
  export async function connectViaEmbeddedSignup(input: { code: string; finishEvent: FinishEvent }): Promise<EsConnectResult>;
  export type EsConnectionRow = { label: string; status: string; createdAt: string; phoneNumberId: string | null; syncRequestedAt: string | null };
  export async function listEsConnections(): Promise<EsConnectionRow[]>;
  export async function getEsReadiness(): Promise<{ ready: true; appId: string; configId: string } | { ready: false; reason: string }>;
  export async function isEsConnectedPhoneNumber(phoneNumberId: string): Promise<boolean>; // worker path, service role
  ```

**הזרימה של `connectViaEmbeddedSignup`**

סדר הפעולות מחייב. בכל כישלון מחזירים `{ok:false}` עם הודעה בעברית בטוחה, בלי קוד ובלי טוקן.

1. `requirePlatformOwner()` ו-`getEsReadiness()`. אם `finishEvent !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'`, להחזיר "סוג חיבור זה אינו נתמך בגרסה זו". לפי YAGNI, רק Coexistence בגרסה הזו.
2. `exchangeCodeForBusinessToken`. אם נכשל: "תוקף הקוד פג או שהחיבור נדחה. נסו שוב."
3. `debugToken({token})`. לקחת את ה-`targetIds` של `whatsapp_business_management`. בדיוק WABA אחד ממשיך. אפס או יותר מאחד מחזיר שגיאה בטוחה, ושום דבר לא נשמר.
4. `subscribeAppToWaba`.
5. `listWabaPhoneNumbers({wabaId, accessToken: token})`. בדיוק מספר אחד ממשיך. **ASSUMPTION:** ב-Coexistence נוצר WABA עם המספר הזה בלבד. אם יש כמה מספרים, להחזיר שגיאה בטוחה ("נמצאו כמה מספרים ב-WABA — פנו לתמיכה").
6. `getCoexistenceStatus`. הערך הצפוי: `isOnBizApp:true` ו-`platformType:'CLOUD_API'`.
7. **לשמור את הטוקן** (`integrations_write_credential`, service role) **לפני הסנכרון**. אם השמירה נכשלת, לא מפעילים סנכרון, כי בלי טוקן שמור אין דרך לחזור לחיבור.
   - `p_label`: `WhatsApp ${display_phone_number}`
   - `p_metadata`: `{ wabaId, phoneNumberId, finishEvent, isOnBizApp, platformType, connectedAt }`
   - `p_created_by`: `user.id`
   - `p_expires_at`: `null`, או לפי `expiresAt` מ-debug_token כש-`>0`.
8. **שער מנוי:** `readWhatsAppSubscription(getAppSubscriptions(...))` חייב להחזיר `ok`. אחרת להריץ `subscribeWhatsAppWebhook` (הקיים, אידמפוטנטי) ולבדוק שוב. אם עדיין לא `ok`: **לא מפעילים סנכרון**, ולהחזיר "החיבור נשמר אבל רישום ה-webhooks נכשל — אל תמשיכו. יש 24 שעות לתקן."
9. `requestSmbSync('smb_app_state_sync')`, ואחריו `requestSmbSync('history')`. את `request_id` ואת `syncRequestedAt` שומרים ב-metadata (`update` על השורה). כישלון של שלב אחד לא מבטל את השני.
10. `logActivity({ action: 'admin.integrations.whatsapp_es_connected', meta: { finishEvent, platformType, isOnBizApp, contactsSync, historySync } })`, בלי מזהים ובלי מספר טלפון, ו-`sendSlackAlert` ברמת `info`.

- [ ] **Step 1: לכתוב את הבדיקות שנכשלות** (`graph.test.ts`, עם `fetch` מדומה, באותו סגנון כמו `subscriptions.test.ts`)

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { GRAPH_API_VERSION } from '../graph-version';
import { exchangeCodeForBusinessToken, requestSmbSync, subscribeAppToWaba } from './graph';

const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as unknown as Response;
let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy); });
afterEach(() => vi.unstubAllGlobals());

describe('exchangeCodeForBusinessToken', () => {
  it('GETs oauth/access_token on the pinned version and returns access_token', async () => {
    fetchSpy.mockResolvedValueOnce(json({ access_token: 'BIZ', token_type: 'bearer' }));
    await expect(exchangeCodeForBusinessToken({ appId: '1', appSecret: 'SECRET', code: 'CODE' })).resolves.toBe('BIZ');
    const url = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(url.pathname).toBe(`/${GRAPH_API_VERSION}/oauth/access_token`);
    expect(url.searchParams.get('client_id')).toBe('1');
    expect(url.searchParams.get('code')).toBe('CODE');
  });

  it('never puts the secret or the code in the thrown message', async () => {
    fetchSpy.mockResolvedValueOnce(json({ error: { code: 100, message: 'code CODE secret SECRET' } }, false, 400));
    const err = await exchangeCodeForBusinessToken({ appId: '1', appSecret: 'SECRET', code: 'CODE' }).catch((e: Error) => e);
    expect(String(err)).not.toMatch(/SECRET|CODE/);
    expect(String(err)).toContain('code 100');
  });
});

describe('subscribeAppToWaba', () => {
  it('POSTs /{waba}/subscribed_apps with the business token', async () => {
    fetchSpy.mockResolvedValueOnce(json({ success: true }));
    await subscribeAppToWaba({ wabaId: '222', token: 'BIZ' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/${GRAPH_API_VERSION}/222/subscribed_apps`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer BIZ');
  });
  it('throws on success:false', async () => {
    fetchSpy.mockResolvedValueOnce(json({ success: false }));
    await expect(subscribeAppToWaba({ wabaId: '222', token: 'BIZ' })).rejects.toThrow();
  });
});

describe('requestSmbSync', () => {
  it('POSTs smb_app_data with the sync type and returns request_id', async () => {
    fetchSpy.mockResolvedValueOnce(json({ messaging_product: 'whatsapp', request_id: 'R1' }));
    await expect(requestSmbSync({ phoneNumberId: '9', token: 'BIZ', syncType: 'history' })).resolves.toEqual({ requestId: 'R1' });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ messaging_product: 'whatsapp', sync_type: 'history' });
  });
});
```

ב-`whatsapp-es.test.ts` צריך לדמות את `@/lib/auth/dal`, `@/lib/whatsapp/debug-token`, `./graph`, `@/lib/whatsapp/phone-numbers`, `@/lib/whatsapp/subscriptions`, `@/lib/supabase/admin`, `@/lib/data/activity` ו-`@/lib/alerts/slack`. הבדיקות:
- **טוקן בלי WABA** ← `ok:false`, ולא נקראת פונקציית rpc. (Review Focus 3)
- **שני targetIds** ← `ok:false`, ולא נקראת rpc. (Review Focus 3)
- **סוג סיום לא נתמך:** `finishEvent:'FINISH'` ← `ok:false`, ו-`exchangeCodeForBusinessToken` לא נקראת.
- **המנוי לא `ok` גם אחרי רישום מחדש** ← `requestSmbSync` לא נקראת, והטוקן **כן** נשמר.
- **היסטוריה נכשלת, אנשי קשר הצליחו** ← `ok:true` עם `sync.history==='failed'`. (Review Focus 4)
- **מסלול מוצלח:** rpc נקראת עם `p_provider:'meta_whatsapp_es'`, `p_credential_kind:'business_token'` ו-`p_created_by:user.id`.
- **`logActivity`** נקרא, וה-meta שלו לא מכיל `wabaId`, `phoneNumberId` או טוקן.
- **הרשאה:** `requirePlatformOwner` שנזרקת ← `connectViaEmbeddedSignup` נזרקת, ולא מתבצעת אף קריאה חיצונית.

- [ ] **Step 2: להריץ ולראות שהבדיקות נכשלות**
Run: `npx vitest run src/lib/whatsapp/embedded-signup src/lib/data/admin/integrations/whatsapp-es.test.ts`
Expected: FAIL

- [ ] **Step 3: לממש `graph.ts`**

```ts
import 'server-only';
import { GRAPH_API_VERSION } from '../graph-version';

// Server-to-server calls of Meta's Tech Provider onboarding + Coexistence sync.
// Errors carry HTTP status and Meta's numeric code ONLY — never the message
// (Meta echoes request params), never the token, code or app secret.

const BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
type GraphErr = { error?: { code?: number } };

function fail(what: string, res: Response, body: GraphErr): Error {
  return new Error(`${what} failed: HTTP ${res.status}${body.error?.code ? ` (code ${body.error.code})` : ''}`);
}

export async function exchangeCodeForBusinessToken(i: { appId: string; appSecret: string; code: string }): Promise<string> {
  const url = new URL(`${BASE}/oauth/access_token`);
  url.searchParams.set('client_id', i.appId);
  url.searchParams.set('client_secret', i.appSecret);
  url.searchParams.set('code', i.code);
  // The code lives 30 seconds; a slow Meta must not hold the action open past it.
  const res = await fetch(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as GraphErr & { access_token?: unknown };
  if (!res.ok || typeof body.access_token !== 'string' || body.access_token === '') throw fail('token exchange', res, body);
  return body.access_token;
}

export async function subscribeAppToWaba(i: { wabaId: string; token: string }): Promise<void> {
  const res = await fetch(`${BASE}/${encodeURIComponent(i.wabaId)}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${i.token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as GraphErr & { success?: boolean };
  if (!res.ok || body.success !== true) throw fail('subscribed_apps', res, body);
}

export async function getCoexistenceStatus(i: { phoneNumberId: string; token: string }): Promise<{ isOnBizApp: boolean | null; platformType: string | null }> {
  const res = await fetch(`${BASE}/${encodeURIComponent(i.phoneNumberId)}?fields=is_on_biz_app,platform_type`, {
    headers: { Authorization: `Bearer ${i.token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as GraphErr & { is_on_biz_app?: unknown; platform_type?: unknown };
  if (!res.ok) throw fail('phone status', res, body);
  return {
    isOnBizApp: typeof body.is_on_biz_app === 'boolean' ? body.is_on_biz_app : null,
    platformType: typeof body.platform_type === 'string' ? body.platform_type : null,
  };
}

// ⚠️ ONE-SHOT per sync type: Meta allows each exactly once per onboarding;
// a repeat needs the customer to offboard and redo the flow. Never retried here.
export async function requestSmbSync(i: { phoneNumberId: string; token: string; syncType: 'smb_app_state_sync' | 'history' }): Promise<{ requestId: string }> {
  const res = await fetch(`${BASE}/${encodeURIComponent(i.phoneNumberId)}/smb_app_data`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${i.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: i.syncType }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as GraphErr & { request_id?: unknown };
  if (!res.ok || typeof body.request_id !== 'string') throw fail(`smb_app_data ${i.syncType}`, res, body);
  return { requestId: body.request_id };
}
```

**UNVERIFIED:** צורת התשובה של `oauth/access_token`. במסמך של Meta התשובה מתוארת רק כ-`<BUSINESS_TOKEN>`. הקוד מצפה ל-JSON עם `access_token`, שזו הצורה הרגילה של Graph OAuth. בהרצה החיה הראשונה, אם ההחלפה נכשלת עם HTTP 200, זו הסיבה הראשונה לבדוק.

- [ ] **Step 4: לממש את `whatsapp-es.ts`** לפי "הזרימה" שלמעלה.
  - `getEsReadiness()` בודק שלושה דברים: `resolveMetaAppId()`, `process.env.META_ES_CONFIG_ID` שעומד ב-`/^\d{5,32}$/`, ו-`getWhatsAppConfig()?.appSecret`. לכל אחד מהם יש `reason` בעברית שמסביר מה חסר.
  - `listEsConnections()`: דרך `requirePlatformPermission('manage_settings')`, service role, ו-`select('label,status,created_at,metadata')` עם `.eq('provider', ES_PROVIDER)`. מחזיר רק את השדות של `EsConnectionRow`, בלי ids ובלי vault. (דפוס: `workflow-connections.ts:87`.)
  - `isEsConnectedPhoneNumber(id)`: service role, בלי שער משתמש, כי זה נתיב worker. `.eq('provider', ES_PROVIDER).eq('status','active').eq('metadata->>phoneNumberId', id)` עם `limit(1)`. אם הקריאה נכשלת היא **זורקת** ולא מחזירה false, באותו עיקרון fail-closed שמוסבר ב-`channel-routing.ts:33-37`.

- [ ] **Step 5: להריץ את כל הבדיקות ולראות שעוברות.** Expected: PASS
- [ ] **Step 6: Commit** (`feat(whatsapp): Embedded Signup Coexistence onboarding domain (server-side WABA derivation, vault storage, one-shot sync)`)

---

### Task 5: הודעות למספר מחובר עוברות בשקט

**Files:**
- Modify: `src/lib/data/webhook-processing.ts:96-110` (`WebhookBatchContext`) ו-`:257-275` (הענף `unknown`)
- Test: `src/lib/data/webhook-processing.test.ts`

**Interfaces:**
- Consumes: `isEsConnectedPhoneNumber` (משימה 4)
- Produces: `WebhookBatchContext.isEsConnected(phoneNumberId: string): Promise<boolean>`, עם memo לכל batch.

- [ ] **Step 1: לכתוב את הבדיקה שנכשלת.** שורת `message` עם `phone_number_id` של מספר מחובר. `isEsConnected` מחזיר true, ולכן **לא** נקראים `sendSlackAlert`, `insertInteraction` ו-`submitRsvp`. בנוסף, בדיקה שמספר לא מוכר ולא מחובר עדיין שולח את ההתראה, כדי לוודא שההתנהגות הקיימת לא נשברה.
- [ ] **Step 2: להריץ ולראות שהבדיקה נכשלת**
- [ ] **Step 3: לממש.** בתוך `if (inbound === 'unknown')`, לפני ההתראה:

```ts
    // A number connected through Embedded Signup (Coexistence) — the owner's
    // WhatsApp Business app number. Its customers are not our guests: never
    // billed, never RSVP, and not an anomaly worth a Slack line per message.
    // The row stays in webhook_inbox (inspectable in /admin/webhooks); what to
    // do with these conversations is an open owner decision.
    if (row.phone_number_id && (await ctx.isEsConnected(row.phone_number_id))) return;
```

`createWebhookBatchContext` מקבל `isEsConnected` עם `Map` של cache, ששומר רק תוצאות מוצלחות, כמו שמוסבר בהערה בשורות 104-107.
- [ ] **Step 4: להריץ ולראות שהבדיקות עוברות**
Run: `npx vitest run src/lib/data/webhook-processing.test.ts`
Expected: PASS
- [ ] **Step 5: Commit** (`fix(webhooks): messages to an Embedded Signup–connected number are stored silently, not alerted`)

---

### Task 6: העמוד, ה-action ורכיב הלקוח

**Files:**
- Create: `src/app/(admin)/admin/integrations/meta-whatsapp/connect/page.tsx`, `actions.ts`, `embedded-signup-launcher.tsx`
- Modify: `src/app/(admin)/admin/integrations/meta-whatsapp/page.tsx` (סקציה עם קישור "חיבור מספר WhatsApp Business קיים (Coexistence)")
- Test: `.../connect/page.test.ts`, `.../connect/actions.test.ts`

**Interfaces:**
- Consumes: `getEsReadiness`, `listEsConnections`, `connectViaEmbeddedSignup`, `EsConnectResult` (משימה 4), `parseSessionEvent`, `isMetaOrigin` (משימה 3), `GRAPH_API_VERSION`.
- Produces: `connectEmbeddedSignupAction(input: { code: string; finishEvent: string }): Promise<EsConnectResult>`

**action (דק):**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { connectViaEmbeddedSignup, type EsConnectResult } from '@/lib/data/admin/integrations/whatsapp-es';

const schema = z.object({
  code: z.string().min(10).max(2048),
  finishEvent: z.enum(['FINISH', 'FINISH_ONLY_WABA', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING']),
});

// Gate is requirePlatformOwner INSIDE connectViaEmbeddedSignup (a Server Action
// is reachable without rendering the page). Called with a plain object, not a
// form, because the launcher fires it from the FB.login callback within the
// code's 30-second life.
export async function connectEmbeddedSignupAction(input: unknown): Promise<EsConnectResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'נתוני החיבור אינם תקינים' };
  try {
    const r = await connectViaEmbeddedSignup(parsed.data);
    revalidatePath('/admin/integrations/meta-whatsapp/connect');
    return r;
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, message: 'החיבור נכשל. נסו שוב.' };
  }
}
```

**רכיב הלקוח (`'use client'`), מצבי תצוגה.**
- **idle:** כפתור "חיבור עם Meta". הכפתור מושבת עד שה-SDK נטען, ואם `ready:false` מוצגת הסיבה.
- **connecting:** בזמן שהחלון פתוח, או בזמן שה-action רץ.
- **success:** מוצגים המספר, `platformType` ו-`isOnBizApp`, והודעה "השאירו את אפליקציית WhatsApp Business פתוחה — הסנכרון נמשך כמה דקות".
- **cancelled:** "החיבור בוטל בשלב X", עם תרגום לעברית של `current_step`.
- **error:** מוצגים `errorCode` ו-`sessionId`, כי Meta מבקשת את שניהם בפנייה לתמיכה.
- **sdk-failed:** "לא ניתן לטעון את רכיב ההתחברות של Meta".

**מימוש:**
- **טעינת ה-SDK:** `next/script` עם `src="https://connect.facebook.net/en_US/sdk.js"` ו-`strategy="afterInteractive"`. ב-`onLoad` נקרא `FB.init({ appId, autoLogAppEvents: false, xfbml: false, version: GRAPH_API_VERSION })`. ב-`onError` המצב עובר ל-sdk-failed.
- **מאזין message:** `window.addEventListener('message', ...)` בתוך `useEffect`, עם cleanup. קודם נבדק `isMetaOrigin(event.origin)`, ואז `parseSessionEvent(event.data)`. אירוע `finish` נשמר ב-ref, ורק `finishEvent` נשלח ל-action. אירועי `cancel` ו-`error` מעבירים את העמוד למצב המתאים.
- **הפעלה:**

  ```ts
  FB.login(cb, {
    config_id: configId,
    response_type: 'code',
    override_default_response_type: true,
    extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
  })
  ```

- **callback:** אם `response.authResponse?.code` קיים, ה-action נקרא **מיד**. אם `finishEvent` עוד לא הגיע, נשלח `'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'`, כי זה הסוג היחיד שהכפתור מפעיל, והשרת גוזר את כל השאר מהטוקן בעצמו. אם אין `authResponse`, המצב עובר ל-cancelled, **בלי** קריאה ל-action.
- **טיפוס של `window.FB`:** ממשק מינימלי ב-`declare global` בתוך הקובץ: `init`, `login`. לא `any`.
- **אין `console.log`** של code או response. התיעוד של Meta אומר במפורש להסיר את השורות האלה.

**העמוד:**
- `await requirePlatformOwner()`, ובמקביל `Promise.all([getEsReadiness(), listEsConnections()])`.
- כותרת והסבר קצר על Coexistence: שני המקומות עובדים במקביל, מגבלה של 20 הודעות לשנייה, ניתוק רק מהטלפון, וסנכרון חד-פעמי תוך 24 שעות.
- ה-launcher.
- טבלת החיבורים הקיימים: תווית, סטטוס, תאריך, ומתי הסנכרון הופעל.
- קישור חזרה ל-`/admin/integrations/meta-whatsapp`.

- [ ] **Step 1: לכתוב את הבדיקות שנכשלות**
  - **`page.test.ts`**, באותו סגנון כמו `numbers/page.test.ts`: עם `ready:false` הסיבה מוצגת ו-`configId` לא מועבר ל-launcher. עם `ready:true` ה-launcher מקבל `appId` ו-`configId`. `requirePlatformOwner` נקרא.
  - **`actions.test.ts`:** קלט לא תקין מחזיר `ok:false`, ו-`connectViaEmbeddedSignup` לא נקראת. קלט תקין מעביר את `code` ואת `finishEvent`.
- [ ] **Step 2: להריץ ולראות שהבדיקות נכשלות**
- [ ] **Step 3: לממש**
- [ ] **Step 4: להריץ את הבדיקות, ואז `npm run lint`, `npx tsc --noEmit`, `npm run build`.** לזכור ש-build תופס exports לא חוקיים בקבצי route, ו-tsc לא תופס אותם.
- [ ] **Step 5: Commit** (`feat(admin): WhatsApp Embedded Signup (Coexistence) connect page`)

---

### Task 7: אימות runtime, רק אחרי P1 עד P4 ורק באישור של בעל המוצר

- [ ] לוודא ש-`getAppSubscriptions` מחזיר את 7 השדות (השער של משימה 1).
- [ ] לפתוח את `/admin/integrations/meta-whatsapp/connect` בכרום:
  - הכפתור פעיל.
  - אין שגיאות ב-console.
  - ה-SDK נטען, ובלשונית Network רואים `connect.facebook.net`.
- [ ] **הרצה חיה אחת בלבד:** בעל המוצר מבצע את החלון בעצמו ובוחר בו את המספר. אחרי ההרצה לבדוק:
  - ב-`integration_connections` יש שורה `meta_whatsapp_es/business_token` בסטטוס `active`.
  - ב-metadata: `platformType='CLOUD_API'`, `isOnBizApp=true`, ושני `request_id`.
  - ב-`webhook_inbox` מופיעות שורות `smb_app_state_sync` ו-`history`.
  - הודעת בדיקה למספר לא מייצרת התראת Slack ולא מייצרת `contact_interactions`.
- [ ] לוודא שבשורה של `app_settings` ובטבלה `provider_number_roles` **לא השתנה כלום**. להשוות select לפני ואחרי.

## Out of scope

אלה לא נכנסים לתוכנית הזו, וכל אחד מהם הוא החלטה נפרדת של בעל המוצר:
- תצוגה של echoes או של ההיסטוריה.
- ייבוא אנשי הקשר מהסנכרון.
- טיפול ב-`account_update` מסוג `PARTNER_REMOVED` (סימון החיבור כ-`revoked`).
- הרשמה רגילה (`FINISH`) עם PIN ורישום מספר.
- שיוך תפקיד למספר.
- שליחה מהמספר המחובר.
- החלפה של פרטי החיבור הקיימים.
