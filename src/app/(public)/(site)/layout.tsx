import { GoogleAnalyticsGated } from '@/components/consent/google-analytics-gated';
import { CallMeNowWidgetLazy } from '@/components/site/call-me-now-widget-lazy';
import { getCookieConsentPublicConfig } from '@/lib/consent/admin-config';
import { getCallMeNowWidgetEnabled } from '@/lib/data/call-me-now-public-config';

// URL-neutral route group for the public MARKETING pages (home, contact,
// legal). Exists so consent-gated analytics can mount here without ever
// reaching the sibling guest token surfaces (/r /g /ty /join) — guests are
// deliberately not measured and their token URLs must not leak to a third
// party (see google-analytics-gated.tsx).
//
// A floating "call me now" widget (src/components/site/call-me-now-widget-lazy.tsx
// -> call-me-now-widget.tsx — call-center research, 12.8, capability A,
// THIRD design) is built and verified, but deliberately NOT mounted here
// yet. This is the design that REPLACED the earlier WebRTC browser widget
// (call-widget-lazy.tsx/call-widget.tsx, left in place as dead code pending
// an explicit cleanup decision — see console-calls.ts's
// evaluateWidgetCallCaps header for why that design was accepted as
// blocked: an unauthenticated endpoint minting telephony credentials is a
// real attack surface even on a shared identity). This design has NO
// browser Voximplant identity at all: the visitor proves control of their
// own phone via SMS OTP (otp.ts, reused unchanged from agreement-signing),
// then the SERVER places a real outbound PSTN call via StartScenarios —
// the same Management-API primitive already proven in production by the
// outbound AI-call campaign — and bridges it to a console agent. See
// console-calls.ts's evaluateCallMeNowCaps header for the full research
// trail and cost math.
//
// It is now mounted, but CONFIG-GATED rather than unconditionally (13.8, once
// the chain became real: scenario ConsoleCallMeNow #919514 deployed and
// verified byte-identical, routing rule 1523124 `cn[0-9a-f]+` created and
// ordered ahead of the two `.*` rules). getCallMeNowWidgetEnabled requires
// BOTH the flag AND a bound numeric rule id, so the earlier objection to
// mounting — "every visitor sees a phone/OTP form that always refuses once
// submitted" — cannot happen: with either piece of config missing the widget
// simply is not rendered. That also means enabling the feature is a pure
// config change with no redeploy, and disabling it again is the same.
export default async function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Deduped against the same call in the root layout via React `cache()`
  // (src/lib/consent/admin-config.ts) — not a second DB round trip.
  // The call-me-now read has its own TTL+request cache for the same reason
  // (see call-me-now-public-config.ts); parallel so the marketing page never
  // serializes two independent settings reads.
  const [cookieConsentAdminConfig, callMeNowEnabled] = await Promise.all([
    getCookieConsentPublicConfig(),
    getCallMeNowWidgetEnabled(),
  ]);
  return (
    <>
      {children}
      <GoogleAnalyticsGated mechanismEnabled={cookieConsentAdminConfig.enabled} />
      {callMeNowEnabled ? <CallMeNowWidgetLazy /> : null}
    </>
  );
}
