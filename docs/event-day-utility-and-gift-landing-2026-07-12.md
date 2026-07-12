# Event-day reminder → UTILITY + dynamic gift landing page (2026-07-12)

Outcome record for the event-day reminder + gift-link work. Complements
`docs/event-day-bit-template-meta-submission.md` (the original MARKETING bodies).

## Problem discovered

The 9 event-day templates first shipped as **MARKETING** (Meta reclassified them
despite `allow_category_change:false`, because the body solicited a Bit gift).
MARKETING templates are silently dropped by Meta error **131049** ("to maintain
healthy ecosystem engagement") for recipients without an active 24h session —
i.e. most guests at a real event. Proven live: a MARKETING brit reminder to a
test recipient failed 131049 with no open session, then delivered once a session
was opened.

## A/B decision → UTILITY

Two brit wordings were submitted with `allow_category_change:true` to observe
Meta's classification:
- **A** (gift-visible body, "מתנה … דרך ביט") → approved **MARKETING**.
- **B** (gift-free reminder — "תזכורת: אישרת הגעה ל… בשעה {{1}}, בכתובת {{2}}." +
  neutral button "לפרטי האירוע") → approved **UTILITY**.

Rule confirmed: a voluntary gift request is MARKETING by definition; only a pure
attendance/logistics reminder reads as UTILITY. UTILITY is not subject to the
131049 marketing cap, so it delivers reliably to guests with no open session.

**Adopted nusach B for all 9 event types** (`kalfa_<type>_dayofpay_util_v1`),
all approved UTILITY. `message_templates` (message_key `event_day_pay`)
`components.variants` + default `name` were repointed to the `_util_v1` names;
`param_contract` (2-tuple time/venue) and `active=true` unchanged.

## Gift lands on a dynamic page, not straight to Bit

`/g/[token]` was a bare 302 to `gift_payment_url`. It is now an event-type-adaptive
landing page; the redirect moved to `/g/[token]/go`.

- `src/lib/data/gift.ts` `getGiftByToken` — fail-closed (active + https); NEVER
  returns `gift_payment_url` (only a derived `giftProvider` tag).
- `src/lib/data/event-theme.ts` — per-type accent/banner/greeting (static Tailwind).
- `src/lib/data/event-display.ts` — shared `formatEventDateLine`/`asEventType`/
  `GIFT_BRAND` (extracted from `rsvp-form.tsx` to avoid duplication).
- `g/[token]/page.tsx` + `gift-landing.tsx` — server-rendered adaptive page
  (invite hero, per-type icon/heading/color, date, venue, Waze, gift CTA → `/go`).
- `g/[token]/go/route.ts` — the redirect (token guard + status=active + https).
- `next.config.ts` — `/g/:token*` no-store / no-referrer / noindex (mirrors `/r`).

Security invariants preserved: 32-hex token guard, rate limit, generic error for
all failures, `gift_payment_url` server-only, https re-check in `/go`.

Commit: **c77f918** (branch main); deployed to beta; browser-verified mobile+desktop.

## Production send (brit, Natalie Kalfa)

Triggered via the campaign UI button "תזכורת יום האירוע + תשלום"
(`sendEventDayReminderAction` → `sendCampaignWhatsApp(campaignId,'event_day_pay')`).
Targeting = `listSendableContacts` (consent ∩ authorized set) ∩ `guests.status='attending'`.
Result: 23 recipients, **22 delivered/read**, 1 failed **131026** (recipient not on
WhatsApp — ברוריה), all `billable=false`. Zero 131049 (UTILITY worked).

## Gotcha: no headless invocation

`sendCampaignWhatsApp` cannot be run in a standalone bundle — its `logActivity`
sub-call invokes `requireUser()` (`@/lib/supabase/server` → `cookies()`), which
needs an authenticated request. Real event-day/gift sends must go through the
authenticated app (the campaign button), not a script.

## Open / not done

- 9 old MARKETING templates (`kalfa_*_dayofpay_v1`) still exist at Meta but are no
  longer referenced by variants — can be deleted later (4-week name category lock).
- Owner still sets `events.gift_payment_url` (the Bit link) per event.
