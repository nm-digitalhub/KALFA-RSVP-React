import { Badge } from '@/components/ui/badge';
import type { ThankyouSchedule } from '@/lib/data/campaigns';
import { ilTimeInputValue } from '@/lib/data/event-date';
import { eventStatusLabel, type EventClosureReason } from '@/lib/data/event-labels';
import type { EventStatsResult } from '@/lib/data/event-stats';
import { formatIsraelDate, formatIsraelDateTime } from '@/lib/date';
import { formatCurrency } from '@/lib/format';

// The CLOSED-event face of /app/events/[id] (plan §6). A pure Server Component:
// it renders a DTO the page already assembled and performs NO data access of
// its own. That is a hard constraint, not a style choice — getEventStats opens
// with a mandatory requireEventAccess(…,'reports','view') that throws
// notFound(), so calling it from the page body would turn a missing reports.view
// into a 404 on the WHOLE event page (plan §0, blocker ח1). The page decides
// whether the viewer may see the stats and passes the result down; here we only
// display it.
//
// Nothing in this file offers an ACTION — not a setup action (publish, sign,
// card hold, activate, setup steps, edit form) and not a "next action" either:
// the event is over, `closed` is terminal (events_guard_update permits no
// closed → * transition, migration 20260630223635), and every send path is
// gated on an ACTIVE event. Offering anything here would invite acting on a
// closed event, or promise an outcome that can no longer happen.

export interface EventSummaryProps {
  /** Route id. No longer read by this component: the only link that consumed it
   *  was the thank-you CTA, removed because that action is unreachable on a
   *  closed event (see §3 below). Kept in the contract so the page's existing
   *  call site stays valid — dropping it is a call-site change, not a change
   *  here. */
  eventId: string;
  stats: EventStatsResult;
  /** From getEventClosureReason — 'cancellation' is what turns "הסתיים" into "בוטל". */
  closureReason: EventClosureReason | null;
  /** From getThankyouSchedule; null when there is no campaign (or it failed to load). */
  thankyou: ThankyouSchedule | null;
}

// Israel calendar date, plus the wall-clock time only when one was actually
// set. Same rule as the open-event page: legacy date-only events are stored as
// midnight UTC, and printing their "time" would show a misleading 02:00/03:00.
function formatEventDate(value: string | null): string | null {
  if (!value) return null;
  const hasTime = ilTimeInputValue(value) !== '';
  return (hasTime ? formatIsraelDateTime(value) : formatIsraelDate(value)) || null;
}

// charge_status is TEXT and nullable; the writers in campaigns.ts use exactly
// this vocabulary (lockCampaignForCharge → 'pending', recordCampaignCharge →
// 'charged', markCampaignChargeOutcome → the other three). An unknown value
// falls back to '—' — a raw DB token must never reach the owner's screen.
const CHARGE_STATUS_LABELS: Record<string, string | undefined> = {
  pending: 'בעיבוד',
  charged: 'חויב',
  nothing_to_charge: 'לא בוצע חיוב',
  charge_failed: 'החיוב לא הושלם',
  charge_review: 'החיוב בבדיקה',
};

function chargeStatusLabel(
  chargeStatus: string | null,
  finalChargeAmount: number | null,
): string {
  if (chargeStatus) return CHARGE_STATUS_LABELS[chargeStatus] ?? '—';
  // No status recorded yet: "בעיבוד" only while there is genuinely no final
  // amount — the same condition the processing banner uses, so the two agree.
  return finalChargeAmount == null ? 'בעיבוד' : '—';
}

function count(value: number): string {
  return value.toLocaleString('he-IL');
}

