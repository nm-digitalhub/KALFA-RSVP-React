// The unified display status of a personal-benefit assignment (admin-panel change, AD2;
// spec §5). ONE pure mapper shared by the staff list and the detail page, so the two
// screens can never disagree. פגה is DERIVED at read time — nothing here writes state.
//
// Inputs are the stored facts: the DB state, the expiry, and the END REASON recorded in
// history for a void row (the void event's reason). The mapper never invents a reason
// from dates: a void row without a recorded reason is "הסתיימה".

export type AssignmentDisplayKey =
  | 'waiting' // assigned, still valid
  | 'bound' // bound to a campaign, still valid
  | 'expired' // assigned/bound past expiry, or void with the recorded expiry reason
  | 'consumed' // consumed — wins over expiry, a refund never reopens it
  | 'cancelled' // void with a recorded cancellation/duplicate/replacement reason
  | 'ended'; // void with no recorded reason

export type AssignmentDisplayStatus = {
  key: AssignmentDisplayKey;
  label: string;
  /** For cancelled rows: the recorded reason, in the team's words. */
  reasonLabel?: string;
};

// The VOID reasons the writers actually record (grep over the TS writers and the SQL
// functions). Anything else is shown as "הסתיימה" + the raw code in reasonLabel.
const CANCELLED_REASONS: Record<string, string> = {
  staff_void: 'בוטלה על ידי הצוות',
  voided_by_staff: 'בוטלה על ידי הצוות',
  duplicate: 'כפילות — נשמרה ההקצאה המאוחרת',
  escalation_replaced: 'הוחלפה בהטבה משופרת',
};

export function deriveAssignmentDisplayStatus(
  row: { state: string; expiresAt: string; endReason?: string | null },
  nowMs: number = Date.now(),
): AssignmentDisplayStatus {
  const expiresMs = Date.parse(row.expiresAt);
  const expired = Number.isFinite(expiresMs) && expiresMs <= nowMs;

  // Consumed wins over expiry (spec §5): a redeemed benefit stays redeemed.
  if (row.state === 'consumed') return { key: 'consumed', label: 'מומשה' };

  if (row.state === 'assigned' || row.state === 'bound') {
    if (expired) return { key: 'expired', label: 'פגה' };
    return row.state === 'assigned'
      ? { key: 'waiting', label: 'ממתינה לשימוש' }
      : { key: 'bound', label: 'משויכת לאירוע' };
  }

  if (row.state === 'void') {
    const reason = (row.endReason ?? '').trim();
    if (reason === 'expired') return { key: 'expired', label: 'פגה' };
    if (reason in CANCELLED_REASONS) {
      return { key: 'cancelled', label: 'בוטלה', reasonLabel: CANCELLED_REASONS[reason] };
    }
    if (reason !== '') return { key: 'ended', label: 'הסתיימה', reasonLabel: reason };
    return { key: 'ended', label: 'הסתיימה' };
  }

  // An unknown stored state renders as ended rather than crashing a staff screen.
  return { key: 'ended', label: 'הסתיימה' };
}
