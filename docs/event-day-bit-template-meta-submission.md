# Event-day reminder + Bit — Meta template submission (Workstream B)

9 WhatsApp templates (one per event type). message_key `event_day_pay`; the DB row
is seeded `active=false` (migration `20260712124239`) → the send path is INERT until
these are approved and an admin sets `active=true` + fills the approved `name`.

## Submission parameters (all 9)
- Endpoint: `POST /{waba_id}/message_templates` (Graph v23.0), language `he`.
- **Category `UTILITY`, `allow_category_change=false`** (true silently reclassified a
  UTILITY invite to MARKETING before — see docs/whatsapp-templates-meta-submission.md).
- **No emoji** (button error 2388060). Positional contract is FIXED once approved:
  `{{1}}` = time (HH:mm), `{{2}}` = venue.
- **BUTTONS:** exactly ONE `URL` button, dynamic, base `https://beta.kalfa.me/g/{{1}}`,
  text `לתשלום בביט`. NO RSVP quick-reply buttons (a URL button and RSVP buttons cannot
  coexist — client.ts:131-137; recipients already confirmed, so none are needed).
- The button variable at send time is `events.gift_link_token` (reused from gift);
  `/g/[token]` 302-redirects to `events.gift_payment_url` (the owner's Bit link).

Shared payment line (in every body):
`לנוחותכם, ניתן להעניק מתנה בקלות ובבטחה דרך ביט — לחצו על הכפתור שמופיע למטה.`

## The 9 bodies

**wedding — `kalfa_wedding_dayofpay_v1`**
```
חברים ומשפחה יקרים,
היום מתקיימת החתונה שלנו! נשמח לראותכם היום בשעה {{1}}, ב{{2}}.
לנוחותכם, ניתן להעניק מתנה בקלות ובבטחה דרך ביט — לחצו על הכפתור שמופיע למטה.
נתראה בשמחה.
```

**brit — `kalfa_brit_dayofpay_v1`**
```
חברים ומשפחה יקרים,
היום נחגוג יחד את שמחת הברית! נשמח לראותכם היום בשעה {{1}}, ב{{2}}.
לנוחותכם, ניתן להעניק מתנה בקלות ובבטחה דרך ביט — לחצו על הכפתור שמופיע למטה.
נתראה בשמחה.
```

**bar_mitzvah — `kalfa_barmitzvah_dayofpay_v1`**
```
חברים ומשפחה יקרים,
היום נחגוג יחד את שמחת בר המצווה! נשמח לראותכם היום בשעה {{1}}, ב{{2}}.
לנוחותכם, ניתן להעניק מתנה בקלות ובבטחה דרך ביט — לחצו על הכפתור שמופיע למטה.
נתראה בשמחה.
```

**bat_mitzvah — `kalfa_batmitzvah_dayofpay_v1`**
```
חברים ומשפחה יקרים,
היום נחגוג יחד את שמחת בת המצווה! נשמח לראותכם היום בשעה {{1}}, ב{{2}}.
לנוחותכם, ניתן להעניק מתנה בקלות ובבטחה דרך ביט — לחצו על הכפתור שמופיע למטה.
נתראה בשמחה.
```

**britah — `kalfa_britah_dayofpay_v1`**
```
חברים ומשפחה יקרים,
היום נחגוג יחד את שמחת הבריתה! נשמח לראותכם היום בשעה {{1}}, ב{{2}}.
לנוחותכם, ניתן להעניק מתנה בקלות ובבטחה דרך ביט — לחצו על הכפתור שמופיע למטה.
נתראה בשמחה.
```

**henna — `kalfa_henna_dayofpay_v1`**
```
חברים ומשפחה יקרים,
היום מתקיימת חגיגת החינה! נשמח לראותכם היום בשעה {{1}}, ב{{2}}.
לנוחותכם, ניתן להעניק מתנה בקלות ובבטחה דרך ביט — לחצו על הכפתור שמופיע למטה.
נתראה בשמחה.
```

**engagement — `kalfa_engagement_dayofpay_v1`**
```
חברים ומשפחה יקרים,
היום נחגוג יחד את שמחת האירוסין! נשמח לראותכם היום בשעה {{1}}, ב{{2}}.
לנוחותכם, ניתן להעניק מתנה בקלות ובבטחה דרך ביט — לחצו על הכפתור שמופיע למטה.
נתראה בשמחה.
```

**birthday — `kalfa_birthday_dayofpay_v1`**
```
חברים ומשפחה יקרים,
היום נחגוג יחד את יום ההולדת! נשמח לראותכם היום בשעה {{1}}, ב{{2}}.
לנוחותכם, ניתן להעניק מתנה בקלות ובבטחה דרך ביט — לחצו על הכפתור שמופיע למטה.
נתראה בשמחה.
```

**other (also the seed row's default name) — `kalfa_event_dayofpay_v1`**
```
חברים ומשפחה יקרים,
האירוע מתקיים היום! נשמח לראותכם היום בשעה {{1}}, ב{{2}}.
לנוחותכם, ניתן להעניק מתנה בקלות ובבטחה דרך ביט — לחצו על הכפתור שמופיע למטה.
נתראה בשמחה.
```

## Submitted to Meta — 2026-07-12 (WABA 990921550130385, all PENDING · UTILITY)

| name | template id |
|---|---|
| kalfa_wedding_dayofpay_v1 | 1601239905336308 |
| kalfa_brit_dayofpay_v1 | 1566404584891508 |
| kalfa_barmitzvah_dayofpay_v1 | 930403040077032 |
| kalfa_batmitzvah_dayofpay_v1 | 2066758947251327 |
| kalfa_britah_dayofpay_v1 | 1746870549821817 |
| kalfa_henna_dayofpay_v1 | 1050650754146004 |
| kalfa_engagement_dayofpay_v1 | 849507708242867 |
| kalfa_birthday_dayofpay_v1 | 1975369893183633 |
| kalfa_event_dayofpay_v1 | 1939031920095112 |

## Activation checklist (after Meta approval)
1. Confirm each template `APPROVED` (`GET /{waba_id}/message_templates?fields=name,status,category`).
2. `message_templates.active = true` for `event_day_pay` (the seed name + the per-type `components.variants` already point at the 9 names).
3. Owner sets `events.gift_payment_url` (the Bit link) per event.
4. Trigger `sendEventDayReminderAction` (manual, non-billable) — sends ONLY to `guests.status='attending'`, on the event day.
