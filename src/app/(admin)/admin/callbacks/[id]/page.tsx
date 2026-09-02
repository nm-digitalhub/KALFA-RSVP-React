import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { buildCallbackActivity } from '@/lib/callbacks/activity-timeline';
import { getCallbackRequest } from '@/lib/data/admin/callbacks';
import {
  callAnalysisStatusLabel,
  callAnalysisSuccessfulLabel,
  callbackStatusLabel,
  callbackStatusVariant,
  callOutcomeLabel,
  deliveryStatusLabel,
  evaluationResultLabel,
  schedulingFailureLabel,
  salesDispatchStatusLabel,
  salesFinishReasonLabel,
  sentimentLabel,
  aiCallSourceLabel,
  confirmationCallStatusLabel,
} from '@/lib/data/admin/labels';
import { PageHeading, formatDateTime, Badge } from '../../_components';
import { CancelCallbackForm } from '../cancel-callback-form';
import { CallOutcomeForm } from '../call-outcome-form';
import { RescheduleForm } from '../reschedule-form';

export const metadata: Metadata = { title: 'פרטי בקשת חזרה' };

type CallbackDetail = NonNullable<Awaited<ReturnType<typeof getCallbackRequest>>>;
type SalesCall = CallbackDetail['salesCalls'][number];

function formatNullableDateTime(iso: string | null): string {
  return iso ? formatDateTime(iso) : '—';
}

function formatSeconds(secs: number | null): string {
  return secs === null ? '—' : `${secs} שניות`;
}

function formatCredits(credits: number | null): string {
  return credits === null ? '—' : `${credits} credits`;
}

function voicemailLabel(value: boolean | null): string {
  if (value === true) return 'כנראה משיבון';
  if (value === false) return 'נראה כמו שיחה עם לקוח';
  return 'לא ידוע';
}

function booleanLabel(value: boolean | null | undefined): string {
  if (value === true) return 'כן';
  if (value === false) return 'לא';
  return '—';
}

// What we know about the signup link, from the attempt row alone.
//
// Three separate facts, deliberately not collapsed: Meta ACCEPTED the message
// (wa_message_id, written synchronously at send time), Meta later REPORTED on
// it (wa_delivery_status, the asynchronous webhook), and the send FAILED before
// any message id existed (the same column, carrying the local failure reason —
// the two can never both apply, see recordSalesLinkSent). "נשלח" and "נקרא" are
// different answers to "should I call this lead again", so the delivery report
// is shown as soon as it exists rather than folded into a single yes/no.
function signupLinkLabel(salesCall: SalesCall): string {
  if (salesCall.linkSent) {
    const reported = salesCall.waDeliveryStatus
      ? deliveryStatusLabel(salesCall.waDeliveryStatus)
      : 'טרם דווח';
    return `נשלח · ${reported}`;
  }
  if (salesCall.waDeliveryStatus) {
    const code = salesCall.waDeliveryErrorCode ? ` (${salesCall.waDeliveryErrorCode})` : '';
    return `שליחה נכשלה${code}`;
  }
  return 'לא נשלח';
}

// The ONE stage a lead has reached — the furthest milestone with a real
// instant behind it, phrased as what is still missing so the row answers
// "what do I say when I call". Read top-down so a later step always wins: a
// cleared hold IS the closed deal, whatever the steps below it look like.
//
// Sales only. A meeting-confirmation call sends no link and has no deal to
// close, so it never reaches this row.
function leadStageLabel(call: SalesCall): string {
  if (call.holdAuthorizedAt) return 'עסקה נסגרה';
  if (call.signupCompletedAt) return 'ההסכם נחתם — ממתין לתפיסת מסגרת';
  if (call.firstCampaignAt) return 'הוקם קמפיין — ממתין לחתימה';
  if (call.signedUpAt) return 'נפתח חשבון — ממתין להקמת קמפיין';
  if (call.linkSent) return 'קישור נשלח — ממתין לפתיחת חשבון';
  // The call is what this row hangs off, so "no link yet" is only meaningful
  // once the call actually concluded. A dial that never connected is already
  // stated by the dispatch badge above; repeating it here as a stalled funnel
  // would read as a lead who ignored us.
  if (call.dispatchStatus === 'concluded') return 'שיחה בוצעה — קישור טרם נשלח';
  return '—';
}

