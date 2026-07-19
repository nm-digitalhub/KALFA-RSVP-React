# מחקר דוקומנטציית Voximplant — קורפוס מלא

מחקר שיטתי של **כל** עץ התיעוד הרשמי של Voximplant (2,147 עמודים) + אוסף ה־Postman המלא של Voximplant Kit API (149 בקשות), שבוצע ב־2026-07-19 ע"י 36 סוכני מחקר (Workflow של 34 + 2 סוכני השלמת־פער), עם מבקר שלמות שאימת כיסוי מול ה־ground truth של העץ.

## מבנה

| קובץ/תיקייה | תוכן |
|---|---|
| `FINAL-voximplant-docs-research.md` | הדו"ח הסופי (עברית, 6 פרקים): תקציר, 4 עמודי־תווך, ממצאים קריטיים ל־KALFA, פערים, נספחי כיסוי והשלמה |
| `digest-platform-guides.md` | סינתזה: getting-started + כל 12 תתי־guides + voice-ai |
| `digest-voxengine-ref.md` | סינתזה: רפרנס VoxEngine המלא (core, callflow, AI, providers, voximplantapi, avatar) |
| `digest-management-api.md` | סינתזה: HTTP Management API (CallLists/Scenarios/History בעומק מלא) |
| `digest-kit-sdk.md` | סינתזה: Voximplant Kit API + Client SDKs |
| `research/` | 30 קבצי notes גולמיים פר קבוצת מחקר (כולל `vox-ref-gap-a/b.md` — השלמת 143 עמודי הרפרנס) |
| `tools/extract.js` | מחלץ JSON→markdown לעמודי הדוקס (כולל טיפול ב־`children` של מחלקות) |
| `tools/voxengine-orphans.txt` | מניפסט 143 העמודים שנמצאו לא־משויכים ע"י ה־critic ונסגרו |

## מתכון גישה לדוקס (לשימוש חוזר)

התוכן נגיש פרוגרמטית, בלי גרידת SPA:

```bash
# עץ מלא (2.4MB JSON, כולל היררכיה)
curl -s 'https://voximplant.com/api/v2/getTree'

# עמוד בודד לפי fqdn מנוקד (ה-URL הציבורי = fqdn עם נקודות→סלשים)
curl -s 'https://voximplant.com/api/v2/getDoc?fqdn=guides.solutions.call-lists' | node tools/extract.js
```

**גוצ'ות ידועות**:
- חברי מחלקות (methods/props של `Call`, `ASR`...) יושבים במערך `children` בתוך ה־JSON של עמוד המחלקה — מחלץ שקורא רק content blocks מפספס אותם (`extract.js` כאן כבר מטפל).
- חלק מדוגמאות הקוד מוגשות כ־code fences ריקים ב־API (רינדור צד־לקוח) — מגבלת פלטפורמה.
- Kit API: האוסף המלא ב־`https://documenter.gw.postman.com/api/collections/24429561-2db2ab94-821b-4acb-88f7-01979c5b2692/2s93m33im7`.

## תקציר מסקנות (פירוט מלא בדו"ח)

1. הארכיטקטורה הקיימת (StartScenarios + ctx/cb + ניקוד) מאוששת כדפוס הקנוני המתועד.
2. **CallList** = הפתרון הפלטפורמי לקמפיינים; עוקף את תקרת 200 הבתים (custom_data פר־שורת CSV); חובה `reportResult`/`reportError` בכל מסלול יציאה; חלונות UTC+0; נעצר מתחת ל־$1 יתרה.
3. אין AMD לישראל — חלופות: beep detection, DTMF, זיהוי ב־LLM.
4. ElevenLabs בשלושה מסלולים (VoiceList / RealtimeTTSPlayer / AgentsClient); תמיכת עברית לא מתועדת.
5. שדרוג גשר Groq: `OpenAI.ChatCompletionsAPIClient` + `baseUrl`, מפתחות ב־Secrets/`getSecretValue`.
6. Kit לא מומלץ (מוצר נפרד, עברית חלשה); תבניות ה־DNC/retry שלו שוות שיקוף.
