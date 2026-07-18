import { getCompanyLegal } from '@/lib/data/company';
import { ManageCookiesButton } from '@/components/consent/manage-cookies-button';
import { LegalShell, LegalSection } from '../_legal';

export const metadata = {
  title: 'מדיניות עוגיות — KALFA',
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
          עוגיות KALFA משתמשת בהן בפועל. נכון להיום אנו משתמשים <strong>אך ורק
          בעוגיות חיוניות</strong> — אין באתר עוגיות מעקב, אנליטיקה, פרסום או שיווק,
          ואיננו טוענים סקריפטים של צד שלישי למטרות אלה.
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

      <LegalSection title="5. ניהול העדפות">
        <p>
          מכיוון שאנו משתמשים בעוגיות חיוניות בלבד, אין עוגיות לא-חיוניות לכבות. ניתן
          לצפות בהודעת העוגיות ובפירוט בכל עת:
        </p>
        <p>
          <ManageCookiesButton className="text-primary hover:text-primary/80">
            פתיחת הודעת העוגיות
          </ManageCookiesButton>
        </p>
      </LegalSection>

      <LegalSection title="6. שינויים במדיניות">
        <p>
          אם בעתיד נוסיף שירותי אנליטיקה או שיווק, נעדכן מדיניות זו, נוסיף אותם כקטגוריה
          נפרדת, ונבקש את הסכמתכם המפורשת (opt-in) לפני טעינתם, בהתאם להנחיות הרשות
          להגנת הפרטיות.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
