import { sendSlackAlert } from '@/lib/alerts/slack';

// Out-of-band signal for owner decisions on remote-desktop access. The audit table is written by the same
// credentials that take the decision, so it cannot be the only record; a message that has already left the
// system can't be taken back. sendSlackAlert is fail-safe by itself (it returns null when Slack is off or
// unreachable), so a notification failure never blocks the action it reports.
//
// Text carries the first 8 characters of the id IN THE TITLE on purpose: sendSlackAlert de-duplicates on
// (level, title, source) and two different requests must not swallow each other's alert. No names, reasons or
// IP addresses go into Slack.

export type RdpOwnerAction =
  | { kind: 'approved'; id: string; minutes: number; selfApproved: boolean }
  | { kind: 'denied'; id: string }
  | { kind: 'revoked'; id: string; tunnelsCut: boolean };

const shortId = (id: string) => id.slice(0, 8);

export async function notifyRdpOwnerAction(action: RdpOwnerAction): Promise<void> {
  switch (action.kind) {
    case 'approved':
      await sendSlackAlert({
        level: action.selfApproved ? 'warn' : 'info',
        category: 'security',
        source: 'rdp-access:cli',
        title: `גישה לשולחן העבודה אושרה (${shortId(action.id)})`,
        detail: `${action.minutes} דקות${action.selfApproved ? ', המבקש אישר לעצמו' : ''}`,
      });
      return;
    case 'denied':
      await sendSlackAlert({
        level: 'info',
        category: 'security',
        source: 'rdp-access:cli',
        title: `בקשת גישה לשולחן העבודה נדחתה (${shortId(action.id)})`,
      });
      return;
    case 'revoked':
      await sendSlackAlert({
        level: action.tunnelsCut ? 'warn' : 'error',
        category: 'security',
        source: 'rdp-access:cli',
        title: `גישה לשולחן העבודה בוטלה (${shortId(action.id)})`,
        detail: action.tunnelsCut ? 'החיבורים נותקו' : 'הביטול נרשם אך ניתוק החיבורים לא אושר',
      });
      return;
  }
}
