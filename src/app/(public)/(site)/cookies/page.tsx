import { getCompanyLegal } from '@/lib/data/company';
import { ManageCookiesButton } from '@/components/consent/manage-cookies-button';
import { getCookieConsentPublicConfig } from '@/lib/consent/admin-config';
import { LegalShell, LegalSection, CategoryStatusBadge } from '../_legal';

export const metadata = {
  title: 'מדיניות עוגיות',
  alternates: { canonical: '/cookies' },
};

// Render per-request so the page reflects the current company/legal config edited
// in /admin — matching the /privacy and /terms convention (both force-dynamic).
export const dynamic = 'force-dynamic';

// Public cookie policy (beta.kalfa.me/cookies). Hebrew, RTL. Legal wording per
// Privacy Protection Law + Amendment 13 — reviewed and approved (no draft
// banner, 2026-08-30). Content describes only the services actually present in
// the app — no generic boilerplate.
export default async function CookiesPage() {
  const [company, consentAdmin] = await Promise.all([
    getCompanyLegal(),
    getCookieConsentPublicConfig(),
  ]);

  return (
    <LegalShell
      title="מדיניות עוגיות"
      updatedText="עודכן לאחרונה: יולי 2026"
      company={company}
    >
      <LegalSection title="1. כללי">
        <p>
          עוגיות (Cookies) הן קובצי טקסט קטנים הנשמרים בדפדפן. מדיניות זו מפרטת אילו
          עוגיות KALFA משתמשת בהן בפועל: <strong>עוגיות חיוניות</strong> הנדרשות לתפעול
          השירות; <strong>עוגיות אנליטיקה (Google Analytics)</strong>; ו
          <strong>עוגיות שיווק ורימרקטינג (Google Ads)</strong> — שתי הקטגוריות
          האחרונות רק בהסכמתכם המפורשת מראש (opt-in), כל אחת בנפרד. איננו מודדים ואיננו
          משתפים מידע פרסומי על דפי אישורי-ההגעה של אורחים כלל.
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

      <LegalSection
        title="5. עוגיות אנליטיקה (Google Analytics) — בהסכמה בלבד"
        badge={<CategoryStatusBadge active={consentAdmin.analyticsEnabled} />}
      >
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
            המדידה עשויה לכלול <strong>מזהים פנימיים של המערכת</strong> — מזהים
            אקראיים (כגון מזהה אירוע או קמפיין) המופיעים בכתובות עמודים באזור
            האישי, וכן תווית כללית של מודל החיוב באירוע תשלום. המזהים אינם כוללים
            כשלעצמם את שם האירוע או את זהות בעליו, והקישור שלהם לרשומות העסקיות
            נעשה באמצעות מערכות KALFA. סוג האירוע (למשל חתונה או בר מצווה){' '}
            <strong>אינו נשלח</strong> למדידה.
          </li>
          <li>
            <strong>Google Signals</strong> מופעל ברמת הנכס: עבור מבקרים המחוברים
            לחשבון Google שהפעילו התאמה אישית של מודעות, Google עשויה לקשר ביקורים
            ממכשירים שונים ולספק לנו נתוני דמוגרפיה ותחומי עניין{' '}
            <strong>מצרפיים בלבד</strong> — אך רק אם אישרתם <strong>גם</strong> את
            קטגוריית ״שיווק ורימרקטינג״ בסעיף 6 להלן. אישור האנליטיקה בלבד אינו מפעיל
            את Google Signals בפועל.
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
            הסכמתכם מתורגמת לאות הסכמה מפורש הנשלח לתג (Consent Mode):‏
            <span dir="ltr"> analytics_storage</span> — מאושר רק לאחר הסכמתכם, ומבוטל
            מיידית עם ביטולה. אותות הפרסום (<span dir="ltr">ad_storage,
            ad_user_data, ad_personalization</span>) נשלטים בנפרד על ידי קטגוריית
            השיווק, ר׳ סעיף 6.
          </li>
        </ul>
      </LegalSection>

      <LegalSection
        title="6. עוגיות שיווק ורימרקטינג (Google Ads) — בהסכמה נפרדת ובנוסף בלבד"
        badge={<CategoryStatusBadge active={consentAdmin.marketingEnabled} />}
      >
        <p>
          חשבון Google Ads שלנו מקושר לנכס האנליטיקה (Google Analytics) של האתר. אם
          תאשרו את קטגוריית השיווק בהודעת העוגיות — קטגוריה נפרדת מהאנליטיקה, כבויה
          כברירת מחדל — יחולו הדברים הבאים:
        </p>
        <ul className="list-disc space-y-1 ps-5">
          <li>
            אנו משתפים עם Google Ads <strong>קהלים</strong> המבוססים על ביקורכם באתר
            (רימרקטינג), לצורך הצגת מודעות מותאמות לכם באתרים ואפליקציות אחרים, ומדידת
            המרות ממודעות שלחצתם עליהן.
          </li>
          <li>
            אישור קטגוריה זו, <strong>יחד עם</strong> אישור קטגוריית האנליטיקה, גם
            מפעיל בפועל את Google Signals (קישור חוצה-מכשירים ונתוני דמוגרפיה מצרפיים,
            ר׳ סעיף 5) — אישור השיווק לבדו, בלי אנליטיקה, אינו טוען את התג כלל ולכן
            חסר השפעה נצפית.
          </li>
          <li>
            הסכמתכם מתורגמת לאותות הסכמה מפורשים הנשלחים לתג (Consent Mode):‏
            <span dir="ltr"> ad_storage, ad_user_data, ad_personalization</span> —
            כולם מאושרים רק לאחר הסכמתכם לקטגוריה זו, ומבוטלים מיידית עם ביטולה
            (ומוחקים את עוגיות/מזהי הפרסום, ‏<span dir="ltr">_gcl*</span>/
            <span dir="ltr">_gac*</span>).
          </li>
          <li>
            קטגוריה זו <strong>אינה פועלת כלל</strong> בדפי אישורי-ההגעה, המתנות
            והאישורים של אורחים — אורחים אינם נחשפים לשיתוף מידע פרסומי בשום מקרה.
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

      <LegalSection title="7. ניהול העדפות">
        <p>
          ניתן לפתוח את הודעת העוגיות בכל עת, לצפות בפירוט הקטגוריות, ולאשר או לבטל כל
          אחת מקטגוריות האנליטיקה והשיווק בנפרד:
        </p>
        <p>
          <ManageCookiesButton className="text-primary hover:text-primary/80">
            פתיחת הודעת העוגיות
          </ManageCookiesButton>
        </p>
      </LegalSection>

      <LegalSection title="8. שינויים במדיניות">
        <p>
          סעיף זה עודכן ב־2026-07-27 עם הוספת קטגוריית השיווק והרימרקטינג (סעיף 6) בעקבות
          קישור חשבון Google Ads לנכס האנליטיקה. כל הרחבה עתידית נוספת של השימוש
          בעוגיות תעודכן במדיניות זו, תתווסף כקטגוריה נפרדת, ותדרוש הסכמה מפורשת
          (opt-in) מחדש לפני הפעלתה, בהתאם להנחיות הרשות להגנת הפרטיות.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