function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'success' | 'destructive' | 'warning';
}) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={
          tone === 'success'
            ? 'text-xl font-bold tabular-nums text-success'
            : tone === 'destructive'
              ? 'text-xl font-bold tabular-nums text-destructive'
              : tone === 'warning'
                ? 'text-xl font-bold tabular-nums text-warning'
                : 'text-xl font-bold tabular-nums'
        }
      >
        {value}
      </dd>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function BillingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function EventSummary({
  // eventId is intentionally NOT destructured — see EventSummaryProps.
  stats,
  closureReason,
  thankyou,
}: EventSummaryProps) {
  const { event, eventState, totals, totalsState, campaign } = stats;

  // §6 consumes exactly ONE alert. The remaining ids (high_pending,
  // over_invited, failed_deliveries, wrong_numbers, ceiling_near_usage) are
  // operational warnings for a LIVE event and are deliberately not surfaced on
  // a closed one — there is nothing left to act on.
  const billingInProcessing = stats.alerts.some(
    (a) => a.id === 'campaign_closed_not_settled',
  );

  // A scheduled thank-you that never went out. This is a CLOSED-EVENT FACT, not
  // a pending action, and the distinction is verified, not assumed: this whole
  // component renders only under event.status === 'closed' (page.tsx), and BOTH
  // send paths are gated on an ACTIVE event —
  //   • the sweep (auto-thankyou.ts listDueThankyouCampaigns) enumerates due
  //     campaigns and then keeps only those whose event is .eq('status','active');
  //   • the manual sendThankyouAction goes through sendCampaignWhatsApp, which
  //     returns {blocked:true} when ev.status !== 'active' (and again when the
  //     campaign itself is not active).
  // `closed` is terminal at the DB (events_guard_update allows draft→active|closed
  // and active→closed only), so the event can never return to a state either path
  // accepts. Hence: no CTA and no future tense — the message will not be sent.
  //
  // Predicate = the sweep's OWN precondition (a schedule existed and never fired):
  // sendAt set + sentAt null. thankyou_auto_enabled is deliberately NOT part of it:
  // getThankyouSchedule fail-opens it to true when the column is absent, so it
  // reports intent it cannot actually prove.
  const unsentThankyou =
    thankyou !== null && thankyou.sendAt !== null && thankyou.sentAt === null;

  const eventDate = formatEventDate(event?.eventDate ?? null);
  const isCancelled = closureReason === 'cancellation';

  // A campaign section is shown only when the campaign really is visible. An
  // event closed without a campaign (campaign.state 'empty' / id === null) and
  // a viewer without campaigns.view ('permission_limited') both render NOTHING
  // here — never a row of zeros, which would read as "we contacted no one".
  const campaignVisible = campaign.state === 'visible' && campaign.id !== null;
  const delivery = campaignVisible ? campaign.delivery : null;
  const billingDetail = campaignVisible ? campaign.billingDetail : null;

  return (
    <div className="space-y-6">
      {/* 1 — header */}
      {eventState === 'visible' && event ? (
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{event.name}</h1>
            {event.status ? (
              <Badge variant={isCancelled ? 'destructive' : 'neutral'}>
                {eventStatusLabel(event.status, closureReason)}
              </Badge>
            ) : null}
          </div>
          {eventDate || event.venue ? (
            <p className="text-sm text-muted-foreground">
              {[eventDate, event.venue].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </header>
      ) : eventState === 'error' ? (
        <p className="text-sm text-muted-foreground">
          לא ניתן לטעון את פרטי האירוע כרגע.
        </p>
      ) : null}

      {/* 2 — billing still open. Verbatim §6 copy. */}
      {billingInProcessing ? (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          האירוע הסתיים. הסיכום הכספי נמצא בעיבוד ויעודכן לאחר סגירת הקמפיין.
        </p>
      ) : null}

      {/* 3 — thank-you status. A plain factual line about what happened, in the
          status region: no heading, no CTA, no planned time. Printing the
          scheduled moment beside "will not be sent" would re-open the very
          ambiguity this line exists to close. Muted rather than warning-toned
          on purpose — there is nothing here for the owner to act on. */}
      {unsentThankyou ? (
        <p className="text-sm text-muted-foreground">
          הודעת התודה למוזמנים לא נשלחה. האירוע נסגר לפני שההודעה יצאה, ולכן היא לא
          תישלח.
        </p>
      ) : null}

      {/* 4 — RSVP results. All four headline numbers are ROW counts so they sum;
          the people-level figures ride along as sub-labels. */}
      {totalsState === 'visible' && totals ? (
        <section
          aria-labelledby="event-summary-rsvp-title"
          className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6"
        >
          <h2 id="event-summary-rsvp-title" className="text-lg font-bold">
            תוצאות אישורי ההגעה
          </h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric
              label="מוזמנים"
              value={count(totals.rows)}
              note={`${count(totals.invited_people)} אנשים`}
            />
            <Metric
              label="אישרו הגעה"
              value={count(totals.attending_rows)}
              note={`${count(totals.attending_people)} אנשים`}
              tone="success"
            />
            <Metric label="לא מגיעים" value={count(totals.declined_rows)} tone="destructive" />
            <Metric label="טרם השיבו" value={count(totals.pending_rows)} />
          </dl>
          {totals.maybe_rows > 0 ? (
            <p className="text-xs text-muted-foreground">
              בנוסף, {count(totals.maybe_rows)} מוזמנים השיבו &quot;אולי&quot;.
            </p>
          ) : null}
        </section>
      ) : totalsState === 'error' ? (
        <p className="text-sm text-muted-foreground">
          לא ניתן לטעון את תוצאות אישורי ההגעה כרגע.
        </p>
      ) : null}

      {/* A delivery failure inside getEventStats marks the WHOLE campaign
          section 'error', so sections 5 and 6 collapse together into one safe
          line rather than showing partial numbers. */}
      {campaign.state === 'error' ? (
        <p className="text-sm text-muted-foreground">
          לא ניתן לטעון את נתוני הקמפיין כרגע.
        </p>
      ) : null}

      {/* 5 — messaging delivery + contacts reached */}
      {delivery ? (
        <section
          aria-labelledby="event-summary-delivery-title"
          className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6"
        >
          <div className="space-y-1">
            <h2 id="event-summary-delivery-title" className="text-lg font-bold">
              מסירת ההודעות
            </h2>
            <p className="text-sm text-muted-foreground">
              אנשי קשר שהושגו:{' '}
              <strong className="font-semibold tabular-nums text-foreground">
                {count(delivery.reached)}
              </strong>
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric label="נשלחו" value={count(delivery.sent)} />
            <Metric label="נמסרו" value={count(delivery.delivered)} />
            <Metric label="נקראו" value={count(delivery.read)} />
            <Metric label="נכשלו" value={count(delivery.failed)} tone="destructive" />
            <Metric label="מספר שגוי" value={count(delivery.wrongNumber)} tone="warning" />
            <Metric label="ביקשו הסרה" value={count(delivery.optedOut)} />
          </dl>
        </section>
      ) : null}

      {/* 6 — billing summary. Behind billing.view upstream: billingDetail is
          null both for "no campaign" and for "no billing.view", and in either
          case this section simply does not exist. There is no receipt link:
          final_invoice_document_id is never written by any code path, and a
          nothing_to_charge settlement produces no SUMIT document at all. */}
      {billingDetail ? (
        <section
          aria-labelledby="event-summary-billing-title"
          className="space-y-3 rounded-2xl border border-border bg-card p-5 sm:p-6"
        >
          <h2 id="event-summary-billing-title" className="text-lg font-bold">
            סיכום החיוב
          </h2>
          <dl>
            {billingDetail.basePrice != null ? (
              <BillingRow label="דמי הפעלה" value={formatCurrency(billingDetail.basePrice)} />
            ) : null}
            {billingDetail.includedReached != null ? (
              <BillingRow
                label="מכסה כלולה"
                value={`${count(billingDetail.includedReached)} מענים`}
              />
            ) : null}
            {billingDetail.pricePerReached != null ? (
              <BillingRow
                label="עלות לכל מענה נוסף"
                value={formatCurrency(billingDetail.pricePerReached)}
              />
            ) : null}
            {/* Never formatCurrency(x ?? 0): a null final charge means "not
                settled yet", and ₪0.00 would state the opposite. */}
            <BillingRow
              label="חיוב סופי"
              value={
                billingDetail.finalChargeAmount == null
                  ? 'בעיבוד'
                  : formatCurrency(billingDetail.finalChargeAmount)
              }
            />
            {billingDetail.creditApplied > 0 ? (
              <BillingRow label="זיכוי שקוזז" value={formatCurrency(billingDetail.creditApplied)} />
            ) : null}
            <BillingRow
              label="מצב התשלום"
              value={chargeStatusLabel(
                billingDetail.chargeStatus,
                billingDetail.finalChargeAmount,
              )}
            />
          </dl>
        </section>
      ) : null}

      {/* No "create another event" affordance here, by owner ruling: a private
          customer who just finished their wedding is not looking to start
          another one, and offering it is the event-producer framing this whole
          screen exists to remove. The sidebar already reaches /app/events/new
          for the rare second event. */}
    </div>
  );
}
