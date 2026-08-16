// WHICH calendar backend is active — the decision alone, with none of the
// implementations attached.
//
// This lives apart from calendar-provider.ts on purpose. That module imports
// BOTH ews-impl and graph-impl in order to hand back an instance, so anything
// importing it drags the whole EWS stack along. mailbox-credential.ts needs the
// answer to "which provider?" and nothing else, and a unit test that mocks the
// provider surface should not thereby change how a credential resolves — which
// is exactly what happened: mocking '@/lib/exchange-ews/calendar-provider' with
// just `calendarProvider` left `selectedCalendarProvider` undefined, the call
// threw, and four fail-closed catch blocks turned it into `decrypt_failed`.
//
// One implementation, no duplication: calendar-provider.ts re-exports this.
export type CalendarProviderName = 'graph' | 'ews' | 'off';

// Resolved per call, never captured at module load: a process that has been up
// for days must pick up a changed value on restart without any code path
// holding a stale reference. Unknown values fall back to `graph` — the active
// backend — rather than throwing, so a typo degrades to the correct default
// instead of taking the calendar down.
export function selectedCalendarProvider(): CalendarProviderName {
  const raw = (process.env.EXCHANGE_PROVIDER ?? 'graph').trim().toLowerCase();
  return raw === 'ews' || raw === 'off' ? raw : 'graph';
}
