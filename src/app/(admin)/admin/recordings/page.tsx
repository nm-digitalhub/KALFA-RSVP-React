import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import { validateRecordingUrl } from '@/lib/voximplant/recording-url';
import { EmptyState, PageHeading, formatDateTime } from '../_components';

export const metadata = { title: 'הקלטות שיחות AI' };

// §1F — read-only ADMIN surface for Voximplant call recordings. Reads
// `call_attempts` through the cookie client, which is gated by the admin RLS
// policy `call_attempts_admin_read` (has_role admin). Owners NEVER see this:
// the route lives under the (admin) group whose layout enforces requireAdmin,
// and requireAdmin is re-asserted here (defense-in-depth). `recording_url` is
// already host-allowlist-validated on write; it is re-validated here before it
// is rendered as a link, and it is never exposed to any owner-facing surface.
//
// Dark-safe: while `VOXIMPLANT_LIVE_CALLS` is off no call rows are produced, so
// this page simply renders the empty state.

// Free-text `call_attempts.status` — a small Hebrew map for the known set; any
// unmapped value falls back to the raw string (never throws on a new status).
const CALL_STATUS_LABELS: Record<string, string> = {
  queued: 'בתור',
  dialing: 'מחייג',
  in_progress: 'בשיחה',
  completed: 'הושלמה',
  failed: 'נכשלה',
  no_answer: 'אין מענה',
  no_response: 'ללא תגובה',
  cancelled: 'בוטלה',
  failed_to_start: 'לא יצאה לפועל',
  expired: 'פגה',
};

function callStatusLabel(status: string): string {
  return CALL_STATUS_LABELS[status] ?? status;
}

function formatDuration(sec: number | null): string {
  if (sec == null || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default async function AdminRecordingsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('call_attempts')
    .select(
      'id, campaign_id, event_id, status, finish_reason, call_duration_sec, recording_url, recording_started_at, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error('טעינת ההקלטות נכשלה');

  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <PageHeading>הקלטות שיחות AI</PageHeading>
        <p className="text-sm text-muted-foreground">
          תצוגת ניהול בלבד. ההקלטות נגישות למנהלים בלבד ולעולם אינן נחשפות לבעלי אירועים.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState>אין עדיין הקלטות שיחות.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-border bg-card text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start font-medium">מועד</th>
                <th className="px-4 py-3 text-start font-medium">מצב</th>
                <th className="px-4 py-3 text-start font-medium">סיבת סיום</th>
                <th className="px-4 py-3 text-start font-medium">משך</th>
                <th className="px-4 py-3 text-start font-medium">הקלטה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { url } = validateRecordingUrl(row.recording_url);
                return (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 tabular-nums">{formatDateTime(row.created_at)}</td>
                    <td className="px-4 py-3">{callStatusLabel(row.status)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.finish_reason ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatDuration(row.call_duration_sec)}
                    </td>
                    <td className="px-4 py-3">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
                        >
                          האזנה
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
