// WHICH calendar backend is active — the decision alone, with none of the
// implementations attached.
//
// This lives apart from calendar-provider.ts on purpose. That module imports an
// implementation in order to hand back an instance, so anything importing it
// drags that implementation's SDK along. A caller that only needs the answer to
// "which provider?" can import it from here instead, and a unit test that mocks
// the provider surface should not thereby change how that answer resolves:
// mocking '@/lib/exchange-ews/calendar-provider' with just `calendarProvider`
// leaves `selectedCalendarProvider` missing.
//
// One implementation, no duplication: calendar-provider.ts re-exports this.
export type CalendarProviderName = 'graph' | 'off';

// Resolved per call, never captured at module load: a process that has been up
// for days must pick up a changed value on restart without any code path
// holding a stale reference.
//
// `ews` was removed as an option when the EWS implementation was deleted. It is
// named explicitly below rather than lumped in with typos, because a deployment
// still carrying EXCHANGE_PROVIDER=ews would otherwise start on Graph silently
// while its operator believed they had rolled back — the worst possible outcome
// for a switch whose entire purpose was to be trustworthy in a crisis. A loud
// failure at boot is the only honest answer.
//
// Any other unrecognised value still degrades to `graph`: a typo should not take
// the calendar down, and `graph` is what a typo was almost certainly aiming at.
export function selectedCalendarProvider(): CalendarProviderName {
  const raw = (process.env.EXCHANGE_PROVIDER ?? 'graph').trim().toLowerCase();
  if (raw === 'ews') {
    throw new Error(
      'EXCHANGE_PROVIDER=ews is no longer supported — the EWS implementation was removed. ' +
        'Use graph (default) or off.',
    );
  }
  return raw === 'off' ? 'off' : 'graph';
}
