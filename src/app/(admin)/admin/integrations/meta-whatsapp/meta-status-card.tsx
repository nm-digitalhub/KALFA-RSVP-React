import { Badge } from '@/components/ui/badge';
import { LocalDateTime } from '@/components/local-date-time';
// TYPE-ONLY. meta-status.ts is `server-only`, and importing a VALUE from it
// (the REQUIRED_SCOPES array, which an earlier draft used just to print a count)
// drags that guard into this module — harmless while the card renders inside a
// Server Component, and an immediate crash the day anyone adds 'use client'.
// Everything this card needs is already in the status object.
import type { MetaStatus } from '@/lib/data/admin/integrations/meta-status';

// What META says about our connection, next to what OUR columns say.
//
// The two are different questions and the panel used to answer only the second.
// "מוגדר" means a value was typed into app_settings; it stays true forever. A
// System User token whose data-access window lapses keeps its shape, so the
// panel would go on reporting a healthy channel while every send failed with a
// provider error nobody was watching for. This card is the first thing in the
// product that asks Meta.
//
// Three states, deliberately distinct — collapsing the last two is the defect
// this shape exists to avoid:
//   - a verdict from Meta (valid / invalid, with Meta's own reason)
//   - "we could not ask", with why (no app secret, no app id, Meta unreachable)
//   - nothing configured, which is not a problem to report
//
// No "latest Graph version" comparison: nothing here can read Meta's current
// version live, and a hardcoded one becomes a lie the month it changes (house
// rule: no placeholder that goes stale). The pinned version is shown as the
// plain fact it is, with a link to the changelog.

const CHANGELOG_URL = 'https://developers.facebook.com/docs/graph-api/changelog';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border py-2 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

// Meta returns 0 for a token with no expiry. That meaning is NOT in the
// reference (checked 2026-09-13) — it is the observed convention for long-lived
// System User tokens — so the wording says what the value is rather than
// asserting a rule Meta never published.
function ExpiryValue({ unix }: { unix: number | null }) {
  if (unix === null) return <span className="text-muted-foreground">לא נמסר</span>;
  if (unix === 0) return <>ללא תפוגה (Meta מחזירה 0)</>;
  return <LocalDateTime iso={new Date(unix * 1000).toISOString()} />;
}

export function MetaStatusCard({ status }: { status: MetaStatus }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">מה Meta אומרת על החיבור</h2>
        <p className="text-sm text-muted-foreground">
          &quot;מוגדר&quot; למטה אומר שהוזנו ערכים. כאן נשאלת Meta עצמה אם הטוקן
          עדיין תקף ואילו הרשאות הוא נושא — שתי שאלות נפרדות.
        </p>
      </div>

      <dl className="divide-y-0">
        <Row label="גרסת Graph">
          <span dir="ltr">{status.graphVersion}</span>{' '}
          <a
            href={CHANGELOG_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            (changelog)
          </a>
        </Row>

        {!status.configured ? (
          <Row label="טוקן">
            <Badge variant="neutral">לא מוגדר</Badge>
          </Row>
        ) : status.token === null ? (
          <Row label="טוקן">
            {/* NOT "invalid". We could not ask — a different problem with a
                different fix, and saying the wrong one sends an admin to
                replace a token that is fine. */}
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant="warning">לא נבדק</Badge>
              <span className="font-normal text-muted-foreground">{status.reason}</span>
            </span>
          </Row>
        ) : (
          <>
            <Row label="טוקן">
              {status.token.isValid ? (
                <Badge variant="success">תקף</Badge>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant="warning">לא תקף</Badge>
                  {status.token.invalidReason ? (
                    <span dir="ltr" className="font-normal text-muted-foreground">
                      {status.token.invalidReason}
                    </span>
                  ) : null}
                </span>
              )}
            </Row>

            <Row label="תפוגת הטוקן">
              <ExpiryValue unix={status.token.expiresAt} />
            </Row>

            {/* The deadline that actually arrives. A System User token's
                data-access window expires on its own schedule even when the
                token itself never does. */}
            <Row label="תפוגת גישה לנתונים">
              <ExpiryValue unix={status.token.dataAccessExpiresAt} />
            </Row>

            <Row label="הרשאות">
              {status.token.missingScopes.length === 0 ? (
                <Badge variant="success">כל ההרשאות הנדרשות קיימות</Badge>
              ) : (
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <Badge variant="warning">חסרות</Badge>
                  <span dir="ltr" className="wrap-anywhere font-normal">
                    {status.token.missingScopes.join(', ')}
                  </span>
                </span>
              )}
            </Row>
          </>
        )}
      </dl>
    </section>
  );
}
