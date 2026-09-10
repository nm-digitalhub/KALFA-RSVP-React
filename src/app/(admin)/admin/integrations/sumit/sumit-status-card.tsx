'use client';

import { Badge } from '../../_components';
import type { SumitHealth } from '@/lib/sumit/health';

// Its own file and its own test, like the other status cards: nested inside a page it
// would be invisible to the render walk, which does not invoke function components.
//
// The branch worth pinning is the three-way split between "your credentials are wrong",
// "SUMIT has a problem", and "we could not reach it". Flattening them sends someone to
// re-check a key that was never wrong.

const KIND_LABELS: Record<string, string> = {
  credentials_rejected: 'הפרטים נדחו',
  provider_error: 'תקלה אצל SUMIT',
  unexpected_response: 'תגובה לא מוכרת',
  unreachable: 'לא ניתן להגיע',
};

/** Failures that are NOT about our configuration. */
const NOT_OURS = new Set(['provider_error', 'unreachable']);

export function SumitStatusCard({ health }: { health: SumitHealth | null }) {
  if (!health) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        לא הוזנו פרטי SUMIT — אין מה לבדוק עדיין.
      </div>
    );
  }

  if (!health.ok) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <Badge variant={NOT_OURS.has(health.kind) ? 'warning' : 'destructive'}>
          {KIND_LABELS[health.kind] ?? health.kind}
        </Badge>
        <p className="mt-2 text-sm text-muted-foreground">{health.message}</p>
        {NOT_OURS.has(health.kind) ? (
          <p className="mt-2 text-xs text-muted-foreground">
            זו אמירה על SUMIT או על הרשת, לא על הפרטים שלכם — אין צורך לשנות דבר כאן.
          </p>
        ) : (
          <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">
            ⚠️ סליקה מושבתת בפועל: חיוב סגירת קמפיין, תפיסת מסגרת וזיכויים עוברים
            כולם דרך אותם פרטים.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <Badge variant="success">מחובר</Badge>
      {/* Our OWN business registration, which is the point: it proves the CompanyID and
          the key resolve to the company we think we are, not merely that some account
          answered. No customer data is read to produce this. */}
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">חברה</dt>
          <dd className="mt-0.5 truncate">{health.companyName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">ח.פ. / עוסק</dt>
          <dd dir="ltr" className="mt-0.5">{health.corporateNumber ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">דואר למסמכים</dt>
          <dd dir="ltr" className="mt-0.5 truncate">{health.documentsEmail ?? '—'}</dd>
        </div>
      </dl>
    </div>
  );
}
