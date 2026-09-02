'use client';

import { useActionState, useEffect, useRef } from 'react';

import { sendBusinessEvent } from '@/components/consent/send-ga-event';
import { FormError, FormNotice } from '@/components/forms';
import type { GaActionEvent } from '@/lib/analytics/ga-event-contracts';
import type { FormState } from '@/lib/validation/result';
import { ilDateInputValue, ilTimeInputValue } from '@/lib/data/event-date';
import { formatIsraelDateTime } from '@/lib/date';
import { DateSelectIL } from '@/components/date-select-il';
import { TimeSelect24 } from '@/components/time-select-24';
import {
  OP_STATUS_LABELS,
  REMOVAL_REQUESTED_LABEL,
  deliveryStatusLabel,
} from '@/app/(customer)/app/events/[id]/guests/labels';
import { CAMPAIGN_STATUS_LABELS } from '@/lib/data/event-labels';
import type { CampaignStatus } from '@/lib/data/campaigns';
import { computeChargeAmount } from '@/lib/data/close-charge-amount';
import { HelpTip } from '@/components/help-tip';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

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

// Shape mirrors CampaignDeliveryBreakdown from '@/lib/data/campaign-delivery'
// (kept inline so this client component doesn't import the server-only module).
type Delivery = {
  totalContacts: number;
  delivery: { sent: number; delivered: number; read: number; failed: number };
  outcome: { reached: number; wrongNumber: number; optedOut: number };
  call: { dialed: number; noAnswer: number; voicemail: number; humanInteraction: number };
} | null;

