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
  sweep: 'ניקוי',
  report: 'דוח יזום',
  identity: 'זיהוי',
  delivery: 'מסירה',
};

const OUTCOME_LABELS: Record<string, { label: string; tone: BadgeVariant }> = {
  intake_queued: { label: 'נקלט', tone: 'info' },
  duplicate: { label: 'כפילות', tone: 'neutral' },
  gated: { label: 'נחסם בשער', tone: 'warning' },
  send_gated: { label: 'נחסם לפני שליחה', tone: 'warning' },
  answered: { label: 'נענה', tone: 'success' },
  fallback_sent: { label: 'נשלחה תשובת כשל', tone: 'warning' },
  run_failed: { label: 'הריצה נכשלה', tone: 'destructive' },
  refused: { label: 'סורב', tone: 'warning' },
  send_failed: { label: 'שליחה נכשלה', tone: 'destructive' },
  expired: { label: 'פג', tone: 'neutral' },
  // Inbound kinds (capabilities plan §4.2–§4.7).
  reaction_received: { label: 'התקבלה תגובה', tone: 'info' },
  bsuid_bound: { label: 'מזהה עסקי קושר', tone: 'success' },
  bsuid_revoked: { label: 'קישור מזהה בוטל', tone: 'warning' },
  bsuid_mismatch: { label: 'מזהה עסקי לא תואם', tone: 'destructive' },
  coalesced: { label: 'אוחד להודעה הבאה', tone: 'neutral' },
  unknown_action: { label: 'לחיצה לא מזוהה', tone: 'warning' },
  unsupported_type: { label: 'סוג הודעה לא נתמך', tone: 'warning' },
  invalid_payload: { label: 'מבנה הודעה לא תקין', tone: 'warning' },
  unsupported_voice: { label: 'הודעה קולית לא נתמכת', tone: 'warning' },
  media_rejected: { label: 'מדיה נדחתה', tone: 'warning' },
  // Proactive report (stage 'report'; reports/report.ts and reports/tick.ts).
  sent: { label: 'דוח נשלח', tone: 'success' },
  skipped: { label: 'דוח דולג', tone: 'warning' },
  // Delivery statuses Meta reported for an agent message (stage 'delivery'; owner-agent/delivery.ts).
  delivered: { label: 'נמסר', tone: 'success' },
  read: { label: 'נקרא', tone: 'success' },
  failed: { label: 'לא נמסר', tone: 'destructive' },
};

