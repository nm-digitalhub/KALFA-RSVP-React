# Sales-closing agent signup link — Meta template submission (2026-08-22)

`send_signup_link` tool (`src/app/api/voximplant/sls/tool/signup-link`) — the
WhatsApp leg for the sales-closing agent's real signup link, falling back to
SMS (`src/lib/callbacks/signup-link-sms.ts`) until this template is approved
and activated.

## Submission

- Endpoint: `POST /{waba_id}/message_templates` (Graph v23.0), language `he`.
- **Category `MARKETING`** (unavoidable — cold send to a non-customer, no
  existing 24h session; see `docs/voice-agent/plans/2026-08-22-sales-closing-agent-script-draft.md`
  §5), `allow_category_change=false` (explicit rejection over silent
  reclassification — same lesson as `kalfa_event_invite_v1`'s original
  reclassification, `docs/whatsapp-templates-meta-submission.md`).
- **BUTTONS:** exactly one `URL` button, dynamic, base
  `https://beta.kalfa.me/auth/signup?ref={{1}}`, text `להרשמה`. The `{{1}}`
  suffix is the `sales_call_attempts.id` (a plain UUID — not a credential,
  grants no access by itself) — used to correlate a later completed signup
  back to this call (owner decision 2026-08-22: "signup completed" for
  tracking means agreement signed + package chosen, not bare account
  creation; see `profiles.sales_referral_attempt_id` /
  `sales_call_attempts.signup_completed_at`).
- No RSVP quick-reply buttons — a URL button and RSVP buttons cannot coexist
  (`client.ts`'s own button-index guard).
- Body ({{1}} = prospect's first name, from `callback_requests.full_name`):

```
שלום {{1}}, כפי שסוכם איתך בשיחה — הנה הקישור להשלמת ההרשמה לקלפה. לחצו על הכפתור למטה כדי להמשיך.
```

No price/discount figures in the body — the actual price was already
disclosed on the call itself (script draft §1 step 5); the message only
carries the link, avoiding any drift between what was said and what is
written (script draft §5's own guidance).

## Submitted 2026-08-22 (WABA — see `app_settings.whatsapp_waba_id`)

| name | template id | status at submission | category |
|---|---|---|---|
| kalfa_sales_signup_link_v1 | 1773127337066249 | PENDING | MARKETING |

`message_templates` row seeded via `20260822144115_sales_signup_link_template.sql`,
`active=false` (fail-closed — `getTemplateByKey('sales_signup_link')` returns
`null` until flipped, so `send_signup_link` falls through to SMS regardless
of `whatsapp_consent` until this is both APPROVED and activated).

Check status: `GET /{waba_id}/message_templates?fields=name,status,category`
(or WhatsApp Manager).

## Activation checklist (after Meta approval)

1. Confirm `APPROVED` via the Graph API call above.
2. `message_templates.active = true` for `message_key='sales_signup_link'`
   (via `/admin/templates` or a small migration, matching the
   `event_day_pay` activation precedent).
3. No further code change needed — `send_signup_link` already reads the
   template live via `getTemplateByKey` on every call.
