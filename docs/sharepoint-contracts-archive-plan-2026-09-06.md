# ארכיון חוזים ב-SharePoint — תכנון ומצב כפי שהוקם (2026-09-06)

אתר: `https://kalfarsvp.sharepoint.com/sites/KALFARSVP` (אתר הצוות של KALFA RSVP).
קוד ההקמה: `scripts/sharepoint-archive-provision.cjs` (אידמפוטנטי; `--dry-run` מדפיס הפרשים בלי כתיבה).
הכללים המקוצרים יושבים גם בארכיון עצמו: `Contracts/_ARCHIVE-RULES.md`.

## 0. הכרעות הבעלים (6.9.2026)

| שאלה | הכרעה |
|---|---|
| היקף | כל חוזי העסק: ספקים ונותני שירות, מסמכי תאגיד, נוסחי הסכם/מדיניות, והסכמי לקוחות |
| הסכמי לקוחות | SharePoint מחזיק **עותק ארכיון של ה-PDF בלבד**. מערכת הרשומה נשארת Supabase (`signed_agreements` + bucket פרטי) |
| שפה | מבנה ושמות קבצים באנגלית (ASCII), תוויות ותיאורים בעברית |
| הרשאות ייחודיות | לא עכשיו (משתמש יחיד באתר; break-inheritance דרך אפליקציה מסכן נעילה). נוהל ב-§6 |
| הרשאת SharePoint API לאפליקציה | נוספה `Sites.FullControl.All` (Office 365 SharePoint Online, application) עם הסכמת מנהל, כדי ש-REST יעבוד |
| חוות דעת משפטית | התקבלה מסוכן israeli-compliance-advisor (§5). לפי הבעלים, לא נדרש אישור עו"ד נוסף לתכנון הזה |

## 1. מבנה

שלוש ספריות מסמכים + רשימה אחת. עומק תיקיות מרבי: 3 (ספרייה / קטגוריה / צד שני). אין תיקיות שנה ב-Contracts, אין תיקיות "פעיל/סגור": סטטוס הוא מטא-דאטה, כי העברת קבצים שוברת קישורים.

```
Contracts/                          חוזים חתומים של העסק — ארכיון הרשומה
  _ARCHIVE-RULES.md
  01-Vendors/<Vendor>/              Meta, Voximplant, ElevenLabs, SUMIT, Supabase, Microsoft,
                                    IONOS, Resend, Google, ExtrA, Accountant, Insurance
  02-Corporate/                     עוסק פטור, בנק, ביטוח עסקי, שכירות
  03-Legal-Templates/
    Customer-Agreement/             כל גרסת נוסח הסכם לקוח (agreement_version) כ-PDF
    Terms-of-Service/
    Privacy-Policy/
Contracts-Working/                  טיוטות ומו"מ בלבד — לא רשומות ארכיון
  01-Vendors/  02-Corporate/  03-Legal-Templates/
Customer-Agreements/                עותקי PDF של הסכמים שנחתמו במערכת — מידע אישי
  <YYYY>/                           תיקיית חודש תתווסף רק מעל ~1,000 קבצים בשנה
Disposition-Log                     רשימה: יומן ביעור
```

`Documents` (ספריית ברירת המחדל של הצוות ב-Teams) נשארת לקבצי עבודה שוטפים. לא מערבבים.

ספק חדש = תיקייה חדשה תחת `01-Vendors/` בשם ASCII קצר (Title-Case, מקף בין מילים). לא יוצרים קטגוריה רביעית בלי לעדכן מסמך זה.

## 2. שמות קבצים

ASCII בלבד. `_` מפריד בין שדות, `-` בתוך שדה. התאריך הוא **תאריך החתימה או התחילה**, לא תאריך ההעלאה. בלי רווחים ובלי `# % & * : < > ? / \ { | } ~`. עד 100 תווים.

```
YYYY-MM-DD_<Counterparty>_<DocType>_v<N>_<status>.pdf
2026-07-15_Voximplant_MSA_v1_signed.pdf
2026-08-01_SUMIT_Terms_v3_signed.pdf
2026-09-01_Meta_WhatsApp-Business_Amendment_v1_signed.pdf
```

`status` ∈ `signed` | `countersigned` | `amendment` | `termination`. ב-Contracts-Working: `_draft-v<N>`.

הסכמי לקוחות (Customer-Agreements), **בלי שם ובלי טלפון** בשם הקובץ:

