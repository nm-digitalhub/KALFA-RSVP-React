'use client';

import { useActionState } from 'react';

import { FormError, FormNotice } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

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

export function ManageClient({
  campaign,
  summary,
  actions,
}: {
  campaign: Campaign;
  summary: Summary;
  actions: {
    activate: BoundAction;
    pause: BoundAction;
    close: BoundAction;
    settle: BoundAction;
  };
}) {
  const s = campaign.status;
  const reached = summary?.reachedCount ?? 0;
  const accrued = Number(summary?.accrued ?? 0);
  const ceiling = Number(campaign.max_charge_ceiling ?? summary?.ceiling ?? 0);
  const balance = Math.max(0, ceiling - accrued);

  const canActivate = ['approved', 'scheduled', 'paused'].includes(s);
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

      {/* Lifecycle controls */}
      <div className="flex flex-wrap gap-3 border-t border-border pt-4">
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