const REASON_LABELS: Record<string, string> = {
  kill_switch_off: 'המתג כבוי',
  not_configured: 'לא הוגדר',
  not_allowlisted: 'לא ברשימת ההיתר',
  number_changed: 'המספר הוחלף',
  not_staff: 'אינו איש צוות',
  phone_unverified: 'טלפון לא מאומת',
  rate_limited: 'חריגה מקצב',
  daily_cap: 'תקרה יומית',
  // Old rows, from before media was accepted.
  non_text: 'לא טקסט',
  empty_text: 'טקסט ריק',
  window_closed: 'חלון 24 השעות נסגר',
  run_failed: 'הריצה נכשלה',
  db_error: 'שגיאת מסד נתונים',
  sql_unavailable: 'גישה חלקית לנתונים',
  partial_send: 'נשלח חלקית',
  provider_rejected: 'Meta דחתה את ההודעה',
  send_unknown: 'תוצאת השליחה לא ידועה',
  send_unconfirmed: 'שליחה לא אושרה',
  // Reactions.
  feedback_up: 'משוב חיובי',
  feedback_down: 'משוב שלילי',
  reaction_other: 'תגובה אחרת',
  reaction_removed: 'תגובה הוסרה',
  // Manual approval.
  override_staff_unverified: 'איש צוות שאושר ידנית',
  override_external: 'אדם חיצוני שאושר ידנית',
  // Button / list clicks.
  foreign_id: 'מזהה לחיצה זר',
  followup_not_found: 'ההצעה לא נמצאה',
  foreign_owner: 'ההצעה שייכת לאחר',
  context_mismatch: 'ההקשר לא תואם',
  followup_expired: 'ההצעה פגה',
  followup_used: 'ההצעה כבר נוצלה',
  // BSUID.
  user_id_update: 'Meta עדכנה את מזהה המשתמש',
  user_changed_user_id: 'המשתמש החליף מזהה',
  // Media.
  media_bad_encoding: 'קידוד מדיה לא תקין',
  media_budget: 'חריגה מתקציב המדיה',
  media_download_failed: 'הורדת המדיה נכשלה',
  media_empty: 'קובץ ריק',
  media_invalid_id: 'מזהה מדיה לא תקין',
  media_lookup_failed: 'פרטי המדיה לא נמצאו',
  media_not_wired: 'קליטת מדיה לא מחוברת',
  media_rejected: 'מדיה נדחתה',
  media_too_large: 'קובץ גדול מדי',
  media_turn_cap: 'יותר מדי קבצים בהודעה',
  media_unavailable: 'המדיה לא זמינה',
  media_unsupported: 'סוג קובץ לא נתמך',
  media_wrong_number: 'מדיה של מספר אחר',
  // Proactive report.
  late: 'באיחור של יותר משעה',
  reports_off: 'מתג הדוחות כבוי',
  no_number: 'לא נבחר מספר',
  subscription_off: 'השעה בוטלה',
  slot_stale: 'השעה כבר לא בתוקף',
  not_opted_in: 'הרשומה לא מקבלת דוחות',
  no_permissions: 'אין הרשאות לנתוני הדוח',
  permissions_changed: 'ההרשאות השתנו',
  template_unavailable: 'מחוץ לחלון 24 השעות ואין תבנית',
  template_fallback: 'נשלח כתבנית אחרי שהחלון נסגר',
  model_fallback: 'הדוח לפי ההנחיות נכשל — נשלח הדוח הרגיל',
  custom_template_missing: 'אין תבנית לדוח לפי הנחיות — נשלח הדוח הרגיל',
  bad_slot: 'שעה לא תקינה',
};

// Any report_* outcome a later change adds reads as a report outcome rather
// than as a bare code.
// Meta's own error codes (Cloud API error-code reference), for the ones a send or
// a delivery can realistically hit. Any other code still shows as its number.
const META_CODE_LABELS: Record<string, string> = {
  '10': 'אין הרשאה',
  '190': 'הטוקן פג',
  '130429': 'חריגה מקצב השליחה',
  '131026': 'המספר לא יכול לקבל את ההודעה',
  '131042': 'בעיה באמצעי התשלום',
  '131045': 'המספר השולח לא רשום',
  '131048': 'הגבלת ספאם על המספר',
  '131049': 'מגבלת הודעות שיווק לנמען',
  '131050': 'הנמען הפסיק לקבל הודעות שיווק',
  '131056': 'יותר מדי הודעות לאותו נמען',
  '131057': 'החשבון בתחזוקה',
  '132001': 'התבנית לא קיימת או לא מאושרת',
  '132015': 'התבנית מושהית',
  '132016': 'התבנית הושבתה',
};

// A failure carries Meta's own code as meta_<digits>.
function reasonLabel(code: string): string {
  const known = REASON_LABELS[code];
  if (known) return known;
  const meta = /^meta_([0-9]+)$/.exec(code);
  if (meta) {
    const label = META_CODE_LABELS[meta[1]];
    return label ? `${label} (קוד Meta ${meta[1]})` : `קוד Meta ${meta[1]}`;
  }
  // An unknown outcome that still carried Meta's code (Meta marked it temporary).
  const unknown = /^send_unknown_([0-9]+)$/.exec(code);
  if (unknown) return `${REASON_LABELS.send_unknown} (קוד Meta ${unknown[1]})`;
  return code;
}

function outcomeLabel(outcome: string): { label: string; tone: BadgeVariant } | undefined {
  const known = OUTCOME_LABELS[outcome];
  if (known) return known;
  if (outcome.startsWith('report_')) return { label: `דוח: ${outcome.slice('report_'.length)}`, tone: 'neutral' };
  return undefined;
}

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
          const outcome = outcomeLabel(row.outcome);
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
                {row.reasonCode ? reasonLabel(row.reasonCode) : '—'}
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
