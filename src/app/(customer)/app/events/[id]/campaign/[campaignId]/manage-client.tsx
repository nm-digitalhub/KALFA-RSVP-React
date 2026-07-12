'use client';

import { useActionState } from 'react';

import { FormError, FormNotice } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';
import {
  OP_STATUS_LABELS,
  REMOVAL_REQUESTED_LABEL,
  deliveryStatusLabel,
} from '@/app/(customer)/app/events/[id]/guests/labels';

type BoundAction = (
  prevState: FormState,
  formData: FormData,
) => Promise<FormState>;

type Campaign = {
  id: string;
  status: string;
  price_per_reached: number | null;
  max_contacts: number | null;
  max_charge_ceiling: number | null;
  final_charge_amount: number | null;
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
} | null;

const STATUS_LABELS: Record<string, string> = {
  draft: 'טיוטה',
  pending_approval: 'ממתין לאישור',
  approved: 'מאושר',
  scheduled: 'מתוזמן',
  active: 'פעיל',
  paused: 'מושהה',
  closed: 'נסגר',
  awaiting_invoice: 'ממתין לחשבון',
  billed: 'חויב',
  paid: 'שולם',
  cancelled: 'בוטל',
};

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
  const { totalContacts, delivery: d, outcome } = delivery;
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
    </section>
  );
}

export function ManageClient({
  campaign,
  summary,
  delivery,
  actions,
  isPast = false,
}: {
  campaign: Campaign;
  summary: Summary;
  delivery: Delivery;
  actions: {
    activate: BoundAction;
    pause: BoundAction;
    close: BoundAction;
    settle: BoundAction;
    sendGift: BoundAction;
    sendEventDay: BoundAction;
  };
  isPast?: boolean;
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
  const canPause = s === 'active';
  const canClose = ['active', 'paused', 'approved', 'scheduled'].includes(s);
  const canSettle = s === 'closed' && campaign.capture_status === 'authorized';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">מצב הקמפיין</span>
          <span className="rounded-full border border-border px-3 py-1 text-sm font-semibold">
            {STATUS_LABELS[s] ?? s}
          </span>
        </div>
        {campaign.final_charge_amount != null ? (
          <span className="text-sm text-muted-foreground">
            חיוב סופי: <strong>{nis(campaign.final_charge_amount)}</strong>
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

      {/* Lifecycle controls */}
      <div className="flex flex-wrap gap-3 border-t border-border pt-4">
        {isPast && activatableState ? (
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
        {canSettle ? (
          <ActionButton
            action={actions.settle}
            label="גמר חשבון וחיוב"
            variant="primary"
            confirm="לבצע גמר חשבון ולחייב את הכרטיס עבור אנשי הקשר שהושגו?"
          />
        ) : null}
      </div>
    </div>
  );
}
