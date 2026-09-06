'use client';

import { useActionState, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import { Tabs, TabsList, TabsTab, TabsPanel } from '@/components/ui/tabs';
import type { AppSettings } from '@/lib/data/admin/settings';
import { updateSettingsAction } from './actions';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 read-only:bg-muted read-only:text-muted-foreground';

// A value row with its own controls: an eye toggle (mask/reveal) for key fields,
// and an "ערוך" toggle that enables editing. The input is ALWAYS present in the
// form — readOnly fields still submit — so values aren't lost when untouched.
function EditableField({
  name,
  label,
  defaultValue,
  maskable = false,
  inputMode,
  placeholder,
  hint,
  errors,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  maskable?: boolean;
  inputMode?: 'numeric';
  placeholder?: string;
  hint?: string;
  errors?: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // Masked by default; revealed (or being edited) shows plain text.
  const type = maskable && !revealed && !editing ? 'password' : 'text';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={name} className="text-sm font-medium">
          {label}
        </label>
        <div className="flex items-center gap-3">
          {maskable ? (
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-pressed={revealed}
            >
              {revealed ? (
                <EyeOff className="size-3.5" aria-hidden />
              ) : (
                <Eye className="size-3.5" aria-hidden />
              )}
              {revealed ? 'הסתר' : 'הצג'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-xs text-primary hover:underline"
            aria-pressed={editing}
          >
            {editing ? 'נעילה' : 'ערוך'}
          </button>
        </div>
      </div>
      <input
        id={name}
        name={name}
        type={type}
        inputMode={inputMode}
        defaultValue={defaultValue}
        placeholder={placeholder}
        readOnly={!editing}
        autoComplete="off"
        className={inputClass}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <FieldError errors={errors} />
    </div>
  );
}

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
  emailProvider,
}: {
  settings: AppSettings;
  emailProvider: 'resend' | 'smtp';
}) {
  const [state, action] = useActionState(updateSettingsAction, null);
  const fieldErrors = state?.fieldErrors;

  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <Tabs defaultValue="payments">
        {/* Four Hebrew labels do not fit one row on a phone. A 2x2 grid keeps
            all four visible; a scrolling strip would hide half of them behind
            an affordance nobody looks for. */}
        <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto">
          <TabsTab value="payments" className="justify-center sm:justify-start">
            תשלומים
          </TabsTab>
          <TabsTab value="messaging" className="justify-center sm:justify-start">
            הודעות
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

          <EditableField
            name="sumit_company_id"
            label="מזהה חברה (SUMIT Company ID)"
            defaultValue={settings.sumit_company_id}
            inputMode="numeric"
            placeholder="לדוגמה 123456"
            errors={fieldErrors?.sumit_company_id}
          />
          <EditableField
            name="sumit_api_public_key"
            label="מפתח ציבורי לטוקניזציה (Public API Key)"
            defaultValue={settings.sumit_api_public_key}
            maskable
            placeholder="מפתח ציבורי מ-SUMIT"
            errors={fieldErrors?.sumit_api_public_key}
          />
          <EditableField
            name="sumit_api_key"
            label="מפתח API פרטי לחיוב (Secret API Key)"
            defaultValue={settings.sumit_api_key}
            maskable
            placeholder="לא מוגדר — הזן מפתח"
            hint="המפתח הסודי נשמר בצד-שרת. כאן הוא מוצג מוסכה כברירת מחדל; לחצו 'הצג' לחשיפה."
            errors={fieldErrors?.sumit_api_key}
          />
        </Panel>

        <Panel value="messaging">
          <Toggle name="sms_enabled" label="הפעלת SMS (ExtrA)" checked={settings.sms_enabled}>
            נדרש לאימות OTP בעת חתימה על ההסכם. כשכבוי — לא נשלחים קודים.
          </Toggle>

          <EditableField
            name="extra_sms_sender"
            label="שם השולח (Sender) המאומת ב-ExtrA"
            defaultValue={settings.extra_sms_sender}
            placeholder="לדוגמה KALFA"
            hint="זהות שולח מאומתת מתוך לשונית 'verified identities' בחשבון ExtrA."
            errors={fieldErrors?.extra_sms_sender}
          />
          <EditableField
            name="extra_sms_token"
            label="מפתח API של ExtrA (Bearer Token)"
            defaultValue={settings.extra_sms_token}
            maskable
            placeholder="לא מוגדר — הזן טוקן"
            hint="הטוקן הסודי נשמר בצד-שרת ומוצג מוסכה כברירת מחדל; לחצו 'הצג' לחשיפה."
            errors={fieldErrors?.extra_sms_token}
          />

          <hr className="border-border" />

          <Toggle name="email_enabled" label="הפעלת דואר עסקי" checked={settings.email_enabled}>
            נדרש לשליחת מיילים עסקיים (ההסכם החתום, חשבוניות). כשכבוי — לא נשלח
            דואר, בכל מוביל.
          </Toggle>

          {/* Which transport is live is decided by EMAIL_PROVIDER, not by this
              form. Saying so here is the difference between an admin who knows
              the fields below are dormant and one who edits them expecting an
              effect. */}
          <p className="text-xs text-muted-foreground">
            {emailProvider === 'resend'
              ? 'המוביל הפעיל: Resend (שולח דרך ה-API, ללא סיסמה). השדות שלהלן משמשים רק את נתיב הנסיגה ואינם בשימוש כרגע.'
              : 'המוביל הפעיל: SMTP. השדות שלהלן הם שמפעילים את שליחת הדואר.'}
          </p>

          <EditableField
            name="smtp_host"
            label="שרת SMTP"
            defaultValue={settings.smtp_host}
            errors={fieldErrors?.smtp_host}
          />
          <EditableField
            name="smtp_port"
            label="פורט"
            defaultValue={settings.smtp_port}
            inputMode="numeric"
            placeholder="587"
            hint="587 = STARTTLS · 465 = SSL"
            errors={fieldErrors?.smtp_port}
          />
          <Toggle name="smtp_secure" label="חיבור מאובטח (SSL)" checked={settings.smtp_secure}>
            סמנו עבור פורט 465 (SSL). לפורט 587 (STARTTLS) — השאירו כבוי.
          </Toggle>
          <EditableField
            name="smtp_user"
            label="שם משתמש (תיבת הדואר)"
            defaultValue={settings.smtp_user}
            placeholder="noreply@kalfa.me"
            errors={fieldErrors?.smtp_user}
          />
          <EditableField
            name="smtp_password"
            label="סיסמת SMTP"
            defaultValue={settings.smtp_password}
            maskable
            placeholder="לא מוגדר — הזן סיסמה"
            hint="הסיסמה נשמרת בצד-שרת ומוצגת מוסכה; לחצו 'הצג' לחשיפה."
            errors={fieldErrors?.smtp_password}
          />
          <EditableField
            name="smtp_from"
            label="כתובת השולח (From)"
            defaultValue={settings.smtp_from}
            placeholder="KALFA <noreply@kalfa.me>"
            hint="הכתובת שתופיע אצל הנמען."
            errors={fieldErrors?.smtp_from}
          />
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
