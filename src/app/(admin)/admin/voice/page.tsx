import { requirePlatformPermission } from '@/lib/auth/dal';
import Link from 'next/link';
import { AlertTriangle, PhoneCall, PhoneForwarded, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { formatIsraelDate } from '@/lib/date';
import { getVoximplantChannelConfig } from '@/lib/data/admin/voximplant-channel';
import {
  getVoiceBalanceTile,
  getVoiceDashboardSummary,
  listEventsWithCallActivity,
} from '@/lib/data/admin/voice-ops';
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
  PageHeading,
  Pagination,
  parsePageParam,
} from '../_components';
import { balanceVariant, formatBalance } from './_helpers';
import { AnswerRateRing, BalanceMeter } from './_meters';

export const metadata = { title: 'מוקד שיחות AI' };

const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

export default async function VoiceOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  // Optimistic gate: redirect early instead of rendering an empty page. The
  // real enforcement is per-function in the DAL.
  await requirePlatformPermission('manage_voice');
  const sp = await searchParams;
  const page = parsePageParam(sp.page);

  const [summary, balance, channel, events] = await Promise.all([
    getVoiceDashboardSummary(),
    getVoiceBalanceTile(),
    getVoximplantChannelConfig(),
    listEventsWithCallActivity({ page }),
  ]);

  const liveOn = channel.liveEnabled;

  const tiles: Array<{
    label: string;
    icon: LucideIcon;
    value: React.ReactNode;
    href?: string;
    extra?: React.ReactNode;
  }> = [
    {
      label: 'יתרת Voximplant',
      icon: Wallet,
      value: (
        <Badge variant={balanceVariant(balance.balance, balance.minCallReserve, balance.lowBalanceThreshold)}>
          {formatBalance(balance.balance, balance.currency)}
        </Badge>
      ),
      href: '/admin/voice/platform',
      // Where the live balance sits relative to the reserve (blocks calls)
      // and low-balance (warns) gates — the same numbers as the badge, in a
      // form that shows headroom at a glance.
      extra: (
        <BalanceMeter
          balance={balance.balance}
          currency={balance.currency}
          minReserve={balance.minCallReserve}
          lowThreshold={balance.lowBalanceThreshold}
        />
      ),
    },
    { label: 'שיחות פעילות כעת', icon: PhoneForwarded, value: String(summary.activeNow) },
    { label: 'שיחות ב־7 ימים', icon: PhoneCall, value: `${summary.completed7d}/${summary.last7d}` },
    {
      label: 'אחוז מענה (7 ימים)',
      icon: PhoneCall,
      value: <AnswerRateRing rate={summary.answerRate7d} size={44} />,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>מוקד שיחות AI</PageHeading>
        <div className="flex items-center gap-3">
          <Badge variant={liveOn ? 'success' : 'destructive'}>
            {liveOn ? 'שיחות חיות פעילות' : 'שיחות חיות מושבתות'}
          </Badge>
          <Link
            href="/admin/channels"
            className="text-sm font-medium text-primary hover:underline"
          >
            הגדרות ערוץ
          </Link>
          <Link
            href="/admin/voice/platform"
            className="text-sm font-medium text-primary hover:underline"
          >
            פלטפורמה וניהול
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t) => {
          const Icon = t.icon;
          const body = (
            <>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="size-4" aria-hidden />
                {t.label}
              </span>
              <span className="text-3xl font-bold">{t.value}</span>
              {t.extra}
            </>
          );
          return t.href ? (
            <Link
              key={t.label}
              href={t.href}
              className="flex flex-col gap-2 rounded-lg border border-border p-4 transition-colors hover:bg-muted"
            >
              {body}
            </Link>
          ) : (
            <div key={t.label} className="flex flex-col gap-2 rounded-lg border border-border p-4">
              {body}
            </div>
          );
        })}
      </div>

      <AttentionPanel
        balance={balance.balance}
        minReserve={balance.minCallReserve}
      />

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">אירועים עם פעילות שיחות</h2>
        {events.truncated ? (
          <p className="text-sm text-warning">
            מוצג חלון מוגבל של הפעילות האחרונה (נחתך בתקרת הבטיחות).
          </p>
        ) : null}
        {events.items.length === 0 ? (
          <EmptyState>אין עדיין פעילות שיחות AI באירועים.</EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>אירוע</TableHead>
                    <TableHead>תאריך</TableHead>
                    <TableHead>בעלים</TableHead>
                    <TableHead>ניסיונות</TableHead>
                    <TableHead>הושלמו</TableHead>
                    <TableHead>אין מענה</TableHead>
                    <TableHead>נכשלו</TableHead>
                    <TableHead>אישרו בשיחה</TableHead>
                    <TableHead>
                      <span className="sr-only">פעולות</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.items.map((e) => (
                    <TableRow key={e.eventId}>
                      <TableCell className="font-medium">{e.eventName}</TableCell>
                      <TableCell>{e.eventDate ? formatIsraelDate(e.eventDate) : '—'}</TableCell>
                      <TableCell>{e.ownerName}</TableCell>
                      <TableCell>{e.attempts}</TableCell>
                      <TableCell>{e.completed}</TableCell>
                      <TableCell>{e.noAnswer}</TableCell>
                      <TableCell>{e.failed}</TableCell>
                      <TableCell>{e.rsvpFromCall}</TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/voice/events/${e.eventId}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          פירוט
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination
              basePath="/admin/voice"
              page={events.page}
              pageSize={events.pageSize}
              total={events.total}
            />
          </>
        )}
      </section>
    </div>
  );
}

function AttentionPanel({
  balance,
  minReserve,
}: {
  balance: number | null;
  minReserve: number;
}) {
  const notes: string[] = [];
  if (balance !== null && balance < minReserve) {
    notes.push(`יתרת Voximplant (${balance.toFixed(2)}) מתחת לרזרבה — שיחות חסומות.`);
  }
  if (notes.length === 0) return null;
  return (
    <section className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <AlertTriangle className="size-5 text-warning" aria-hidden />
        דורש תשומת לב
      </h2>
      <ul className="list-inside list-disc text-sm">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  );
}
