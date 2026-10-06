# מפת נקודות הקצה של SUMIT CRM

נבנתה ב-5.10.2026 מ-`openapi/sumit.openapi.json` ומקוד הפרויקט. `swagger.json` שבשורש הפרויקט זהה לו בתוכן (אותו hash, 592,099 בתים).
החוזה: OpenAPI 3.1.1, "SUMIT API - Full", גרסה v1, 84 נתיבים. כולם `POST`, ובגוף כל בקשה יש `Credentials` (`CompanyID`, `APIKey`).
המפה לאחר מכן לפי נושאים, לכל 84 הנתיבים: [sumit-api-endpoints-by-topic-2026-10-05.md](sumit-api-endpoints-by-topic-2026-10-05.md).

## 12 נקודות CRM בחוזה

| נקודה | שדות בבקשה (* = חובה) | שימוש בקוד |
|---|---|---|
| `/crm/data/listentities/` | `Folder`, `IncludeInheritedFolders`, `Filters`, `Order`, `Paging`, `LoadProperties` | **אפליקציה:** `src/lib/sumit/crm-holds.ts` (`listSumitHolds`, שורה 55; כתובת בשורה 16) ← `src/lib/data/sumit-hold-reconcile.ts:86`. **סקריפטים:** `sumit-crm-list-holds.ts`, `sumit-crm-list-customers.ts` |
| `/crm/schema/listfolders/` | `NameFilter` | **אפליקציה:** `crm-triggers.ts` (`listSumitFolders`, שורה 73) ← `admin/sumit-trigger-subscriptions.ts:72` ← `(admin)/admin/workflows/actions.ts:302`. **סקריפט:** `sumit-crm-list-folders.ts`. **טסט:** `crm-triggers.test.ts` |
| `/crm/views/listviews/` | `*FolderID` | **אפליקציה:** `crm-triggers.ts` (`listSumitViews`, שורה 82) ← `admin/sumit-trigger-subscriptions.ts:81` ← `workflows/actions.ts:306` |
| `/crm/schema/getfolder/` | `*Folder`, `IncludeProperties` | סקריפט בלבד: `sumit-crm-probe.ts` (`PROBE_KIND=folder`). מוזכר בתיעוד צומת `trigger-sumit-card` |
| `/crm/data/getentity/` | `*EntityID`, `IncludeIncomingProperties`, `IncludeFields` | סקריפט בלבד: `sumit-crm-probe.ts` (`PROBE_KIND=entity`) |
| `/crm/data/createentity/` | `*Entity` | אין שימוש |
| `/crm/data/updateentity/` | `*Entity`, `CreateIfMissing`, `RemoveExistingProperties` | אין שימוש |
| `/crm/data/deleteentity/` | `*EntityID` | אין שימוש |
| `/crm/data/archiveentity/` | `*EntityID` | אין שימוש |
| `/crm/data/countentityusage/` | `*EntityID` | אין שימוש |
| `/crm/data/getentitieshtml/` | `*SchemaID`, `*ViewID`, `PDF` | אין שימוש |
| `/crm/data/getentityprinthtml/` | `*SchemaID`, `*EntityID`, `PDF` | אין שימוש |

**המסקנה:** הקוד קורא מה-CRM בלבד, מ-5 נקודות מתוך 12 (3 מהן בשימוש אפליקציה). מ-7 הנקודות שאינן בשימוש, 4 כותבות (`create`, `update`, `delete`, `archive`).

## Triggers (שייך ל-CRM, נתיב נפרד)

| נקודה | שדות | שימוש |
|---|---|---|
| `/triggers/triggers/subscribe/` | `*Credentials`, `URL`, `Folder` (מחרוזת), `View` (מספר), `TriggerType` | `crm-triggers.ts:91` (`subscribeSumitTrigger`) ← `admin/sumit-trigger-subscriptions.ts:215` |
| `/triggers/triggers/unsubscribe/` | `*Credentials`, `URL` | `crm-triggers.ts:104` ← `admin/sumit-trigger-subscriptions.ts:211, 239, 304` |

- סוגי שינוי (`TriggerType`): `CreateOrUpdate`, `Create`, `Update`, `Archive`, `Delete` (`SUMIT_TRIGGER_TYPES`, `crm-triggers.ts:23`).
- **אין נקודת רשימה:** לא נרשמת רשימת טריגרים קיימים, ולכן כתובת הטריגר נשמרת ב-Vault כדי שאפשר יהיה לבטל אותו. הכתובת היא סוד ואינה נרשמת בלוג ובהודעות שגיאה.
- הסקריפט `scripts/sumit-probe-endpoints.ts` בדק כמועמדים נתיבים שאינם בחוזה: `/crm/data/search/`, `/crm/schema/createfolder/`, `/triggers/triggers/list/`, `/triggers/triggers/history/`.
- המטען שמגיע ל-webhook נקרא בצומת `src/lib/workflow/nodes/trigger-sumit-card/` ובתבנית `catalogue/templates/sumit-hold-changed.ts`.

## מזהים קבועים

- **תיקיית "תפיסות מסגרת":** `1076735289` (`src/lib/sumit/hold-status.ts:12`). נבדקה חיה ב-30.8.2026. סטטוסים: `1` פתוחה, `3` שוחררה ידנית (`2` חויבה: ראיה חלשה יותר, ללא שם מיוצא).
- **תיקיית לקוחות:** `1076734599`, מופיעה רק ב-`scripts/sumit-crm-list-customers.ts`.
- SUMIT שולחת קוד ולא שם: `Billing_Status` הוא enum, ו-`getfolder` מחזיר אותו בלי תוויות. השמות שבקוד הם שלנו.

## גבולות האינטגרציה הנוכחית

- אין API לשחרור תפיסה ב-SUMIT: השחרור נעשה ידנית בדשבורד, והקוד רק מגלה אותו בדיעבד דרך `listentities` (`crm-holds.ts:5-9`).
- דף אחד, מהחדש לישן (`PageSize` ברירת מחדל 100), מכוון: הקוד משווה מול מעט תפיסות פתוחות במסד.

## איך לחדש את המפה

- חוזה: `openapi/sumit.openapi.json` (מקור: `swagger.json`).
- שימוש בקוד: סריקת מחרוזות (לא הערות) לכל נתיב בחוזה, בקבצי TypeScript/JavaScript שאינם תיעוד.
