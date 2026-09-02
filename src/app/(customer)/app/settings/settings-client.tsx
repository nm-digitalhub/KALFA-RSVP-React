'use client';

import { useActionState, useRef, useState } from 'react';
import {
  Bell,
  KeyRound,
  Mail,
  Pencil,
  Settings,
  ShieldCheck,
  Smartphone,
  UserRound,
} from 'lucide-react';

import type { ProfileDTO } from '@/lib/data/profiles';
import type { UserSettingsDTO } from '@/lib/data/user-settings';
import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import { Button } from '@/components/ui/button';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import {
  requestEmailChangeAction,
  requestPhoneChangeAction,
  sendPasswordResetAction,
  updateProfileAction,
  updateSettingsAction,
  verifyPhoneChangeAction,
} from './actions';
import { formatIsraelDate } from '@/lib/date';
import { PasskeyManager } from './passkey-manager';
import { PushNotificationManager } from './push-notification-manager';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const sectionClass = 'scroll-mt-24 space-y-5 rounded-lg border border-border bg-card p-5';
const sectionHeaderClass = 'flex items-start gap-3';

interface SettingsPageClientProps {
  userEmail: string | undefined;
  profile: ProfileDTO | null;
  settings: UserSettingsDTO;
  loadError: boolean;
}

