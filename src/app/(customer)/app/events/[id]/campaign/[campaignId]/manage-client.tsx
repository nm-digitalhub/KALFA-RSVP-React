'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import type { GaActionEvent } from '@/lib/analytics/ga-event-contracts';
import type { CampaignStatus } from '@/lib/data/campaigns';
import { cancelActionCopy, isCampaignCancellable } from '@/lib/data/campaign-status';
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
  // A package campaign is funded by its payment (the ledger): its price, and the ledger state the page derived for it
  // (null for a campaign without a package, or when the ledger could not be read).
  price: number | null;
  // How many contacts the campaign may approach (null = the campaign has no quota). Used: its authorized list.
  contact_quota: number | null;
  payment_status: string | null;
  // Everything that settled on the payment is test money (a payment on the no-money test terminal). Absent = false.
  payment_test_money?: boolean;
};

// What the stage, the cancel rule and the cancel button's words need from the campaign about its payment.
const paymentOf = (c: Pick<Campaign, 'payment_status' | 'payment_test_money'>) =>
  c.payment_status ? { status: c.payment_status, ...(c.payment_test_money ? { testMoney: true } : {}) } : null;

// How many contacts were reached (billing.ts getCampaignBillingSummary).
type Summary = {
  reachedCount: number;
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
  cancel: BoundAction;
  sendGift: BoundAction;
  sendEventDay: BoundAction;
  sendThankyou: BoundAction;
  updateThankyouSchedule: BoundAction;
  rescheduleEvent: BoundAction;
};

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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const appearance =
    variant === 'primary'
      ? 'bg-primary text-primary-foreground shadow-sm hover:opacity-90'
      : variant === 'danger'
        ? 'border border-destructive/40 bg-background text-destructive hover:bg-destructive/10'
        : 'border border-border bg-background text-foreground hover:bg-accent/50';

  const className = `inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${appearance}`;
  const text = pending ? 'מבצע פעולה...' : label;

  if (!confirm) {
    return (
      <button type="submit" disabled={pending} aria-disabled={pending} className={className}>
        {text}
      </button>
    );
  }

  // The dialog is portaled outside the form, so its confirm button submits the
  // trigger's form explicitly — the same action the plain submit runs.
  return (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogTrigger
        ref={buttonRef}
        disabled={pending}
        render={<button type="button" aria-disabled={pending} className={className} />}
      >
        {text}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction
            variant={variant === 'danger' ? 'destructive' : 'default'}
            onClick={() => {
              setConfirmOpen(false);
              buttonRef.current?.form?.requestSubmit();
            }}
          >
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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

// The campaign's stage and its contact quota, as a plain list. The money that actually moved is the payments list (ledger).
function CampaignStatusCard({
  campaign,
  status,
  authorizedCount,
}: {
  campaign: Campaign;
  status: CampaignStatus;
  authorizedCount: number | null;
}) {
  const stage = campaignStage({
    status,
    price: campaign.price,
    payment: paymentOf(campaign),
  });
  const quota = campaign.contact_quota;

  return (
    <section
      aria-labelledby="campaign-summary-title"
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="flex items-center gap-3 border-b border-border p-5 sm:p-6">
        <h2 id="campaign-summary-title" className="text-sm text-muted-foreground">
          מצב הקמפיין
        </h2>
        <Badge
          variant={CAMPAIGN_STAGE_VARIANTS[stage]}
          className="h-8 px-3 text-sm font-semibold"
        >
          {CAMPAIGN_STAGE_LABELS[stage]}
        </Badge>
      </div>

      {quota !== null ? (
        <dl className="divide-y divide-border px-5 sm:px-6">
          <DetailRow
            label="מכסת אנשי קשר"
            value={
              authorizedCount === null
                ? quota.toLocaleString('he-IL')
                : `${authorizedCount.toLocaleString('he-IL')} מתוך ${quota.toLocaleString('he-IL')}`
            }
          />
        </dl>
      ) : null}
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
            {/* A group, not a <label>: one label cannot name the several
                selects inside; each select carries its own labelPrefix name. */}
            <div role="group" aria-labelledby="send_date-label" className="text-sm">
              <span id="send_date-label" className="mb-1.5 block text-muted-foreground">
                תאריך
              </span>
              <DateSelectIL
                id="send_date"
                name="send_date"
                labelPrefix="תאריך"
                defaultValue={ilDateInputValue(thankyou.sendAt)}
              />
            </div>
            <div role="group" aria-labelledby="send_time-label" className="text-sm">
              <span id="send_time-label" className="mb-1.5 block text-muted-foreground">
                שעה
              </span>
              <TimeSelect24
                id="send_time"
                name="send_time"
                labelPrefix="שעה"
                defaultValue={ilTimeInputValue(thankyou.sendAt)}
              />
            </div>
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
// The date is locked once the first message or call has gone out to a guest, and
// that lock is a database trigger, not a UI rule — so this control is not "the
// disabled field, enabled". It posts to a separate action that reaches a separate
// SECURITY DEFINER function, the only thing permitted to lift the lock. The
// owner's own form can change the date only until that first send.
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

        <div role="group" aria-labelledby="new_event_date-label" className="block text-sm">
          <span id="new_event_date-label" className="mb-1.5 block text-muted-foreground">
            מועד חדש
          </span>
          <DateSelectIL id="new_event_date" name="new_event_date" labelPrefix="מועד חדש" />
        </div>
        <FieldErrors errors={state?.fieldErrors?.event_date} />

        <div role="group" aria-labelledby="new_event_time-label" className="block text-sm">
          <span id="new_event_time-label" className="mb-1.5 block text-muted-foreground">
            שעה
          </span>
          <TimeSelect24 id="new_event_time" name="new_event_time" labelPrefix="שעה" />
        </div>
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

// One actions card, three sections — the owner's campaign actions, תודה אוטומטית,
// פעולות מנהל — rather than a bordered panel per section, which on mobile would
// stack into a column of frames.
//
// They are kept apart WITHIN the card, by a rule and a heading, because the
// distinction is real: the admin group ends a campaign's life.
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
  // A campaign whose only money is test money is reset, not "cancelled": the button says which.
  const cancelCopy = cancelActionCopy(paymentOf(campaign));
  const hasOwnerActions = canActivate || needsPayment || isActive;
  const hasAdminActions = canPause || canClose || canCancel;
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
              המשך לתשלום החבילה
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

            {canCancel ? (
              <ActionButton
                action={actions.cancel}
                label={cancelCopy.label}
                variant="danger"
                confirm={cancelCopy.confirm}
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
  payments = null,
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
  /** The reached count could not be read — NOT "nobody was reached". */
  summaryFailed?: boolean;
  /** The payments list (ledger), rendered by the server page for THIS viewer; null when it is not theirs to see. */
  payments?: ReactNode;
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

  // Funded = the package was paid in full (from the ledger).
  const funded = campaign.price != null && campaign.payment_status === 'collected';
  const heldOrLive =
    funded &&
    ['approved', 'scheduled', 'active', 'paused'].includes(status);
  const showEmptyState = heldOrLive && authorizedCount === 0 && reached === 0;
  const excluded =
    heldOrLive && authorizedCount != null && uniqueContacts != null
      ? Math.max(0, uniqueContacts - authorizedCount)
      : 0;

  const activatableState = ['approved', 'scheduled', 'paused'].includes(status);
  const canActivate = !isPast && activatableState && funded;
  const needsPayment = !isPast && status === 'approved' && !funded;
  const canPause = viewerIsAdmin && status === 'active';
  const canClose =
    viewerIsAdmin &&
    ['active', 'paused', 'approved', 'scheduled'].includes(status);
  // Only where the cancel_campaign RPC would accept it (pre-money). A campaign with a payment or a reached contact is
  // refunded through the cancellation-request flow instead.
  const canCancel = viewerIsAdmin && isCampaignCancellable({ ...campaign, payment: paymentOf(campaign) }, reached);
  const showLifecycleWarning = isPast && activatableState;
  // Split from showThankyou so a failed load only warns where the panel would
  // have appeared anyway — a draft campaign has no schedule to miss.
  const thankyouRelevant = !['draft', 'pending_approval', 'approved', 'scheduled'].includes(
    status,
  );

  return (
    <div className="space-y-6 pb-6">
      <CampaignStatusCard campaign={campaign} status={status} authorizedCount={authorizedCount} />

      {showLifecycleWarning ? (
        <p
          role="status"
          className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-6 text-warning"
        >
          מועד האירוע חלף ולכן לא ניתן להפעיל את הקמפיין. מנהל המערכת עדיין יכול
          לסגור אותו.
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

      {/* Three cards. On mobile they simply stack in reading order — what the
          campaign is and costs, how it is performing, what you can do about
          it — with no `order-*` swap pushing the action buttons above the
          numbers. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-6">
          {payments}

          {/* The reached count defaults to 0 when it is missing, and a zero reads as a fact. Say the read failed instead. */}
          {summaryFailed ? (
            <LoadFailureNotice title="אנשי קשר שהושגו" what="מספר אנשי הקשר שהושגו" />
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

        <aside className="lg:sticky lg:top-24">
          <ActionsPanel
            campaign={campaign}
            actions={actions}
            eventId={eventId}
            canActivate={canActivate}
            needsPayment={needsPayment}
            isPast={isPast}
            canPause={canPause}
            canClose={canClose}
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
