import { getCompanyLegal } from '@/lib/data/company';
import { ManageCookiesButton } from '@/components/consent/manage-cookies-button';
import { LegalShell, LegalSection } from '../_legal';

export const metadata = {
  title: 'מדיניות עוגיות',
};

// Render per-request so the page reflects the current company/legal config edited
// in /admin — matching the /privacy and /terms convention (both force-dynamic).
export const dynamic = 'force-dynamic';

// Public cookie policy (beta.kalfa.me/cookies). Hebrew, RTL. DRAFT per Privacy
// Protection Law + Amendment 13; lawyer review required before go-live. Content
// describes only the services actually present in the app — no generic boilerplate.
export default async function CookiesPage() {
  const company = await getCompanyLegal();

  return (
    <LegalShell
      title="מדיניות עוגיות"
      updatedText="עודכן לאחרונה: יולי 2026 · גרסת טיוטה"
      company={company}
    >
      <LegalSection title="1. כללי">
        <p>
          עוגיות (Cookies) הן קובצי טקסט קטנים הנשמרים בדפדפן. מדיניות זו מפרטת אילו
          עוגיות KALFA משתמשת בהן בפועל: <strong>עוגיות חיוניות</strong> הנדרשות לתפעול
          השירות, ו<strong>עוגיות אנליטיקה (Google Analytics) — רק בהסכמתכם המפורשת
          מראש (opt-in)</strong>. איננו טוענים עוגיות פרסום או שיווק, ואיננו מודדים את
          דפי אישורי-ההגעה של אורחים כלל.
        </p>
      </LegalSection>

      <LegalSection title="2. עוגיות חיוניות">
        <p>
          עוגיות אלה נדרשות לתפקוד הבסיסי של השירות ואינן ניתנות לכיבוי. הן אינן
          משמשות למעקב אחר גלישה:
        </p>
        <ul className="list-disc space-y-1 ps-5">
          <li>
            <strong>עוגיות אימות (Supabase):</strong> שומרות את החיבור המאובטח (session
            ורענון אסימון) כדי שתישארו מחוברים.
          </li>
          <li>
            <strong>בחירת ארגון פעיל:</strong> זוכרת עבור משתמשים מרובי-ארגונים לאיזה
            ארגון המסך משויך.
          </li>
          <li>
            <strong>מצב סרגל הצד:</strong> זוכרת אם סרגל הצד פתוח או מכווץ (העדפת ממשק
            באזור האישי).
          </li>
          <li>
            <strong>יציבות גרסה:</strong> ערך זמני המונע לולאת רענון בעת פריסת גרסה
            חדשה של האתר.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. סליקת תשלומים (SUMIT)">
        <p>
          בעמוד התשלום בלבד, וכאשר אתם יוזמים תשלום, נטען רכיב סליקה מאובטח של ספק
          הסליקה SUMIT לצורך הזנת פרטי כרטיס. רכיב זה נדרש להשלמת עסקה שביקשתם ואינו
          נטען בגלישה רגילה. עוגיות שספק הסליקה עשוי להגדיר משמשות לביצוע התשלום
          ולמניעת הונאה בלבד.
        </p>
      </LegalSection>

      <LegalSection title="4. התראות דחיפה (אופציונלי)">
        <p>
          אם תבחרו להפעיל התראות דחיפה מתוך הגדרות האזור האישי, הדפדפן ירשום מנוי
          התראות. מדובר בהרשמה ייעודית בהסכמתכם המפורשת (לא בעוגיית מעקב), וניתן לבטלה
          בכל עת מההגדרות.
        </p>
      </LegalSection>

      <LegalSection title="5. עוגיות אנליטיקה (Google Analytics) — בהסכמה בלבד">
        <p>
          אם אישרתם את קטגוריית האנליטיקה בהודעת העוגיות, אנו טוענים את Google
          Analytics 4 לצורך מדידת השימוש באתר ושיפורו. במסגרת זו:
        </p>
        <ul className="list-disc space-y-1 ps-5">
          <li>
            נאספים נתוני שימוש (עמודים שנצפו, מקורות הגעה, סוג מכשיר) ונשמרות עוגיות
            מדידה של Google (בשמות המתחילים ב-<span dir="ltr">_ga</span>).
          </li>
          <li>
            מופעל Google Signals: עבור מבקרים המחוברים לחשבון Google שהפעילו התאמה
            אישית של מודעות, Google עשויה לקשר ביקורים ממכשירים שונים ולספק לנו נתוני
            דמוגרפיה ותחומי עניין <strong>מצרפיים בלבד</strong>.
          </li>
          <li>
            האנליטיקה <strong>אינה נטענת כלל</strong> לפני הסכמתכם, ואינה פועלת בדפי
            אישורי-ההגעה, המתנות והאישורים של אורחים.
          </li>
          <li>
            ביטול ההסכמה (בכל עת, מכפתור ההעדפות) מפסיק את הטעינה ומוחק את עוגיות
            המדידה.
          </li>
          <li>
            הסכמתכם מתורגמת לאותות הסכמה מפורשים הנשלחים לתג (Consent Mode):‏
            <span dir="ltr"> analytics_storage, ad_storage, ad_user_data,
            ad_personalization</span> — כולם מאושרים רק לאחר הסכמתכם, ומבוטלים
            מיידית עם ביטולה.
          </li>
          <li>
            את העדפות ההתאמה האישית של מודעות בחשבון Google ניתן לנהל דרך{' '}
            <a
              href="https://myadcenter.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              מרכז המודעות שלי של Google
            </a>
            , ואת הפעילות שנשמרה בחשבון ניתן לראות ולמחוק דרך{' '}
            <a
              href="https://myactivity.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80"
            >
              הפעילות שלי
            </a>
            .
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="6. ניהול העדפות">
        <p>
          ניתן לפתוח את הודעת העוגיות בכל עת, לצפות בפירוט הקטגוריות, ולאשר או לבטל את
          קטגוריית האנליטיקה:
        </p>
        <p>
          <ManageCookiesButton className="text-primary hover:text-primary/80">
            פתיחת הודעת העוגיות
          </ManageCookiesButton>
        </p>
      </LegalSection>

      <LegalSection title="7. שינויים במדיניות">
        <p>
          כל הרחבה עתידית של השימוש בעוגיות (למשל שיווק) תעודכן במדיניות זו, תתווסף
          כקטגוריה נפרדת, ותדרוש הסכמה מפורשת (opt-in) מחדש לפני הפעלתה, בהתאם
          להנחיות הרשות להגנת הפרטיות.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
