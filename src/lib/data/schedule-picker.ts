// The part of the schedule picker the browser needs: the shape of one option, and which option a new row starts with.
// Kept apart from schedule-options.ts (which decides WHAT to offer and pulls in the template model) so the form's
// client bundle stays small.

export type ScheduleStepOption = {
  channel: string;
  messageKey: string;
  label: string;
  // Why this step cannot be picked right now; null = it can. A step with a problem is still shown, so the admin sees
  // that it exists and what stands in its way.
  problem: string | null;
};

/** The first step of a channel that can be picked — what a new row, or a row that changed channel, starts with. */
export function firstSelectableKey(options: readonly ScheduleStepOption[], channel: string): string {
  return options.find((o) => o.channel === channel && o.problem === null)?.messageKey ?? '';
}
