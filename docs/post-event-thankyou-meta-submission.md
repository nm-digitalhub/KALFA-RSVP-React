# Post-event thank-you — Meta template submission (Feature 2)

9 WhatsApp templates (one per event type). message_key `thankyou`; the DB row is
seeded `active=false` (migration `20260712174206`) → the send path is INERT until
these are approved and an admin sets `active=true` + fills the approved `name`.

## Submission parameters (all 9)
- Endpoint: `POST /{waba_id}/message_templates` (Graph v23.0), language `he`.
- **Category `UTILITY`, `allow_category_change=false`** (same posture as the
  event-day templates — see docs/event-day-bit-template-meta-submission.md).
- **No emoji** (button error 2388060). Positional contract is FIXED once approved:
  `{{1}}` = event-type label (e.g. "חתונה"), `{{2}}` = celebrant names text.
- **BUTTONS: NONE.** Pure gratitude, no CTA — nothing to click through to
  post-event.
- No URL button variable, no header image variant.

## The 9 bodies

**wedding — `kalfa_wedding_thankyou_v1`**
```
חברים ומשפחה יקרים,
מעומק הלב — תודה שבאתם לחגוג איתנו את ה{{1}} של {{2}}.
הנוכחות שלכם עשתה את היום למושלם.
```

**brit — `kalfa_brit_thankyou_v1`**
```
חברים ומשפחה יקרים,
מעומק הלב — תודה שבאתם לחגוג איתנו את ה{{1}} של {{2}}.
הנוכחות שלכם עשתה את היום למושלם.
```

**bar_mitzvah — `kalfa_barmitzvah_thankyou_v1`**
```
חברים ומשפחה יקרים,
מעומק הלב — תודה שבאתם לחגוג איתנו את ה{{1}} של {{2}}.
הנוכחות שלכם עשתה את היום למושלם.
```

**bat_mitzvah — `kalfa_batmitzvah_thankyou_v1`**
```
חברים ומשפחה יקרים,
מעומק הלב — תודה שבאתם לחגוג איתנו את ה{{1}} של {{2}}.
הנוכחות שלכם עשתה את היום למושלם.
```

**britah — `kalfa_britah_thankyou_v1`**
```
חברים ומשפחה יקרים,
מעומק הלב — תודה שבאתם לחגוג איתנו את ה{{1}} של {{2}}.
הנוכחות שלכם עשתה את היום למושלם.
```

**henna — `kalfa_henna_thankyou_v1`**
```
חברים ומשפחה יקרים,
מעומק הלב — תודה שבאתם לחגוג איתנו את ה{{1}} של {{2}}.
הנוכחות שלכם עשתה את היום למושלם.
```

**engagement — `kalfa_engagement_thankyou_v1`**
```
חברים ומשפחה יקרים,
מעומק הלב — תודה שבאתם לחגוג איתנו את ה{{1}} של {{2}}.
הנוכחות שלכם עשתה את היום למושלם.
```

**birthday — `kalfa_birthday_thankyou_v1`**
```
חברים ומשפחה יקרים,
מעומק הלב — תודה שבאתם לחגוג איתנו את ה{{1}} של {{2}}.
הנוכחות שלכם עשתה את היום למושלם.
```

**other (also the seed row's default name) — `kalfa_event_thankyou_v1`**
```
חברים ומשפחה יקרים,
מעומק הלב — תודה שבאתם לחגוג איתנו את ה{{1}} של {{2}}.
הנוכחות שלכם עשתה את היום למושלם.
```

## Activation checklist (after Meta approval)
1. Confirm each template `APPROVED` (`GET /{waba_id}/message_templates?fields=name,status,category`).
2. `message_templates.active = true` for `thankyou` (the seed name + the per-type
   `components.variants` already point at the 9 names).
3. Trigger `sendThankyouAction` (manual, non-billable) — the ONLY message_key the
   L1 past-event gate (`outreach.ts`) lets through after the event day
   (`POST_EVENT_MESSAGE_KEYS` in `template-spec.ts`); runs through the
   authenticated app only, never headless.

## Not yet submitted
Templates are NOT yet submitted to Meta — this document defines the 9 bodies for
a future, separately-approved submission step. `active` stays `false` until then.
