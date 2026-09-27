import type { FleetRoleInfo } from './handoff';

// When will a role actually SEE an owner write? Three different answers hide
// behind the same `pending`/`active` status, and the owner needs to know which
// one applies BEFORE they wait on a reply:
//   - reactive on the fast trigger -> the scheduler spawns it within a tick
//   - enabled with scheduled slots -> its next slot
//   - enabled with neither         -> only a manual run
//   - disabled                     -> never, until it is switched on
//
// `fastReactiveName` is the one thing that differs between callers:
// 'owner_direct_request' for a message, 'goal_due' for a goal.
// FleetRoleInfo.reactive is an array (a role can react to several triggers),
// hence .includes(), not ===.
//
// Pure and directive-free: the conversation header (server) and the composer
// (client) both read it. Moved here from fleet-client.tsx ('use client').

export type Reachability = {
  tone: 'ok' | 'warn' | 'blocked';
  /** Short state for the conversation header. */
  status: string;
  /** Full sentence for the composer, shown BEFORE sending. */
  text: string;
  /** Short delivery estimate under the owner's last pending message. */
  eta: string;
};

export function reachability(
  role: FleetRoleInfo | undefined,
  fastReactiveName: 'owner_direct_request' | 'goal_due' = 'owner_direct_request',
): Reachability {
  const act = fastReactiveName === 'goal_due' ? 'יצירת המטרה' : 'שליחה';
  const noun = fastReactiveName === 'goal_due' ? 'המטרה' : 'ההודעה';
  if (!role) {
    return {
      tone: 'blocked',
      status: 'לא מוגדר ב-fleet.json',
      text: 'הסוכן לא מוגדר ב-fleet.json — אי אפשר לשלוח לו',
      eta: 'הסוכן לא מוגדר',
    };
  }
  if (!role.enabled) {
    return {
      tone: 'blocked',
      status: 'כבוי',
      text: 'הסוכן כבוי — אי אפשר לשלוח לו עד שיופעל ב-fleet.json',
      eta: 'הסוכן כבוי',
    };
  }
  if (role.reactive.includes(fastReactiveName)) {
    return { tone: 'ok', status: 'ריאקטיבי', text: `${act} תפעיל את הסוכן — תוך כדקה`, eta: 'ייקלט תוך כדקה' };
  }
  if (role.scheduleSlots > 0) {
    return {
      tone: 'ok',
      status: 'מתוזמן',
      text: `${act} תפעיל את הסוכן — בהרצה המתוזמנת הבאה`,
      eta: 'ייקלט בהרצה הבאה',
    };
  }
  return {
    tone: 'warn',
    status: 'הרצה ידנית בלבד',
    text: `לסוכן אין לוח זמנים ואינו ריאקטיבי לכך — ${noun} תיקלט רק בהרצה ידנית`,
    eta: 'ייקלט רק בהרצה ידנית',
  };
}
