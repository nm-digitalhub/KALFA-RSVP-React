# Cookie Consent — KALFA

## What & why

KALFA loads **zero non-essential trackers** — no Google Analytics, GTM, Meta
Pixel, Clarity, Hotjar, Sentry, chat widgets, or third-party embeds (verified by
codebase sweep, 2026-07-18). The only third-party client script is the SUMIT
payment library, loaded on the checkout page when the user initiates a payment.

Because there is nothing non-essential to gate, the implementation is an honest
**"essential cookies only" notice** — not an empty multi-category opt-in. It uses
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
| `src/app/(public)/cookies/page.tsx` | Cookie policy page (`/cookies`). |
| `src/app/(public)/page.tsx` | Footer legal links + "ניהול עוגיות" reopen button. |
| `src/app/(public)/privacy/page.tsx` | §10 links to `/cookies` + reopen button. |

## Consent categories

Today: **`necessary` only** (read-only, always on). It covers every cookie KALFA
sets — all strictly necessary:

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

`analytics` and `marketing` categories **do not exist yet** and are intentionally
not shown (no empty categories).

## How to add a new tracker (e.g. Google Analytics) later

1. In `cookie-consent-config.ts` add the category, e.g.:
   ```ts
   categories: {
     necessary: { enabled: true, readOnly: true },
     analytics: {
       autoClear: { cookies: [{ name: /^_ga/ }, { name: '_gid' }], reloadPage: true },
     },
   }
   ```
2. Add a preferences section with `linkedCategory: 'analytics'` (+ Hebrew copy).
3. Gate the tracker's `<Script>` so it only loads after consent — e.g. render it
   from a client component that checks `CookieConsent.acceptedCategory('analytics')`,
   and (re)acts on the config's `onChange` callback. Do **not** inject the script
   unconditionally.
4. Bump `CONSENT_REVISION` so returning users are re-prompted.
5. Update `/cookies` and `/privacy` to describe the new service.

## Reopening the preferences dialog

Call `CookieConsent.showPreferences()` — the `<ManageCookiesButton>` does this.
It is wired into the landing footer, `/privacy` §10, and `/cookies`.

## Bumping the policy revision

Increment `CONSENT_REVISION` in `cookie-consent-config.ts`. `vanilla-cookieconsent`
compares it to the stored value and re-shows the notice when it changes.

## Verifying that non-essential scripts are blocked

Today there are none, so this is trivially true. In DevTools → Network, before
accepting there must be no requests to analytics/marketing hosts; in Application →
Cookies there must be no `_ga`/`_fbp`/etc. When a gated tracker is added, confirm
its request/cookies appear only **after** consent and disappear (via `autoClear`)
on opt-out.

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
