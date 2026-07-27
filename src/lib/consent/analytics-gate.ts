// Pure decision for the consent-gated analytics loader: render the GA tag
// only when BOTH a measurement id is configured AND the visitor granted the
// `analytics` category. Extracted from the client component so the rule is
// unit-testable in the repo's Node test environment (the event-driven consent
// sync itself is covered by the runtime browser verification gate).
export function shouldLoadAnalytics(
  gaId: string | undefined,
  analyticsGranted: boolean,
): boolean {
  return !!gaId?.trim() && analyticsGranted;
}

// Consent Mode v2 signal mapping. The single `analytics` category covers, per
// its revision-3 disclosure, measurement AND Google Signals (cross-device via
// signed-in Google accounts + aggregate demographics) — Signals requires the
// ad signals granted, so consent grants all four and revocation denies all
// four (pushed as a live `consent update` to an already-loaded tag).
export type ConsentSignalState = 'granted' | 'denied';

export interface ConsentSignals {
  analytics_storage: ConsentSignalState;
  ad_storage: ConsentSignalState;
  ad_user_data: ConsentSignalState;
  ad_personalization: ConsentSignalState;
}

export function consentSignals(analyticsGranted: boolean): ConsentSignals {
  const v: ConsentSignalState = analyticsGranted ? 'granted' : 'denied';
  return {
    analytics_storage: v,
    ad_storage: v,
    ad_user_data: v,
    ad_personalization: v,
  };
}
