import { Badge } from '@/components/ui/badge';
import { formatIsraelDateTime } from '@/lib/date';
import { formatAmount } from '@/lib/format';
import type { DisplayedOperation, OperationStaffFacts, StaffDisplayedOperation } from '@/lib/payments/ledger';
import { OPERATION_OUTCOME_LABELS, ledgerMoneyParts } from '@/lib/payments/operation-labels';
import { ledgerMoney } from '@/lib/payments/status';

// A campaign's payments, as the ledger recorded them: one row per operation, with the operation's own name from the
// registry (payment_operation_kinds.label_he) and its outcome as two separate facts. Nothing here names a kind or a
// billing model: a kind added to the registry shows under its own name. A Server Component that only renders what the
// page read; the page decides who sees what (a customer gets DisplayedOperation without failed attempts, staff get
// StaffDisplayedOperation with every attempt and the provider's references).

type Props =
  | { audience: 'customer'; operations: DisplayedOperation[] | null }
  | { audience: 'staff'; operations: StaffDisplayedOperation[] | null };

// A document link is shown only when it is an https address; anything else is shown as its number alone.
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

const STAFF_FACTS: { key: keyof OperationStaffFacts; label: string }[] = [
  { key: 'provider', label: 'חברת סליקה' },
  { key: 'terminal', label: 'מסוף' },
  { key: 'terminalEcho', label: 'מסוף בתשובה' },
  { key: 'paymentId', label: 'מזהה עסקה' },
  { key: 'authRef', label: 'מספר אישור' },
  { key: 'providerStatus', label: 'קוד תשובה' },
  { key: 'providerStatusDescription', label: 'תיאור התשובה' },
  { key: 'authDescription', label: 'תיאור האישור' },
  { key: 'documentType', label: 'סוג מסמך' },
  { key: 'dealType', label: 'סוג עסקה' },
  { key: 'paymentType', label: 'אמצעי תשלום' },
  { key: 'numberOfPayments', label: 'מספר תשלומים' },
  { key: 'acquirer', label: 'סולק' },
  { key: 'cardBrand', label: 'מותג כרטיס' },
  { key: 'cardIssuer', label: 'מנפיק' },
  { key: 'cardIsAbroad', label: 'כרטיס חו״ל' },
  { key: 'uniqueId', label: 'מזהה ייחודי' },
  { key: 'rrn', label: 'RRN' },
  { key: 'couponNumber', label: 'מספר שובר' },
  { key: 'creditApplied', label: 'קוזז מזיכוי' },
  { key: 'source', label: 'מקור הרישום' },
  { key: 'note', label: 'הערה' },
  { key: 'recordedAt', label: 'נרשם' },
];

function factValue(key: keyof OperationStaffFacts, value: OperationStaffFacts[keyof OperationStaffFacts]): string | null {
  if (value === null || value === '') return null;
  if (typeof value === 'boolean') return value ? 'כן' : 'לא';
  if (key === 'creditApplied') return Number(value) > 0 ? formatAmount(Number(value)) : null;
  if (key === 'recordedAt') return formatIsraelDateTime(String(value)) || String(value);
  return String(value);
}

function StaffFacts({ facts }: { facts: OperationStaffFacts }) {
  const rows = STAFF_FACTS.map(({ key, label }) => ({ label, value: factValue(key, facts[key]) })).filter(
    (r): r is { label: string; value: string } => r.value !== null,
  );
  if (rows.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        פרטים טכניים (צוות בלבד)
      </summary>
      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex min-w-0 justify-between gap-3">
            <dt className="shrink-0 text-muted-foreground">{r.label}</dt>
            <dd className="min-w-0 truncate font-medium tabular-nums" dir="auto" title={r.value}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function OperationRow({ op, staff }: { op: DisplayedOperation; staff?: OperationStaffFacts }) {
  const outcome = OPERATION_OUTCOME_LABELS[op.outcome];
  const docUrl = safeUrl(op.document?.url ?? null);
  const docLabel = op.document?.number != null ? `מסמך ${op.document.number}` : 'מסמך';
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold">{op.kindLabel}</span>
          <Badge variant={outcome.variant}>{outcome.label}</Badge>
          {op.isTest ? <Badge variant="neutral">בדיקה</Badge> : null}
        </div>
        <span className="font-bold tabular-nums">{formatAmount(op.amount)}</span>
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{formatIsraelDateTime(op.occurredAt)}</span>
        {op.cardLast4 ? <span dir="ltr">•••• {op.cardLast4}</span> : null}
        {op.document ? (
          docUrl ? (
            <a
              href={docUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {docLabel}
            </a>
          ) : (
            <span>{docLabel}</span>
          )
        ) : null}
      </p>
      {staff ? <StaffFacts facts={staff} /> : null}
    </li>
  );
}

export function CampaignPayments(props: Props) {
  const { operations } = props;
  if (operations === null) {
    return (
      <section aria-labelledby="campaign-payments-title" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 id="campaign-payments-title" className="text-base font-bold">
          תשלומים
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">לא ניתן לטעון כרגע את נתוני התשלומים. רעננו את הדף.</p>
      </section>
    );
  }
  // Nothing recorded: the section has nothing true to say, so it is not shown.
  if (operations.length === 0) return null;
  const summary = ledgerMoneyParts(ledgerMoney(operations));
  return (
    <section aria-labelledby="campaign-payments-title" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="campaign-payments-title" className="text-base font-bold">
          תשלומים
        </h2>
        {summary.length > 0 ? <p className="text-sm text-muted-foreground">{summary.join(' · ')}</p> : null}
      </div>
      <ul className="mt-2 divide-y divide-border">
        {props.audience === 'staff'
          ? props.operations?.map((op) => <OperationRow key={op.id} op={op} staff={op.staff} />)
          : props.operations?.map((op) => <OperationRow key={op.id} op={op} />)}
      </ul>
    </section>
  );
}
