# Eleven v4 — תיעוד טכני (סיכום)

> מקור: https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4
> סיכום מובנה במילים שלי. דוגמאות הטקסט הקריאטיביות מהעמוד לא הועתקו.
> טיפ: ElevenLabs מציעה גרסת Markdown רשמית לכל עמוד, בהוספת `.md` לסוף ה-URL.

## סקירה
Eleven v4 הוא מודל ה-TTS המתקדם ביותר של ElevenLabs. הוא משפר את v3 באיכות, בדיוק הקול, בעקביות, ברגש, בהגשה, ב-audio tags ובכיסוי השפות. ElevenLabs ממליצה לעבור אליו ולבדוק אותו עם הקולות והתוכן שלך.

## Model variants
| שם | Model ID | מיועד ל |
|---|---|---|
| Eleven v4 | `eleven_v4` | האיכות הגבוהה ביותר: תוכן, ספרי שמע, דמויות |
| Eleven v4 Turbo | `eleven_v4_turbo` | איכות גבוהה מאוד עם latency נמוך: סוכני שיחה וחוויות אינטראקטיביות |

## Voice settings
| הגדרה | נתמך | הסבר |
|---|---|---|
| `stability` | ✅ | ערך נמוך נותן הגשה מגוונת ואקספרסיבית. ערך גבוה שומר על הגשה יציבה. |
| `similarity` | ✅ | ערך גבוה מצמיד את הפלט לקול המקור, לפעמים על חשבון טבעיות. |
| `style` | ❌ | לא זמין ב-v4 |
| `speed` | ❌ | לא זמין ב-v4 |
| SSML | ❌ | לא נתמך. שולטים בהגשה עם פיסוק ו-audio tags. |

## Audio tags
תגיות בסוגריים מרובעים מכוונות את ההגשה, למשל `[whispering]`, `[shouting]`, `[laughing]`, `[casual]`, `[annoyed]`, `[sigh]`. ב-v4 הן מתפרשות בעדינות רבה יותר מבעבר, אבל עדיין לא תמיד מבוצעות בצורה מלאה. ElevenLabs ממשיכה לשפר את זה.

## Voice cloning
- **IVC (Instant Voice Clone):** מדויק משמעותית יותר מבעבר. דגימה של דקה עד שתיים מספיקה, בלי שלב אימון.
- **PVC (Professional Voice Clone):** נתמך במלואו, בתהליך הפצה הדרגתי. כדי לאמן PVC קיים על v4, נכנסים ל-My Voices, מרחפים מעל הקול ולוחצים על ➕ ליד Eleven v4.
- **השלכה:** v4 משחזר טוב יותר את מאפייני המקור (גוון, קצב, הגשה, עוצמה, מבטא), ולכן קול עשוי להישמע שונה מאוד מגרסת ה-v3 שלו. כדאי להשוות בין השניים.
- **איכות הקלטת המקור קריטית:** v4 קולט גם פגמים כמו רעש, plosives, sibilance ותנודות עוצמה.
- **המלצה נוכחית:** להקליט את חומר האימון בסגנון דיבור אחיד אחד.
- **Voice Design:** עובד עם v4, אבל ייתכן שיישמע פחות טוב מאשר במודלים קודמים.

## Native accent handling (שינוי התנהגות חשוב)
| מצב | התנהגות |
|---|---|
| שפת הפלט זהה לשפת הקול המקורי | המבטא המקורי נשמר |
| שפת הפלט שונה | נוצר דיבור שוטף וטבעי בשפת היעד, בלי המבטא המקורי |

- מדובר בשינוי מכוון ולא בבאג. אם הפרויקט שלך מסתמך על העברת מבטא בין שפות, בדוק את זה לפני מעבר.
- אפשר לנסות לכוון מבטא עם audio tags, אבל התוצאות לא עקביות.
- ElevenLabs בוחנת אפשרות להפוך את זה ל-toggle בעתיד, בלי לוח זמנים.

## שפות נתמכות
Afrikaans, Amharic, Arabic, Armenian, Assamese, Asturian, Azerbaijani, Belarusian, Bengali, Bosnian, Bulgarian, Burmese, Cantonese, Catalan, Cebuano, Croatian, Czech, Danish, Dutch, English, Estonian, Filipino, Finnish, French, Fula (Pulaar), Galician, Georgian, German, Greek, Gujarati, Hausa, **Hebrew**, Hindi, Hungarian, Icelandic, Indonesian, Italian, Japanese, Kannada, Kazakh, Korean, Kyrgyz, Lao, Lingala, Lithuanian, Luganda, Luxembourgish, Macedonian, Malay, Malayalam, Maltese, Mandarin Chinese, Māori, Marathi, Mongolian, Nepali, Norwegian Bokmål, Occitan, Odia, Pashto, Persian, Polish, Portuguese (Brazil), Punjabi, Romanian, Russian, Serbian, Shona, Sindhi, Slovak, Slovenian, Somali, Sorani Kurdish, Spanish (LatAm), Swahili, Swedish, Tajik, Tamil, Telugu, Thai, Turkish, Ukrainian, Urdu, Uzbek, Vietnamese, Welsh, Wolof.

> רמת השטף משתנה בין שפות.

## דוגמאות בעמוד המקור (Voice IDs)
| שימוש | Voice ID |
|---|---|
| השוואת cloning בין v3 ל-v4 | `NfUrCNRReUL9RXS9upG1`, `HBDoL4wkcalemIO0nUAu` |
| Voice acting עם tags | `EkK5I93UQWFDigLMpZcX`, `t7VaN65ClS2VrEUwk1nR` |
| Audiobook | `KHRvDizAHFVPzoSehNY6` |

## הערות
- המודל ממשיך להתעדכן אחרי ההשקה, ולכן ההתנהגות שלו עשויה להשתנות. כדאי לבדוק מחדש את ה-use case מדי פעם.
- הנחיות prompting (tags, פיסוק, דיאלוג): https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v4
