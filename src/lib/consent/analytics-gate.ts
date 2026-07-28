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

// Consent Mode v2 signal mapping — SPLIT across two categories (revision 5,
// 2026-07-27): the GA4 property was linked to a Google Ads account
// (8060256907) for remarketing/conversions, which is a purpose distinct from
// measurement. Per the Privacy Protection Law's purpose-limitation regime
// (s.8(b): database use limited to its declared purpose; s.2(9): passing on
// personal information for a purpose other than the one it was given for is
// an infringement) and the Privacy Protection Authority's consent position
// paper (§58: "consent for one purpose does not authorize another purpose"),
// consent granted for the disclosed `analytics` purpose ("measurement, to
// understand and improve site usage") cannot silently also authorize the
// undisclosed `marketing` purpose (building/exporting ad-targeting
// audiences to Google Ads). The two purposes now map to two independently
// opt-in categories:
//   - `analytics` -> analytics_storage only.
//   - `marketing` -> ad_storage + ad_user_data + ad_personalization only.
// CONSEQUENCE (documented per compliance review, not a bug): Google Signals
// (cross-device association + aggregate demographics) requires the ad
// signals per Google's own Consent Mode mechanics, so it now populates only
// for visitors who grant BOTH `analytics` AND `marketing` — an
// analytics-only grant no longer feeds Signals. Alternative considered and
// rejected: keep bundling the ad signals under `analytics` (status quo
// before this revision) to preserve full Signals coverage — rejected
// because it re-creates the exact §58 problem (measurement-purpose consent
// silently used for an advertising purpose) the moment the property is
// linked to Ads; the reduced Signals coverage among marketing-declining
// visitors is the accepted, disclosed cost of honest purpose separation.
export type ConsentSignalState = 'granted' | 'denied';

export interface ConsentSignals {
  analytics_storage: ConsentSignalState;
  ad_storage: ConsentSignalState;
  ad_user_data: ConsentSignalState;
  ad_personalization: ConsentSignalState;
}

export function consentSignals(
  analyticsGranted: boolean,
  marketingGranted: boolean,
): ConsentSignals {
  const analytics: ConsentSignalState = analyticsGranted ? 'granted' : 'denied';
  const marketing: ConsentSignalState = marketingGranted ? 'granted' : 'denied';
  return {
    analytics_storage: analytics,
    ad_storage: marketing,
    ad_user_data: marketing,
    ad_personalization: marketing,
  };
}
