import { getCompanyLegal } from '@/lib/data/company';
import { LegalShell, LegalSection } from '../_legal';

export const metadata = {
  title: 'מדיניות פרטיות — KALFA',
};

// Public privacy policy (beta.kalfa.me/privacy). Hebrew, RTL, reads company
// identity from config. DRAFT per Privacy Protection Law §11 + Amendment 13;
// lawyer review required before go-live.
export default async function PrivacyPage() {
  const company = await getCompanyLegal();

  return (
    <LegalShell
      title="מדיניות פרטיות"
      updatedText="עודכן לאחרונה: יוני 2026 · גרסת טיוטה"
      company={company}
    >
      <LegalSection title="1. כללי">
        <p>
          מדיניות זו מסבירה כיצד KALFA אוספת, משתמשת ושומרת מידע אישי במסגרת שירות
          אישורי ההגעה (RSVP). השימוש בשירות מהווה הסכמה למדיניות זו, בהתאם לחוק
          הגנת הפרטיות, התשמ״א‑1981 ולתיקון 13 לחוק.
        </p>
      </LegalSection>

      <LegalSection title="2. איזה מידע נאסף">
        <ul className="list-disc space-y-1 ps-5">
          <li>
            <strong>נתוני אורחים:</strong> שמות ומספרי טלפון שבעל האירוע מעלה,
            ותגובות אישור ההגעה שהתקבלו.
          </li>
          <li>
            <strong>נתוני בעל האירוע:</strong> שם, אימייל, טלפון, חתימה אלקטרונית
            ואימות טלפון (קוד חד‑פעמי).
          </li>
          <li>
            <strong>נתונים טכניים:</strong> כתובת IP, מזהי מכשיר ודפדפן וחותמות
            זמן. בהתאם לתיקון 13, כתובת IP ומזהים מקוונים נחשבים מידע אישי.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. מטרות העיבוד">
        <p>
          המידע משמש אך ורק לאספקת השירות: יצירת קשר עם אנשי הקשר בערוצים המאושרים,
          איסוף תגובות RSVP, חישוב חיוב לפי תוצאה, אבטחת זהות החותם, ושמירת ראיות
          להסכמה. איננו מוכרים מידע אישי.
        </p>
      </LegalSection>

      <LegalSection title="4. בסיס חוקי וחלוקת תפקידים">
        <p>
          <strong>בעל האירוע</strong> הוא בעל המאגר ביחס לנתוני האורחים שאסף, והוא
          האחראי לבסיס החוקי לפנייה אליהם. <strong>KALFA</strong> פועלת כמחזיק/מעבד
          בשמו ביחס לנתוני האורחים, וכבעלת שליטה ביחס לנתוני אימות הזהות של החותם.
        </p>
      </LegalSection>

      <LegalSection title="5. שיתוף עם ספקי שירות">
        <p>
          לצורך מתן השירות אנו נעזרים בספקי תקשורת וסליקה הפועלים בשמנו: Meta
          (WhatsApp Cloud API), Voximplant (שיחות), ספק סליקה לתשלומים, וספק SMS
          לאימות. ספקים אלה מעבדים מידע בהתאם להוראותינו ולמטרת השירות בלבד.
        </p>
      </LegalSection>

      <LegalSection title="6. אבטחת מידע">
        <p>
          אנו מיישמים אמצעי אבטחה בהתאם לתקנות הגנת הפרטיות (אבטחת מידע),
          התשע״ז‑2017, לרבות בקרת הרשאות, הצפנה, ותיעוד גישה. נתונים רגישים נשמרים
          בגישה מוגבלת לצוות מורשה בלבד.
        </p>
      </LegalSection>

      <LegalSection title="7. שמירת מידע ומחיקה">
        <p>
          מידע נשמר למשך הזמן הנדרש לאספקת השירות, לעמידה בחובות חשבונאיות וחוקיות,
          ולהוכחת הסכמה. בתום הצורך המידע נמחק או מונגש למחיקה לפי מדיניות שמירה.
        </p>
      </LegalSection>

      <LegalSection title="8. זכויותיכם">
        <p>
          בכפוף לחוק, יש לכם זכות לעיין במידע האישי שלכם, לבקש את תיקונו או מחיקתו,
          ולהתנגד לעיבוד מסוים. לפנייה בנושא זה השתמשו בפרטי הקשר בתחתית העמוד.
        </p>
      </LegalSection>

      <LegalSection title="9. דיוור ופנייה (§30א)">
        <p>
          פנייה לאנשי קשר נעשית עבור בעל האירוע ועל אחריותו, כהזמנת RSVP אישית
          ללא תוכן פרסומי של KALFA. כל בקשת הסרה תכובד בכל ערוץ.
        </p>
      </LegalSection>

      <LegalSection title="10. עוגיות (Cookies)">
        <p>
          אנו משתמשים בעוגיות חיוניות לתפעול השירות (התחברות וזיהוי), שאינן דורשות
          הסכמה. עוגיות שאינן חיוניות (אנליטיקה/שיווק, ככל שייעשה בהן שימוש) ייאספו
          בהסכמה מפורשת (opt‑in) בלבד, בהתאם להנחיות הרשות להגנת הפרטיות.
        </p>
      </LegalSection>

      <LegalSection title="11. שינויים במדיניות">
        <p>
          אנו עשויים לעדכן מדיניות זו מעת לעת. עדכונים מהותיים יפורסמו בעמוד זה עם
          תאריך עדכון מעודכן.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
