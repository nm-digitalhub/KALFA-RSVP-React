import { getCookieConsentAdminView } from '@/lib/data/admin/cookie-consent';
import { PageHeading } from '../_components';
import { CookieConsentClient } from './cookie-consent-client';

const sectionClass = 'space-y-4 rounded-lg border border-border bg-card p-5';

// Admin control for the vanilla-cookieconsent mechanism (master switch +
// per-category availability + revision bump). requirePlatformPermission
// ('manage_settings') is enforced in the DAL. Text stays fully in code — see
// plans/cookie-consent-admin-control.md §7 for why. The master switch is a
// rare/emergency control: disabling it also stops Google Analytics and the
// Consent Mode ad signals sitewide (verified fail-safe against the installed
// library source, plan §2.1) — not a routine toggle.
export default async function AdminCookieConsentPage() {
  const view = await getCookieConsentAdminView();

  return (
    <div className="space-y-6">
      <PageHeading>הסכמת עוגיות</PageHeading>

      <section className={sectionClass}>
        <div>
          <h2 className="text-lg font-semibold">מנגנון ההסכמה</h2>
          <p className="text-sm text-muted-foreground">
            כיבוי המתג הראשי מונע את הצגת הודעת העוגיות לחלוטין — וכתוצאה ישירה
            גם את טעינת Google Analytics ואת אותות השיווק, ללא תלות בהסכמה
            קודמת שנשמרה אצל מבקרים. מיועד לשימוש נדיר/חירום (למשל תקלה בתוסף
            עצמו) — לא מתג שגרתי.
          </p>
        </div>
        <div>
          <h2 className="text-lg font-semibold">קטגוריות</h2>
          <p className="text-sm text-muted-foreground">
            כיבוי קטגוריה מסיר אותה מהודעת העוגיות ומעלה אוטומטית את מספר
            הגרסה (revision) — כך שכל מי שכבר הסכים יתבקש להסכים מחדש. עוגיות
            חיוניות אינן ניתנות לכיבוי בשום מצב.
          </p>
        </div>
        <CookieConsentClient view={view} />
      </section>
    </div>
  );
}