function SectionTitle({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof UserRound;
  title: string;
  description: string;
}) {
  return (
    <div className={sectionHeaderClass}>
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function ProfileSection({ profile }: { profile: ProfileDTO | null }) {
  const [state, action] = useActionState(updateProfileAction, null);

  // Plain uncontrolled inputs (name + defaultValue), NOT react-hook-form: a
  // Server Action resets the form on submit, and revalidatePath re-renders this
  // section with the freshly-saved profile so defaultValue shows the saved value
  // (RHF doesn't set the defaultValue attribute, so its fields blanked out).
  return (
    <section id="profile" className={sectionClass}>
      <SectionTitle
        icon={UserRound}
        title="פרופיל"
        description="פרטים שיופיעו באזור החשבון ויעזרו לנו לזהות אתכם."
      />
      <form action={action} className="space-y-4">
        <FormNotice message={state?.notice} />
        <FormError message={state?.error} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="full_name" className="mb-1 block text-sm font-medium">
              שם מלא
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              autoComplete="name"
              defaultValue={profile?.full_name ?? ''}
              className={inputClass}
            />
            <FieldError errors={state?.fieldErrors?.full_name} />
          </div>

        </div>

        <div className="max-w-44">
          <SubmitButton>שמירת פרופיל</SubmitButton>
        </div>
      </form>
    </section>
  );
}

function ToggleField({
  label,
  description,
  name,
  defaultChecked,
}: {
  label: string;
  description: string;
  name: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-md border border-border p-4">
      <span className="space-y-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-1 size-4 rounded border-border accent-primary"
      />
    </label>
  );
}

function NotificationsSection({ settings }: { settings: UserSettingsDTO }) {
  const [state, action] = useActionState(updateSettingsAction, null);

  return (
    <section id="notifications" className={sectionClass}>
      <SectionTitle
        icon={Bell}
        title="התראות"
        description="בחירת סוגי העדכונים שתרצו לקבל מהמערכת."
      />
      <form action={action} className="space-y-4">
        <FormNotice message={state?.notice} />
        <FormError message={state?.error} />
        <ToggleField
          label="עדכוני אירועים"
          description="שינויים ופעילות באירועים שלכם."
          name="event_updates"
          defaultChecked={settings.event_updates}
        />
        <ToggleField
          label="תזכורות מערכת"
          description="תזכורות לפני פעולות חשובות ותאריכים קרובים."
          name="reminder_updates"
          defaultChecked={settings.reminder_updates}
        />
        <ToggleField
          label="עדכוני חיוב"
          description="סטטוסים של הזמנות, חשבוניות ותשלומים."
          name="billing_updates"
          defaultChecked={settings.billing_updates}
        />
        <div className="max-w-44">
          <SubmitButton>שמירת התראות</SubmitButton>
        </div>
      </form>

      <PushNotificationManager />
    </section>
  );
}

function SummarySection({
  profile,
  settings,
}: {
  profile: ProfileDTO | null;
  settings: UserSettingsDTO;
}) {
  return (
    <section id="summary" className={sectionClass}>
      <SectionTitle
        icon={Settings}
        title="סיכום חשבון"
        description="תמונת מצב קצרה על הפרופיל והעדכונים האחרונים."
      />

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <dt className="text-muted-foreground">שם מלא</dt>
          <dd className="mt-1 font-medium">
            {profile?.full_name?.trim() || 'לא הוגדר עדיין'}
          </dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-muted-foreground">טלפון</dt>
          <dd className="mt-1 font-medium">{profile?.phone || 'לא הוגדר עדיין'}</dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-muted-foreground">עדכון פרופיל אחרון</dt>
          <dd className="mt-1 font-medium">
            {profile?.updated_at
              ? formatIsraelDate(profile.updated_at)
              : 'עדיין לא נשמר'}
          </dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-muted-foreground">עדכון הגדרות אחרון</dt>
          <dd className="mt-1 font-medium">
            {settings.updated_at
              ? formatIsraelDate(settings.updated_at)
              : 'ברירות מחדל פעילות'}
          </dd>
        </div>
      </dl>
    </section>
  );
}


function SecuritySection() {
  const [state, action] = useActionState(sendPasswordResetAction, null);

  return (
    <section id="security" className={sectionClass}>
      <SectionTitle
        icon={KeyRound}
        title="אבטחה"
        description="ניהול גישה לחשבון ללא מחיקת חשבון בגרסה זו."
      />
      <form action={action} className="space-y-4">
        <FormNotice message={state?.notice} />
        <FormError message={state?.error} />
        <div className="rounded-md border border-border p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 text-primary" aria-hidden />
            <div className="space-y-1">
              <p className="text-sm font-medium">איפוס סיסמה</p>
              <p className="text-sm text-muted-foreground">
                נשלח אליכם קישור מאובטח לאיפוס הסיסמה לכתובת האימייל של החשבון.
              </p>
            </div>
          </div>
        </div>
        <div className="max-w-48">
          <SubmitButton>שליחת קישור</SubmitButton>
        </div>
      </form>

      <PasskeyManager />
    </section>
  );
}

function AccountSection({
  userEmail,
  profile,
  settings,
}: {
  userEmail: string | undefined;
  profile: ProfileDTO | null;
  settings: UserSettingsDTO;
}) {
  const [emailState, emailAction] = useActionState(
    requestEmailChangeAction,
    null,
  );

  return (
    <section id="account" className={sectionClass}>
      <SectionTitle
        icon={Settings}
        title="חשבון"
        description="מידע בסיסי על החשבון והעדכון האחרון."
      />

      <form
        action={emailAction}
        className="space-y-3 rounded-md border border-border p-4"
      >
        <div className="flex items-center gap-2">
          <Mail className="size-4 text-primary" aria-hidden />
          <span className="text-sm font-medium">שינוי כתובת מייל</span>
        </div>
        <FormNotice message={emailState?.notice} />
        <FormError message={emailState?.error} />
        {/* The fallback is Hebrew, so the line cannot be LTR — only the
            address is. Same fix as the signing form's phone line. */}
        <p className="text-sm text-muted-foreground">
          {userEmail ? <bdi dir="ltr">{userEmail}</bdi> : 'לא זמין'}
        </p>
        <div>
          <label htmlFor="new_email" className="mb-1 block text-sm font-medium">
            כתובת מייל חדשה
          </label>
          <input
            id="new_email"
            name="new_email"
            type="email"
            dir="ltr"
            inputMode="email"
            autoComplete="email"
            placeholder="name@example.com"
            className={`${inputClass} text-start`}
          />
          <FieldError errors={emailState?.fieldErrors?.email} />
          <p className="mt-1 text-xs text-muted-foreground">
            לאבטחתכם, המייל יתחלף רק לאחר שתאשרו דרך קישור שיישלח לכתובת החדשה —
            בדיוק כמו בהרשמה. עד אז, נשארת הכתובת הנוכחית.
          </p>
        </div>
        <div className="max-w-48">
          <SubmitButton>שליחת אישור</SubmitButton>
        </div>
      </form>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <dt className="text-muted-foreground">אימייל</dt>
          {/* Dropping dir="ltr" also puts the icon back at the RTL start
              (right), matching every other icon+label pair on this page. */}
          <dd className="mt-1 flex items-center gap-2 font-medium">
            <Mail className="size-4" aria-hidden />
            {userEmail ? <bdi dir="ltr">{userEmail}</bdi> : 'לא זמין'}
          </dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-muted-foreground">עדכון פרופיל אחרון</dt>
          <dd className="mt-1 font-medium">
            {profile?.updated_at
              ? formatIsraelDate(profile.updated_at)
              : 'עדיין לא נשמר'}
          </dd>
        </div>
        <div className="rounded-md border border-border p-3 sm:col-span-2">
          <dt className="text-muted-foreground">עדכון הגדרות אחרון</dt>
          <dd className="mt-1 font-medium">
            {settings.updated_at
              ? formatIsraelDate(settings.updated_at)
              : 'ברירות מחדל פעילות'}
          </dd>
        </div>
      </dl>
    </section>
  );
}


// Phone verification, owned end to end by Supabase Auth.
//
// Two forms, not one: Auth's flow is genuinely two round trips —
// updateUser({phone}) makes it mint and send a code, verifyOtp redeems it —
// and a single form would have to guess which half the submit meant.
//
// The number is a controlled value shared by BOTH forms: verifyOtp must be
// given the same number updateUser was, or Auth has no pending change to
// match. Editing it after a code was sent resets the step, so a code can
// never be redeemed against a number it was not sent to.
function PhoneVerification({ profile }: { profile: ProfileDTO | null }) {
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [sendState, sendAction] = useActionState(requestPhoneChangeAction, null);
  const [verifyState, verifyAction] = useActionState(verifyPhoneChangeAction, null);
  // Derived from the SEND actually succeeding, not from the click: a failed
  // send must not offer a code field there is no code for. `dirty` clears it
  // when the number is edited, so a code can never be redeemed against a
  // number it was not sent to.
  const [dirty, setDirty] = useState(false);

  // A proved number is not free text. The field is FROZEN while it holds one,
  // and the pencil is the only way out — so "שליחת קוד" cannot be offered for a
  // number there is nothing to prove.
  const [editing, setEditing] = useState(false);
  const phoneInput = useRef<HTMLInputElement>(null);

  const justVerified = verifyState?.notice != null;
  const storedVerified = Boolean(profile?.phone_verified_at);
  // justVerified locks immediately, without waiting for the revalidated
  // profile to arrive — otherwise the field would sit unlocked and editable in
  // the moment right after the owner proved it.
  const locked = justVerified || (storedVerified && !editing);

  // `dirty` clears it when the number is edited, so a code can never be
  // redeemed against a number it was not sent to; `locked` closes it once the
  // proof lands.
  const codeSent = sendState?.notice != null && !dirty && !locked;
  const otpInvalid = Boolean(verifyState?.fieldErrors?.otp_code?.length);

  function beginEditing() {
    setEditing(true);
    // The pencil is a promise that the field is now writable — put the caret
    // in it rather than making the owner tap twice.
    requestAnimationFrame(() => phoneInput.current?.focus());
  }

  function cancelEditing() {
    setPhone(profile?.phone ?? '');
    setDirty(false);
    setEditing(false);
  }

  return (
    <section id="phone" className={sectionClass}>
      <div className={sectionHeaderClass}>
        <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div>
          <h2 className="font-semibold">טלפון נייד</h2>
          <p className="text-sm text-muted-foreground">
            נדרש לאימות בעת חתימה על הסכם, ולזיהוי רשימות מוזמנים שתשלחו בוואטסאפ.
          </p>
        </div>
      </div>

      {/* Clearing `dirty` on SUBMIT, not on the action's return: whatever is in
          the field at submit time IS the number being sent to, so editing it
          before submitting is not a mismatch. Without this the flag latched on
          the first keystroke and the code field could never open — the send
          succeeded and the step stayed shut (measured 2026-09-02). */}
      <form action={sendAction} onSubmit={() => setDirty(false)} className="space-y-4">
        <div className="max-w-sm">
          <label htmlFor="phone" className="mb-1 block text-sm font-medium">
            מספר טלפון
          </label>
          <div className="flex items-center gap-2">
            <input
              ref={phoneInput}
              id="phone"
              name="phone"
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              placeholder="050-000-0000"
              value={phone}
              readOnly={locked}
              // readOnly, NOT disabled: a disabled input is skipped by form
              // serialization, so the number would never reach the action, and
              // it drops out of the tab order and reads as broken to a screen
              // reader. readOnly keeps it announced and submitted.
              aria-describedby={locked ? 'phone-verified' : undefined}
              onChange={(e) => {
                setPhone(e.target.value);
                // A code already sent belongs to the OLD number.
                setDirty(true);
              }}
              className={`${inputClass} text-start ${
                locked ? 'bg-muted/50 text-muted-foreground' : ''
              }`}
            />
            {locked ? (
              <>
                <span
                  id="phone-verified"
                  className="shrink-0 rounded-full border border-success/20 bg-success/10 px-3 py-1 text-xs font-medium text-success"
                >
                  מאומת
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={beginEditing}
                  className="shrink-0"
                  aria-label="שינוי מספר הטלפון"
                  title="שינוי מספר הטלפון"
                >
                  <Pencil className="size-4" aria-hidden />
                </Button>
              </>
            ) : null}
          </div>
          <FieldError errors={sendState?.fieldErrors?.phone} />
        </div>

        <FormError message={sendState?.error} />
        {locked ? null : <FormNotice message={sendState?.notice} />}

        {/* No send button while the field is frozen: there is nothing to prove
            about a number already proved, and offering it was how "נשלח קוד"
            came to be shown for an SMS Auth never dispatched. */}
        {locked ? null : (
          <div className="flex items-center gap-3">
            <div className="max-w-44 grow">
              <SubmitButton>{codeSent ? 'שליחת קוד מחדש' : 'שליחת קוד'}</SubmitButton>
            </div>
            {/* Only when there is a proved number to fall back to. */}
            {editing && storedVerified ? (
              <Button type="button" variant="ghost" onClick={cancelEditing}>
                ביטול
              </Button>
            ) : null}
          </div>
        )}
      </form>

      {codeSent ? (
        <form action={verifyAction} className="space-y-4 border-t border-border pt-5">
          {/* The number travels with the code — Auth matches the two. */}
          <input type="hidden" name="phone" value={phone} />
          <div className="max-w-sm">
            <label htmlFor="otp_code" className="mb-1 block text-sm font-medium">
              הזינו את הקוד שנשלח לנייד
            </label>
            {/* dir="ltr" sits on the GROUP, deliberately.
                `components.json` has `"rtl": true`, and that DID fire on this
                component — the CLI rewrote the registry's physical classes to
                logical ones on install (border-l/r -> border-s/e,
                rounded-l/r-lg -> rounded-s/e-lg; diffed against
                ui.shadcn.com/r/styles/base-nova/input-otp.json). But that
                transform only mirrors borders and radii. It cannot fix ORDER,
                and input-otp itself has no direction handling whatsoever
                (its dist contains no `dir`, `rtl` or `direction`, and the
                published docs never mention RTL). So under the page's
                dir="rtl" the slot row still reverses and slot 0 renders on the
                RIGHT: 538395 would read as 593835.
                Forcing the group LTR fixes the order AND makes the logical
                classes resolve the way the registry drew them. The label and
                the field's place in the page stay RTL — the same treatment
                the card-number fields already get. */}
            <InputOTP
              id="otp_code"
              name="otp_code"
              maxLength={6}
              pattern={REGEXP_ONLY_DIGITS}
              inputMode="numeric"
              autoFocus
              aria-invalid={otpInvalid || undefined}
              containerClassName="justify-start"
            >
              <InputOTPGroup dir="ltr">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    aria-invalid={otpInvalid || undefined}
                    // size-8 is the registry default; every other control in
                    // this form is h-10, and 44px keeps a real touch target.
                    className="size-11 text-base"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <FieldError errors={verifyState?.fieldErrors?.otp_code} />
          </div>

          <FormError message={verifyState?.error} />
          <FormNotice message={verifyState?.notice} />

          <div className="max-w-44">
            <SubmitButton>אימות מספר</SubmitButton>
          </div>
        </form>
      ) : null}
    </section>
  );
}

export function SettingsPageClient({
  userEmail,
  profile,
  settings,
  loadError,
}: SettingsPageClientProps) {
  const nav = [
    { href: '#profile', label: 'פרופיל', icon: UserRound },
    { href: '#notifications', label: 'התראות', icon: Bell },
    { href: '#summary', label: 'סיכום', icon: Settings },
    { href: '#security', label: 'אבטחה', icon: KeyRound },
    { href: '#account', label: 'חשבון', icon: Settings },
  ];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">הגדרות</h1>
        <p className="max-w-2xl text-muted-foreground">
          ניהול פרטי החשבון, העדפות התראה, סקירת חיוב ואבטחת גישה.
        </p>
      </header>

      {loadError ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          חלק מנתוני ההגדרות לא נטענו. נסו לרענן את העמוד.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav className="grid gap-1 rounded-lg border border-border bg-card p-2">
            {nav.map(({ href, label, icon: Icon }) => (
              <a
                key={href}
                href={href}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="space-y-5">
          <ProfileSection profile={profile} />
          <PhoneVerification profile={profile} />
          <NotificationsSection settings={settings} />
          <SummarySection profile={profile} settings={settings} />
          <SecuritySection />
          <AccountSection
            userEmail={userEmail}
            profile={profile}
            settings={settings}
          />
        </div>
      </div>
    </div>
  );
}
