import { ChevronLeft } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ProviderNumber } from '@/lib/data/admin/integrations/provider-numbers';
import {
  PROVIDER_LABELS,
  ROLE_LABELS,
  type ProviderKey,
} from '@/lib/validation/provider-numbers';
import { formatIsraelDateTime } from '@/lib/date';

import { EmptyState } from '../../_components';
import { statusBadgeClass, statusBadgeNeutralTone } from '../_components/form-fields';

// Every connected line in one table, grouped the way the panel reads: the number
// first, what it is FOR second, where it came from last.
//
// Server component. The only interactive element is the per-row snapshot fold, and
// that is a native <details>: semantic, keyboard-operable, open-in-print, and it
// costs no client JavaScript for a disclosure that most readers never open. It also
// sidesteps the Base UI Collapsible trigger gotcha this codebase has already been
// bitten by.
//
// RTL: the number cell is dir="ltr" because a phone number is an LTR token even in
// a Hebrew sentence — without it the leading '+' jumps to the wrong end and reads as
// a different number. Everything else stays in the document direction, and spacing
// is logical (ps/pe), never left/right.

const PROVIDER_TONE: Record<ProviderKey, string> = {
  meta_whatsapp: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  voximplant: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
  extra_sms: 'bg-violet-500/10 text-violet-600 border-violet-500/30',
  company: 'bg-muted text-muted-foreground border-border',
};

const SOURCE_LABELS: Record<string, string> = {
  admin: 'נוסף ידנית',
  backfill: 'הועבר מההגדרות',
  sync: 'סונכרן מהספק',
};

function ProviderChip({ provider }: { provider: ProviderKey }) {
  return (
    <span className={`${statusBadgeClass} ${PROVIDER_TONE[provider]}`}>
      {PROVIDER_LABELS[provider]}
    </span>
  );
}

function RoleChips({ roles }: { roles: ProviderNumber['roles'] }) {
  if (roles.length === 0) {
    return (
      <span className={`${statusBadgeClass} ${statusBadgeNeutralTone}`}>
        ללא תפקיד
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((role) => (
        <span
          key={role}
          className={`${statusBadgeClass} bg-primary/10 text-primary border-primary/30`}
        >
          {ROLE_LABELS[role]}
        </span>
      ))}
    </div>
  );
}

function Snapshot({ number }: { number: ProviderNumber }) {
  const entries = Object.entries(number.snapshot ?? {}).filter(
    ([, v]) => v !== null && v !== '',
  );
  if (entries.length === 0) return null;

  return (
    <details className="group mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <ChevronLeft
          className="size-3.5 transition-transform group-open:-rotate-90"
          aria-hidden
        />
        מה שהספק מדווח ({entries.length})
      </summary>
      {/* dir="ltr" ON THE ROW, not on dt and dd separately — and the pair does not
          share one flex line.

          Both were wrong before, and the two faults compounded into an unreadable
          block (seen on a real phone 2026-09-11). Marking only the children LTR left
          the ROW in the page's rtl, so flex put `dt` on the right and the pair read
          back-to-front: "NOT_APPLICABLE throughput" instead of "throughput
          NOT_APPLICABLE". And the flex row had no min-width floor, so unbreakable
          provider tokens (NOT_APPLICABLE, PENDING_REVIEW, is_official_business_account)
          overflowed their grid column and printed on top of the neighbouring one.

          A key stacked ABOVE its value removes the horizontal contest entirely —
          these keys are long and so are the values, and nothing here is scanned as a
          two-column table. `wrap-anywhere` is the repo's idiom for a token with no
          break opportunity. */}
      <dl className="mt-2 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} dir="ltr" className="min-w-0">
            <dt className="wrap-anywhere text-muted-foreground">{key}</dt>
            <dd className="wrap-anywhere font-medium">{String(value)}</dd>
          </div>
        ))}
      </dl>
      {number.snapshotAt ? (
        <p className="mt-2 text-xs text-muted-foreground">
          נקרא מהספק: {formatIsraelDateTime(number.snapshotAt)}
        </p>
      ) : null}
    </details>
  );
}

export function NumbersTable({ numbers }: { numbers: ProviderNumber[] }) {
  if (numbers.length === 0) {
    return (
      <EmptyState>
        אין מספרים רשומים. הריצו סנכרון מהספק, או הוסיפו מספר ידנית.
      </EmptyState>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[46rem]">
        <TableHeader>
          <TableRow className="text-xs text-muted-foreground">
            <TableHead>מספר</TableHead>
            <TableHead>ספק</TableHead>
            <TableHead>למה משמש</TableHead>
            <TableHead>מצב</TableHead>
            <TableHead>מקור</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {numbers.map((n) => (
            <TableRow key={n.id}>
              <TableCell className="align-top">
                {/* A phone number is an LTR token even inside Hebrew: without this
                    the leading '+' lands at the wrong end and reads as a different
                    number entirely. */}
                <span className="font-medium" dir="ltr">
                  {n.e164 ?? '—'}
                </span>
                {n.displayLabel ? (
                  <p className="text-xs text-muted-foreground">{n.displayLabel}</p>
                ) : null}
                {n.providerRef ? (
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {n.providerRef}
                  </p>
                ) : null}
                <Snapshot number={n} />
              </TableCell>
              <TableCell className="align-top">
                <ProviderChip provider={n.provider} />
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                <RoleChips roles={n.roles} />
              </TableCell>
              <TableCell className="align-top">
                {n.isActive ? (
                  <span
                    className={`${statusBadgeClass} bg-emerald-500/10 text-emerald-600 border-emerald-500/30`}
                  >
                    פעיל
                  </span>
                ) : (
                  <span
                    className={`${statusBadgeClass} bg-amber-500/10 text-amber-600 border-amber-500/30`}
                  >
                    מושבת אצל הספק
                  </span>
                )}
              </TableCell>
              <TableCell className="align-top text-xs text-muted-foreground">
                {SOURCE_LABELS[n.source] ?? n.source}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
