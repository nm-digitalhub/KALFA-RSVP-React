# Eleven v4 Turbo דרך Wiro AI — סיכום API

> מקור: https://wiro.ai/models/elevenlabs/eleven-v4-turbo
> סיכום מובנה במילים שלי.

## כללי
| | |
|---|---|
| ספק | ElevenLabs (דרך Wiro) |
| קטגוריה | Text to Speech |
| Endpoint | `POST https://api.wiro.ai/v1/Run/elevenlabs/eleven-v4-turbo` |
| Auth | Header `x-api-key: <WIRO_API_KEY>` |
| פלט | קובץ MP3 יחיד |

## פרמטרים
| פרמטר | חובה | ערכים | הערות |
|---|---|---|---|
| `prompt` | ✅ | טקסט עד 10,000 תווים | תומך ב-audio tags כמו `[whispering]`, `[laughing]`, `[shouting]`, `[excited]` |
| `voice` | ✅ | adam, alice, bella, bill, brian, callum, charlie, chris, daniel, eric, george, harry, jessica, laura, liam, lily, matilda, river, roger, sarah, will | קולות מובנים בלבד |
| `outputFormat` | ✅ | `mp3_22050_32`, `mp3_44100_32`, `mp3_44100_64`, `mp3_44100_96`, `mp3_44100_128` | ברירת מחדל: `mp3_44100_128` |
| `languageCode` | ❌ | `auto` או קוד שפה | `auto` מזהה את השפה מהטקסט. בחירה מפורשת משפיעה גם על הקראת מספרים ותאריכים. |
| Timestamps | ❌ | `true` / `false` | אם `true`, מוחזר גם JSON עם זמני התחלה וסיום לכל מילה |
| `stability` | ❌ | 0–1 | ערך נמוך נותן יותר רגש וגיוון, ערך גבוה נותן הגשה יציבה |
| `similarity` | ❌ | 0–1 | ערך גבוה צמוד יותר לקול, ועשוי להיות פחות טבעי |

> העמוד מציין 4 הגדרות מתקדמות, אבל לא את כל שמות השדות. את שם השדה המדויק ל-timestamps ולהגדרות המתקדמות כדאי לאמת מול ה-JSON schema בעמוד.

## דוגמת בקשה
```bash
curl -X POST "https://api.wiro.ai/v1/Run/elevenlabs/eleven-v4-turbo" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $WIRO_API_KEY" \
  -d '{
    "prompt": "[friendly] שלום! [calm] איך אפשר לעזור?",
    "voice": "alice",
    "outputFormat": "mp3_44100_128",
    "languageCode": "auto"
  }'
```

## מגבלות
- עד 10,000 תווים בבקשה אחת.
- אין תמיכה ב-SSML (כולל break tags) במשפחת v4. שולטים בהשהיות עם פיסוק ו-tags.
- Tags לא תמיד מבוצעים במלואם.
- קלט לא מסודר (אותיות גדולות, חוסר פיסוק, סגנון tags לא עקבי) פוגע בקצב ובטבעיות.
- **ב-Wiro הפלט הוא MP3 בלבד.** אין PCM, Opus או codecs טלפוניים (μ-law וכו'). לטלפוניה צריך לעבוד ישירות מול ElevenLabs.

## שימושים מוצעים
סוכני קול בזמן אמת, דמויות במשחקים, voiceovers קצרים, קולות עוזר עקביים, ולוקליזציה עם אותו קול.

## בטיחות
חלה מדיניות השימוש של ElevenLabs: נדרשת הסכמה לשיבוט קול, אסור להשתמש בהתחזות או בהונאה, חלק מהקולות חסומים לשיבוט, וייתכן שהאודיו כולל סימני מעקב (traceability).
