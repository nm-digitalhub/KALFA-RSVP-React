import { requirePlatformPermission } from '@/lib/auth/dal';
import { cache } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  Ban,
  CheckCircle2,
  FileQuestion,
  HelpCircle,
  PhoneCall,
  PhoneMissed,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { formatIsraelDate } from '@/lib/date';
import { getEventForStaffView } from '@/lib/data/admin/event-view';
import { callRsvpAnswer, listCallAttemptsForEvent } from '@/lib/data/admin/voice-ops';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Badge,
  EmptyState,
  formatDateTime,
  PageHeading,
  Pagination,
  parsePageParam,
} from '../../../_components';
import {
  callStatusLabel,
  callStatusTone,
  callStatusVariant,
  toneChipClass,
  type MeterTone,
} from '../../_helpers';
import type { StackedBarSegment } from '../../_meters';
import { StatusDonut } from '../../_donut';

// Per-request memoization of the event fetch, so generateMetadata and the page
// body share ONE query. Supabase reads are not `fetch`, so Next's automatic
// request memoization does not apply — the generate-metadata docs prescribe
// React `cache` for exactly this case. (requireAdmin inside is already cached.)
// 'view_events', NOT the campaign board's getEventForAdminView: that reader
// demands manage_billing, so this page — gated on manage_voice — redirected
// any viewer holding voice but not billing straight off a page they are
// entitled to. A voice operator needs the event's NAME, not its money.
const getEventCached = cache(getEventForStaffView);

// Dynamic <title>: the event's name instead of a fixed string, so a browser tab
// says WHICH event is being supervised. A static `metadata` export cannot
// coexist with generateMetadata in the same segment (docs), so this replaces it;
// getEventForStaffView calls notFound() on a missing event, which the docs
// explicitly allow inside generateMetadata.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string }>;
}): Promise<Metadata> {
  const { eventId } = await params;
  const event = await getEventCached(eventId);
  return { title: event.name ? `שיחות AI — ${event.name}` : 'שיחות AI לאירוע' };
}

const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

// The RSVP answer of one attempt row, merged across both capture paths
// (callRsvpAnswer) and labeled with its source — the agent bridge writes
// rsvp_outcome, the DTMF path writes the digit.
function rsvpAnswerLabel(r: {
  rsvpDigit: string | null;
  rsvpOutcome: string | null;
  rsvpMethod: string | null;
}): string {
  const answer = callRsvpAnswer(r.rsvpDigit, r.rsvpOutcome);
  if (!answer) return '—';
  const word = answer === 'attending' ? 'אישר' : answer === 'declined' ? 'סירב' : 'אולי';
  const source = r.rsvpOutcome ? 'סוכן' : r.rsvpMethod === 'dtmf' ? 'הקשה' : r.rsvpMethod;
  return source ? `${word} (${source})` : word;
}

// Hebrew labels for the disposition column. sip_* codes pass through raw —
// they are the diagnostic (408 no-answer vs 486 busy vs 603 decline).
const FINISH_REASON_LABELS: Record<string, string> = {
  agent_end_call: 'הסוכן סיים',
  guest_hangup: 'האורח ניתק',
  session_terminating: 'נסגר בפירוק סשן',
};
function finishReasonLabel(reason: string | null): string {
  if (!reason) return '—';
  return FINISH_REASON_LABELS[reason] ?? reason;
}

