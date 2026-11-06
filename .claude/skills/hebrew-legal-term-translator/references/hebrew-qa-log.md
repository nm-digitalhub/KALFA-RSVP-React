# Hebrew QA Log

## Scope

Reviewed public Hebrew content in `SKILL_HE.md`, Hebrew strings in `metadata.json`, Hebrew examples in `README.md`, and Hebrew terminology in reference files.

## Changes applied

| Area | Change | Reason |
| --- | --- | --- |
| Technical prose | Removed niqqud from Hebrew explanatory prose. | Keep professional Israeli style and avoid search mismatches. |
| Dates | Standardized review examples to DD/MM/YYYY, for example 03/06/2026. | Match local date format requested for public materials. |
| Money | Used ₪ in examples such as ₪4,200. | Match Israeli currency presentation. |
| Legal terminology | Used `ניכוי מס במקור`, `חשבונית מס`, `קבלה`, `עוסק פטור`, `עוסק מורשה`, `הוצאה לפועל`, `כתב הגנה`, `מאגר מידע`, and `ערבות אישית`. | Prefer established Israeli legal and accounting terms. |
| Voice | Rephrased guidance as imperatives such as `בדוק`, `אמת`, `שמור`, `אל תניח`. | Maintain neutral professional voice. |
| Anglicisms | Replaced unnecessary foreign wording with Hebrew terms such as `שורת פקודה`, `ממשק`, `סביבת בדיקה`, `תוצאה מובנית`. | Use natural Israeli terminology. |
| Consumer wording | Used `עסקת מכר מרחוק`, `ביטול עסקה`, `הרשות להגנת הצרכן ולסחר הוגן`. | Match Israeli consumer-law vocabulary. |
| Employment wording | Used `שכר מינימום`, `שעות נוספות`, `חופשה שנתית`, `פיצויי פיטורים`, `הודעה מוקדמת`. | Match payroll and employment usage. |
| Privacy wording | Used `מאגר מידע`, `הסכמה`, `מידע אישי`, `הרשות להגנת הפרטיות`. | Match Israeli privacy terminology. |
| Debt wording | Used `התראה לפני נקיטת הליכים`, `אזהרה`, `רשות האכיפה והגבייה`. | Match enforcement and collection usage. |

## Verification checks

- Public Hebrew prose contains no niqqud characters.
- Public Hebrew guidance uses neutral imperatives.
- Hebrew examples use ₪ for money.
- Public date examples use DD/MM/YYYY.
- Legal terms use Hebrew where a standard term exists.
- Command flags remain in English only when they are literal CLI syntax.
