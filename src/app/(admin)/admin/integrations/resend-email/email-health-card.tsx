'use client';

import { Badge } from '../../_components';
import type { EmailHealth } from '@/lib/email/health';

// The outgoing-mail verdict, in its own file for the same reason as ExtrA's: a
// component nested inside a page is invisible to the render tests this branch uses,
// which walk the element tree without invoking function components. The branch worth
// pinning here is `fullyVerified === false` — verified, but not completely — which must
// read as a note and never as a failure.

const KIND_LABELS: Record<string, string> = {
  key_invalid: 'מפתח אינו תקף',
  key_restricted: 'לא ניתן לבדוק בהרשאת המפתח',
  domain_missing: 'הדומיין אינו רשום',
  domain_unverified: 'הדומיין טרם אומת',
  domain_failed: 'אימות הדומיין נשבר',
  sending_disabled: 'השליחה כבויה ב-Resend',
  rate_limited: 'הוגבל זמנית',
  smtp_auth_failed: 'ההזדהות נדחתה',
  unreachable: 'לא ניתן להגיע',
};

/** Failures that describe our ability to ASK, not the integration's health. */
const NOT_A_FAULT = new Set(['key_restricted', 'rate_limited']);

export function EmailHealthCard({ health }: { health: EmailHealth | null }) {
  if (!health) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        שירות הדואר אינו מוגדר — אין מה לבדוק עדיין.
      </div>
    );
  }

  if (!health.ok) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <Badge variant={NOT_A_FAULT.has(health.kind) ? 'warning' : 'destructive'}>
          {KIND_LABELS[health.kind] ?? health.kind}
        </Badge>
        <p className="mt-2 text-sm text-muted-foreground">{health.message}</p>
        {health.observedStatus ? (
          <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
            status: {health.observedStatus}
          </p>
        ) : null}
        {NOT_A_FAULT.has(health.kind) ? (
          <p className="mt-2 text-xs text-muted-foreground">
            זו אמירה על היכולת לבדוק, לא על הדואר עצמו — שליחות עשויות לעבוד כרגיל.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">תקין</Badge>
        <Badge variant="neutral">{health.transport === 'resend' ? 'Resend API' : 'SMTP'}</Badge>
        {/* `false` is NOT a failure: an optional record (open/click tracking, unused
            here) can be outstanding while mail flows perfectly. `null` means the SMTP
            path, where DNS state belongs to the relay, not to us. */}
        {health.fullyVerified === false ? <Badge variant="warning">אימות חלקי</Badge> : null}
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">שולח</dt>
          <dd dir="ltr" className="mt-0.5 truncate">{health.from}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">דומיין</dt>
          <dd dir="ltr" className="mt-0.5">
            {health.domain ?? '—'}
            {health.domainStatus ? ` · ${health.domainStatus}` : ''}
          </dd>
        </div>
      </dl>

      {health.records.length ? (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {health.records.map((r, i) => (
            <li key={`${r.record}-${i}`} dir="ltr">
              {r.record} — {r.status}
            </li>
          ))}
        </ul>
      ) : null}

      {health.fullyVerified === null ? (
        <p className="mt-3 text-xs text-muted-foreground">
          במסלול SMTP אין כאן חיווי SPF/DKIM: הממסר כותב מחדש את גוף ההודעה וחותם
          עליה בעצמו, כך שמצב ה-DNS הוא שלו ולא שלנו.
        </p>
      ) : null}
    </div>
  );
}
