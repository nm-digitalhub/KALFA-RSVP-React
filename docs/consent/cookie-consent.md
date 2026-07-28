# Cookie Consent — KALFA

## What & why

> **REVISION 2 (2026-07-27):** Google Analytics 4 was added as an OPT-IN
> `analytics` category — the "zero trackers" statement below describes revision
> 1 history. GA is rendered by
> `src/components/consent/google-analytics-gated.tsx` strictly AFTER the
> visitor grants the category (no Google request leaves the browser before
> consent), and is mounted only on the marketing route group
> `(public)/(site)` and the customer app layout — NEVER on the guest token
> surfaces (`/r` `/g` `/ty` `/join`), so guests are unmeasured and tokenized
> URLs cannot leak. Revoking wipes `_ga*` via `autoClear`; the measurement id
> comes from `NEXT_PUBLIC_GA_ID` (component renders nothing when unset).
> Invariants are unit-tested in `src/lib/consent/analytics-gate.test.ts`.

> **REVISION 3 (2026-07-27):** Google Signals enabled on the GA4 property —
> the analytics category now also covers cross-device association (signed-in
> Google users with ads personalization on) and aggregate demographics; banner
> + `/cookies` disclose it, with My Ad Center / My Activity opt-out links.

> **REVISION 4 (2026-07-27):** the compliance review surfaced that
> customer-area page addresses (page_location/page_path/page_referrer)
> already include internal UUIDs (`/app/events/<uuid>/...`), and the
> `purchase` event now carries a billing-model LABEL (`billing_model`:
> base_overage/per_reached — never an amount; renamed from payment_plan
> before any data was collected — the values describe the billing model,
> not an installment plan). Both are disclosed in the
> banner text, `/cookies` §5 and `/privacy` §2. Explicit UUID event params
> (`event_id`/`campaign_id`) were implemented, then **HELD before deploy** on
> necessity grounds (owner minimization directive, 27.7 afternoon): they are
> not custom dimensions and no BigQuery export exists, so nothing consumes
> them — the validated carry mechanism stays dormant in
> `ga-event-contracts.ts` pending the legal decision (attorney questions
> 20–24). `event_type` is deliberately NOT sent — combined with identifiers
> it would constitute special-category (religious) data under s. 3 of the
> Privacy Protection Law. URL normalization (UUID → placeholder before
> send) is IMPLEMENTED per `plans/ga4-url-normalization.md`: gtag.js is
> loaded directly with `send_page_view:false` and `PageViewTracker` sends
> every page_view with normalized page_location/page_path/page_referrer
> (`normalize-path.ts`); after each deploy of this change the stream's
> "page changes based on browser history events" toggle must be OFF
> (Admin API `updateEnhancedMeasurementSettings.pageChangesEnabled`) to
> prevent double counting.

> **REVISION 5 (2026-07-27):** the owner linked a Google Ads account
> (8060256907) to this GA4 property (beta stream `15330155015`), intending
> to run remarketing + ads conversions. This is a purpose distinct from
> measurement, so per the Privacy Protection Law's purpose-limitation regime
> (s.8(b): database use limited to its declared purpose; s.2(9): passing on
> personal information for a purpose other than the one it was given is an
> infringement) and the Privacy Protection Authority's consent position
> paper (§58: consent for one purpose does not authorize another), a NEW
> **`marketing`** category was added — opt-in, off by default, and toggled
> **independently** of `analytics`. Consent Mode v2's ad signals
> (`ad_storage`/`ad_user_data`/`ad_personalization`) moved OFF `analytics`
> and onto `marketing` exclusively; `analytics_storage` stays under
> `analytics` alone. See `src/lib/consent/analytics-gate.ts` for the exact
> mapping.
>
> **Consequence, documented not accidental:** Google Signals (cross-device
> association + aggregate demographics) requires the ad signals per Google's
> own Consent Mode mechanics, so it now populates only for visitors who
> grant **both** `analytics` and `marketing` — an analytics-only grant no
> longer feeds Signals (previously, under revision 3/4, analytics alone
> granted all four signals). Alternative considered and rejected: keep
> bundling the ad signals under `analytics` to preserve full Signals
> coverage — rejected because it re-creates the exact §58 problem the
> moment the property is linked to Ads (measurement-purpose consent
> silently reused for an advertising purpose); the reduced Signals coverage
> is the accepted, disclosed cost of honest purpose separation.
>
> **Ships DARK:** the category exists in code and policy (`/cookies` §6,
> `/privacy` §2/§5/§10) but the owner has not yet enabled
> remarketing/audiences in GA4 or built any Ads campaign asset that consumes
> them — granting the category today pushes a Consent Mode signal that
> nothing on the Google side currently reads. Enabling remarketing in
> GA4/Ads is a separate, owner-only step, out of scope for this change.
>
> **UPD ("User-provided data" / hashed email) — explicitly NOT built here,
> recommendation only:** a prior investigation (same day) found the toggle,
> if left on with consent granted, causes every hit to carry `em=<hash>` —
> undisclosed today. In an Ads-linked property this is materially riskier
> than plain measurement: a hashed email can be used by Google Ads for
> Customer Match–style identity matching, not just aggregate demographics.
> Recommendation: leave the toggle OFF; if ever enabled, gate it behind
> `marketing` specifically (not `analytics`, since its purpose is
> ad-matching), disclose it by name in policy, and route through
> israeli-compliance-advisor first — this mirrors the still-open BigQuery
> transfer-adequacy question (attorney questions 20–21) since Google Ads
> infrastructure is also abroad. No code path for UPD was added in this
> revision.

