'use client';

import { useActionState } from 'react';

import {
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import { Tabs, TabsList, TabsTab, TabsPanel } from '@/components/ui/tabs';
import type { AppSettings } from '@/lib/data/admin/settings';
import { updateSettingsAction } from './actions';

// A value row with its own controls: an eye toggle (mask/reveal) for key fields,
// and an "ערוך" toggle that enables editing. The input is ALWAYS present in the
// form — readOnly fields still submit — so values aren't lost when untouched.

// Twenty toggles share one markup; the component is what keeps adding another
// from being another fifteen lines of copy.
function Toggle({
  name,
  label,
  checked,
  children,
}: {
  name: string;
  label: string;
  checked: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={checked}
        className="mt-1 size-4 accent-primary"
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{children}</span>
      </span>
    </label>
  );
}

// Sub-heading inside a panel — the calls panel holds ten switches, which without
// grouping reads as a wall of checkboxes.
function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function Panel({ value, children }: { value: string; children: React.ReactNode }) {
  // keepMounted is load-bearing, not cosmetic: Base UI unmounts a hidden panel by
  // default, and this is ONE form with ONE save. An unmounted checkbox is absent
  // from the FormData, and absent reads as `false` — so saving from any tab would
  // silently switch off every toggle on the other three.
  return (
    <TabsPanel value={value} keepMounted className="space-y-5">
      {children}
    </TabsPanel>
  );
}

export function SettingsForm({
  settings,
}: {
  settings: AppSettings;
}) {
  const [state, action] = useActionState(updateSettingsAction, null);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <Tabs defaultValue="payments">
        {/* THREE labels now — the fourth ("הודעות") moved to its own provider
            forms in Task 0.2. The grid stays 2x2 and must NOT become grid-cols-3:
            Hebrew labels do not fit one row on a phone, and a scrolling strip hides
            half of them behind an affordance nobody looks for. Three in a 2x2 grid
            simply leaves one cell empty, which is the cheap, correct outcome. */}
        <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto">
          <TabsTab value="payments" className="justify-center sm:justify-start">
            תשלומים
          </TabsTab>
          <TabsTab value="automations" className="justify-center sm:justify-start">
            אוטומציות
          </TabsTab>
          <TabsTab value="calls" className="justify-center sm:justify-start">
            שיחות
          </TabsTab>
        </TabsList>

        <Panel value="payments">
          <Toggle name="payments_enabled" label="הפעלת סליקה" checked={settings.payments_enabled}>
            כשכבוי — כפתור התשלום מוסתר מהלקוחות וה-endpoint דוחה כל ניסיון חיוב.
          </Toggle>

          <Toggle
            name="close_charge_enabled"
            label="הפעלת חיוב סופי בסגירת קמפיין"
            checked={settings.close_charge_enabled}
          >
            כסף אמיתי — כשמופעל, סגירת קמפיין לוכדת את הכרטיס שהוחזק ומחייבת את
            הסכום שנצבר (לפי אנשי־קשר שהושגו, עד התקרה). פועל רק אם גם «הפעלת
            סליקה» מופעלת. כשכבוי — הסגירה לא מחייבת.
          </Toggle>

          <Toggle
            name="campaign_holds_enabled"
            label="תפיסת מסגרת אשראי בפתיחת קמפיין"
            checked={settings.campaign_holds_enabled}
          >
            כסף אמיתי — כשמופעל, פתיחת קמפיין תופסת מסגרת בכרטיס הלקוח כדי
            להבטיח את החיוב בסגירה. כשכבוי — לא נתפסת מסגרת.
          </Toggle>

          {/* Not a feature flag — it selects WHICH billing model
              try_record_billed_result runs. Described in full because an admin
              flipping this changes who gets charged and by how much. */}
          <Toggle
            name="billing_exposure_gate"
            label="מודל חיוב לפי שירות בפועל"
            checked={settings.billing_exposure_gate}
          >
            מחליף את שיטת החיוב, ולא רק מפעיל תכונה. כשכבוי (המצב היום): מחויב רק
            אורח שהיה ברשימה שהוקפאה בפתיחת הקמפיין, והתקרה היא מספר אנשי־הקשר
            שהוגדר. כשמופעל: מחויב כל אורח ששורת בפועל — גם אם נוסף אחרי ההקפאה —
            והתקרה נגזרת מסכום המסגרת שנתפסה בכרטיס, כך שהחיוב לעולם לא יעבור
            אותה. שימו לב: אם נתוני הסכום חסרים או שגויים, התקרה נופלת ל-0
            והקמפיין לא יחייב אף אחד. אל תשנו בלי לבדוק קמפיין פעיל.
          </Toggle>

        </Panel>

        <Panel value="automations">
          <Toggle
            name="inquiry_followup_enabled"
            label="מעקב שקט אחר פניות"
            checked={settings.inquiry_followup_enabled}
          >
            כשמופעל: פנייה שנענתה ואין תגובה מהלקוח מקבלת תזכורת אחרי יום, אזהרה
            אחרי 3 ימים, ונסגרת אוטומטית אחרי 4 ימים. כשכבוי (ברירת המחדל) —
            שום מייל לא נשלח ואף פנייה לא נסגרת אוטומטית.
          </Toggle>

          <Toggle
            name="agreement_archive_enabled"
            label="ארכיון הסכמים חתומים ב-SharePoint"
            checked={settings.agreement_archive_enabled}
          >
            כשמופעל: פעם בלילה כל הסכם לקוח שנחתם ועדיין לא יוצא מועתק (PDF מאומת
            hash + פרטי הראיות) לספריית Customer-Agreements באתר KALFA RSVP, ופעם
            בשבוע (יום ראשון 04:10) רצה בדיקת שלמות של הארכיון: אימות SHA-256,
            השלמת hash לחוזים שהועלו ידנית, סימון Expired, ודוח ביעור/פקיעה
            ל-Slack. כשכבוי (ברירת המחדל) — שום קובץ לא נשלח ושום בדיקה לא רצה.
            לא מוחק דבר, לא ב-Supabase ולא ב-SharePoint.
          </Toggle>

          <Toggle
            name="signup_reminder_enabled"
            label="תזכורת אימות מייל להרשמות שלא הושלמו"
            checked={settings.signup_reminder_enabled}
          >
            כשמופעל: כל יום ב-10:20 נשלחת פעם אחת בלבד תזכורת למי שנרשם לפני
            יממה ועדיין לא אישר את כתובת המייל (עד 7 ימים אחורה, עד 25 בהרצה).
            כתובת שמייל האישור אליה כבר נדחה בעבר מדולגת, ואף אחד לא מקבל
            תזכורת שנייה. תוכן המייל הוא מייל האישור הרגיל, בלי תוכן שיווקי.
            כשכבוי (ברירת המחדל) — שום תזכורת לא נשלחת.
          </Toggle>

          <Toggle
            name="unconfirmed_cleanup_enabled"
            label="מחיקת הרשמות שלא אומתו אחרי 30 יום"
            checked={settings.unconfirmed_cleanup_enabled}
          >
            כשמופעל: כל יום ב-04:50 נמחקת כל הרשמה שלא אושרה במשך 30 יום, כולל
            השם והטלפון שנשמרו בה. זו לא רק תחזוקה: כתובת שהוקלדה בטעות היא לרוב
            תו אחד מתיבה אמיתית, ו-Supabase אינה חוסמת איפוס סיסמה לחשבון שלא
            אומת — כלומר זר שקיבל את המייל יכול להשתלט על החשבון ולראות את פרטי
            מי שנרשם. חשבון שיש בבעלותו אירוע לעולם לא נמחק. המחיקה בלתי הפיכה.
            כשכבוי (ברירת המחדל) — שום חשבון לא נמחק.
          </Toggle>
        </Panel>

        {/* Every switch in this panel was a database column the runtime read but
            nothing could write — until now the only way to flip one was SQL. */}
        <Panel value="calls">
          <GroupHeading>טלפון הנציג</GroupHeading>

          <Toggle
            name="console_softphone_enabled"
            label="טלפון בקונסולה"
            checked={settings.console_softphone_enabled}
          >
            מאפשר לנציג לענות ולחייג מתוך הקונסולה. כשכבוי — פאנל הטלפון כלל
            אינו נטען. נכשל לצד הבטוח: גם שגיאת קריאה משאירה אותו כבוי.
          </Toggle>

          <Toggle
            name="console_wake_enabled"
            label="התעוררות הקונסולה"
            checked={settings.console_wake_enabled}
          >
            מעיר את הקונסולה כששיחה ממתינה לנציג.
          </Toggle>

          <Toggle
            name="console_manual_dial_enabled"
            label="חיוג ידני"
            checked={settings.console_manual_dial_enabled}
          >
            מאפשר לנציג לחייג למספר שהקליד, ולא רק להחזיר שיחה מהתור.
          </Toggle>

          <Toggle
            name="console_consult_conference_enabled"
            label="שיחת התייעצות"
            checked={settings.console_consult_conference_enabled}
          >
            מאפשר לנציג לצרף גורם נוסף לשיחה לפני העברה.
          </Toggle>

          <Toggle name="handoff_enabled" label="העברת שיחה לנציג" checked={settings.handoff_enabled}>
            מאפשר להעביר שיחה מסוכן ה-AI לנציג אנושי. כשכבוי — אין העברה.
          </Toggle>

          <Toggle
            name="console_dtmf_handoff_enabled"
            label="העברה בלחיצת מקש"
            checked={settings.console_dtmf_handoff_enabled}
          >
            מאפשר למי שעונה לשיחה לבקש נציג בלחיצת ספרה. <strong>דורש גם
            «האזנה לשיחה» למעלה</strong> — הספרה מפעילה בדיוק את אותו מסלול
            ועידה, ולכן הקוד מחזיר «כבוי» כל עוד ההאזנה כבויה, גם אם המתג הזה
            דלוק.
          </Toggle>

          <Toggle name="monitor_enabled" label="האזנה לשיחה" checked={settings.monitor_enabled}>
            מאפשר האזנה לשיחה פעילה דרך מיקסר הוועידה. כבוי בכוונה מאז שנוצר:
            המיגרציה קובעת שהוא יידלק רק אחרי שתרחיש RSVPAgent יכיל את מטפל
            הוועידה ושהשינוי יאומת בשיחה חיה. הדלקה לפני כן פותחת מסלול שלא נבדק.
            הוא גם השער של «העברה בלחיצת מקש» למטה.
          </Toggle>

          <hr className="border-border" />
          <GroupHeading>ווידג׳ט באתר</GroupHeading>

          <Toggle
            name="console_widget_enabled"
            label="ווידג׳ט שיחה בדפדפן (מסלול ישן)"
            checked={settings.console_widget_enabled}
          >
            ווידג׳ט ה-WebRTC המקורי. <strong>הוחלף</strong> ב«התקשרו אליי עכשיו»
            שלמטה, והמסלול שלו אינו בשימוש. המתג נשאר כדי שלא תהיה עמודה בלי
            שליטה, אבל הדלקתו לא תוסיף יכולת.
          </Toggle>

          <Toggle
            name="console_call_me_now_enabled"
            label="«התקשרו אליי עכשיו»"
            checked={settings.console_call_me_now_enabled}
          >
            מאפשר למבקר להשאיר מספר, לאמת אותו ב-OTP, ולקבל שיחה חוזרת. המתג
            לבדו אינו מספיק — בלי כלל ניתוב מוגדר הווידג׳ט יוצג אבל כל ניסיון
            ייכשל, ולכן הקוד מציג אותו רק כששניהם קיימים.
          </Toggle>

          <hr className="border-border" />
          <GroupHeading>שיחות נכנסות</GroupHeading>

          <Toggle
            name="inbound_calls_enabled"
            label="קבלת שיחות נכנסות"
            checked={settings.inbound_calls_enabled}
          >
            מנתב שיחות שמגיעות למספר של KALFA. כשכבוי — שיחה נכנסת אינה מנותבת.
          </Toggle>
        </Panel>
      </Tabs>

      {/* Outside the tabs, and stuck to the bottom on a phone: one save covers
          all four panels, and it must not sit behind ten switches of scrolling. */}
      <div className="sticky bottom-0 z-10 -mx-1 border-t border-border bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <SubmitButton>שמירה</SubmitButton>
      </div>
    </form>
  );
}
