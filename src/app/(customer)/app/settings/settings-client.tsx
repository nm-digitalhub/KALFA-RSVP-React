'use client';

import { useActionState } from 'react';
import {
  Bell,
  CreditCard,
  KeyRound,
  Mail,
  Receipt,
  Settings,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

import type { ProfileDTO } from '@/lib/data/profiles';
import type { OrderListItem } from '@/lib/data/orders';
import type { UserSettingsDTO } from '@/lib/data/user-settings';
import { ORDER_STATUS_LABELS } from '@/lib/constants';
import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import { formatCurrency } from '@/lib/format';
import {
  requestEmailChangeAction,
  sendPasswordResetAction,
  updateProfileAction,
  updateSettingsAction,
} from './actions';
import { formatIsraelDate } from '@/lib/date';
import { PushNotificationManager } from './push-notification-manager';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const sectionClass = 'scroll-mt-24 space-y-5 rounded-lg border border-border bg-card p-5';
const sectionHeaderClass = 'flex items-start gap-3';

interface SettingsPageClientProps {
  userEmail: string | undefined;
  profile: ProfileDTO | null;
  settings: UserSettingsDTO;
  orders: OrderListItem[];
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

          <div>
            <label htmlFor="phone" className="mb-1 block text-sm font-medium">
              טלפון
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              placeholder="050-000-0000"
              defaultValue={profile?.phone ?? ''}
              className={`${inputClass} text-start`}
            />
            <FieldError errors={state?.fieldErrors?.phone} />
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

function BillingSection({ orders }: { orders: OrderListItem[] }) {
  const recent = orders.slice(0, 3);

  return (
    <section id="billing" className={sectionClass}>
      <SectionTitle
        icon={CreditCard}
        title="חיוב והזמנות"
        description="סקירת הזמנות קיימות וסטטוסי חיוב בחשבון."
      />

      {recent.length === 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          <Receipt className="size-5" aria-hidden />
          אין הזמנות להצגה כרגע.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {recent.map((order) => (
            <li key={order.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="space-y-1">
                <p className="font-medium">{formatCurrency(order.total_with_vat)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatIsraelDate(order.created_at)}
                </p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                {ORDER_STATUS_LABELS[order.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
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
        <p className="text-sm text-muted-foreground" dir="ltr">
          {userEmail ?? 'לא זמין'}
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
          <dd className="mt-1 flex items-center gap-2 font-medium" dir="ltr">
            <Mail className="size-4" aria-hidden />
            {userEmail ?? 'לא זמין'}
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

export function SettingsPageClient({
  userEmail,
  profile,
  settings,
  orders,
  loadError,
}: SettingsPageClientProps) {
  const nav = [
    { href: '#profile', label: 'פרופיל', icon: UserRound },
    { href: '#notifications', label: 'התראות', icon: Bell },
    { href: '#billing', label: 'חיוב', icon: CreditCard },
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
          <NotificationsSection settings={settings} />
          <BillingSection orders={orders} />
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
