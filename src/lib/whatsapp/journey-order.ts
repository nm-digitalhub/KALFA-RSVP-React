// The order a guest meets the WhatsApp steps. One place, shared by the templates screen and the package schedule
// picker, so both list the steps the way the guest lives them. A step that is not listed here (a new one) comes last.
const JOURNEY_ORDER = ['invite', 'reminder_1', 'reminder_2', 'final', 'event_day_pay', 'gift', 'thankyou'];

export function journeyRank(messageKey: string): number {
  const i = JOURNEY_ORDER.indexOf(messageKey);
  return i === -1 ? JOURNEY_ORDER.length : i;
}
