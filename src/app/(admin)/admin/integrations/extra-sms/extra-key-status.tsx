'use client';

import { Badge } from '../../_components';
import { type ExtraKeyHealth } from '@/lib/sms/extra-client';
import { EXTRA_KEY_WARN_DAYS } from './thresholds';

// The key's remaining life, which is the reason this page exists at all: it expires
// 2027-10-27 and, until the daily queue added alongside it, nothing watched that date.
//
// Its own file rather than a helper inside page.tsx for two reasons. It holds the only
// branch on this page worth pinning — the 60-day threshold — and a component nested
// inside a page is invisible to the render tests this branch uses, because they walk
// the element tree without invoking function components. A threshold nobody can test
// is a threshold that drifts.

export function ExtraKeyStatus({ health }: { health: ExtraKeyHealth }) {
  if (!health.ok) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <Badge variant={health.kind === 'key_invalid' ? 'destructive' : 'warning'}>
          {health.kind === 'key_invalid' ? 'מפתח אינו תקף' : 'לא ניתן לבדוק כעת'}
        </Badge>
        <p className="mt-2 text-sm text-muted-foreground">{health.message}</p>
      </div>
    );
  }

  const days = health.daysToExpiry;
  // Amber at 60 days, not the 30 the Slack alert uses. The card warns EARLY so whoever
  // opens the panel can plan a renewal; the alert fires late so Slack is not nagged for
  // two months about a date nobody can act on yet. See run-key-check.ts.
  const expiringSoon = days !== null && days <= EXTRA_KEY_WARN_DAYS;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">מפתח תקף</Badge>
        {days !== null ? (
          <Badge variant={expiringSoon ? 'warning' : 'neutral'}>
            {days < 0 ? `פג לפני ${Math.abs(days)} ימים` : `${days} ימים לתפוגה`}
          </Badge>
        ) : null}
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">בתוקף עד</dt>
          <dd dir="ltr" className="mt-0.5">{health.expireAt ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">נוצר</dt>
          <dd dir="ltr" className="mt-0.5">{health.createdAt ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">חשבון</dt>
          <dd dir="ltr" className="mt-0.5 truncate">{health.accountEmail ?? '—'}</dd>
        </div>
      </dl>
      {health.scopes === null ? (
        <p className="mt-3 text-xs text-muted-foreground">
          המפתח ללא scopes — כלומר הרשאה מלאה לכל החשבון. זו התנהגות ברירת המחדל של
          מפתחות ותיקים ב-ExtrA, לא תקלה.
        </p>
      ) : null}
      {expiringSoon ? (
        <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-400">
          ⚠️ חידוש מתבצע ב-<span dir="ltr">/my/api/</span> בפורטל ExtrA, ואז עדכון השדה
          כאן. בפקיעה נעצרות כל שליחות ה-SMS בבת אחת.
        </p>
      ) : null}
    </div>
  );
}