// The whole path on one line. The row above names the CURRENT stage; this
// shows every step to the deal, so a skipped one in the middle stays visible
// instead of being implied by the stage that follows it.
//
// "Created an event" is deliberately absent: it happens moments after signup,
// so it separates no two real states and would only add a dot.
//
// Every step reads its own instant — a later step being done never marks an
// earlier one done.
function SalesFunnel({ salesCall }: { salesCall: SalesCall }) {
  const steps = [
    { label: 'שיחה', at: salesCall.attemptCreatedAt },
    { label: 'קישור נשלח', at: salesCall.linkSent ? (salesCall.waStatusAt ?? salesCall.attemptUpdatedAt) : null },
    { label: 'נרשם', at: salesCall.signedUpAt },
    { label: 'קמפיין', at: salesCall.firstCampaignAt },
    { label: 'חתם', at: salesCall.signupCompletedAt },
    { label: 'מסגרת', at: salesCall.holdAuthorizedAt },
  ];
  const reached = steps.filter((s) => s.at).length;

  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label={`התקדמות הליד — ${reached} מתוך ${steps.length}`}>
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden="true" className="text-muted-foreground/40">·</span>}
          <span
            title={step.at ? formatDateTime(step.at) : undefined}
            className={
              step.at
                ? 'rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success'
                : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
            }
          >
            {step.label}
            {/* Not colour alone: the tick is what a colour-blind reader sees. */}
            <span aria-hidden="true">{step.at ? ' ✓' : ' ○'}</span>
            <span className="sr-only">{step.at ? ' — בוצע' : ' — טרם'}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function SalesCallCard({ salesCall, index }: { salesCall: SalesCall; index: number }) {
  const data = salesCall.dataCollection;
  return (
    <article className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {aiCallSourceLabel(salesCall.source)} #{index + 1}
          </h3>
          <p className="text-xs text-muted-foreground">
            נוצר {formatDateTime(salesCall.attemptCreatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{salesDispatchStatusLabel(salesCall.dispatchStatus)}</Badge>
          {salesCall.hasAnalysis ? (
            <Badge variant={salesCall.callSuccessful === 'success' ? 'success' : 'neutral'}>
              {callAnalysisSuccessfulLabel(salesCall.callSuccessful)}
            </Badge>
          ) : (
            <Badge variant="warning">ניתוח טרם התקבל</Badge>
          )}
        </div>
      </div>

      {/* Sales only: a meeting-confirmation call sends no signup link and has
          no funnel to report — an all-empty strip would read as a stalled lead
          rather than an inapplicable one. */}
      {salesCall.source === 'sales' && <SalesFunnel salesCall={salesCall} />}

      {/* First, above every number: what actually happened on the call, in
          ElevenLabs' own words. A score tells you how it went; only this tells
          you what it was about. */}
      {salesCall.transcriptSummary && (
        <div className="rounded-md border border-border bg-muted/40 p-3">
          {salesCall.summaryTitle && (
            <p className="mb-1 font-medium">{salesCall.summaryTitle}</p>
          )}
          <p className="wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed">
            {salesCall.transcriptSummary}
          </p>
          {salesCall.sentimentLabel && (
            <p className="mt-2 text-xs text-muted-foreground">
              {sentimentLabel(salesCall.sentimentLabel)}
              {salesCall.frustrationScore !== null && salesCall.frustrationScore > 0
                ? ` · תסכול ${salesCall.frustrationScore}`
                : ''}
            </p>
          )}
        </div>
      )}

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">סטטוס ElevenLabs</dt>
          <dd>{callAnalysisStatusLabel(salesCall.status)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">ציון</dt>
          <dd>{salesCall.callSuccessScore ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">משך</dt>
          <dd>{formatSeconds(salesCall.callDurationSecs)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">עלות</dt>
          <dd>{formatCredits(salesCall.costCredits)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">תורי סוכן / לקוח</dt>
          <dd>
            {salesCall.agentTurns ?? '—'} / {salesCall.userTurns ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">משיבון</dt>
          <dd>{voicemailLabel(salesCall.likelyVoicemail)}</dd>
        </div>
        <div className="sm:col-span-3">
          <dt className="text-xs font-medium text-muted-foreground">סיבת סיום</dt>
          {/* Falls back to the telephony's own finish_reason while the
              ElevenLabs analysis is still outstanding — see mapSalesCall. */}
          <dd className="wrap-anywhere">
            {salesCall.terminationReason ? salesFinishReasonLabel(salesCall.terminationReason) : '—'}
          </dd>
        </div>
        {/* Each persona's own field, rendered only for the persona that has it
            — never flattened into a shared vocabulary, which would lose the
            distinction the card exists to show. */}
        {salesCall.confirmationCallStatus && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground">תשובת הלקוח</dt>
            <dd>{confirmationCallStatusLabel(salesCall.confirmationCallStatus)}</dd>
          </div>
        )}
        {salesCall.source === 'sales' && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground">קישור הרשמה</dt>
            <dd>{signupLinkLabel(salesCall)}</dd>
          </div>
        )}
        {salesCall.source === 'sales' && (
          <>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">תוצאה נרשמה</dt>
              <dd>{formatNullableDateTime(salesCall.outcomeRecordedAt)}</dd>
            </div>
            {/* Was "הרשמה הושלמה", printing signupCompletedAt as a date. The
                label was actively wrong — that column is stamped at AGREEMENT
                SIGNING, not at account creation, so a lead who had just opened
                an account read as not-registered. Same row, same place; the
                value is now the stage the lead has actually reached. */}
            <div>
              <dt className="text-xs font-medium text-muted-foreground">שלב הליד</dt>
              <dd>{leadStageLabel(salesCall)}</dd>
            </div>
          </>
        )}
      </dl>

      {/* Identifiers, not readings — kept together, in small type, below the
          facts a person actually acts on. They are the handles for pulling the
          call's own logs from each provider, so they stay LTR and stay
          verbatim, but they no longer sit in the middle of the grid where a
          missing analysis printed three empty English-labelled rows. */}
      <dl className="grid gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-3">
        <div>
          <dt>מועד קבלת הניתוח</dt>
          <dd>{formatNullableDateTime(salesCall.analysisAt)}</dd>
        </div>
        <div>
          <dt>מזהה שיחה (ElevenLabs)</dt>
          <dd className="wrap-anywhere text-end" dir="ltr">
            {salesCall.elConversationId ?? '—'}
          </dd>
        </div>
        <div>
          <dt>מזהה שיחה (טלפוניה)</dt>
          <dd className="wrap-anywhere text-end" dir="ltr">
            {salesCall.voxCallSessionHistoryId ?? '—'}
          </dd>
        </div>
        {/* Which persona took the call — three share this pipeline, so it is
            the first thing to check when a transcript reads wrong. */}
        <div>
          <dt>מזהה סוכן</dt>
          <dd className="wrap-anywhere text-end" dir="ltr">
            {salesCall.agentId ?? '—'}
          </dd>
        </div>
      </dl>

      {data && (
        <div className="rounded-md bg-muted/40 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Data collection</p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">תוצאה</dt>
              <dd>{data.callOutcome ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">סוג אירוע</dt>
              <dd>{data.eventType ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">כמות אורחים משוערת</dt>
              <dd>{data.estimatedGuestCount ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">הסכמת WhatsApp</dt>
              <dd>{booleanLabel(data.whatsappConsent)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">התנגדות מחיר</dt>
              <dd>{data.objectionReason ?? '—'}</dd>
            </div>
          </dl>
        </div>
      )}

      {salesCall.evaluation && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Evaluation</p>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <tbody>
                {Object.entries(salesCall.evaluation).map(([criterion, result]) => (
                  <tr key={criterion} className="border-b border-border last:border-0">
                    <td className="wrap-anywhere px-3 py-2 font-mono text-xs" dir="ltr">
                      {criterion}
                    </td>
                    <td className="px-3 py-2">{evaluationResultLabel(result)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </article>
  );
}

// One callback request.
//
// This is the target of the deep link the scheduler writes into the calendar
// item's body, so it is read on a phone, in the seconds before a call — not
// browsed. Everything needed to make that call is above the fold and the phone
// number is a real tel: link, because the whole point is to tap it and dial.

export default async function CallbackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Optimistic gate; the real enforcement lives per-function in the DAL.
  await requirePlatformPermission('view_customer_data');
  const { id } = await params;
  const callback = await getCallbackRequest(id);

  // A calendar item outlives the row it points at — a deleted request must give
  // a proper 404, not a server error.
  if (!callback) notFound();

  const activity = buildCallbackActivity({
    createdAt: callback.created_at,
    scheduledAt: callback.scheduled_at,
    status: callback.status,
    salesCalls: callback.salesCalls,
    audit: callback.audit,
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/admin/callbacks"
          className="text-sm text-muted-foreground underline underline-offset-2"
        >
          ← כל בקשות החזרה
        </Link>
        <PageHeading>{callback.full_name}</PageHeading>
      </div>

      {/* The call itself. Big, tappable, first. */}
      <div className="rounded-lg border border-border p-4">
        <p className="text-xs font-medium text-muted-foreground">טלפון</p>
        <a
          href={`tel:${callback.phone}`}
          dir="ltr"
          className="mt-1 inline-block text-2xl font-semibold text-primary underline underline-offset-4"
        >
          {callback.phone}
        </a>
        {callback.attempt_count > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            ניסיונות קודמים: {callback.attempt_count}
          </p>
        )}
        {/* Only surfaced once it's actually building toward the 3-attempt
            auto-close (applyCallOutcome) — zero is the ordinary state and
            would just be noise here. */}
        {callback.consecutive_no_answer_count > 0 && (
          <p className="mt-1 text-sm text-warning">
            ניסיונות רצופים ללא מענה: {callback.consecutive_no_answer_count}/3
          </p>
        )}
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">נושא</dt>
          <dd className="mt-1 text-sm">{callback.topic || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">סטטוס שיבוץ</dt>
          <dd className="mt-1 text-sm">
            <Badge variant={callbackStatusVariant(callback.status)}>
              {callbackStatusLabel(callback.status)}
            </Badge>
            {callback.status === 'unschedulable' && callback.scheduling_failure_reason && (
              <p className="mt-1 text-xs text-muted-foreground">
                סיבה: {schedulingFailureLabel(callback.scheduling_failure_reason)}
              </p>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">התקבלה</dt>
          <dd className="mt-1 text-sm">{formatDateTime(callback.created_at)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">מועד מבוקש</dt>
          <dd className="mt-1 text-sm">
            {callback.requested_at ? formatDateTime(callback.requested_at) : 'ללא העדפה'}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-muted-foreground">שובץ ביומן</dt>
          <dd className="mt-1 text-sm">
            {callback.scheduled_at ? (
              formatDateTime(callback.scheduled_at)
            ) : (
              <span className="text-muted-foreground">טרם שובץ</span>
            )}
          </dd>
        </div>
      </dl>

      {callback.note && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">מה שנכתב בפנייה</p>
          {/* wrap-anywhere: a long unbreakable token would otherwise widen the
              admin shell — same latent overflow as the list and /admin/fleet. */}
          <p className="mt-1 wrap-anywhere whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {callback.note}
          </p>
        </div>
      )}

      {/* Directly under the details, ABOVE the read-only CRM sections. This is
          the screen the calendar item deep-links to, opened on a phone in the
          seconds around a call — so what you WRITE when the call ends stays
          within reach, and the sales-call cards and the history (which grow
          without bound as attempts accumulate) sit below it rather than
          pushing it off the screen precisely on the leads that have the most
          to record.

          One section, not two: recording an outcome and asking to be called
          back later are the same moment, and `needs_followup` + a new slot is
          the ordinary pairing rather than an exception. Cancelling is NOT part
          of it — that is the scheduler's own dimension (see below and
          validation/admin.ts), and it is destructive, so the scroll to reach
          it is deliberate. */}
      <section className="space-y-4 border-t border-border pt-4">
        <h2 className="font-semibold">אחרי השיחה</h2>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">תוצאת שיחה</p>
          <p className="mb-2 text-sm">{callOutcomeLabel(callback.call_outcome)}</p>
          <CallOutcomeForm id={callback.id} currentOutcome={callback.call_outcome} />
        </div>

        {/* Answered, but not resolved: a different time was requested, or the
            caller asked to be called again later. Closes the current slot (if
            any) and opens a fresh one from the chosen instant. */}
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">ביקש/ה לחזור במועד אחר</p>
          <RescheduleForm id={callback.id} />
        </div>
      </section>

      <section className="space-y-3 border-t border-border pt-4">
        <div>
          <h2 className="font-semibold">שיחות AI</h2>
          {/* Was "metadata-only, בלי transcript או audio" until the summary was
              added (2026-09-01). The audio and the spoken turns are still never
              stored — but a written summary is not metadata, and the line has to
              say what is actually kept. */}
          <p className="text-sm text-muted-foreground">
            מ-ElevenLabs נשמרים נתוני ניתוח וסיכום כתוב של השיחה. הקלטת השיחה והתמליל המלא אינם
            נשמרים.
          </p>
        </div>
        {callback.salesCalls.length > 0 ? (
          <div className="space-y-3">
            {callback.salesCalls.map((salesCall, index) => (
              <SalesCallCard key={salesCall.attemptId} salesCall={salesCall} index={index} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            טרם בוצעה שיחת AI עבור הפנייה הזו.
          </div>
        )}
      </section>

      {/* Composed from timestamps that already exist — see activity-timeline.ts
          for why there is no per-tool-call row here. */}
      <section className="space-y-3 border-t border-border pt-4">
        <div>
          <h2 className="font-semibold">היסטוריית פעולות</h2>
          <p className="text-sm text-muted-foreground">
            מורכב ממה שנרשם בפועל בבסיס הנתונים. פעולות פנימיות של הסוכן בתוך השיחה אינן נרשמות
            בנפרד.
          </p>
        </div>
        <ol className="divide-y divide-border rounded-lg border border-border">
          {activity.map((entry) => (
            <li
              key={entry.key}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{entry.title}</p>
                  {entry.planned && <Badge variant="info">מתוכנן</Badge>}
                </div>
                {entry.detail && (
                  <p className="wrap-anywhere text-xs text-muted-foreground">{entry.detail}</p>
                )}
                {/* Words, not an arrow: RTL reorders the two timestamps around
                    a "←" so the line reads as the opposite move. Formatted
                    here because the timeline builder is pure — it has neither
                    locale nor timezone. */}
                {(entry.movedFrom || entry.movedTo) && (
                  <p className="text-xs text-muted-foreground">
                    {entry.movedFrom ? `מ-${formatDateTime(entry.movedFrom)}` : ''}
                    {entry.movedFrom && entry.movedTo ? ' אל ' : ''}
                    {entry.movedTo ? formatDateTime(entry.movedTo) : ''}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDateTime(entry.at)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="border-t border-border pt-4">
        <CancelCallbackForm id={callback.id} currentStatus={callback.status} />
      </div>
    </div>
  );
}
