import Link from 'next/link';

import { formatIsraelDateTime } from '@/lib/date';
import { getAppOrigin } from '@/lib/url';
import { getElevenLabsFleetStatus } from '@/lib/data/elevenlabs-status';
import { getLogExportStatus, getVoicePlatformView } from '@/lib/data/admin/voice-ops';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge, EmptyState, PageHeading } from '../../_components';
import {
  balanceVariant,
  callStatusLabel,
  formatBalance,
  WIRING_STATE_LABELS,
  WIRING_STATE_VARIANTS,
} from '../_helpers';
import { RefreshButton, RunLogExportButton } from './platform-actions';
import { WiringControls } from './wiring-card';
import { ElevenLabsKeyForm } from './elevenlabs-key-form';

export const metadata = { title: 'פלטפורמה — מוקד שיחות AI' };

const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

const AUDIT_STATUS_LABEL: Record<string, string> = {
  ok: '',
  forbidden: 'דורש הרשאת Owner — זמין דרך ה־CLI עם מפתח מתאים.',
  unconfigured: 'הערוץ אינו מוגדר.',
  unavailable: 'לא זמין כרגע.',
};

export default async function VoicePlatformPage() {
  const [view, logExport, origin, fleet] = await Promise.all([
    getVoicePlatformView(),
    getLogExportStatus(),
    getAppOrigin(),
    getElevenLabsFleetStatus(),
  ]);
  const proposedCallbackBase = `${origin}/api/voximplant/account-callback`;

  const agentStatusLabel: Record<string, string> = {
    ok: 'פעיל',
    missing: 'לא נמצא ב־API',
    error: fleet.configured ? 'שגיאה' : 'לא מוגדר',
  };
  const agentStatusVariant: Record<string, 'success' | 'warning' | 'neutral' | 'destructive'> = {
    ok: 'success',
    missing: 'warning',
    error: 'neutral',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>פלטפורמה וניהול</PageHeading>
        <div className="flex items-center gap-3">
          <RefreshButton />
          <Link href="/admin/voice" className="text-sm font-medium text-primary hover:underline">
            ← חזרה למוקד
          </Link>
        </div>
      </div>

      {/* §1 balance + wiring */}
      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">יתרה וחיווט התראות</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">יתרה חיה</dt>
            <dd>
              {view.balance.status === 'ok' ? (
                <Badge
                  variant={balanceVariant(
                    view.balance.balance,
                    view.balance.minCallReserve,
                    view.balance.lowBalanceThreshold,
                  )}
                >
                  {formatBalance(view.balance.balance, view.balance.currency)}
                </Badge>
              ) : view.balance.status === 'unconfigured' ? (
                'הערוץ אינו מוגדר'
              ) : (
                'לא זמין'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">ספים</dt>
            <dd dir="ltr">
              reserve {view.balance.minCallReserve} · low {view.balance.lowBalanceThreshold}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">מצב חיווט התראות יתרה</dt>
            <dd>
              <Badge variant={WIRING_STATE_VARIANTS[view.wiring.state] ?? 'neutral'}>
                {WIRING_STATE_LABELS[view.wiring.state] ?? view.wiring.state}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">callback אחרון התקבל</dt>
            <dd dir="ltr">
              {view.wiring.lastCallbackAt ? formatIsraelDateTime(view.wiring.lastCallbackAt) : '—'}
            </dd>
          </div>
        </dl>
        {view.balance.callbackUrlEcho ? (
          <p className="text-xs text-muted-foreground" dir="ltr">
            echo: {view.balance.callbackUrlEcho}
          </p>
        ) : null}
        <WiringControls state={view.wiring.state} proposedUrl={proposedCallbackBase} />
      </section>

      {/* §2 call lists (A1) */}
      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">רשימות חיוג</h2>
        {view.callLists.status !== 'ok' ? (
          <EmptyState>
            {view.callLists.status === 'unconfigured'
              ? 'הערוץ אינו מוגדר.'
              : 'לא זמין כרגע.'}
          </EmptyState>
        ) : view.callLists.lists.length === 0 ? (
          <EmptyState>אין רשימות חיוג — מסלול CallList טרם הופעל.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>שם</TableHead>
                  <TableHead>סטטוס</TableHead>
                  <TableHead>ניסיונות</TableHead>
                  <TableHead>מקבילות</TableHead>
                  <TableHead>הוגש</TableHead>
                  <TableHead>הושלם</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.callLists.lists.map((l) => (
                  <TableRow key={l.listId ?? l.name}>
                    <TableCell className="font-medium">{l.name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge>{callStatusLabel(l.status)}</Badge>
                    </TableCell>
                    <TableCell>{l.numAttempts ?? '—'}</TableCell>
                    <TableCell>{l.maxSimultaneous ?? '—'}</TableCell>
                    <TableCell dir="ltr">
                      {l.submittedAt ? formatIsraelDateTime(l.submittedAt) : '—'}
                    </TableCell>
                    <TableCell dir="ltr">
                      {l.completedAt ? formatIsraelDateTime(l.completedAt) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* §3 audit (A3) */}
      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">יומן ביקורת</h2>
        {view.audit.status !== 'ok' ? (
          <EmptyState>{AUDIT_STATUS_LABEL[view.audit.status] ?? 'לא זמין.'}</EmptyState>
        ) : view.audit.entries.length === 0 ? (
          <EmptyState>אין רשומות ביקורת בחלון.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>זמן</TableHead>
                  <TableHead>פקודה</TableHead>
                  <TableHead>מבצע</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.audit.entries.map((e, i) => (
                  <TableRow key={`${e.command}-${e.at}-${i}`}>
                    <TableCell dir="ltr">
                      {e.at ? formatIsraelDateTime(e.at) : '—'}
                    </TableCell>
                    <TableCell>{e.command ?? '—'}</TableCell>
                    <TableCell>{e.actorType}</TableCell>
                    <TableCell dir="ltr">{e.ipMasked ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* §4 allowlist (A2) */}
      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">Allowlist לחומת אש (IONOS)</h2>
        {view.allowlist.status !== 'ok' ? (
          <EmptyState>לא זמין כרגע.</EmptyState>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {view.allowlist.ips.length} כתובות מקור לבקשות מתוך תרחישים.
            </p>
            <pre
              dir="ltr"
              className="max-h-48 overflow-auto rounded-md border border-border bg-muted p-3 text-xs"
            >
              {view.allowlist.ips.join('\n')}
            </pre>
          </>
        )}
      </section>

      {/* §5 log export (A4) */}
      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">ייצוא לוגים</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">נשמרו</dt>
            <dd className="text-2xl font-bold">{logExport.stored}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">ממתינים</dt>
            <dd className="text-2xl font-bold">{logExport.pending}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">כשלים</dt>
            <dd className="text-2xl font-bold">{logExport.failed}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">ייצוא אחרון</dt>
            <dd dir="ltr">
              {logExport.lastExportedAt ? formatIsraelDateTime(logExport.lastExportedAt) : '—'}
            </dd>
          </div>
        </dl>
        <RunLogExportButton />
      </section>

      {/* §6 ElevenLabs agent fleet (read-only) */}
      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">צי הסוכנים (ElevenLabs)</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>סוכן</TableHead>
                <TableHead dir="ltr">ID</TableHead>
                <TableHead>סטטוס</TableHead>
                <TableHead>שיחות אחרונות</TableHead>
                <TableHead>פעילות אחרונה</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fleet.agents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    אין סוכנים ברישום ה־IaC (agents.json).
                  </TableCell>
                </TableRow>
              ) : (
                fleet.agents.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell dir="ltr" className="text-xs">
                      {a.id}
                    </TableCell>
                    <TableCell>
                      <Badge variant={agentStatusVariant[a.status]}>
                        {agentStatusLabel[a.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {a.conversations
                        ? `${a.conversations.count}${a.conversations.more ? '+' : ''}`
                        : '—'}
                    </TableCell>
                    <TableCell dir="ltr">
                      {a.conversations?.lastAt
                        ? formatIsraelDateTime(a.conversations.lastAt)
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {fleet.quota ? (
          <p className="text-sm text-muted-foreground">
            מכסת תווים: {fleet.quota.characterCount ?? '—'} / {fleet.quota.characterLimit ?? '—'}
            {fleet.quota.tier ? ` · תוכנית ${fleet.quota.tier}` : ''}
          </p>
        ) : null}
        <ElevenLabsKeyForm keySource={fleet.keySource} />
      </section>
    </div>
  );
}