As of revision 1 (2026-07-18), KALFA loaded **zero non-essential trackers** — no
Google Analytics, GTM, Meta Pixel, Clarity, Hotjar, Sentry, chat widgets, or
third-party embeds (verified by codebase sweep). The only third-party client
script was the SUMIT payment library, loaded on the checkout page when the user
initiates a payment.

The implementation uses
[`vanilla-cookieconsent`](https://cookieconsent.orestbida.com) so we get a
professional, accessible, versioned notice with a preference dialog, while keeping
consent **local-only** (a first-party cookie) with no backend or paid service.

### Package chosen

`vanilla-cookieconsent@3.1.0` — MIT, zero dependencies, 100% client-side/local by
design. Themed to KALFA's design tokens via CSS variables (no foreign look).

Rejected alternatives:

- **@c15t/nextjs** — most React-native, but its maintainers state offline/local
  mode is "dev/simple only"; production wants the hosted consent.io service or a
  self-hosted `@c15t/backend`. Conflicts with our local-only / no-external-service
  requirement.
- **react-cookie-consent** — no category management / granular preferences.
- **SaaS (Cookiebot, CookieYes, Osano)** — paid account + a third-party script +
  external dependency.
- **In-house component** — considered, but a maintained professional package was
  preferred.

There is **no Supabase-native cookie-consent mechanism** (verified against Supabase
docs — the only "consent" there is the Google OAuth consent screen).

## Files

| File | Role |
|---|---|
| `src/lib/consent/cookie-consent-config.ts` | Central config + `CONSENT_REVISION`. The one file to edit to add a category/service. |
| `src/components/consent/cookie-consent.tsx` | `'use client'` initialiser (`CookieConsent.run`). Renders `null`. Mounted in the root layout. |
| `src/components/consent/manage-cookies-button.tsx` | `'use client'` button → `CookieConsent.showPreferences()`. |
| `src/app/layout.tsx` | Imports `cookieconsent.css` (before `globals.css`) + mounts `<CookieConsentBanner />`. |
| `src/app/globals.css` | `#cc-main { … }` block mapping the plugin's `--cc-*` vars to KALFA tokens. |
| `src/app/(public)/(site)/cookies/page.tsx` | Cookie policy page (`/cookies`). |
| `src/app/(public)/(site)/page.tsx` | Footer legal links + "ניהול עוגיות" reopen button. |
| `src/app/(public)/(site)/privacy/page.tsx` | §10 links to `/cookies` + reopen button. |

## Consent categories

As of **revision 5** (2026-07-27), there are three categories:

| Category | Default | Purpose | Consent Mode v2 signals it controls |
|---|---|---|---|
| `necessary` | always on, read-only | Every cookie KALFA itself sets (below) | — |
| `analytics` | off, opt-in | GA4 measurement (`google-analytics-gated.tsx`) | `analytics_storage` |
| `marketing` | off, opt-in, **independent** of `analytics` | Google Ads remarketing/conversions (property linked to Ads account 8060256907) | `ad_storage`, `ad_user_data`, `ad_personalization` |

`necessary` covers:

| Cookie / storage | Purpose | Type |
|---|---|---|
| `sb-<ref>-auth-token[.0/.1]` | Supabase auth session + refresh token | Cookie (HttpOnly) |
| `active_org` | Active organization (multi-tenant scoping) | Cookie (HttpOnly) |
| `sidebar_state` | Sidebar open/collapsed UI state (post-login) | Cookie |
| `kalfa-skew-reload-at` | One-time reload guard on stale deploys | sessionStorage |
| `kalfa_cookie_consent` | Stores the consent choice itself | Cookie |

SUMIT (payment) is a **script** loaded only at checkout, user-initiated — described
in the policy. Its cookies are not yet inventoried (open item — needs DevTools on
an authenticated payment page). Web Push is a ServiceWorker subscription with its
own explicit toggle, not a consent-cookie.

Google Signals (cross-device + demographics) needs **both** `analytics` and
`marketing` granted — see the REVISION 5 note above and
`src/lib/consent/analytics-gate.ts` for why the ad signals live under
`marketing` rather than `analytics`.

## How to add a new tracker / category later

1. In `cookie-consent-config.ts` add the category, e.g.:
   ```ts
   categories: {
     necessary: { enabled: true, readOnly: true },
     analytics: { enabled: false, autoClear: { cookies: [{ name: /^_ga/ }] } },
     marketing: { enabled: false, autoClear: { cookies: [{ name: /^_gcl/ }, { name: /^_gac/ }] } },
     newCategory: {
       enabled: false,
       autoClear: { cookies: [{ name: /^_new/ }], reloadPage: true },
     },
   }
   ```
2. Add a preferences section with `linkedCategory: 'newCategory'` (+ Hebrew copy).
3. Gate the tracker's `<Script>` (or the signals it sends) so it only activates after
   consent — e.g. render/push from a client component that checks
   `CookieConsent.acceptedCategory('newCategory')`, and (re)acts on `cc:onConsent`/
   `cc:onChange`. Do **not** activate anything unconditionally. If the new purpose is
   distinct from an existing purpose already covered by consent (e.g. measurement vs.
   advertising), it needs its **own** category — reusing an existing grant for a new
   purpose is the exact problem revision 5 fixed (see REVISION 5 note, Privacy
   Protection Law purpose-limitation).
4. Bump `CONSENT_REVISION` so returning users are re-prompted.
5. Update `/cookies` and `/privacy` to describe the new service.

## Reopening the preferences dialog

Call `CookieConsent.showPreferences()` — the `<ManageCookiesButton>` does this.
It is wired into the landing footer, `/privacy` §10, and `/cookies`.

## Bumping the policy revision

Increment `CONSENT_REVISION` in `cookie-consent-config.ts`. `vanilla-cookieconsent`
compares it to the stored value and re-shows the notice when it changes.

## Verifying that non-essential scripts are blocked

In DevTools → Network, before accepting anything there must be zero requests to
`googletagmanager.com`/`google-analytics.com`/Ads hosts; in Application → Cookies
there must be no `_ga*`/`_gcl*`/`_gac*`. Confirm each category independently:
accepting only `analytics` must load the GA4 tag and set `_ga*`, with the ad
signals (`ad_storage` etc.) still `denied`; accepting only `marketing` must load
nothing (the tag itself stays gated on `analytics`); accepting both must set both
cookie families and push all four Consent Mode signals as `granted`. Revoking a
category must wipe that category's cookies via `autoClear` without touching the
other category's.

## Notes / limitations

- Consent is stored **locally only** (`kalfa_cookie_consent` cookie), never in
  Supabase. There is no product requirement to persist consent server-side.
- `secure` is set to `NODE_ENV === 'production'` so the cookie isn't dropped on
  `http://localhost` in dev.
- CSP: the strict `default-src 'self'; script-src 'self'` policy applies **only to
  `/sw.js`** (`next.config.ts`), not globally, so it does not affect the notice.
- The legal pages (`/privacy`, `/terms`, `/cookies`) are marked DRAFT pending
  lawyer review. This is a technical implementation, not legal advice.
- SUMIT cookies at checkout are an open inventory item (see above).
