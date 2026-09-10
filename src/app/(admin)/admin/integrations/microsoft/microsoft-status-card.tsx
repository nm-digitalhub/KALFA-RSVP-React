import type { MicrosoftHealth } from '@/lib/microsoft/health';
import { formatIsraelDate } from '@/lib/date';

import { statusBadgeClass, statusBadgeNeutralTone } from '../_components/form-fields';

// What Microsoft says about our app identity, rendered without inventing anything it
// did not say. Every "unknown" below is printed as unknown rather than folded into a
// reassuring default — the whole reason this card reads Graph instead of our own
// exchange_connections table is that the table can only answer for one admin.

// Far enough ahead that a certificate rotation is a scheduled task rather than an
// incident. Nothing else in this system watches that date.
const WARN_DAYS = 60;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

export function MicrosoftStatusCard({ health }: { health: MicrosoftHealth | null }) {
  if (!health) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <span className={`${statusBadgeClass} ${statusBadgeNeutralTone}`}>
          לא ניתן היה לבדוק
        </span>
        <p className="mt-2 text-sm text-muted-foreground">
          הבדיקה לא הושלמה. זו אמירה על הבדיקה, לא על החיבור.
        </p>
      </div>
    );
  }

  if (!health.ok) {
    const tone =
      health.kind === 'not_configured'
        ? statusBadgeNeutralTone
        : 'bg-destructive/10 text-destructive border-destructive/30';
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <span className={`${statusBadgeClass} ${tone}`}>
          {health.kind === 'not_configured' ? 'לא מוגדר' : 'החיבור נכשל'}
        </span>
        <p className="mt-2 text-sm text-muted-foreground">{health.message}</p>
      </div>
    );
  }

  const days = health.certDaysRemaining;
  const certExpiring = days !== null && days <= WARN_DAYS;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-5">
      <span
        className={`${statusBadgeClass} bg-emerald-500/10 text-emerald-600 border-emerald-500/30`}
      >
        מחובר
      </span>

      <dl className="divide-y divide-border">
        <Row label="ארגון">{health.organization ?? '—'}</Row>
        <Row label="דומיינים מאומתים">
          {health.verifiedDomains.length > 0 ? (
            <span dir="ltr">{health.verifiedDomains.join(', ')}</span>
          ) : (
            '—'
          )}
        </Row>
        <Row label="תיבת הדואר">
          {health.mailbox ? (
            <span className="inline-flex items-center gap-2">
              <span dir="ltr">{health.mailbox}</span>
              {health.mailboxResolves ? (
                <span className="text-emerald-600">✓</span>
              ) : (
                <span className="text-destructive">✗ לא נמצאה</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">לא הוגדרה</span>
          )}
        </Row>
        <Row label="תעודת האפליקציה">
          {health.certExpiresAt ? (
            <span className={certExpiring ? 'text-amber-600' : undefined}>
              {formatIsraelDate(health.certExpiresAt)}
              {days !== null ? ` · ${days} ימים` : ''}
            </span>
          ) : (
            <span className="text-muted-foreground">לא ניתן לקרוא</span>
          )}
        </Row>
        {health.clientSecretCount !== null && health.clientSecretCount > 0 ? (
          <Row label="סודות סיסמה">
            {/* Certificate auth is what this app uses. A password credential is a
                change worth seeing, not a detail. */}
            <span className="text-amber-600">
              {health.clientSecretCount} — האפליקציה אמורה להשתמש בתעודה בלבד
            </span>
          </Row>
        ) : null}
      </dl>

      {certExpiring ? (
        <p className="text-sm text-amber-600">
          התעודה פגה בעוד {days} ימים. כשהיא פגה — סנכרון היומן וקליטת הדואר נעצרים,
          בלי הודעה למשתמש.
        </p>
      ) : null}

      {health.mailbox && !health.mailboxResolves ? (
        <p className="text-sm text-destructive">
          הזהות תקינה אבל התיבה אינה נמצאת — הקריאות מולה ייכשלו בלי שהחיבור ייראה
          שבור.
        </p>
      ) : null}
    </div>
  );
}