function nis(v: number | null | undefined): string {
  return v == null ? '—' : `₪${Number(v).toLocaleString('he-IL')}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}

// Fires an analytics payload a Server Action attached to its returned state
// (e.g. settle's `purchase`) — exactly once per returned state object, so
// re-renders with the same state never duplicate the event.
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
  const cls =
    variant === 'primary'
      ? 'bg-primary text-primary-foreground hover:opacity-90'
      : variant === 'danger'
        ? 'border border-destructive/40 text-destructive hover:bg-destructive/10'
        : 'border border-border hover:bg-accent/40';
  return (
    <form action={formAction} className="space-y-2">
      <button
        type="submit"
        onClick={
          confirm
            ? (e) => {
                if (!window.confirm(confirm)) e.preventDefault();
              }
            : undefined
        }
        className={`rounded-md px-4 py-2 text-sm font-medium transition ${cls}`}
      >
        {label}
      </button>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

// A compact, RTL-safe horizontal bar — a logical-property width fill, no chart
// dependency (deliberate: the recharts wrapper is unverified at runtime here).
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
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={`h-full rounded-full ${tone}`} style={{ inlineSize: `${pct}%` }} />
      </div>
    </div>
  );
}

// §B8 — the WhatsApp/Meta webhook breakdown. Shown BESIDE the billing summary
// (never replacing it): message delivery (sent/delivered/read/failed, latest per
// contact) + contact outcomes (reached/wrong-number/opt-out), all from inbound
// Meta signals. Hidden until the campaign has contacts (deliberate empty state).
function DeliveryBreakdown({ delivery }: { delivery: NonNullable<Delivery> }) {
  const { totalContacts, delivery: d, outcome, call } = delivery;
  const hasCalls =
    call.dialed + call.noAnswer + call.voicemail + call.humanInteraction > 0;
  return (
    <section className="space-y-4 border-t border-border pt-4">
      <div>
        <h2 className="text-sm font-semibold">פעילות WhatsApp</h2>
        <p className="text-xs text-muted-foreground">
          לפי אותות מ-Meta (נפרד מסיכום החיוב).
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Message delivery — latest state per contact. */}
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">מסירת הודעות</p>
          <DeliveryBar label={deliveryStatusLabel('sent')} value={d.sent} total={totalContacts} tone="bg-muted-foreground/40" />
          <DeliveryBar label={deliveryStatusLabel('delivered')} value={d.delivered} total={totalContacts} tone="bg-primary/60" />
          <DeliveryBar label={deliveryStatusLabel('read')} value={d.read} total={totalContacts} tone="bg-primary" />
          <DeliveryBar label={deliveryStatusLabel('failed')} value={d.failed} total={totalContacts} tone="bg-destructive/70" />
        </div>

        {/* Contact outcomes — from the contact record (op_status + opt-out). */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">תוצאות אנשי קשר</p>
          <div className="grid grid-cols-2 gap-3">
            <Stat label={OP_STATUS_LABELS.reached_billed} value={String(outcome.reached)} />
            <Stat label={OP_STATUS_LABELS.wrong_number} value={String(outcome.wrongNumber)} />
            <Stat label={REMOVAL_REQUESTED_LABEL} value={String(outcome.optedOut)} />
            <Stat label="סך אנשי קשר" value={String(totalContacts)} />
          </div>
        </div>
      </div>

      {/* AI-call family — shown only when the campaign has real call activity so
          a WhatsApp-only campaign doesn't render an empty call block. Counts
          only; recording links are admin-only (§1F), never surfaced to owners. */}
      {hasCalls ? (
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">שיחות AI</p>
          <div className="grid grid-cols-2 gap-3">
            <Stat label={OP_STATUS_LABELS.call_dialed} value={String(call.dialed)} />
            <Stat label={OP_STATUS_LABELS.no_answer} value={String(call.noAnswer)} />
            <Stat label={OP_STATUS_LABELS.voicemail} value={String(call.voicemail)} />
            <Stat
              label={OP_STATUS_LABELS.human_interaction_call}
              value={String(call.humanInteraction)}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

type ThankyouSchedule = {
  autoEnabled: boolean;
  sendAt: string | null;
  sentAt: string | null;
} | null;

// Owner controls for the auto-thankyou sweep (worker/main.ts, every 5 min):
// opt-in toggle + an editable Israel wall-clock date/time. Once thankyou_sent_at
// is set, the plan's "cancel window" has already closed — the form disables
// itself and shows when it fired instead of a misleading editable schedule.
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
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">תודה אוטומטית אחרי האירוע</h2>
        <p className="text-xs text-muted-foreground">
          נשלחת אוטומטית למי שאישרו הגעה, בשעה שנקבעה. ניתן לבטל או לשנות עד שהיא נשלחת.
        </p>
      </div>
      {alreadySent ? (
        <p className="text-sm text-muted-foreground">
          הודעת התודה כבר נשלחה ({formatIsraelDateTime(thankyou.sentAt!)}) — לא ניתן לשנות עוד.
        </p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="auto_enabled"
              defaultChecked={thankyou.autoEnabled}
              className="size-4"
            />
            שליחה אוטומטית פעילה
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">תאריך</span>
              <DateSelectIL
                id="send_date"
                name="send_date"
                defaultValue={ilDateInputValue(thankyou.sendAt)}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">שעה</span>
              <TimeSelect24
                id="send_time"
                name="send_time"
                defaultValue={ilTimeInputValue(thankyou.sendAt)}
              />
            </label>
          </div>
          <button
            type="submit"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent/40"
          >
            עדכון לוח זמנים
          </button>
        </>
      )}
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

export function ManageClient({
  campaign,
  summary,
  delivery,
  thankyou,
  actions,
  eventId,
  authorizedCount,
  uniqueContacts,
  isPast = false,
  viewerIsAdmin,
}: {
  campaign: Campaign;
  summary: Summary;
  delivery: Delivery;
  thankyou?: ThankyouSchedule;
  actions: {
    activate: BoundAction;
    pause: BoundAction;
    close: BoundAction;
    settle: BoundAction;
    cancel: BoundAction;
    sendGift: BoundAction;
    sendEventDay: BoundAction;
    sendThankyou: BoundAction;
    updateThankyouSchedule: BoundAction;
  };
  eventId: string;
  // The campaign's authorized set size and the event's reachable-contact count
  // (null = unavailable to this viewer; the empty state / banner then hide).
  authorizedCount: number | null;
  uniqueContacts: number | null;
  isPast?: boolean;
  // The four wind-down controls (pause/close/settle/cancel) are platform-admin-
  // only. This flag only HIDES them for non-admins; the real enforcement is
  // server-side in the campaign actions. Owners keep activate + the send-*
  // controls.
  viewerIsAdmin: boolean;
}) {
  const s = campaign.status;
  const reached = summary?.reachedCount ?? 0;
  const ceiling = Number(campaign.max_charge_ceiling ?? summary?.ceiling ?? 0);
  const basePrice = Number(campaign.base_price ?? 0);
  const includedReached = Number(campaign.included_reached ?? 0);
  const overageRate = Number(campaign.price_per_reached ?? 0);
  // Live preview of "what would be charged if settled right now" — the SAME
  // pure formula close-charge.ts uses at actual settlement (base + overage
  // above the included count, capped at the ceiling), not a separate
  // approximation. credits are intentionally 0 here: available credit is
  // applied only at settle time and shown as "זיכוי שקוזז" once that happens.
  const accrued = computeChargeAmount({
    base: basePrice,
    included: includedReached,
    overage: overageRate,
    reached,
    ceiling,
    credits: 0,
  }).amount;
  const balance = Math.max(0, ceiling - accrued);

  // Audit §7 — "אין עדיין מוזמנים בקמפיין": the set is empty on a campaign the
  // owner already committed money to. Shown ONLY after the hold (before it the
  // set is empty by design). Reached contacts are always ⊆ the set, so an empty
  // set with reached > 0 cannot happen; guard anyway.
  const heldOrLive =
    campaign.capture_status === 'authorized' &&
    ['approved', 'scheduled', 'active', 'paused'].includes(s);
  const showEmptyState = heldOrLive && authorizedCount === 0 && reached === 0;
  // Guests on the list that the campaign will NOT reach (funded_cap reached —
  // reconcile_authorized_set returned ceiling_full). Surfaced instead of the
  // console.warn-only signal the P0-2 note describes.
  const excluded =
    heldOrLive && authorizedCount != null && uniqueContacts != null
      ? Math.max(0, uniqueContacts - authorizedCount)
      : 0;

  // A past event can no longer BEGIN outreach (activate), but pause/close/settle
  // remain so the owner can wind the campaign down and settle what was reached.
  // Activation requires a CONFIRMED hold (activateCampaign's capture_status
  // guard) — without one the right next step is the payment page, not a button
  // that fails server-side. A paused campaign is already held by construction.
  const activatableState = ['approved', 'scheduled', 'paused'].includes(s);
  const canActivate = !isPast && activatableState && campaign.capture_status === 'authorized';
  const needsPayment = !isPast && s === 'approved' && campaign.capture_status !== 'authorized';
  // pause/close/settle/cancel are platform-admin-only (server-enforced). The
  // viewerIsAdmin factor here only hides the buttons from owners/org-members.
  const canPause = viewerIsAdmin && s === 'active';
  const canClose = viewerIsAdmin && ['active', 'paused', 'approved', 'scheduled'].includes(s);
  // Terminal charge outcomes ('charged'/'nothing_to_charge') are final — mirror
  // the same guard closeCampaignAndCharge itself enforces (close-charge.ts) so
  // a settled campaign never shows a re-clickable settle button.
  const settled =
    campaign.charge_status === 'charged' || campaign.charge_status === 'nothing_to_charge';
  const canSettle =
    viewerIsAdmin && s === 'closed' && campaign.capture_status === 'authorized' && !settled;
  // Cancel is a hard wind-down: allowed while operational or closed (before a
  // final charge lands). Terminal states (billed/paid/cancelled) can't cancel.
  const canCancel =
    viewerIsAdmin &&
    ['active', 'paused', 'approved', 'scheduled', 'closed'].includes(s);
  // Whether ANY lifecycle control shows — used so an owner (who now sees none of
  // the admin controls) doesn't get a dangling `border-t` divider. activate +
  // the send-* controls remain owner-visible.
  const showLifecycleWarning = isPast && activatableState;
  const anyLifecycleControl =
    canActivate ||
    needsPayment ||
    canPause ||
    canClose ||
    canCancel ||
    canSettle ||
    s === 'active';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">מצב הקמפיין</span>
          <span className="rounded-full border border-border px-3 py-1 text-sm font-semibold">
            {CAMPAIGN_STATUS_LABELS[s]}
          </span>
        </div>
        {campaign.final_charge_amount != null ? (
          <span className="text-sm text-muted-foreground">
            חיוב סופי: <strong>{nis(campaign.final_charge_amount)}</strong>
            {Number(campaign.credit_applied ?? 0) > 0 ? (
              <> · זיכוי שקוזז: <strong>{nis(campaign.credit_applied)}</strong></>
            ) : null}
          </span>
        ) : null}
      </div>

      {showEmptyState ? (
        <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="font-semibold">אין עדיין מוזמנים בקמפיין.</p>
          <p className="text-sm text-muted-foreground">
            הפניות יישלחו רק למוזמנים שברשימה. הוסיפו מוזמנים כדי שהקמפיין יתחיל לעבוד.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/app/events/${eventId}/guests/import`} className={buttonVariants()}>
              ייבוא מוזמנים
            </Link>
            <Link
              href={`/app/events/${eventId}/guests/new`}
              className={buttonVariants({ variant: 'outline' })}
            >
              הוספת מוזמן
            </Link>
            <Link
              href={`/app/events/${eventId}/guests/import/whatsapp`}
              className={buttonVariants({ variant: 'outline' })}
            >
              שליחה דרך וואטסאפ
            </Link>
          </div>
        </section>
      ) : null}

      {excluded > 0 ? (
        <p
          role="status"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          {excluded.toLocaleString('he-IL')} אנשי קשר ברשימה אינם כלולים בקמפיין — מכסת הקמפיין (
          {(authorizedCount ?? 0).toLocaleString('he-IL')} אנשי קשר) מלאה. להגדלת המכסה פנו
          לתמיכה.
        </p>
      ) : null}

      {/* §15 owner board */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium">תוכנית החיוב</span>
        <HelpTip
          text={
            basePrice > 0
              ? `דמי הפעלה קבועים של ${nis(basePrice)} — נגבים במלואם ללא תלות בתוצאה, כולל אם אף איש קשר לא השיב. ${includedReached} אנשי הקשר הראשונים שהשיבו כלולים בדמי ההפעלה; מעבר לכך נוסף ${nis(overageRate)} לכל איש קשר נוסף שהשיב, עד לתקרה של ${nis(ceiling)}.`
              : `מחיר לכל איש קשר ייחודי שהשיב בפועל: ${nis(overageRate)}, עד לתקרה של ${nis(ceiling)}. אין דמי הפעלה קבועים בתוכנית הזו.`
          }
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="מחיר לאיש קשר שהושג" value={nis(campaign.price_per_reached)} />
        <Stat
          label="אנשי קשר מורשים"
          value={String(campaign.max_contacts ?? '—')}
        />
        <Stat label="תקרת חיוב" value={nis(ceiling)} />
        <Stat label="אנשי קשר שהושגו" value={String(reached)} />
        <Stat
          label={reached === 0 && basePrice > 0 ? 'דמי הפעלה' : 'חיוב מצטבר'}
          value={nis(accrued)}
        />
        <Stat label="יתרה עד התקרה" value={nis(balance)} />
      </div>
      <p className="text-xs text-muted-foreground">
        לא מחויבים: הודעות שנקראו בלבד · ניסיונות ללא מענה · תאים קוליים · מספרים
        שגויים · תגובות כפולות. החיוב הוא לכל איש קשר ייחודי שהשיב בפועל, פעם אחת.
      </p>

      {/* §B8 webhook breakdown — beside the billing board; hidden until there are
          contacts so a not-yet-started campaign doesn't show a wall of zeros. */}
      {delivery && delivery.totalContacts > 0 ? (
        <DeliveryBreakdown delivery={delivery} />
      ) : null}

      {/* Auto-thankyou schedule — only meaningful once the campaign has
          activated at least once (thankyou_send_at is seeded on activation;
          draft/pending_approval/approved/scheduled have nothing to show yet). */}
      {thankyou && !['draft', 'pending_approval', 'approved', 'scheduled'].includes(s) ? (
        <ThankyouScheduleForm thankyou={thankyou} action={actions.updateThankyouSchedule} />
      ) : null}

      {/* Lifecycle controls — rendered (with the border-t divider) only when at
          least one control or the past-event warning shows, so an owner who now
          sees none of the admin wind-down controls gets no dangling divider. */}
      {anyLifecycleControl || showLifecycleWarning ? (
      <div className="flex flex-wrap gap-3 border-t border-border pt-4">
        {showLifecycleWarning ? (
          <p className="w-full rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            מועד האירוע חלף — לא ניתן להפעיל את הקמפיין. ניתן לסגור ולבצע גמר חשבון
            על אנשי הקשר שכבר הושגו.
          </p>
        ) : null}
        {canActivate ? (
          <ActionButton action={actions.activate} label="הפעלת קמפיין" variant="primary" />
        ) : null}
        {needsPayment ? (
          <Link
            href={`/app/events/${eventId}/campaign/${campaign.id}/payment`}
            className={buttonVariants()}
          >
            המשך לאמצעי תשלום
          </Link>
        ) : null}
        {canPause ? (
          <ActionButton action={actions.pause} label="השהיה" />
        ) : null}
        {canClose ? (
          <ActionButton
            action={actions.close}
            label="סגירת קמפיין"
            variant="danger"
            confirm="לסגור את הקמפיין? לא יישלחו פניות נוספות."
          />
        ) : null}
        {s === 'active' ? (
          <ActionButton
            action={actions.sendGift}
            label="שליחת תזכורת מתנה"
            confirm="לשלוח תזכורת מתנה עם קישור הפייבוקס/ביט לכל המוזמנים עם הסכמה?"
          />
        ) : null}
        {s === 'active' ? (
          <ActionButton
            action={actions.sendEventDay}
            label="תזכורת יום האירוע + תשלום"
            confirm="לשלוח תזכורת יום האירוע עם קישור לתשלום בביט — רק למי שאישרו הגעה?"
          />
        ) : null}
        {s === 'active' && isPast ? (
          <ActionButton
            action={actions.sendThankyou}
            label="שליחת הודעת תודה"
            confirm="לשלוח הודעת תודה לכל המוזמנים עם הסכמה?"
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
            confirm="לבטל את הקמפיין לצמיתות? פעולה זו עוצרת כל פנייה נוספת ולא ניתנת לשחזור."
          />
        ) : null}
      </div>
      ) : null}
    </div>
  );
}