```
YYYY-MM-DD_CA_<campaign-id-8>_v<agreement_version>_<sha256-8>.pdf
```

`campaign-id-8` = 8 התווים הראשונים של `campaigns.id`; `sha256-8` = 8 התווים הראשונים של `signed_agreements.content_hash`. הקובץ עצמו הוא ה-PDF המקורי שעליו חושב ה-hash, ללא המרה.

## 3. מטא-דאטה: content type בשם `Contract`

עמודות אתר (קבוצת "KALFA Archive"), מצורפות ל-content type ולשלוש הספריות. `Contract` ראשון בסדר, כלומר ברירת המחדל בהעלאה. ה-content type `Document` נשאר זמין.

| עמודה (שם פנימי) | תווית | סוג | ערכים / כלל |
|---|---|---|---|
| Title | שם | טקסט | שם בעברית לקריאה |
| Counterparty | צד שני | טקסט | שם הספק/הגורם. בהסכמי לקוחות: ריק |
| ContractType | סוג מסמך | בחירה | MSA, Terms, DPA, Order, Amendment, NDA, License, Insurance, Lease, Customer-Agreement, Policy, Other |
| EffectiveDate | תאריך חתימה/תחילה | תאריך | חובה בקליטה |
| ExpiryDate | תאריך סיום | תאריך | ריק = ללא מועד ידוע; ממלאים בסיום |
| Status | סטטוס | בחירה | Active (ברירת מחדל), Expired, Terminated, Superseded |
| RetentionUntil | שימור עד | תאריך | ראו §5. ממלאים בקליטה, מעדכנים בסיום החוזה |
| ExternalRef | מזהה חיצוני | טקסט | מזהה קמפיין / חשבון ספק / מספר פוליסה |
| SHA256 | SHA-256 | טקסט (64) | חובה. להסכמי לקוחות: `signed_agreements.content_hash` |
| DataClass | סיווג מידע | בחירה | Internal, Confidential (ברירת מחדל), Personal-Data |
| Amends | מתקן את | טקסט | שם הקובץ שהמסמך הזה מתקן |
| LegalHold | הקפאה משפטית | כן/לא | ריק/לא = אין הקפאה. ראו §7 |
| ArchiveNotes | הערות ארכיון | טקסט רב-שורתי | |

Graph לא יוצר עמודת קישור (400) ולכן `Amends` הוא טקסט.

תצוגות (Contracts): `Active`, `Expiring-90d`, `Due-for-disposition`, `Legal-Hold`. (Customer-Agreements): `Due-for-disposition`, `Legal-Hold`. תצוגת ברירת המחדל בשתי הספריות מציגה את עמודות הליבה.

הגדרות ספרייה: ניהול content types מופעל; גרסאות מז'וריות בלבד, עד 50; סל מחזור 93 יום (ברירת מחדל של SharePoint).

`Disposition-Log` (רשימה): Title (נתיב הפריט), Library, DisposedAt, RetentionUntil, Reason (Retention-expired, Superseded, Duplicate, Legal-request, Data-subject-request), DisposedBy, RecordRef (מזהה רשומה / גרסה; לעולם לא שם או טלפון), SHA256 לפני מחיקה, Notes. הערה: SharePoint קידד את השם הפנימי של עמודת ה-SHA ל-`_x0053_HA256` בכל רשימה או ספרייה שקיבלה אותה (עמודת האתר עצמה נשארה `SHA256`); התווית תקינה. הריצה הראשונה של הייצוא נכשלה על זה ("Field 'SHA256' is not recognized"), ולכן המודול קורא את שמות העמודות של הספרייה בזמן ריצה ומתרגם (`decodeInternalName`/`translateFields`). כל קוד שכותב מטא-דאטה לספריות האלה חייב לעשות אותו דבר.

## 4. כללי הארכיון