export default async function EventVoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  // Optimistic gate: redirect early instead of rendering an empty page. The
  // real enforcement is per-function in the DAL.
  await requirePlatformPermission('manage_voice');
  const { eventId } = await params;
  const sp = await searchParams;
  const page = parsePageParam(sp.page);

  const [event, attempts] = await Promise.all([
    getEventCached(eventId),
    listCallAttemptsForEvent(eventId, { page }),
  ]);

  // Aggregate the page's rows for the stat tiles (full-history counts would need
  // a separate query; the visible page's tallies are shown as "בעמוד זה").
  //
  // TWO tile groups, deliberately: telephony outcomes (did the call connect)
  // and RSVP answers (what the guest said). They used to share one row, and an
  // answer was counted ONLY off the DTMF digit — so a completed agent call
  // that saved a real RSVP via save_rsvp showed "אישרו 0" right next to
  // "הושלמו 2" with nothing explaining the gap. callRsvpAnswer merges both
  // capture paths, and "הושלמו ללא רישום" makes the remaining gap EXPLICIT:
  // a completed conversation whose answer never landed (the exact class the
  // 2026-09-06 lost-RSVP call belonged to) is now a number, not a mystery.
  const rows = attempts.items;
  const answers = rows.map((r) => callRsvpAnswer(r.rsvpDigit, r.rsvpOutcome));
  const tally = {
    completed: rows.filter((r) => ['completed', 'handed_off'].includes(r.status)).length,
    noAnswer: rows.filter((r) => ['no_answer', 'no_response'].includes(r.status)).length,
    failed: rows.filter((r) => ['failed', 'failed_to_start'].includes(r.status)).length,
    cancelled: rows.filter((r) => r.status === 'cancelled').length,
    confirmed: answers.filter((a) => a === 'attending').length,
    declined: answers.filter((a) => a === 'declined').length,
    maybe: answers.filter((a) => a === 'maybe').length,
  };
  const unrecorded = Math.max(
    0,
    rows.filter((r, i) => ['completed', 'handed_off'].includes(r.status) && answers[i] === null)
      .length,
  );

  type Tile = { label: string; value: string; icon: LucideIcon; tone: MeterTone };
  const telephonyTiles: Tile[] = [
    { label: 'ניסיונות (סה״כ)', value: String(attempts.total), icon: PhoneCall, tone: 'info' },
    { label: 'הושלמו (בעמוד)', value: String(tally.completed), icon: CheckCircle2, tone: 'success' },
    { label: 'אין מענה (בעמוד)', value: String(tally.noAnswer), icon: PhoneMissed, tone: 'warning' },
    { label: 'נכשלו (בעמוד)', value: String(tally.failed), icon: XCircle, tone: 'destructive' },
    { label: 'בוטלו (בעמוד)', value: String(tally.cancelled), icon: Ban, tone: 'neutral' },
  ];
  const rsvpTiles: Tile[] = [
    { label: 'אישרו (בעמוד)', value: String(tally.confirmed), icon: ThumbsUp, tone: 'success' },
    { label: 'סירבו (בעמוד)', value: String(tally.declined), icon: ThumbsDown, tone: 'destructive' },
    { label: 'אולי (בעמוד)', value: String(tally.maybe), icon: HelpCircle, tone: 'warning' },
    { label: 'הושלמו ללא רישום (בעמוד)', value: String(unrecorded), icon: FileQuestion, tone: 'neutral' },
  ];

  // The same page tallies as a part-to-whole mix — completed/no-answer/
  // failed/cancelled proportions at a glance, reusing the exact tones the
  // status Badge already assigns to these outcomes (callStatusTone).
  const breakdown: StackedBarSegment[] = [
    { key: 'completed', label: callStatusLabel('completed'), value: tally.completed, tone: callStatusTone('completed') },
    { key: 'no_answer', label: callStatusLabel('no_answer'), value: tally.noAnswer, tone: callStatusTone('no_answer') },
    { key: 'failed', label: callStatusLabel('failed'), value: tally.failed, tone: callStatusTone('failed') },
    { key: 'cancelled', label: callStatusLabel('cancelled'), value: tally.cancelled, tone: callStatusTone('cancelled') },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>שיחות AI — {event.name}</PageHeading>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href={`/admin/events/${eventId}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            לעמוד האירוע
          </Link>
          <Link href="/admin/voice" className="text-sm font-medium text-primary hover:underline">
            חזרה למוקד
          </Link>
        </div>
      </div>

      <section className={sectionClass}>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">תאריך האירוע</dt>
            <dd>{event.eventDate ? formatIsraelDate(event.eventDate) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">סטטוס אירוע</dt>
            <dd>{event.statusLabel}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">סוג אירוע</dt>
            <dd>{event.eventTypeLabel}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">תוצאות טלפוניה</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {telephonyTiles.map((t) => {
            const Icon = t.icon;
            return (
              <div key={t.label} className="flex flex-col gap-2 rounded-lg border border-border p-4">
                <span className={`inline-flex size-7 items-center justify-center rounded-full ${toneChipClass(t.tone)}`}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="text-sm text-muted-foreground">{t.label}</span>
                <span className="text-2xl font-bold">{t.value}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">תשובות RSVP מהשיחות</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {rsvpTiles.map((t) => {
            const Icon = t.icon;
            return (
              <div key={t.label} className="flex flex-col gap-2 rounded-lg border border-border p-4">
                <span className={`inline-flex size-7 items-center justify-center rounded-full ${toneChipClass(t.tone)}`}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="text-sm text-muted-foreground">{t.label}</span>
                <span className="text-2xl font-bold">{t.value}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">פילוח תוצאות שיחה (בעמוד)</h2>
        <StatusDonut
          segments={breakdown}
          ariaLabel="פילוח תוצאות שיחה בעמוד הנוכחי"
          centerSubLabel="בעמוד"
        />
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">ניסיונות שיחה</h2>
        {rows.length === 0 ? (
          <EmptyState>אין ניסיונות שיחה לאירוע זה.</EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>זמן</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>משך (שנ׳)</TableHead>
                    <TableHead>תוצאת RSVP</TableHead>
                    <TableHead>סיבת סיום</TableHead>
                    <TableHead>הקלטה</TableHead>
                    <TableHead>תמליל</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell dir="ltr" className="whitespace-nowrap">
                        {formatDateTime(r.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={callStatusVariant(r.status)}>
                          {callStatusLabel(r.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{r.durationSec ?? '—'}</TableCell>
                      <TableCell>{rsvpAnswerLabel(r)}</TableCell>
                      <TableCell>{finishReasonLabel(r.finishReason)}</TableCell>
                      <TableCell>
                        {r.hasRecording && r.sessionHistoryId ? (
                          <Link
                            href={`/admin/recordings?session=${r.sessionHistoryId}`}
                            className="text-sm text-primary hover:underline"
                          >
                            צפייה
                          </Link>
                        ) : r.hasRecording ? (
                          // Recording exists on the row but no session id to
                          // build the recordings link (early Branch B rows).
                          <span className="text-sm text-muted-foreground">קיימת (ללא session)</span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        {r.hasTranscript ? 'קיים' : r.hasAnalysis ? 'סיכום ניתוח' : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination
              basePath={`/admin/voice/events/${eventId}`}
              page={attempts.page}
              pageSize={attempts.pageSize}
              total={attempts.total}
            />
          </>
        )}
      </section>
    </div>
  );
}
