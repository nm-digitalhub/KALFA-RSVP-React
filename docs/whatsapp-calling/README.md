# WhatsApp Business Calling API — תיעוד

תיעוד ה-Calling API של WhatsApp Cloud API, שנמשך ב-14.09.2026.

## איך זה נמשך, ולמה לא בזחלן

`scripts/scraper-v1.mjs` לא מגיע לעמודים האלה. `developers.facebook.com` עונה
**HTTP 400** לכל בקשת HTTP רגילה מהשרת הזה — נבדק על שלוש צורות URL, עם
User-Agent ו-Accept-Language של דפדפן אמיתי. המסלול המוסמך הוא ה-MCP של Meta
(`devtools_discovery` / `search_docs`), שמחזיר את טקסט העמוד עצמו.

להפקה מחדש:

```
node scripts/meta-docs-to-md.mjs <results-dir> docs/whatsapp-calling /calling
```

## ⚠️ מה הקבצים האלה כן ומה הם לא

החיפוש מחזיר **קטעים שהתאימו לשאילתה**, לא עמוד שלם. זה מספיק כדי לעבוד מולו,
ואינו תחליף לעמוד החי כשמדובר בחוזה מדויק לבייט. כל קובץ נושא את כתובת המקור
שלו בכותרת. תפריט הניווט של Meta — כ-72,000 תווים שחזרו זהים בכל עמוד — סונן.

## העמודים

| קובץ | נושא | תווים |
|---|---|---|
| [`business-initiated-calls.md`](business-initiated-calls.md) | Business-initiated calls | 18,311 |
| [`call-button-messages-deep-links.md`](call-button-messages-deep-links.md) | Call Button Messages and Deep Links | 9,868 |
| [`call-recording.md`](call-recording.md) | Call recording | 6,384 |
| [`call-settings.md`](call-settings.md) | Configure Call Settings | 29,217 |
| [`call-transcription.md`](call-transcription.md) | Call transcription | 6,767 |
| [`calling-api.md`](calling-api.md) | WhatsApp Cloud API - Calling API | 7,576 |
| [`callsettings.md`](callsettings.md) | Call Settings - Messenger Platform | 11,978 |
| [`faq.md`](faq.md) | FAQs | 10,125 |
| [`index.md`](index.md) | Cloud API Calling API | 12,711 |
| [`integration-examples.md`](integration-examples.md) | Integration Examples | 18,554 |
| [`integration-patterns.md`](integration-patterns.md) | Integration Patterns | 12,316 |
| [`reference.md`](reference.md) | API and Webhook Reference | 12,440 |
| [`sandbox.md`](sandbox.md) | Using a Sandbox Account for Calling | 10,238 |
| [`sip.md`](sip.md) | Session Initiation Protocol (SIP) | 8,139 |
| [`troubleshooting.md`](troubleshooting.md) | Troubleshooting and Error Codes | 24,855 |
| [`user-call-permissions.md`](user-call-permissions.md) | Obtain User Call Permissions | 14,101 |
| [`user-initiated-calls.md`](user-initiated-calls.md) | User-initiated calls | 26,991 |
| [`v23.0.md.md`](v23.0.md.md) | Developer Documentation - Markdown | 5,779 |

## הקשר ל-KALFA

זה **ערוץ חיוג שלישי אפשרי**, לצד Voximplant + ElevenLabs שכבר בייצור. שלוש
עובדות מהתיעוד שקובעות אם הוא רלוונטי בכלל:

- **שיחה ביוזמת העסק דורשת הרשאה מהמשתמש** — לכל משתמש בנפרד, ויש מגבלות יומיות.
- **חשבון ייצור מוגבל ל-2,000 נמענים ייחודיים ביום** לפני שהיכולת נפתחת.
- **המדינה של מספר העסק חייבת להיות ברשימה הנתמכת** לשיחות יוצאות.

אף אחת מהן לא נבדקה מול החשבון של KALFA — זו הורדת תיעוד, לא הערכת היתכנות.