1. **רשומה אחת, מקום אחד.** חוזה חתום קיים רק ב-Contracts. טיוטה לעולם לא נכנסת לשם. הסכם לקוח חתום: מערכת הרשומה היא Supabase; SharePoint = עותק ארכיון.
2. **אי-שינוי.** PDF חתום לא נערך לעולם. תיקון, הארכה או סיום = קובץ חדש, עם `Amends` שמצביע על המקורי, וסטטוס המקורי מתעדכן ל-Superseded/Terminated.
3. **שלמות (fixity).** SHA-256 נרשם בקליטה. להסכמי לקוחות משווים ל-`signed_agreements.content_hash`. בדיקה שנתית (§8) מחשבת מחדש ומשווה.
4. **פורמט.** PDF כפי שנחתם. PDF/A-2b מומלץ כעותק שימור ארוך-טווח, אבל רק כ**קובץ נוסף** לצד המקור, עם hash משלו. אין להמיר את הקובץ שעליו חושב ה-hash.
5. **שמות.** לפי §2. ASCII, תאריך ISO, בלי מידע אישי.
6. **גישה.** בעלים בלבד. מחבר Claude פועל בזהות הבעלים; כלי הכתיבה שלו ל-SharePoint במצב Ask. אין שיתוף חיצוני מהאתר.
7. **מידע אישי.** Customer-Agreements מסווג Personal-Data. אין תעודות זהות (המערכת מזהה ב-OTP ולא שומרת צילום ת"ז; `id_document_ref` הוא עמודת מורשת לא פעילה). אין שמות או טלפונים בשמות קבצים, בכותרות או במטא-דאטה, כי חיפוש, Copilot, כתובות URL ולוגים מאנדקסים אותם.
8. **ביקורת.** היסטוריית גרסאות + Microsoft Purview Audit (Standard), שכלול ב-Business Standard (שמירת לוג 180 יום). Disposition-Log נשמר לפחות 24 חודשים אחרי הביעור האחרון שנרשם בו.

## 5. שימור (לפי חוות הדעת, 6.9.2026)

מקורות: חוק ההתיישנות ס' 5(1)+6; הוראות מס הכנסה (ניהול פנקסי חשבונות) ס' 25(ג)(1), 25(ג2), 25(ד) ונספח ז'; חוק חתימה אלקטרונית ס' 3(א), 3א; פקודת הראיות ס' 35-36, 41ב; חוק הגנת הפרטיות (נוסח 14.8.2025) ס' 3, 8א; תקנות אבטחת מידע 2017 תק' 2(ג), 8, 10, 15, 17(א). מידע משפטי כללי; אינו ייעוץ משפטי.

| סוג | תקופה | בסיס |
|---|---|---|
| הסכמי לקוחות (Customer-Agreements) | **7 שנים מתום שנת המס** של האירוע/הסליקה | מינימום סטטוטורי: 3 שנים מהגשת הדו"ח (ניהול ספרים 25(ד)) — **תקנה**. 7 שנים = תקופת ההתיישנות — **היסק** מקובל |
| חוזי ספקים ותאגיד (Contracts) | **7 שנים מסיום ההתקשרות** | כנ"ל. וכל עוד הספק מחזיק מידע של KALFA (תק' 15) |
| נוסחי הסכם/מדיניות (03-Legal-Templates) | כל עוד קיים הסכם חתום שמפנה לגרסה + 7 שנים | היסק: בלי הנוסח אי אפשר לפרש רשומה חתומה |
| Disposition-Log | 24 חודשים לפחות | תק' 17(א) — **תקנה** |

**נוסחת RetentionUntil:** 31 בדצמבר של שנת הסיום + 7 שנים. הסכם לקוח: שנת הסיום = שנת האירוע (או הסליקה, המאוחר). חוזה ספק ללא מועד סיום: RetentionUntil ריק עד שהחוזה מסתיים, ואז ממלאים.

**חבילת הראיות.** לפי ס' 3א לחוק חתימה אלקטרונית נטל הוכחת החתימה על KALFA. לכן OTP, טלפון מאומת, IP, user-agent, חותמת זמן, גרסת הנוסח, hash ותמונת החתימה חייבים להישמר יחד עם ה-PDF ולאותה תקופה. הם נשמרים ב-Supabase (`signed_agreements` + bucket). **אין למחוק רשומה או קובץ מ-Supabase לפני תום תקופת השימור, ולא לפני העותק ב-SharePoint.** ה-PDF + חבילת הראיות = מקור (פקודת הראיות 41ב), לא העתק.

**פרטיות.** אין חובת רישום או הודעה על המאגר (ס' 8א). חובות שכן חלות: סקירה שנתית של מידע עודף (תק' 2(ג)); הרשאות לפי תפקיד; ה-DPA של Microsoft (Product Terms) מכסה את תק' 15. **מיקום הנתונים (נבדק 6.9.2026 ב-admin center → הגדרות ארגון → פרופיל ארגון → מיקום הנתונים):** SharePoint, OneDrive, Exchange Online, Exchange Online Protection, Teams, Copilot ו-Viva Connections — כולם **Israel** (Local Region Geography), ללא Advanced Data Residency ("No Commitment"). המידע נשאר בישראל, ולכן תקנות העברת מידע לחו"ל אינן חלות על הארכיון. לבדוק שוב אם Microsoft תודיע על שינוי גאוגרפיה.

**רישיון.** Business Standard לא כולל retention labels ל-SharePoint (דורש Business Premium/E3). לכן האכיפה היא נוהלית (§7) עם התצוגות. שדרוג ל-Business Premium יאפשר אכיפה אוטומטית; לא נדרש עכשיו.

## 6. נהלים

**קליטת חוזה ספק.** להוריד את הגרסה החתומה הסופית כ-PDF → לחשב SHA-256 (`sha256sum`) → להעלות לתיקיית הספק ב-Contracts עם שם לפי §2 → למלא: Title, Counterparty, ContractType, EffectiveDate, ExpiryDate (אם ידוע), RetentionUntil (אם ידוע), ExternalRef, SHA256, DataClass. טיוטות שקדמו לו נשארות ב-Contracts-Working או נמחקות.

**קליטת הסכם לקוח — אוטומטית.** משימת worker לילית (`agreement-archive-sweep`, 03:50 שעון ישראל, `src/lib/data/agreement-archive.ts`) מייצאת עד 25 הסכמים לריצה: בוחרת שורות `signed_agreements` עם `sharepoint_exported_at IS NULL` (הישנות קודם) → מורידה את ה-PDF מה-bucket → מחשבת SHA-256 ומשווה ל-`content_hash` (אי-התאמה = התראת Slack, השורה לא מסומנת ולא מיוצאת) → מעלה ל-`Customer-Agreements/<שנת החתימה>/` בשם לפי §2 עם conflictBehavior=fail (קובץ שכבר קיים מאומץ רק אם ה-hash הרשום בו זהה) → כותבת מטא-דאטה → מסמנת `sharepoint_exported_at` + `sharepoint_item_id`. מתג: /admin/settings → "ארכיון הסכמים חתומים ב-SharePoint" (`app_settings.agreement_archive_enabled`, כבוי כברירת מחדל). קונפיגורציה: `SHAREPOINT_ARCHIVE_SITE` ב-.env.local. המשימה מעתיקה בלבד ולעולם לא מוחקת ב-Supabase.

מטא-דאטה של הסכם לקוח (הכרעת בעלים 6.9.2026: פרטי הלקוח וראיות החתימה נשמרים בארכיון לצורך הגנה משפטית): Title = "הסכם לקוח <campaign-id-8> · <שם החותם>", Counterparty = שם החותם, ContractType=Customer-Agreement, EffectiveDate=signed_at, ExpiryDate=תאריך האירוע, Status=Expired אם האירוע עבר, RetentionUntil לפי §5 (שנת האירוע, או שנת החתימה אם אין תאריך), ExternalRef=`campaign_id`, SHA256=`content_hash`, DataClass=Personal-Data, ArchiveNotes = **חבילת הראיות המלאה, שורה לכל שדה, בלי השמטות (הכרעת בעלים 6.9.2026: "אל תשמיט שום פרט, כולל PII")**: signed_agreements.id, agreement_version, signed_at, content_hash, pdf_ref, signature_ref, id_document_ref, campaign_id, event_id, event_name, event_date, event_venue, signer_user_id, signer_name, signer_email (מ-auth.users), signer_profile_phone, verified_phone, otp_verified_at, ip, user_agent. שדה ריק נכתב כמפתח ריק, לא מושמט. שם הקובץ נשאר מבוסס מזהים בלבד (הוא עובר ב-URL ובלוגים). התראות Slack נשארות עם מזהים בלבד (צד שלישי).

שורה ללא `pdf_ref` (מורשת) נספרת כ"דולגה" בכל ריצה עד שתטופל ידנית. ריצה ידנית מחוץ ללו"ז: דרך /admin/jobs, תור `agreement-archive-sweep`.

**גרסת נוסח חדשה** (agreement_docs / תנאי שימוש / מדיניות פרטיות): לייצא PDF של הנוסח המלא ל-`03-Legal-Templates/<סוג>/` בשם `YYYY-MM-DD_KALFA_Policy_v<version>_published.pdf`, EffectiveDate = מועד הפרסום, ExternalRef = `agreement_version`.

**הרשאות ייחודיות** (להפעיל כשמצטרף משתמש שני לאתר): הגדרות ספרייה → Permissions → Stop inheriting permissions **עם העתקת ההרשאות**, ואז להסיר את קבוצת Members ו-Visitors מ-Contracts ומ-Customer-Agreements. לוודא קודם שהבעלים חבר בקבוצת Owners. לא לבצע דרך אפליקציה.

## 7. ביעור והקפאה משפטית

1. פעם בשנה (ינואר), לפתוח את התצוגה `Due-for-disposition` בשתי הספריות.
2. לכל פריט: לוודא ש-`LegalHold` ריק, שאין הליך תלוי או דרישת רשות, ושאין חוזה פעיל שמפנה אליו (`Amends`).
3. לרשום שורה ב-Disposition-Log **לפני** המחיקה: Title = הנתיב, Library, DisposedAt, RetentionUntil כפי שנרשם, Reason, DisposedBy, RecordRef (מזהה קמפיין/גרסה), SHA256.
4. למחוק את הקובץ. המחיקה פיזית, לא אנונימיזציה (הסכם חתום אנונימי חסר ערך ראייתי). סל המחזור מרוקן אחרי 93 יום.
5. להסכמי לקוחות: אחרי המחיקה ב-SharePoint, למחוק גם את הקובץ ב-bucket ואת הרשומה ב-`signed_agreements` (משימה נפרדת, עם אישור).

**הקפאה משפטית.** הליך תלוי או דרישת רשות → `LegalHold` = כן + הסבר ב-ArchiveNotes. הפריט יוצא מ-`Due-for-disposition` ונכנס ל-`Legal-Hold`. מסירים הקפאה רק בכתב, ורושמים ב-ArchiveNotes מי ומתי.

## 8. בדיקה שנתית (ינואר, יחד עם §7)

- fixity: לחשב SHA-256 לכל קובץ ב-Contracts ו-Customer-Agreements ולהשוות לעמודה. אי-התאמה = אירוע (לתעד, לשחזר מגרסה קודמת או מ-Supabase).
- מידע עודף (תק' 2(ג)): לעבור על Customer-Agreements ולוודא שאין פריטים מעבר לתקופה.
- Contracts-Working: למחוק טיוטות של חוזים שכבר נחתמו.
- לוודא שהסקריפט ב-`--dry-run` מדפיס רק "exists/ok" (המבנה לא נסחף).

## 9. פתוח, מחוץ להיקף הזה

- ~~ייצוא אוטומטי של הסכמי לקוחות~~ — **בוצע 6.9.2026** (§6, §10).
- **PDF/A** כעותק נוסף.
- ~~מיקום הנתונים של הטננט~~ — **נבדק 6.9.2026: Israel לכל השירותים** (§5).
- **הרשאות האפליקציה KALFA-RSVP** ב-Graph רחבות מהנדרש (Directory.ReadWrite.All, RoleManagement.ReadWrite.Directory, Application.ReadWrite.All ועוד); ראוי לצמצם. עכשיו נוספה גם SharePoint `Sites.FullControl.All`.
- **retention labels** אם ישודרג הרישיון ל-Business Premium.

## 9א. פורטל פנימי (אתר All Company)

הוקם 6.9.2026 בהחלטת הבעלים: `https://kalfarsvp.sharepoint.com/sites/allcompany` הוא דף בית פנימי (`SitePages/Portal.aspx`, קוד: `scripts/sharepoint-intranet-provision.cjs`, אידמפוטנטי; `--dry-run` להפרשים, `--text-only` לרשימות טקסט במקום Quick Links). שם האתר (web title) שונה ל-"KALFA"; קבוצת ה-Microsoft 365 שמאחוריו נשארה "All Company" (קהילת Viva Engage). Home.aspx המקורי של Viva Engage נמחק לסל המחזור אחרי שהפורטל הפך לדף הבית. עדכון תוכן = עריכת הסקריפט וריצה חוזרת.

**עיצוב (לפי התיעוד החי של Microsoft, נקרא 6.9.2026):**
- ערכת נושא "KALFA Coral" בקטלוג הטננט ומוחלת על האתר. הצבע הראשי `#cc4830` = קורל הלוגו `#FF5A3C` מוכהה ב-20% עד ניגודיות 4.63:1 מול טקסט לבן (WCAG AA); הלוגו עצמו נשאר בקורל המקורי. הנוסחה בסקריפט (`accessiblePrimary`).
- לוגו: `public/icons/icon.svg` → PNG ‏192×192 (sharp) → `SiteAssets/kalfa-logo.png` → לוגו ותמונה ממוזערת של האתר (`siteiconmanager/setsitelogo`).
- Header: פריסה Compact, הדגשה Strong (פס בצבע הנושא). ניווט אופקי (HorizontalQuickLaunch) עם הצמתים: ארכיון חוזים, הסכמי לקוחות, יומן ביעור, אתר הצוות KALFA RSVP.
- הדף (Graph, פריסת home): מקטע פתיחה ברקע Strong (תחליף ל-Hero, שקיים רק ב-Communication site); שתי עמודות Quick Links: "מערכות" בפריסת Compact עם אייקוני Fluent, "ארכיון חוזים" בפריסת List עם תיאור לכל פריט; מקטע שליש ברקע Soft: נהלים קבועים (רחב) ולוח תפעולי (צר).

**מלכודות שנמצאו, לידיעת מי שמריץ שוב:**
- `thememanager/ApplyTheme` מחיל ערכה **מקטלוג הטננט לפי שם**; שם שלא קיים מעדכן רק את ThemeData הקלאסי, והדף המודרני נשאר על ברירת המחדל Teal. חובה `AddTenantTheme`/`UpdateTenantTheme` לפני `ApplyTheme`.
- Graph: PATCH לדף שומר רכיבי טקסט אבל **מפיל בשקט** רכיבים סטנדרטיים (Quick Links). דף עם Quick Links נוצר מחדש (מחיקה + יצירה) בכל ריצה; רשימות טקסט מתעדכנות במקום. הערת `@odata.type` על רכיב ב-PATCH גורמת לשגיאת OData.
- ספריית Site Assets נוצרת עצלה; `_api/web/lists/EnsureSiteAssetsLibrary` יוצרת אותה, ואינדקס הרשימות של Graph מתעדכן כמה שניות אחרי.
- מחרוזת שמתחילה בספרות בתוך פסקה עברית מתהפכת ויזואלית; `&lrm;` לפניה פותר.

## 10. מה הוקם בפועל (6.9.2026, אומת ב-Graph)

- 12 עמודות אתר + content type `Contract` (0x010100E752B8B4969C524BB1C07BEB0E6512B4) בקבוצת KALFA Archive.
- ספריות Contracts, Contracts-Working, Customer-Agreements עם סקלטון התיקיות לפי §1, `Contract` מצורף וראשון בסדר, content types מופעלים, 50 גרסאות מז'וריות.
- `Contracts/_ARCHIVE-RULES.md`.
- רשימת Disposition-Log עם 8 עמודות.
- 6 תצוגות + עמודות הליבה בתצוגות ברירת המחדל.
- הרשאת SharePoint `Sites.FullControl.All` (application) על KALFA-RSVP עם הסכמת מנהל.
- ייצוא אוטומטי: מיגרציה `20260906085345_agreement_archive_export.sql` (מוחלת), מודול `src/lib/data/agreement-archive.ts` + 16 בדיקות, תור `agreement-archive-sweep` (singleton, 03:50), מתג ב-/admin/settings (הופעל 6.9), `SHAREPOINT_ARCHIVE_SITE` ב-.env.local.
- ריצה ראשונה 6.9.2026 12:19: 5 קבצים הועלו, המטא-דאטה נכשלה על שם העמודה המקודד (§3). אחרי התיקון, ריצה שנייה 12:23: `exported: 5, failed: 0`; חמשת ההסכמים ב-`Customer-Agreements/2026/` עם Title, Counterparty, תאריכים, RetentionUntil (2033/2036), SHA256 ו-DataClass=Personal-Data, וכל שורות `signed_agreements` מסומנות. הריצה השנייה אימצה את הקבצים הקיימים (409 + התאמת גודל) בלי העלאה כפולה.

תקלות בדרך, לידיעת מי שמריץ שוב: Graph לא יוצר עמודת hyperlink (400) ודורש `base` ולא `parentId` ביצירת content type; SharePoint REST דורש הרשאת SharePoint Online נפרדת מהרשאות Graph (401 בלעדיה).
