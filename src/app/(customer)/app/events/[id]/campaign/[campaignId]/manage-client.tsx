'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import {
  OP_STATUS_LABELS,
  REMOVAL_REQUESTED_LABEL,
  deliveryStatusLabel,
} from '@/app/(customer)/app/events/[id]/guests/labels';
import { sendBusinessEvent } from '@/components/consent/send-ga-event';
import { DateSelectIL } from '@/components/date-select-il';
import { FormError, FormNotice } from '@/components/forms';
import { TimeSelect24 } from '@/components/time-select-24';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import type { GaActionEvent } from '@/lib/analytics/ga-event-contracts';
import type { CampaignStatus } from '@/lib/data/campaigns';
import { computeChargeAmount } from '@/lib/data/close-charge-amount';
import { ilDateInputValue, ilTimeInputValue } from '@/lib/data/event-date';
import {
  CAMPAIGN_STAGE_LABELS,
  CAMPAIGN_STAGE_VARIANTS,
  campaignStage,
} from '@/lib/data/event-labels';
import { formatIsraelDateTime } from '@/lib/date';
import type { FormState } from '@/lib/validation/result';

type BoundAction = (
  prevState: FormState,
  formData: FormData,
) => Promise<FormState>;

type Campaign = {
  id: string;
  status: CampaignStatus;
  price_per_reached: number | null;
  max_contacts: number | null;
  max_charge_ceiling: number | null;
  final_charge_amount: number | null;
  credit_applied: number | null;
  capture_status: string | null;
  charge_status: string | null;
  base_price: number | null;
  included_reached: number | null;
};

type Summary = {
  reachedCount: number;
  accrued: number;
  ceiling: number;
  maxContacts: number;
} | null;

type Delivery = {
  totalContacts: number;
  delivery: {
    sent: number;
    delivered: number;
    read: number;
    failed: number;
  };
  outcome: {
    reached: number;
    wrongNumber: number;
    optedOut: number;
  };
  call: {
    dialed: number;
    noAnswer: number;
    voicemail: number;
    humanInteraction: number;
  };
} | null;

type ThankyouSchedule = {
  autoEnabled: boolean;
  sendAt: string | null;
  sentAt: string | null;
} | null;

type Actions = {
  activate: BoundAction;
  pause: BoundAction;
  close: BoundAction;
  settle: BoundAction;
  cancel: BoundAction;
  sendGift: BoundAction;
  sendEventDay: BoundAction;
  sendThankyou: BoundAction;
  updateThankyouSchedule: BoundAction;
  rescheduleEvent: BoundAction;
};

function nis(value: number | null | undefined): string {
  return value == null ? '—' : `₪${Number(value).toLocaleString('he-IL')}`;
}

function useGaFromState(state: unknown) {
  const fired = useRef<unknown>(null);

  useEffect(() => {
    if (!state || fired.current === state) return;

    const ga = (state as { ga?: GaActionEvent }).ga;
    if (!ga?.name) return;

    fired.current = state;
    sendBusinessEvent(ga);
  }, [state]);
}

function SubmitButton({
  label,
  confirm,
  variant,
}: {
  label: string;
  confirm?: string;
  variant: 'default' | 'primary' | 'danger';
}) {
  const { pending } = useFormStatus();

  const appearance =
    variant === 'primary'
      ? 'bg-primary text-primary-foreground shadow-sm hover:opacity-90'
      : variant === 'danger'
        ? 'border border-destructive/40 bg-background text-destructive hover:bg-destructive/10'
        : 'border border-border bg-background text-foreground hover:bg-accent/50';

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      onClick={
        confirm
          ? (event) => {
              if (!window.confirm(confirm)) event.preventDefault();
            }
          : undefined
      }
      className={`inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${appearance}`}
    >
      {pending ? 'מבצע פעולה...' : label}
    </button>
  );
}

