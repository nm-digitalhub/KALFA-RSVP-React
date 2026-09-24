import { LocalDateTime } from '@/components/local-date-time';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { OwnerAgentAuditRow } from '@/lib/data/admin/owner-agent';

// The agent's recent audit trail: who, where, what happened, and which tools ran.
// Ids and codes only — the table cannot hold a phone number or text (its shape
// checks, plan §3.7), and the question text lives in owner_agent_intake, which this
// screen never reads.
//
// The codes are a PATTERN in the database, not a closed list, so a new one needs no
// migration. The labels below cover today's codes and fall back to the raw code:
// an unknown code shown as-is is information, a blank cell is not.

const STAGE_LABELS: Record<string, string> = {
  route: 'קליטה',
  agent: 'סוכן',
  send: 'שליחה',
};

const OUTCOME_LABELS: Record<string, { label: string; tone: BadgeVariant }> = {
  intake_queued: { label: 'נקלט', tone: 'info' },
  duplicate: { label: 'כפילות', tone: 'neutral' },
  gated: { label: 'נחסם בשער', tone: 'warning' },
  answered: { label: 'נענה', tone: 'success' },
  refused: { label: 'סורב', tone: 'warning' },
  send_failed: { label: 'שליחה נכשלה', tone: 'destructive' },
};

const REASON_LABELS: Record<string, string> = {
  kill_switch_off: 'המתג כבוי',
  not_staff: 'אינו איש צוות',
  phone_unverified: 'טלפון לא מאומת',
  rate_limited: 'חריגה מקצב',
  daily_cap: 'תקרה יומית',
  non_text: 'לא טקסט',
  window_closed: 'חלון 24 השעות נסגר',
  run_failed: 'הריצה נכשלה',
  db_error: 'שגיאת מסד נתונים',
};

export function AuditTable({
  rows,
  staffNames,
}: {
  rows: OwnerAgentAuditRow[];
  /** userId → display name, from the staff directory. */
  staffNames: Map<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        אין עדיין רשומות. שורה נכתבת רק על הודעה שהוסטה לסוכן, אף פעם לא על תעבורת אורחים.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>זמן</TableHead>
          <TableHead>איש צוות</TableHead>
          <TableHead>שלב</TableHead>
          <TableHead>תוצאה</TableHead>
          <TableHead>סיבה</TableHead>
          <TableHead>כלים</TableHead>
          <TableHead>משך</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const outcome = OUTCOME_LABELS[row.outcome];
          return (
            <TableRow key={row.id}>
              <TableCell>
                <LocalDateTime iso={row.occurredAt} />
              </TableCell>
              <TableCell>
                {row.staffUserId ? (staffNames.get(row.staffUserId) ?? 'לא בצוות כעת') : '—'}
              </TableCell>
              <TableCell>{STAGE_LABELS[row.stage] ?? row.stage}</TableCell>
              <TableCell>
                <Badge variant={outcome?.tone ?? 'neutral'}>{outcome?.label ?? row.outcome}</Badge>
              </TableCell>
              <TableCell>
                {row.reasonCode ? (REASON_LABELS[row.reasonCode] ?? row.reasonCode) : '—'}
              </TableCell>
              <TableCell>
                {row.toolNames.length > 0 ? (
                  <span dir="ltr" className="font-mono text-xs">
                    {row.toolNames.join(', ')}
                  </span>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell>
                {row.latencyMs !== null ? (
                  <span className="tabular-nums">{(row.latencyMs / 1000).toFixed(1)} ש׳</span>
                ) : (
                  '—'
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
