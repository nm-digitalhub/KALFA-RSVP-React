import { cache } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  Ban,
  CheckCircle2,
  PhoneCall,
  PhoneMissed,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { formatIsraelDate } from '@/lib/date';
import { getEventForAdminView } from '@/lib/data/admin/campaigns';
import { listCallAttemptsForEvent } from '@/lib/data/admin/voice-ops';
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
const getEventCached = cache(getEventForAdminView);

// Dynamic <title>: the event's name instead of a fixed string, so a browser tab
// says WHICH event is being supervised. A static `metadata` export cannot
// coexist with generateMetadata in the same segment (docs), so this replaces it;
// getEventForAdminView calls notFound() on a missing event, which the docs
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

export default async function EventVoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { eventId } = await params;
  const sp = await searchParams;
  const page = parsePageParam(sp.page);

  const [event, attempts] = await Promise.all([
    getEventCached(eventId),
    listCallAttemptsForEvent(eventId, { page }),
  ]);

  // Aggregate the page's rows for the stat tiles (full-history counts would need
  // a separate query; the visible page's tallies are shown as "בעמוד זה").
  const rows = attempts.items;
  const tally = {
    completed: rows.filter((r) => r.status === 'completed').length,
    noAnswer: rows.filter((r) => r.status === 'no_answer').length,
    failed: rows.filter((r) => ['failed', 'failed_to_start', 'no_response'].includes(r.status))
      .length,
    cancelled: rows.filter((r) => r.status === 'cancelled').length,
    confirmed: rows.filter((r) => r.rsvpDigit === '1').length,
    declined: rows.filter((r) => r.rsvpDigit === '2').length,
  };

  const tiles: Array<{ label: string; value: string; icon: LucideIcon; tone: MeterTone }> = [
    { label: 'ניסיונות (סה״כ)', value: String(attempts.total), icon: PhoneCall, tone: 'info' },
    { label: 'הושלמו (בעמוד)', value: String(tally.completed), icon: CheckCircle2, tone: 'success' },
    { label: 'אין מענה (בעמוד)', value: String(tally.noAnswer), icon: PhoneMissed, tone: 'warning' },
    { label: 'נכשלו (בעמוד)', value: String(tally.failed), icon: XCircle, tone: 'destructive' },
    { label: 'בוטלו (בעמוד)', value: String(tally.cancelled), icon: Ban, tone: 'neutral' },
    { label: 'אישרו (בעמוד)', value: String(tally.confirmed), icon: ThumbsUp, tone: 'success' },
    { label: 'סירבו (בעמוד)', value: String(tally.declined), icon: ThumbsDown, tone: 'destructive' },
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
        <Link href="/admin/voice" className="text-sm font-medium text-primary hover:underline">
          ← חזרה למוקד
        </Link>
      </div>

      <section className={sectionClass}>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">תאריך האירוע</dt>
            <dd>{event.event_date ? formatIsraelDate(event.event_date) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">סטטוס אירוע</dt>
            <dd>{event.status}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">סוג אירוע</dt>
            <dd>{event.event_type ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        {tiles.map((t) => {
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
                      <TableCell>
                        {r.rsvpDigit === '1'
                          ? `אישר${r.rsvpMethod ? ` (${r.rsvpMethod})` : ''}`
                          : r.rsvpDigit === '2'
                            ? 'סירב'
                            : '—'}
                      </TableCell>
                      <TableCell>{r.finishReason ?? '—'}</TableCell>
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
                      <TableCell>{r.hasTranscript ? 'קיים' : '—'}</TableCell>
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
