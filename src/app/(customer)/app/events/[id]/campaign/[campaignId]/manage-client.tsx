'use client';

import { useActionState } from 'react';

import { FormError, FormNotice } from '@/components/forms';
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
  isPast?: boolean;
  // The four wind-down controls (pause/close/settle/cancel) are platform-admin-
  // only. This flag only HIDES them for non-admins; the real enforcement is
  // server-side in the campaign actions. Owners keep activate + the send-*
  // controls.
  viewerIsAdmin: boolean;
}) {
  const s = campaign.status;
  const reached = summary?.reachedCount ?? 0;
  const accrued = Number(summary?.accrued ?? 0);
  const ceiling = Number(campaign.max_charge_ceiling ?? summary?.ceiling ?? 0);
  const balance = Math.max(0, ceiling - accrued);

  // A past event can no longer BEGIN outreach (activate), but pause/close/settle
  // remain so the owner can wind the campaign down and settle what was reached.
  const activatableState = ['approved', 'scheduled', 'paused'].includes(s);
  const canActivate = !isPast && activatableState;
  // pause/close/settle/cancel are platform-admin-only (server-enforced). The
  // viewerIsAdmin factor here only hides the buttons from owners/org-members.
  const canPause = viewerIsAdmin && s === 'active';
  const canClose = viewerIsAdmin && ['active', 'paused', 'approved', 'scheduled'].includes(s);
  const canSettle = viewerIsAdmin && s === 'closed' && campaign.capture_status === 'authorized';
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
    canActivate || canPause || canClose || canCancel || canSettle || s === 'active';

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

      {/* §15 owner board */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="מחיר לאיש קשר שהושג" value={nis(campaign.price_per_reached)} />
        <Stat
          label="אנשי קשר מורשים"
          value={String(campaign.max_contacts ?? '—')}
        />
        <Stat label="תקרת חיוב" value={nis(ceiling)} />
        <Stat label="אנשי קשר שהושגו" value={String(reached)} />
        <Stat label="חיוב מצטבר" value={nis(accrued)} />
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
