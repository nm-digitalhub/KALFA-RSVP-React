# Tasks

## 1. Database

- [ ] 1.1 `npx supabase migration new marketing_email_sends`: table per design D3 (no CHECKs on `template`/`status` — validated in code; the two partial unique indexes; index on `(status, created_at)`), RLS on with no policy, revoke all from anon/authenticated/service_role then grant service_role select/insert/update; `app_settings.marketing_emails_enabled boolean not null default false`; drop `marketing_consent_events_source_check` (allowed sources stay in `ConsentSource`; add `email_unsubscribe` there); header with why/rollback. Verify: `db push --dry-run` lists only this file.
- [ ] 1.2 With approval: push, `gen:types`, `types:check`. Verify live: grants as designed; an aborted block as `authenticated` cannot insert or read.

## 2. Sending primitives

- [ ] 2.1 `EmailSender.send` accepts optional `headers` (Resend path passes them through; IONOS/SMTP path too if it exists). Verify: sender tests show headers forwarded and existing callers unchanged.
- [ ] 2.2 Pure `isMarketingSendAllowed(ms)` (design D7) on top of `DEFAULT_SEND_POLICY` + `buildJewishCalendar` + hebcal Yom HaZikaron/Yom HaShoah/Tisha B'Av. Verify: tests pin Sun 10:00 allowed, Fri 12:30 blocked, Sat 15:00 blocked, Motzash+30m blocked, 2027-05-10 blocked, 2027-08-11 blocked, Erev Yom Kippur evening blocked.
- [ ] 2.3 Unsubscribe token sign/verify with key ids (design D4) from `MARKETING_UNSUBSCRIBE_KEYS`, added to `env-validation.ts`. Verify: tests for round-trip, a token signed by a retired key still verifies, tampered user id, tampered signature, unknown kid, missing keys (throws at sign, rejects at verify).

## 3. Templates

- [ ] 3.1 `src/lib/email/marketing-templates.ts`: welcome, setup_reminder (event name + current step label), how_it_works, per the approved canvas; shared footer from company details; subject helper adds "פרסומת | "; plain-text alternative; `version` per template. Verify: tests that every template's subject and body start with "פרסומת", the footer has name/address/phone/email and the unsubscribe URL, `lang`/`dir` on html and body, and missing company details throw.
- [ ] 3.2 Render each template to HTML files in the scratchpad and compare with the canvas. Verify: the owner sees the three rendered emails (sent to the owner's address through 6.0).

## 4. Unsubscribe surface

- [ ] 4.1 `POST /api/marketing/unsubscribe` (RFC 8058 one-click and the page's confirm): verify token, rate-limit, `recordConsent` withdraw `email_unsubscribe`, enqueue sync, generic 200 for any token. Verify: route tests for one-click, forged token, repeated unsubscribe, no-consent customer, rate limit.
- [ ] 4.2 `/unsubscribe?t=` page: confirm button that POSTs; GET never withdraws; an unverifiable token shows how to unsubscribe anyway (settings, reply) and never says "removed"; Hebrew RTL, accessible. Verify: page tests for GET writing nothing and for the invalid-token message.
- [ ] 4.3 Security review of 4.1–4.2 by the `public-rsvp-sentinel` agent (public token surface). Verify: its findings resolved or recorded.

## 5. The sweep

- [ ] 5.1 `src/lib/data/marketing-email-sweep.ts` per design D6: switch, window, due selection per template, re-check gates, claim, render, send with headers and idempotency key, mark sent/failed. Verify: tests for each template's rule, a withdrawn customer skipped, an unconfirmed address skipped, a concurrent claim (23505) skipped, a send failure marked failed and alerted, guests never read.
- [ ] 5.2 Queue `marketing-email-sweep` (singleton), worker registration every 15 min, staleness entry. Verify: `queue-schedule.test.ts`, `worker:build`, `worker:deps` pass.

## 6. Owner test send

- [ ] 6.0 Admin-only test action: requires a platform permission, sends one chosen template only to the caller's own confirmed address (real one-click headers, a token for the caller), writes no send-ledger row. Verify: action tests for permission refused, address fixed to the caller, no ledger write.

## 7. Release

- [ ] 7.1 `npm run lint`, `npx tsc --noEmit`, `npm run build`, full test suite. Verify: all green.
- [ ] 7.2 Owner release gates: keys set, migration pushed, deploy; the company address corrected in settings; each template sent to the owner's address through 6.0; in a test email's raw source the DKIM `h=` list covers `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 8058); one-click unsubscribe works (then re-granted); **the owner decides on the §17ו database registration number (add it to the footer, or record why none is needed) before sending**; the owner turns `marketing_emails_enabled` on. Verify: each gate recorded here.

## Workflow follow-up

- Archive `marketing-email-consent` and this change after release.