function ActionButton({
  action,
  label,
  confirm,
  variant = 'default',
}: {
  action: BoundAction;
  label: string;
  confirm?: string;
  variant?: 'default' | 'primary' | 'danger';
}) {
  const [state, formAction] = useActionState(action, null);
  useGaFromState(state);

  return (
    <form action={formAction} className="w-full space-y-2">
      <SubmitButton label={label} confirm={confirm} variant={variant} />
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

function SummaryMetric({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div className="min-w-0 px-3 first:ps-0 last:pe-0 sm:px-5">
      <dt className="truncate text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd
        className={`mt-1 truncate font-bold tabular-nums ${
          emphasized ? 'text-2xl text-primary sm:text-3xl' : 'text-xl sm:text-2xl'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function DeliveryBar({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: string;
}) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{value}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={value}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full transition-[inline-size] ${tone}`}
          style={{ inlineSize: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

// Status and money in ONE card, because they are one question: what state is
// this campaign in and what will it cost. They were two cards (מצב הקמפיין and
// תוכנית החיוב) that repeated the same three figures — reached, accrued,
// ceiling — in two different visual languages, one as headline metrics and one
// as a progress bar with tiles.
//
// The rows below are a plain list, NOT tiles. Every figure here used to sit in
// its own rounded box inside a rounded box inside this card; at mobile width
// that stacked into a column of nested frames with a couple of words in each.
// A list of label/value pairs says the same thing and reads faster.
function CampaignStatusAndBilling({
  campaign,
  status,
  captureStatus,
  reached,
  accrued,
  ceiling,
  balance,
  basePrice,
  includedReached,
  overageRate,
  finalCharge,
  creditApplied,
}: {
  campaign: Campaign;
  status: CampaignStatus;
  captureStatus: string | null;
  reached: number;
  accrued: number;
  ceiling: number;
  balance: number;
  basePrice: number;
  includedReached: number;
  overageRate: number;
  finalCharge: number | null;
  creditApplied: number | null;
}) {
  const stage = campaignStage({ status, capture_status: captureStatus });
  const primaryChargeLabel = reached === 0 && basePrice > 0 ? 'דמי הפעלה' : 'חיוב נוכחי';
  const percentage = ceiling > 0 ? Math.min(100, Math.round((accrued / ceiling) * 100)) : 0;
  const pricingExplanation =
    basePrice > 0
      ? `דמי הפעלה קבועים של ${nis(basePrice)}. ${includedReached.toLocaleString('he-IL')} אנשי הקשר הראשונים שהשיבו כלולים בדמי ההפעלה. לאחר מכן נוסף ${nis(overageRate)} לכל איש קשר נוסף שהשיב, עד לתקרה של ${nis(ceiling)}.`
      : `החיוב הוא ${nis(overageRate)} לכל איש קשר ייחודי שהשיב בפועל, עד לתקרה של ${nis(ceiling)}.`;

  return (
    <section
      aria-labelledby="campaign-summary-title"
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      {/* justify-between only earns its place when the second child exists.
          finalCharge is null for every campaign before settlement, and
          spreading a lone status badge left a wide empty gap beside it. */}
      <div
        className={`flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:p-6${
          finalCharge != null ? ' sm:justify-between' : ''
        }`}
      >
        {/* Label and badge on ONE line. Stacked, this pair was two lines tall
            while filling about a fifth of the row, which read as a large empty
            panel next to it — the metric row below only looks right because
            three items fill the width. */}
        <div className="flex items-center gap-3">
          <h2 id="campaign-summary-title" className="text-sm text-muted-foreground">
            מצב הקמפיין וחיוב
          </h2>
          <Badge
            variant={CAMPAIGN_STAGE_VARIANTS[stage]}
            className="h-8 px-3 text-sm font-semibold"
          >
            {CAMPAIGN_STAGE_LABELS[stage]}
          </Badge>
        </div>

        {finalCharge != null ? (
          <p className="text-sm text-muted-foreground">
            חיוב סופי: <strong className="text-foreground">{nis(finalCharge)}</strong>
            {Number(creditApplied ?? 0) > 0 ? (
              <>
                {' '}
                לאחר קיזוז זיכוי של{' '}
                <strong className="text-foreground">{nis(creditApplied)}</strong>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      {/* No `divide-x-reverse`: Tailwind 4 compiles divide-x to border-inline-*,
          which is already direction-aware, so the divider lands between the
          items on its own. Adding the v3 RTL work-around flips it to
          inline-start — the RIGHT side in Hebrew — which drew a stray rule on
          the outer edge of the first metric ("הושגו"). Verified against the
          compiled stylesheet, not assumed. */}
      <dl className="grid grid-cols-3 divide-x divide-border p-5 sm:p-6">
        <SummaryMetric label="הושגו" value={reached.toLocaleString('he-IL')} />
        <SummaryMetric label={primaryChargeLabel} value={nis(accrued)} emphasized />
        <SummaryMetric label="תקרת חיוב" value={nis(ceiling)} />
      </dl>

      {/* The bar sits directly on the card. It used to have its own tinted,
          rounded panel — a frame around a frame, whose only content was a
          number the metric row above already showed. */}
      <div className="border-t border-border px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
        <div
          role="progressbar"
          aria-label="ניצול מסגרת החיוב"
          aria-valuemin={0}
          aria-valuemax={ceiling}
          aria-valuenow={Math.min(accrued, ceiling)}
          className="h-2.5 overflow-hidden rounded-full bg-primary/15"
        >
          <div
            className="h-full rounded-full bg-primary transition-[inline-size]"
            style={{ inlineSize: `${percentage}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{percentage}% מהמסגרת</span>
          <span>נותרו {nis(balance)}</span>
        </div>

        <dl className="mt-4 divide-y divide-border">
          <DetailRow label="דמי הפעלה" value={nis(basePrice)} />
          <DetailRow
            label="כלולים במחיר"
            value={includedReached.toLocaleString('he-IL')}
          />
          <DetailRow
            label={basePrice > 0 ? 'עלות לכל מענה נוסף' : 'מחיר לכל מענה'}
            value={nis(overageRate)}
          />
          <DetailRow
            label="מכסת אנשי קשר"
            value={campaign.max_contacts?.toLocaleString('he-IL') ?? '—'}
          />
          <DetailRow label="יתרה עד התקרה" value={nis(balance)} />
        </dl>

        <details className="group mt-2 border-t border-border pt-3">
          <summary className="cursor-pointer list-none text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            איך מחושב החיוב
          </summary>
          <div className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
            <p>{pricingExplanation}</p>
            <p>
              אין חיוב על הודעה שנקראה בלבד, ניסיון ללא מענה, תא קולי, מספר שגוי או
              תגובה כפולה. כל איש קשר ייחודי מחויב פעם אחת בלבד לאחר שהשיב בפועל.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}

function DeliveryBreakdown({ delivery }: { delivery: NonNullable<Delivery> }) {
  const { totalContacts, delivery: messageDelivery, outcome, call } = delivery;
  const hasCalls =
    call.dialed + call.noAnswer + call.voicemail + call.humanInteraction > 0;

  return (
    <section aria-labelledby="delivery-title" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="delivery-title" className="text-lg font-bold">
            ביצועי הקמפיין
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            מסירת הודעות ותוצאות אנשי הקשר לפי הנתונים שהתקבלו מ-Meta.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-sm font-semibold tabular-nums">
          {totalContacts.toLocaleString('he-IL')} אנשי קשר
        </span>
      </div>

      <div className="mt-5 grid gap-6 xl:grid-cols-2">
        {/* No inner frame: four labelled bars are already a visual group, and
            boxing them inside this card produced a border a few pixels from a
            border. */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">מסירת הודעות WhatsApp</h3>
          <DeliveryBar
            label={deliveryStatusLabel('sent')}
            value={messageDelivery.sent}
            total={totalContacts}
            tone="bg-muted-foreground/50"
          />
          <DeliveryBar
            label={deliveryStatusLabel('delivered')}
            value={messageDelivery.delivered}
            total={totalContacts}
            tone="bg-primary/55"
          />
          <DeliveryBar
            label={deliveryStatusLabel('read')}
            value={messageDelivery.read}
            total={totalContacts}
            tone="bg-primary"
          />
          <DeliveryBar
            label={deliveryStatusLabel('failed')}
            value={messageDelivery.failed}
            total={totalContacts}
            tone="bg-destructive/70"
          />
        </div>

        <div>
          <h3 className="text-sm font-semibold">תוצאות אנשי קשר</h3>
          <dl className="mt-1 divide-y divide-border">
            <DetailRow
              label={OP_STATUS_LABELS.reached_billed}
              value={outcome.reached.toLocaleString('he-IL')}
            />
            <DetailRow
              label={OP_STATUS_LABELS.wrong_number}
              value={outcome.wrongNumber.toLocaleString('he-IL')}
            />
            <DetailRow
              label={REMOVAL_REQUESTED_LABEL}
              value={outcome.optedOut.toLocaleString('he-IL')}
            />
            <DetailRow
              label="סך אנשי קשר"
              value={totalContacts.toLocaleString('he-IL')}
            />
          </dl>
        </div>
      </div>

      {hasCalls ? (
        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-sm font-semibold">שיחות AI</h3>
          <dl className="mt-1 divide-y divide-border sm:grid sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0">
            <DetailRow
              label={OP_STATUS_LABELS.call_dialed}
              value={call.dialed.toLocaleString('he-IL')}
            />
            <DetailRow
              label={OP_STATUS_LABELS.no_answer}
              value={call.noAnswer.toLocaleString('he-IL')}
            />
            <DetailRow
              label={OP_STATUS_LABELS.voicemail}
              value={call.voicemail.toLocaleString('he-IL')}
            />
            <DetailRow
              label={OP_STATUS_LABELS.human_interaction_call}
              value={call.humanInteraction.toLocaleString('he-IL')}
            />
          </dl>
        </div>
      ) : null}
    </section>
  );
}

// Shown where a panel's data was expected but could not be read. It says the
// read failed — it never invents a reason, and above all never reports a failed
// read as an empty campaign, which is the confusion this component exists to
// end. role="status" so a screen reader announces it like the other notices.
function LoadFailureNotice({ title, what }: { title: string; what: string }) {
  return (
    <section
      role="status"
      className="rounded-2xl border border-warning/40 bg-warning/10 p-5 sm:p-6"
    >
      <h2 className="text-base font-bold text-warning">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-warning">
        לא הצלחנו לטעון כרגע את {what}. רעננו את הדף; אם זה חוזר, פנו לתמיכה.
      </p>
    </section>
  );
}

// The schedule as information, for a viewer who may not change it (platform
// staff, or an org member without ownership). The alternative — rendering the
// form anyway — is a button whose submit requireOwnedEvent is certain to reject.
function ThankyouScheduleReadOnly({
  thankyou,
}: {
  thankyou: NonNullable<ThankyouSchedule>;
}) {
  return (
    <div>
      <h3 className="text-sm font-bold">תודה אוטומטית</h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        רק בעל האירוע יכול לשנות את לוח הזמנים.
      </p>
      <dl className="mt-2 divide-y divide-border">
        <DetailRow
          label="שליחה אוטומטית"
          value={thankyou.autoEnabled ? 'פעילה' : 'כבויה'}
        />
        <DetailRow
          label="מועד מתוכנן"
          value={thankyou.sendAt ? formatIsraelDateTime(thankyou.sendAt) : 'לא נקבע'}
        />
        {thankyou.sentAt ? (
          <DetailRow label="נשלחה בפועל" value={formatIsraelDateTime(thankyou.sentAt)} />
        ) : null}
      </dl>
    </div>
  );
}

function ThankyouScheduleForm({
  thankyou,
  action,
}: {
  thankyou: NonNullable<ThankyouSchedule>;
  action: BoundAction;
}) {
  const [state, formAction] = useActionState(action, null);
  const alreadySent = thankyou.sentAt != null;

  return (
    <form action={formAction}>
      <h3 className="text-sm font-bold">תודה אוטומטית</h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        הודעת תודה למי שאישרו הגעה, במועד שתבחרו.
      </p>

      {alreadySent ? (
        <p className="mt-4 rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">
          הודעת התודה נשלחה בתאריך {formatIsraelDateTime(thankyou.sentAt!)} ולא ניתן
          לשנות את המועד.
        </p>
      ) : (
        <>
          <label className="mt-4 flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-xl border border-border px-3 text-sm font-medium">
            <span>שליחה אוטומטית פעילה</span>
            <input
              type="checkbox"
              name="auto_enabled"
              defaultChecked={thankyou.autoEnabled}
              className="size-5 accent-primary"
            />
          </label>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <label className="text-sm">
              <span className="mb-1.5 block text-muted-foreground">תאריך</span>
              <DateSelectIL
                id="send_date"
                name="send_date"
                defaultValue={ilDateInputValue(thankyou.sendAt)}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1.5 block text-muted-foreground">שעה</span>
              <TimeSelect24
                id="send_time"
                name="send_time"
                defaultValue={ilTimeInputValue(thankyou.sendAt)}
              />
            </label>
          </div>

          <button
            type="submit"
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-semibold transition hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            עדכון לוח זמנים
          </button>
        </>
      )}

      <div className="mt-3 space-y-2">
        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />
      </div>
    </form>
  );
}

// Staff-only: move a live event's date.
//
// The date is locked once an event leaves draft, and that lock is a database
// trigger, not a UI rule — so this control is not "the disabled field, enabled".
// It posts to a separate action that reaches a separate SECURITY DEFINER
// function, the only thing permitted to lift the lock. The owner's own form
// keeps refusing exactly as before.
//
// Collapsed by default: this is the rarest thing on the page and the most
// consequential, and an always-open date picker beside "cancel campaign" invites
// the accident it is trying to serve.
function RescheduleEventForm({
  action,
  eventDate,
  alreadyNotified,
}: {
  action: BoundAction;
  eventDate: string | null;
  /** Guests already sent a message carrying the OLD date. */
  alreadyNotified: number;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <details className="group mt-3 rounded-xl border border-border px-4 py-3">
      <summary className="cursor-pointer list-none text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        שינוי מועד האירוע
      </summary>

      <form action={formAction} className="mt-3 space-y-3">
        <p className="text-sm leading-6 text-muted-foreground">
          המועד הנוכחי:{' '}
          <strong className="text-foreground">
            {eventDate ? formatIsraelDateTime(eventDate) : '—'}
          </strong>
        </p>

        {alreadyNotified > 0 ? (
          <p
            role="status"
            className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm leading-6 text-warning"
          >
            {alreadyNotified.toLocaleString('he-IL')} מוזמנים כבר קיבלו הודעה עם
            המועד הקיים. שינוי המועד <strong>אינו</strong> שולח להם עדכון — יש
            להודיע להם בנפרד.
          </p>
        ) : null}

        <label className="block text-sm">
          <span className="mb-1.5 block text-muted-foreground">מועד חדש</span>
          <DateSelectIL id="new_event_date" name="new_event_date" />
        </label>
        <FieldErrors errors={state?.fieldErrors?.event_date} />

        <label className="block text-sm">
          <span className="mb-1.5 block text-muted-foreground">שעה</span>
          <TimeSelect24 id="new_event_time" name="new_event_time" />
        </label>
        <FieldErrors errors={state?.fieldErrors?.event_time} />

        <label className="block text-sm">
          <span className="mb-1.5 block text-muted-foreground">
            סיבת השינוי (נרשמת ביומן הביקורת)
          </span>
          <textarea
            id="reschedule_reason"
            name="reschedule_reason"
            rows={2}
            required
            minLength={10}
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <FieldErrors errors={state?.fieldErrors?.reason} />

        <SubmitButton
          label="עדכון מועד האירוע"
          variant="danger"
          confirm="לשנות את מועד האירוע? חלון החיוב של הקמפיין יזוז איתו, ומוזמנים שכבר קיבלו הודעה לא יעודכנו אוטומטית."
        />

        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />
      </form>
    </details>
  );
}

function FieldErrors({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {errors[0]}
    </p>
  );
}

// One actions card, three sections. It was three cards — פעולות הקמפיין,
// תודה אוטומטית, פעולות מנהל — each a bordered panel holding one to three
// buttons, stacking on mobile into a column of frames.
//
// They are kept apart WITHIN the card, by a rule and a heading, because the
// distinction is real: the admin group ends a campaign's life and settles money.
// What it does not need is a second border around it. The destructive buttons
// keep their own red outline, which is what actually marks them.
function ActionsPanel({
  campaign,
  actions,
  eventId,
  canActivate,
  needsPayment,
  isPast,
  canPause,
  canClose,
  canSettle,
  canCancel,
  thankyou,
  thankyouRelevant,
  thankyouFailed,
  canEditThankyou,
  updateThankyouSchedule,
  canReschedule,
  eventDate,
  alreadyNotified,
}: {
  campaign: Campaign;
  actions: Actions;
  eventId: string;
  canActivate: boolean;
  needsPayment: boolean;
  isPast: boolean;
  canPause: boolean;
  canClose: boolean;
  canSettle: boolean;
  canCancel: boolean;
  thankyou?: ThankyouSchedule;
  thankyouRelevant: boolean;
  thankyouFailed: boolean;
  canEditThankyou: boolean;
  updateThankyouSchedule: BoundAction;
  /** Staff only, and only while the EVENT is active — a draft uses the owner form. */
  canReschedule: boolean;
  eventDate: string | null;
  alreadyNotified: number;
}) {
  const isActive = campaign.status === 'active';
  const hasOwnerActions = canActivate || needsPayment || isActive;
  const hasAdminActions = canPause || canClose || canSettle || canCancel;
  const showThankyou = Boolean(thankyou) && thankyouRelevant;
  const showThankyouFailure = thankyouFailed && thankyouRelevant;
  const showAdminSection = hasAdminActions || canReschedule;

  // Nothing to act on — render nothing rather than an empty titled box.
  if (!hasOwnerActions && !showAdminSection && !showThankyou && !showThankyouFailure) {
    return null;
  }

  return (
    <section
      aria-labelledby="actions-title"
      className="rounded-2xl border border-border bg-card p-5"
    >
      <h2 id="actions-title" className="text-base font-bold">
        פעולות
      </h2>

      {hasOwnerActions ? (
        <div className="mt-4 space-y-3">
          {canActivate ? (
            <ActionButton action={actions.activate} label="הפעלת קמפיין" variant="primary" />
          ) : null}

          {needsPayment ? (
            <Link
              href={`/app/events/${eventId}/campaign/${campaign.id}/payment`}
              className={`${buttonVariants()} min-h-11 w-full justify-center rounded-lg`}
            >
              המשך לאמצעי תשלום
            </Link>
          ) : null}

          {isActive ? (
            <ActionButton
              action={actions.sendGift}
              label="שליחת תזכורת מתנה"
              confirm="לשלוח תזכורת מתנה עם קישור הפייבוקס או הביט לכל המוזמנים עם הסכמה?"
            />
          ) : null}

          {isActive ? (
            <ActionButton
              action={actions.sendEventDay}
              label="תזכורת יום האירוע ותשלום"
              confirm="לשלוח תזכורת יום האירוע עם קישור לתשלום בביט רק למי שאישרו הגעה?"
            />
          ) : null}

          {isActive && isPast ? (
            <ActionButton
              action={actions.sendThankyou}
              label="שליחת הודעת תודה"
              confirm="לשלוח הודעת תודה לכל המוזמנים עם הסכמה?"
            />
          ) : null}
        </div>
      ) : null}

      {showThankyouFailure ? (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-bold">תודה אוטומטית</h3>
          <p role="status" className="mt-1 text-sm leading-6 text-warning">
            לא הצלחנו לטעון כרגע את לוח הזמנים לתודה. רעננו את הדף; אם זה חוזר,
            פנו לתמיכה.
          </p>
        </div>
      ) : showThankyou && thankyou ? (
        <div className="mt-5 border-t border-border pt-4">
          {canEditThankyou ? (
            <ThankyouScheduleForm thankyou={thankyou} action={updateThankyouSchedule} />
          ) : (
            <ThankyouScheduleReadOnly thankyou={thankyou} />
          )}
        </div>
      ) : null}

      {showAdminSection ? (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-bold">פעולות מנהל</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            פעולות תפעוליות שמשנות את מחזור החיים של הקמפיין.
          </p>

          <div className="mt-3 space-y-3">
            {canPause ? <ActionButton action={actions.pause} label="השהיית קמפיין" /> : null}

            {canClose ? (
              <ActionButton
                action={actions.close}
                label="סגירת קמפיין"
                variant="danger"
                confirm="לסגור את הקמפיין? לא יישלחו פניות נוספות."
              />
            ) : null}

            {canSettle ? (
              <ActionButton
                action={actions.settle}
                label="גמר חשבון וחיוב"
                variant="primary"
                confirm="לבצע גמר חשבון ולחייב את הכרטיס עבור אנשי הקשר שהושגו?"
              />
            ) : null}

            {canCancel ? (
              <ActionButton
                action={actions.cancel}
                label="ביטול קמפיין"
                variant="danger"
                confirm="לבטל את הקמפיין לצמיתות? הפעולה עוצרת כל פנייה נוספת ולא ניתנת לשחזור."
              />
            ) : null}
          </div>

          {canReschedule ? (
            <RescheduleEventForm
              action={actions.rescheduleEvent}
              eventDate={eventDate}
              alreadyNotified={alreadyNotified}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function ManageClient({
  campaign,
  summary,
  delivery,
  summaryFailed = false,
  deliveryFailed = false,
  thankyou,
  thankyouFailed = false,
  canEditThankyou,
  actions,
  eventDate = null,
  eventIsActive = false,
  eventId,
  authorizedCount,
  uniqueContacts,
  isPast = false,
  viewerIsAdmin,
}: {
  campaign: Campaign;
  summary: Summary;
  /** The read failed or was not permitted — NOT "the campaign has no activity". */
  summaryFailed?: boolean;
  delivery: Delivery;
  deliveryFailed?: boolean;
  thankyou?: ThankyouSchedule;
  thankyouFailed?: boolean;
  /** Only the event's owner may write the schedule; everyone else reads it. */
  canEditThankyou: boolean;
  actions: Actions;
  eventDate?: string | null;
  /** The EVENT's own status — a draft's date is edited on the owner form. */
  eventIsActive?: boolean;
  eventId: string;
  authorizedCount: number | null;
  uniqueContacts: number | null;
  isPast?: boolean;
  viewerIsAdmin: boolean;
}) {
  const status = campaign.status;
  const reached = summary?.reachedCount ?? 0;
  const ceiling = Number(campaign.max_charge_ceiling ?? summary?.ceiling ?? 0);
  const basePrice = Number(campaign.base_price ?? 0);
  const includedReached = Number(campaign.included_reached ?? 0);
  const overageRate = Number(campaign.price_per_reached ?? 0);
  const accrued = computeChargeAmount({
    base: basePrice,
    included: includedReached,
    overage: overageRate,
    reached,
    ceiling,
    credits: 0,
  }).amount;
  const balance = Math.max(0, ceiling - accrued);

  const heldOrLive =
    campaign.capture_status === 'authorized' &&
    ['approved', 'scheduled', 'active', 'paused'].includes(status);
  const showEmptyState = heldOrLive && authorizedCount === 0 && reached === 0;
  const excluded =
    heldOrLive && authorizedCount != null && uniqueContacts != null
      ? Math.max(0, uniqueContacts - authorizedCount)
      : 0;

  const activatableState = ['approved', 'scheduled', 'paused'].includes(status);
  const canActivate =
    !isPast && activatableState && campaign.capture_status === 'authorized';
  const needsPayment =
    !isPast && status === 'approved' && campaign.capture_status !== 'authorized';
  const canPause = viewerIsAdmin && status === 'active';
  const canClose =
    viewerIsAdmin &&
    ['active', 'paused', 'approved', 'scheduled'].includes(status);
  const settled =
    campaign.charge_status === 'charged' ||
    campaign.charge_status === 'nothing_to_charge';
  const canSettle =
    viewerIsAdmin &&
    status === 'closed' &&
    campaign.capture_status === 'authorized' &&
    !settled;
  const canCancel =
    viewerIsAdmin &&
    ['active', 'paused', 'approved', 'scheduled', 'closed'].includes(status);
  const showLifecycleWarning = isPast && activatableState;
  // Split from showThankyou so a failed load only warns where the panel would
  // have appeared anyway — a draft campaign has no schedule to miss.
  const thankyouRelevant = !['draft', 'pending_approval', 'approved', 'scheduled'].includes(
    status,
  );

  return (
    <div className="space-y-6 pb-6">
      <CampaignStatusAndBilling
        campaign={campaign}
        status={status}
        captureStatus={campaign.capture_status}
        reached={reached}
        accrued={accrued}
        ceiling={ceiling}
        balance={balance}
        basePrice={basePrice}
        includedReached={includedReached}
        overageRate={overageRate}
        finalCharge={campaign.final_charge_amount}
        creditApplied={campaign.credit_applied}
      />

      {showLifecycleWarning ? (
        <p
          role="status"
          className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-6 text-warning"
        >
          מועד האירוע חלף ולכן לא ניתן להפעיל את הקמפיין. מנהל המערכת עדיין יכול
          לסגור אותו ולבצע גמר חשבון עבור אנשי הקשר שכבר הושגו.
        </p>
      ) : null}

      {showEmptyState ? (
        <section className="rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
          <h2 className="text-lg font-bold">הקמפיין מוכן, אבל עדיין אין בו מוזמנים</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            הפניות יישלחו רק לאנשי הקשר שנוספו לרשימת המוזמנים.
          </p>
          <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
            <Link
              href={`/app/events/${eventId}/guests/import`}
              className={`${buttonVariants()} min-h-11 justify-center rounded-lg`}
            >
              ייבוא מוזמנים
            </Link>
            <Link
              href={`/app/events/${eventId}/guests/new`}
              className={`${buttonVariants({ variant: 'outline' })} min-h-11 justify-center rounded-lg`}
            >
              הוספת מוזמן
            </Link>
            <Link
              href={`/app/events/${eventId}/guests/import/whatsapp`}
              className={`${buttonVariants({ variant: 'outline' })} min-h-11 justify-center rounded-lg`}
            >
              ייבוא דרך WhatsApp
            </Link>
          </div>
        </section>
      ) : null}

      {excluded > 0 ? (
        <p
          role="status"
          className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-6 text-warning"
        >
          {excluded.toLocaleString('he-IL')} אנשי קשר ברשימה אינם כלולים בקמפיין
          משום שמכסת הקמפיין, הכוללת{' '}
          {(authorizedCount ?? 0).toLocaleString('he-IL')} אנשי קשר, מלאה. להגדלת
          המכסה יש לפנות לתמיכה.
        </p>
      ) : null}

      {/* Three cards, not six. On mobile they simply stack in reading order —
          what the campaign is and costs, how it is performing, what you can do
          about it — so the old `order-*` swap that pushed the action buttons
          above the numbers is gone. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-6">
          {/* The figures below default to 0 when the summary is missing, and a
              zeroed bill reads as a fact. Say the read failed instead. */}
          {summaryFailed ? (
            <LoadFailureNotice title="סיכום החיוב" what="נתוני החיוב המעודכנים" />
          ) : null}

          {deliveryFailed ? (
            <LoadFailureNotice
              title="ביצועי הקמפיין"
              what="נתוני המסירה והתוצאות"
            />
          ) : delivery && delivery.totalContacts > 0 ? (
            <DeliveryBreakdown delivery={delivery} />
          ) : (
            <section className="rounded-2xl border border-dashed border-border bg-card p-5 text-center sm:p-6">
              <h2 className="text-base font-bold">ביצועי הקמפיין</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {/* The page already knows how many contacts are in the campaign,
                    so it should not ask for contacts that are already there. */}
                {authorizedCount != null && authorizedCount > 0
                  ? 'נתוני המסירה והתוצאות יוצגו כאן ברגע שהקמפיין יתחיל לפעול.'
                  : 'נתוני המסירה והתוצאות יוצגו לאחר הוספת אנשי קשר ותחילת הפעילות.'}
              </p>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-6">
          <ActionsPanel
            campaign={campaign}
            actions={actions}
            eventId={eventId}
            canActivate={canActivate}
            needsPayment={needsPayment}
            isPast={isPast}
            canPause={canPause}
            canClose={canClose}
            canSettle={canSettle}
            canCancel={canCancel}
            thankyou={thankyou}
            thankyouRelevant={thankyouRelevant}
            thankyouFailed={thankyouFailed}
            canEditThankyou={canEditThankyou}
            updateThankyouSchedule={actions.updateThankyouSchedule}
            canReschedule={viewerIsAdmin && eventIsActive}
            eventDate={eventDate}
            // Contacts whose most recent message actually went out — the people
            // holding the OLD date. Not totalContacts: someone queued but never
            // messaged has nothing to be corrected about.
            alreadyNotified={delivery?.delivery.sent ?? 0}
          />
        </aside>
      </div>
    </div>
  );
}
